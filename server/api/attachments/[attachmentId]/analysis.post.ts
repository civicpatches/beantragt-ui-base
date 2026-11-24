/**
 * POST /api/attachments/:attachmentId/analysis
 *
 * Adds explicit external-analysis consent to an existing unsubmitted upload.
 * Drupal verifies its one-time claim token and streams the canonical stored
 * bytes back to this trusted proxy before the policy-gated analysis runs.
 */
import { requireSameOriginRequest, setPrivateNoStore } from '../../../utils/request-security';
import { serviceProxyHeaders } from '../../../utils/public-status-proxy';
import {
    citizenAttachmentAnalysisCode,
    citizenAttachmentAnalysisResult,
    normalizeAttachmentAnalysisMediaType,
    resolveAttachmentAnalysisDispatchPolicy
} from '../../../utils/attachment-analysis-contract';
import { failAttachmentAnalysisRun } from '../../../utils/attachment-analysis-persistence';
import { hasAttachmentAnalysisDisclosureProvider } from '../../../utils/attachment-analysis-disclosure';
import {
    requestIntelligenceAttachmentAnalysis,
    type IntelligenceAttachmentAnalysisResult
} from '../../../utils/intelligence-attachment-analysis-client';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELD_ID_PATTERN = /^[a-z][a-z0-9_]{0,127}$/;
const CLAIM_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,96}$/;
const ANALYSIS_RUN_ID_PATTERN = /^[a-f0-9]{32}$/;
const MAX_FILE_SIZE = 10 * 1024 * 1024;

interface AnalysisConsentBody {
    analysisConsent?: unknown
    formId?: unknown
    fieldId?: unknown
    claimToken?: unknown
    language?: unknown
}

function requiredString(value: unknown, pattern: RegExp, field: string): string {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!pattern.test(normalized)) {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.attachments.invalidRequest',
            data: { code: 'errors.attachments.invalidRequest', field }
        });
    }
    return normalized;
}

function analysisLanguage(value: unknown): 'de' | 'en' {
    if (value === 'de' || value === 'en') return value;
    throw createSafeError({
        statusCode: 400,
        message: 'errors.attachments.invalidRequest',
        data: { code: 'errors.attachments.invalidRequest', field: 'language' }
    });
}

