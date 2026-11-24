/**
 * GET /api/attachments/:attachmentId/analysis
 *
 * Lets the form poll an upload check (story A) that outlasted the upload's
 * wait budget. The citizen proves the upload with the claim token from the
 * upload response, sent in the X-Attachment-Claim-Token header (never in the
 * URL). Unknown attachments, foreign or expired tokens and claimed uploads
 * all answer the same 404.
 *
 * The answer is the citizen reduction only: status, outcome, criteria,
 * missing hints and notices. Drupal returns stories.citizen without run ids,
 * provider or source facts and without anything purpose-bound; criteria are
 * rebuilt here from the current profile, as story A, with the rules the
 * upload response used. No provider, prompt or analysis pipeline code runs.
 */
import {
    citizenAttachmentAnalysisCode,
    citizenAttachmentAnalysisResult,
    loadAttachmentAnalysisProfile
} from '../../../utils/attachment-analysis-contract';
import { citizenSourceFailure, isSourceFailure } from '../../../utils/attachment-analysis-source';
import { citizenViewOfPersistedResult } from '../../../utils/attachment-analysis-result';
import { fetchCitizenAttachmentAnalysis, type CitizenStoredAnalysis } from '../../../utils/attachment-citizen-analysis';
import { setPrivateNoStore } from '../../../utils/request-security';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLAIM_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,96}$/;
const ATTACHMENT_CLAIM_TOKEN_HEADER = 'x-attachment-claim-token';

function notFound(): never {
    throw createSafeError({
        statusCode: 404,
        message: 'errors.attachments.notFound',
        data: { code: 'errors.attachments.notFound' }
    });
}

async function citizenResult(stored: CitizenStoredAnalysis): Promise<Record<string, unknown> | undefined> {
    if (stored.status !== 'complete' || !stored.result) return undefined;
    let view: Record<string, unknown>;
    try {
        const { profile } = await loadAttachmentAnalysisProfile(stored.formId, stored.fieldId);
        // Without a profile (field removed since) only the bounded facts stay.
        view = profile
            ? citizenViewOfPersistedResult(profile, stored.result, stored.language)
            : { outcome: stored.result.outcome, notices: stored.result.notices, pagesChecked: stored.result.pagesChecked };
    } catch {
        console.warn('[attachments] Profile lookup for the upload check view failed.');
        view = { outcome: stored.result.outcome, notices: stored.result.notices, pagesChecked: stored.result.pagesChecked };
    }
    return citizenAttachmentAnalysisResult(view);
}

export default defineEventHandler(async (event) => {
    setPrivateNoStore(event);

    const ip = getClientIp(event);
    checkRateLimit(ip, 'attachment_analysis_poll', event);

    const attachmentId = (getRouterParam(event, 'attachmentId') || '').trim().toLowerCase();
    const claimToken = (getHeader(event, ATTACHMENT_CLAIM_TOKEN_HEADER) || '').trim();
    if (!UUID_PATTERN.test(attachmentId) || !CLAIM_TOKEN_PATTERN.test(claimToken)) {
        notFound();
    }

    let stored: CitizenStoredAnalysis | null;
    try {
        stored = await fetchCitizenAttachmentAnalysis({ attachmentId, claimToken, ip });
    } catch {
        console.warn('[attachments] Upload check status is unavailable.');
        throw createSafeError({
            statusCode: 503,
            message: 'errors.attachments.analysisUnavailable',
            data: { code: 'errors.attachments.analysisUnavailable' }
        });
    }
    if (!stored) notFound();

    const result = await citizenResult(stored);
    const status = stored.status === 'failed' && isSourceFailure(stored.code)
        ? citizenSourceFailure(stored.code).status
        : stored.status;
    return {
        data: {
            id: attachmentId,
            analysisStatus: status,
            analysis: {
                language: stored.language,
                status,
                code: citizenAttachmentAnalysisCode(status, stored.code),
                ...(result ? { result } : {})
            }
        }
    };
});
