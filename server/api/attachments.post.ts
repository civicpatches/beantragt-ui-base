/**
 * POST /api/attachments
 *
 * Same-origin upload proxy for public application attachments. Files are
 * forwarded to Drupal's native v1 attachment endpoint and returned as
 * claimable attachment UUIDs. If the form field opts into attachment
 * analysis, this request runs the policy-gated check against the stored form
 * profile and returns only the sanitized result for citizen feedback.
 *
 * Story A never holds up the form: the citizen waits at most
 * UPLOAD_ANALYSIS_BUDGET_MS for it. A run that takes longer keeps going on
 * the server, stores its result through Drupal's update route and the upload
 * answers with analysis 'pending'; the form then polls
 * GET /api/attachments/:id/analysis. A sovereign or local PDF reaches the
 * model only as pages Drupal rendered (never the raw file).
 */
import type { H3Event } from 'h3';
import { requireSameOriginRequest, setPrivateNoStore } from '../utils/request-security';
import { serviceProxyHeaders } from '../utils/public-status-proxy';
import { isDrupalSessionCookie } from '../utils/session';
import {
    citizenAttachmentAnalysisCode,
    citizenAttachmentAnalysisResult,
    normalizeAttachmentAnalysisMediaType,
    resolveAttachmentAnalysisDispatchPolicy
} from '../utils/attachment-analysis-contract';
import { citizenPrecheckRequiresRedaction, areVerifiedRedactedPages, citizenSourceFailure, isSourceFailure, unverifiedSourceReason, type SourceFailureCode } from '../utils/attachment-analysis-source';
import { failAttachmentAnalysisRun, recordAttachmentSourceFailure } from '../utils/attachment-analysis-persistence';
import { hasAttachmentAnalysisDisclosureProvider } from '../utils/attachment-analysis-disclosure';
import { IntelligenceServiceRequestError } from '../utils/intelligence-service';
import { CitizenAnalysisSourceError, requestCitizenAnalysisPages } from '../utils/attachment-citizen-analysis';
import {
    requestIntelligenceAttachmentAnalysis,
    type IntelligenceAttachmentAnalysisResult
} from '../utils/intelligence-attachment-analysis-client';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ANALYSIS_RUN_ID_PATTERN = /^[a-f0-9]{32}$/;
/** Longest the citizen waits for the upload and story A once the file is in. */
const UPLOAD_ANALYSIS_BUDGET_MS = 25_000;
const BUDGET_SPENT = Symbol('upload-analysis-budget-spent');
/** Policies whose PDFs leave Drupal only as rendered pages. */
const PAGE_SOURCE_EGRESS_POLICIES: ReadonlySet<string> = new Set(['sovereign_only', 'local_only']);
const STAFF_UPLOAD_ROLES = new Set(['administrator', 'department_admin', 'case_worker', 'service_account', 'nuxt_service']);

type MultipartParts = Awaited<ReturnType<typeof readMultipartFormData>>;

interface AttachmentSessionUser {
    uid?: number
    uuid?: string
    roles?: unknown
}

interface AttachmentCreatedPayload {
    data: {
        id: string
        claimToken: string
        mimeType?: unknown
        /** Run id of story A, minted by Drupal for this upload only. */
        analysisRunId?: unknown
        analysisStory?: unknown
        [key: string]: unknown
    }
    [key: string]: unknown
}

type AttachmentAnalysisLanguage = 'de' | 'en';

function firstMultipartString(parts: MultipartParts, name: string): string {
    const part = parts?.find(item => item.name === name);
    if (!part?.data) return '';
    return part.data.toString('utf8').trim();
}

function attachmentAnalysisLanguage(parts: MultipartParts): AttachmentAnalysisLanguage {
    const language = firstMultipartString(parts, 'language').toLowerCase();
    if (!language) return 'de';
    if (language === 'de' || language === 'en') return language;
    throw createSafeError({
        statusCode: 400,
        message: 'errors.attachments.invalidRequest',
        data: { code: 'errors.attachments.invalidRequest', field: 'language' }
    });
}