export default defineEventHandler(async (event) => {
    requireSameOriginRequest(event);
    setPrivateNoStore(event);

    const ip = getClientIp(event);
    checkRateLimit(ip, 'attachment_analysis_consent', event);

    const attachmentId = requiredString(getRouterParam(event, 'attachmentId'), UUID_PATTERN, 'attachmentId');
    const body = await readBody<AnalysisConsentBody>(event).catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body) || body.analysisConsent !== true) {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.attachments.invalidRequest',
            data: { code: 'errors.attachments.invalidRequest' }
        });
    }
    const formId = requiredString(body.formId, UUID_PATTERN, 'formId');
    const fieldId = requiredString(body.fieldId, FIELD_ID_PATTERN, 'fieldId');
    const claimToken = requiredString(body.claimToken, CLAIM_TOKEN_PATTERN, 'claimToken');
    const language = analysisLanguage(body.language);

    if (!hasAttachmentAnalysisDisclosureProvider()) {
        return {
            data: {
                id: attachmentId,
                externalAnalysisConsent: false,
                analysisStatus: 'not_requested',
                analysis: { language, status: 'skipped', code: citizenAttachmentAnalysisCode('skipped', 'not_configured') }
            }
        };
    }

    const config = useRuntimeConfig();
    if (!config.apiBase) {
        throw createSafeError({
            statusCode: 500,
            message: 'errors.server.configuration',
            data: { code: 'errors.server.configuration' }
        });
    }

    let policy: Awaited<ReturnType<typeof resolveAttachmentAnalysisDispatchPolicy>>;
    try {
        policy = await resolveAttachmentAnalysisDispatchPolicy(formId, fieldId);
    } catch {
        console.warn('[attachments] Unable to resolve attachment analysis consent policy.');
        throw createSafeError({
            statusCode: 503,
            message: 'errors.attachments.analysisUnavailable',
            data: { code: 'errors.attachments.analysisUnavailable' }
        });
    }
    if (!policy.configured || !policy.requiresCitizenConsent || policy.egressPolicy !== 'external_allowed') {
        throw createSafeError({
            statusCode: 409,
            message: 'errors.attachments.analysisConsentNotAvailable',
            data: { code: 'errors.attachments.analysisConsentNotAvailable' }
        });
    }

    const consentBody = new URLSearchParams({
        formId,
        fieldId,
        claimToken,
        language,
        analysisConsent: 'true'
    });
    const storedFileResponse = await fetch(
        `${config.apiBase}/api/v1/attachments/${encodeURIComponent(attachmentId)}/analysis-consent`,
        {
            method: 'POST',
            headers: {
                ...serviceProxyHeaders('attachment-analysis-consent', ip),
                'Accept': 'application/octet-stream',
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: consentBody
        }
    );
    if (!storedFileResponse.ok) {
        const payload = await storedFileResponse.json().catch(() => null);
        const code = payload?.error?.code === 'rate_limit.exceeded'
            ? 'errors.rateLimit.tooManyRequests'
            : payload?.error?.code === 'attachment.claim_invalid'
                ? 'errors.attachments.invalidRequest'
                : payload?.error?.code === 'attachment.analysis_consent_not_available'
                    ? 'errors.attachments.analysisConsentNotAvailable'
                    : 'errors.attachments.analysisUnavailable';
        throw createSafeError({
            statusCode: storedFileResponse.status,
            message: code,
            data: { code }
        });
    }

    const mediaType = normalizeAttachmentAnalysisMediaType(storedFileResponse.headers.get('content-type'), '');
    const advertisedSize = Number(storedFileResponse.headers.get('x-beantragt-attachment-size') || 0);
    const analysisRunId = storedFileResponse.headers.get('x-beantragt-analysis-run-id') || '';
    const hasValidAnalysisRunId = ANALYSIS_RUN_ID_PATTERN.test(analysisRunId);
    // A story profile reserved story A ('citizen'); legacy sends no story.
    const analysisStory = storedFileResponse.headers.get('x-beantragt-analysis-story') === 'citizen'
        ? 'citizen' as const
        : undefined;
    const failReservedRun = async (): Promise<void> => {
        if (!hasValidAnalysisRunId) return;
        try {
            await failAttachmentAnalysisRun({
                attachmentId,
                formId,
                fieldId,
                analysisRunId,
                ...(analysisStory ? { story: analysisStory } : {}),
                ip
            }, language);
        } catch {
            console.warn('[attachments] Unable to release failed attachment analysis run.');
        }
    };
    const matchingContext = storedFileResponse.headers.get('x-beantragt-attachment-id') === attachmentId
      && storedFileResponse.headers.get('x-beantragt-form-id') === formId
      && storedFileResponse.headers.get('x-beantragt-field-id') === fieldId
      && storedFileResponse.headers.get('x-beantragt-analysis-language') === language
      && hasValidAnalysisRunId;
    if (!mediaType || !matchingContext || !Number.isInteger(advertisedSize) || advertisedSize <= 0 || advertisedSize > MAX_FILE_SIZE) {
        await failReservedRun();
        throw createSafeError({
            statusCode: 502,
            message: 'errors.attachments.analysisUnavailable',
            data: { code: 'errors.attachments.analysisUnavailable' }
        });
    }

    let data: Buffer;
    try {
        data = Buffer.from(await storedFileResponse.arrayBuffer());
    } catch {
        await failReservedRun();
        console.warn('[attachments] Canonical attachment stream failed.');
        throw createSafeError({
            statusCode: 502,
            message: 'errors.attachments.analysisUnavailable',
            data: { code: 'errors.attachments.analysisUnavailable' }
        });
    }
    if (data.length !== advertisedSize || data.length > MAX_FILE_SIZE) {
        await failReservedRun();
        throw createSafeError({
            statusCode: 502,
            message: 'errors.attachments.analysisUnavailable',
            data: { code: 'errors.attachments.analysisUnavailable' }
        });
    }

    let analysis: IntelligenceAttachmentAnalysisResult;
    try {
        analysis = await requestIntelligenceAttachmentAnalysis(event, {
            attachmentId,
            formId,
            fieldId,
            analysisRunId,
            ...(analysisStory ? { story: analysisStory } : {}),
            mediaType,
            size: data.length,
            ...(policy.transferBytes ? { data } : {}),
            sourceKind: 'original',
            citizenConsent: true,
            language,
            tenant: policy.scope
        });
    } catch {
        console.warn('[attachments] Later attachment analysis failed.');
        await failReservedRun();
        analysis = { status: 'failed', code: 'analysis_failed' };
    }

    return {
        data: {
            id: attachmentId,
            externalAnalysisConsent: true,
            analysisStatus: analysis.status === 'skipped' ? 'not_requested' : analysis.status,
            analysis: {
                language,
                status: analysis.status,
                code: citizenAttachmentAnalysisCode(analysis.status, analysis.code),
                ...(citizenAttachmentAnalysisResult(analysis.result)
                    ? { result: citizenAttachmentAnalysisResult(analysis.result) }
                    : {})
            }
        }
    };
});