function mapAttachmentErrorCode(code: unknown): string {
    switch (code) {
        case 'attachment.file_too_large':
            return 'errors.attachments.fileTooLarge';
        case 'attachment.total_size_exceeded':
            return 'errors.attachments.totalSizeExceeded';
        case 'attachment.tenant_storage_quota_exceeded':
            return 'errors.attachments.tenantStorageQuotaExceeded';
        case 'attachment.unsupported_file_type':
        case 'attachment.mime_mismatch':
            return 'errors.attachments.unsupportedType';
        case 'attachment.quarantined':
            return 'errors.attachments.quarantined';
        case 'form.not_found':
            return 'errors.submit.formNotFound';
        case 'rate_limit.exceeded':
            return 'errors.rateLimit.tooManyRequests';
        case 'attachment.file_missing':
            return 'errors.attachments.fileMissing';
        case 'auth.required':
            return 'errors.auth.notAuthenticated';
        case 'attachment.invalid_context':
        case 'attachment.owner_unavailable':
        case 'attachment.save_failed':
        default:
            return 'errors.attachments.uploadFailed';
    }
}

/**
 * Resolves with the run result, or with BUDGET_SPENT once the budget is
 * spent. The run itself is never cancelled: it finishes and persists on its
 * own.
 */
async function settleWithinBudget<T>(run: Promise<T>, remainingMs: number): Promise<T | typeof BUDGET_SPENT> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const budget = new Promise<typeof BUDGET_SPENT>((resolve) => {
        timer = setTimeout(() => resolve(BUDGET_SPENT), Math.max(0, remainingMs));
    });
    try {
        return await Promise.race([run, budget]);
    } finally {
        clearTimeout(timer);
    }
}

function hasBrowserSessionCookie(event: H3Event): boolean {
    const cookieHeader = getHeader(event, 'cookie') || '';
    return cookieHeader
        .split(';')
        .map(value => value.trim())
        .some((cookie) => {
            const [name, value = ''] = cookie.split('=');
            return isDrupalSessionCookie(name || '', value);
        });
}

function citizenOwnerUuid(user: AttachmentSessionUser | null | undefined): string | null {
    const roles = Array.isArray(user?.roles)
        ? user.roles.filter((role): role is string => typeof role === 'string')
        : [];
    const uuid = typeof user?.uuid === 'string' ? user.uuid : '';
    if (
        !Number.isInteger(user?.uid)
        || Number(user?.uid) <= 0
        || !roles.includes('authenticated')
        || roles.some(role => STAFF_UPLOAD_ROLES.has(role))
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)
    ) {
        return null;
    }
    return uuid;
}

function isAttachmentCreatedPayload(payload: unknown): payload is AttachmentCreatedPayload {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return false;
    }
    const data = (payload as { data?: unknown }).data;
    return Boolean(
        data
        && typeof data === 'object'
        && !Array.isArray(data)
        && typeof (data as { id?: unknown }).id === 'string'
        && typeof (data as { claimToken?: unknown }).claimToken === 'string'
    );
}

async function currentCitizenOwnerUuid(event: H3Event): Promise<string | null> {
    if (!hasBrowserSessionCookie(event)) {
        return null;
    }
    try {
        return citizenOwnerUuid(await getAuthenticatedUser(event) as AttachmentSessionUser);
    } catch {
        console.info('[attachments] Ignoring unverified browser session for public upload.');
        return null;
    }
}

export default defineEventHandler(async (event) => {
    requireSameOriginRequest(event);
    setPrivateNoStore(event);

    const ip = getClientIp(event);
    checkRateLimit(ip, 'attachment_upload', event);

    const contentLengthHeader = getHeader(event, 'content-length');
    const contentLength = Number(contentLengthHeader || 0);
    if (!contentLengthHeader || !Number.isFinite(contentLength) || contentLength <= 0) {
        throw createSafeError({
            statusCode: 411,
            message: 'errors.attachments.invalidRequest',
            data: { code: 'errors.attachments.invalidRequest' }
        });
    }
    if (contentLength > MAX_FILE_SIZE + 64_000) {
        throw createSafeError({
            statusCode: 413,
            message: 'errors.attachments.fileTooLarge',
            data: { code: 'errors.attachments.fileTooLarge' }
        });
    }

    const parts = await readMultipartFormData(event);
    // The server-side wait (Drupal upload with malware scan, policy lookup,
    // story A) counts from here; the browser's transfer time is not ours.
    const deadline = Date.now() + UPLOAD_ANALYSIS_BUDGET_MS;
    if (!parts || parts.length === 0) {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.attachments.fileMissing',
            data: { code: 'errors.attachments.fileMissing' }
        });
    }

    const formId = firstMultipartString(parts, 'formId');
    const fieldId = firstMultipartString(parts, 'fieldId');
    const language = attachmentAnalysisLanguage(parts);
    const analysisAvailable = hasAttachmentAnalysisDisclosureProvider();
    const analysisConsent = analysisAvailable && firstMultipartString(parts, 'analysisConsent') === 'true';
    const filePart = parts.find(item => item.name === 'file' && item.data);
    if (!formId || !fieldId || !filePart?.data) {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.attachments.invalidRequest',
            data: { code: 'errors.attachments.invalidRequest' }
        });
    }
    validateUuid(formId, 'formId');

    if (filePart.data.length > MAX_FILE_SIZE) {
        throw createSafeError({
            statusCode: 413,
            message: 'errors.attachments.fileTooLarge',
            data: { code: 'errors.attachments.fileTooLarge' }
        });
    }

    const config = useRuntimeConfig();
    const apiBase = config.apiBase;
    if (!apiBase) {
        throw createSafeError({
            statusCode: 500,
            message: 'errors.server.configuration',
            data: { code: 'errors.server.configuration' }
        });
    }

    const body = new FormData();
    body.append('formId', formId);
    body.append('fieldId', fieldId);
    body.append('language', language);
    if (analysisConsent) {
        // Drupal persists this separately from the client-side immediate
        // analysis so a later queue/retry can apply the same data-path gate.
        body.append('analysisConsent', 'true');
    }
    const ownerUuid = await currentCitizenOwnerUuid(event);
    if (ownerUuid) {
        body.append('ownerUuid', ownerUuid);
    }
    body.append(
        'file',
        new Blob([new Uint8Array(filePart.data)], { type: filePart.type || 'application/octet-stream' }),
        filePart.filename || 'attachment'
    );

    const response = await fetch(`${apiBase}/api/v1/attachments`, {
        method: 'POST',
        headers: {
            ...serviceProxyHeaders('application-attachment', ip),
            Accept: 'application/json'
        },
        body
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
        const code = mapAttachmentErrorCode(payload?.error?.code);
        throw createSafeError({
            statusCode: response.status,
            message: code,
            data: {
                code,
                ...(code === 'errors.rateLimit.tooManyRequests' ? { seconds: 60 } : {})
            }
        });
    }

    if (!isAttachmentCreatedPayload(payload)) {
        throw createSafeError({
            statusCode: 502,
            message: 'errors.attachments.uploadFailed',
            data: { code: 'errors.attachments.uploadFailed' }
        });
    }

    const verifiedMimeType = typeof payload.data.mimeType === 'string' ? payload.data.mimeType : '';
    const mediaType = normalizeAttachmentAnalysisMediaType(
        verifiedMimeType || filePart.type,
        verifiedMimeType ? '' : filePart.filename || ''
    );
    let analysis: IntelligenceAttachmentAnalysisResult | undefined;
    const persistedExternalAnalysisConsent = analysisConsent && payload.data.externalAnalysisConsent === true;
    // Story A of a story profile: Drupal minted the run id with the upload.
    // Both stay on the server; the browser never sees them.
    const { analysisRunId: rawRunId, analysisStory: rawStory, ...publicData } = payload.data;
    const citizenRunId = rawStory === 'citizen'
      && typeof rawRunId === 'string'
      && ANALYSIS_RUN_ID_PATTERN.test(rawRunId)
        ? rawRunId
        : '';
    const releaseCitizenRun = async (): Promise<void> => {
        if (!citizenRunId) return;
        try {
            await failAttachmentAnalysisRun({
                attachmentId: payload.data.id,
                formId,
                fieldId,
                analysisRunId: citizenRunId,
                story: 'citizen',
                ip
            }, language);
        } catch {
            console.warn('[attachments] Unable to release failed attachment analysis run.');
        }
    };
    if (mediaType && !analysisAvailable) {
        analysis = { status: 'skipped', code: 'not_configured' };
    } else if (mediaType) {
        try {
            const policy = await resolveAttachmentAnalysisDispatchPolicy(formId, fieldId);
            if (!policy.configured) {
                analysis = { status: 'skipped', code: 'not_configured' };
            } else if (policy.egressPolicy !== 'external_redacted') {
                if (policy.requiresCitizenConsent && !persistedExternalAnalysisConsent) {
                    analysis = { status: 'skipped', code: 'consent_required' };
                } else if (policy.storyMode && !citizenRunId) {
                    // Drupal starts story A only where the trigger table puts
                    // it on the upload; without its run id nothing runs here.
                    analysis = { status: 'skipped', code: 'not_configured' };
                } else {
                    const citizenConsent = policy.egressPolicy === 'external_allowed' && persistedExternalAnalysisConsent;
                    const redact = citizenPrecheckRequiresRedaction(policy, citizenConsent);
                    const target = {
                        attachmentId: payload.data.id,
                        formId,
                        fieldId,
                        ...(citizenRunId ? { analysisRunId: citizenRunId, story: 'citizen' as const } : {})
                    };
                    const recordSourceFailure = async (code: SourceFailureCode) => {
                        try {
                            await recordAttachmentSourceFailure({ ...target, ip }, language, code);
                        } catch {
                            console.warn('[attachments] Could not record the source preparation failure.');
                        }
                        return citizenSourceFailure(code);
                    };
                    const run = (async (): Promise<IntelligenceAttachmentAnalysisResult> => {
                        // Legacy PDFs have no upload-time page preparation or citizen run to update.
                        if (redact && mediaType === 'application/pdf' && !citizenRunId) {
                            return { status: 'skipped', code: 'analysis_after_submit' };
                        }
                        try {
                            const pages = citizenRunId && mediaType === 'application/pdf' && PAGE_SOURCE_EGRESS_POLICIES.has(policy.egressPolicy)
                                ? await requestCitizenAnalysisPages({
                                    attachmentId: payload.data.id,
                                    formId,
                                    fieldId,
                                    claimToken: payload.data.claimToken,
                                    analysisRunId: citizenRunId,
                                    ip
                                })
                                : undefined;
                            if (redact && !areVerifiedRedactedPages(pages?.renderedFrom, pages?.redaction)) {
                                return await recordSourceFailure(unverifiedSourceReason(mediaType, pages?.redaction));
                            }
                            return await requestIntelligenceAttachmentAnalysis(event, {
                                ...target,
                                mediaType,
                                size: filePart.data.length,
                                ...(pages ? { pages } : policy.transferBytes ? { data: filePart.data } : {}),
                                sourceKind: 'original',
                                citizenConsent,
                                language,
                                tenant: policy.scope
                            });
                        } catch (error: unknown) {
                            if (error instanceof CitizenAnalysisSourceError && isSourceFailure(error.reason)) {
                                return error.recorded ? citizenSourceFailure(error.reason) : await recordSourceFailure(error.reason);
                            }
                            console.warn('[attachments] Immediate attachment analysis failed:',
                                error instanceof IntelligenceServiceRequestError ? error.reason : 'analysis_failed');
                            if (!(error instanceof CitizenAnalysisSourceError && error.recorded)) await releaseCitizenRun();
                            return { status: 'failed', code: 'analysis_failed' };
                        }
                    })();
                    // Only Drupal's reserved story A supports polling.
                    const settled = citizenRunId ? await settleWithinBudget(run, deadline - Date.now()) : await run;
                    analysis = settled === BUDGET_SPENT
                        ? { status: 'pending', code: 'analysis_pending' }
                        : settled;
                }
            }
        } catch {
            console.warn('[attachments] Immediate attachment analysis failed.');
            await releaseCitizenRun();
            analysis = { status: 'failed', code: 'analysis_failed' };
        }
    }
    if (citizenRunId && (!analysis || analysis.status === 'skipped')) {
        // The minted run never started: release it instead of leaving story
        // A pending until its lease runs out.
        await releaseCitizenRun();
    }

    return {
        ...payload,
        data: {
            ...publicData,
            ...(analysis
                ? {
                    analysisStatus: analysis.status === 'skipped'
                        ? (citizenRunId ? 'not_requested' : payload.data.analysisStatus || 'not_requested')
                        : analysis.status,
                    analysis: {
                        language,
                        status: analysis.status,
                        code: citizenAttachmentAnalysisCode(analysis.status, analysis.code),
                        ...(citizenAttachmentAnalysisResult(analysis.result) ? { result: citizenAttachmentAnalysisResult(analysis.result) } : {})
                    }
                }
                : {})
        }
    };
});
