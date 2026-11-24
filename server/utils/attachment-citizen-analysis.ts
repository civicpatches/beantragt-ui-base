/**
 * Drupal calls of the citizen upload check (story A) that need the claim
 * token the applicant holds: the rendered pages of a sovereign or local PDF
 * and the applicant's view of a check that is still running.
 *
 * Both go to service-only Drupal routes. The claim token travels in the JSON
 * body, never in a URL, so it does not end up in access logs.
 */
import type { IntelligenceAttachmentAnalysisPages } from './intelligence-attachment-analysis-client';
import { serviceProxyHeaders } from './public-status-proxy';

/** Guard (at least 50 s) plus render (up to 30 s) plus transport. */
const PAGES_REQUEST_TIMEOUT_MS = 150_000;
const POLL_REQUEST_TIMEOUT_MS = 10_000;
const MAX_PAGES = 8;
const MAX_PAGE_BASE64_CHARS = Math.ceil((4 * 1024 * 1024) / 3) * 4 + 8;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/u;
const ANALYSIS_STATUSES = new Set(['not_requested', 'pending', 'complete', 'failed']);
/** Same identifier rules as Drupal's routes; formId ends up in a JSON:API path. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELD_ID_PATTERN = /^[a-z][a-z0-9_]{0,127}$/;

interface CitizenAnalysisIdentity {
    attachmentId: string
    claimToken: string
    ip: string
}

/**
 * Drupal could not prepare the pages. recorded: Drupal already wrote the
 * failure into stories.citizen of this run, so the proxy must not release it.
 */
export class CitizenAnalysisSourceError extends Error {
    constructor(
        public readonly reason: string,
        public readonly recorded: boolean
    ) {
        super(`citizen_analysis_source_${reason}`);
        this.name = 'CitizenAnalysisSourceError';
    }
}

/** The applicant's view of story A as Drupal stores it (no staff data). */
export interface CitizenStoredAnalysis {
    formId: string
    fieldId: string
    mode: 'story' | 'legacy'
    language: 'de' | 'en'
    status: 'not_requested' | 'pending' | 'complete' | 'failed'
    code?: string
    result?: Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function apiBase(): string {
    const base = useRuntimeConfig().apiBase;
    if (!base) throw new CitizenAnalysisSourceError('configuration', false);
    return base;
}

function parsePages(payload: unknown, attachmentId: string): IntelligenceAttachmentAnalysisPages {
    const data = isRecord(payload) && isRecord(payload.data) ? payload.data : null;
    const pages = Array.isArray(data?.pages) ? data.pages : [];
    if (
        !data
        || data.id !== attachmentId
        || data.story !== 'citizen'
        || data.mediaType !== 'application/pdf'
        || pages.length === 0
        || pages.length > MAX_PAGES
        || (data.renderedFrom !== 'derivative' && data.renderedFrom !== 'original')
        || typeof data.pageCount !== 'number'
        || !Number.isInteger(data.pageCount)
        || data.pageCount < pages.length
        || typeof data.truncated !== 'boolean'
        || (data.redaction !== 'redacted' && data.redaction !== 'unredacted_needs_review' && data.redaction !== 'none')
    ) {
        throw new CitizenAnalysisSourceError('invalid_response', false);
    }
    const parsedPages = pages.map((page: unknown): IntelligenceAttachmentAnalysisPages['pages'][number] => {
        if (
            !isRecord(page)
            || (page.mediaType !== 'image/jpeg' && page.mediaType !== 'image/png')
            || typeof page.data !== 'string'
            || page.data.length === 0
            || page.data.length > MAX_PAGE_BASE64_CHARS
            || !BASE64_PATTERN.test(page.data)
        ) {
            throw new CitizenAnalysisSourceError('invalid_response', false);
        }
        return { mediaType: page.mediaType, data: page.data };
    });
    return {
        pages: parsedPages,
        renderedFrom: data.renderedFrom,
        pageCount: data.pageCount,
        truncated: data.truncated,
        redaction: data.redaction
    };
}

/**
 * Asks Drupal for the pages of story A of a fresh upload (sovereign or local
 * PDF). Drupal checks the claim token and the run id it minted with the
 * upload, runs the source preparer and stores nothing of the pages.
 */
export async function requestCitizenAnalysisPages(request: CitizenAnalysisIdentity & {
    formId: string
    fieldId: string
    analysisRunId: string
}): Promise<IntelligenceAttachmentAnalysisPages> {
    let response: Response;
    try {
        response = await fetch(
            `${apiBase()}/api/internal/attachments/${encodeURIComponent(request.attachmentId)}/analysis-source?story=citizen`,
            {
                method: 'POST',
                headers: {
                    ...serviceProxyHeaders('application-attachment-analysis-source', request.ip),
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    formId: request.formId,
                    fieldId: request.fieldId,
                    claimToken: request.claimToken,
                    analysisRunId: request.analysisRunId
                }),
                redirect: 'error',
                signal: AbortSignal.timeout(PAGES_REQUEST_TIMEOUT_MS)
            }
        );
    } catch (error: unknown) {
        if (error instanceof CitizenAnalysisSourceError) throw error;
        throw new CitizenAnalysisSourceError('unavailable', false);
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
        const error = isRecord(payload) && isRecord(payload.error) ? payload.error : {};
        const details = isRecord(error.details) ? error.details : {};
        const analysisCode = typeof details.analysisCode === 'string' ? details.analysisCode : `http_${response.status}`;
        throw new CitizenAnalysisSourceError(analysisCode, details.recorded === true);
    }
    return parsePages(payload, request.attachmentId);
}

/**
 * Reads the applicant's view of story A for an unclaimed upload. Returns
 * null for every mismatch Drupal answers with 404 (unknown attachment,
 * foreign or expired token, claimed upload); throws on any other failure.
 */
export async function fetchCitizenAttachmentAnalysis(request: CitizenAnalysisIdentity): Promise<CitizenStoredAnalysis | null> {
    const response = await fetch(
        `${apiBase()}/api/internal/attachments/${encodeURIComponent(request.attachmentId)}/citizen-analysis`,
        {
            method: 'POST',
            headers: {
                ...serviceProxyHeaders('application-attachment-analysis-poll', request.ip),
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ claimToken: request.claimToken }),
            redirect: 'error',
            signal: AbortSignal.timeout(POLL_REQUEST_TIMEOUT_MS)
        }
    );
    if (response.status === 404) return null;
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
        throw new Error(`citizen_analysis_read_failed:${response.status}`);
    }
    const data = isRecord(payload) && isRecord(payload.data) ? payload.data : null;
    if (
        !data
        || data.id !== request.attachmentId
        // Drupal answers formId '' once the form schema is gone.
        || typeof data.formId !== 'string'
        || !UUID_PATTERN.test(data.formId)
        || typeof data.fieldId !== 'string'
        || !FIELD_ID_PATTERN.test(data.fieldId)
        || (data.mode !== 'story' && data.mode !== 'legacy')
        || typeof data.status !== 'string'
        || !ANALYSIS_STATUSES.has(data.status)
    ) {
        throw new Error('citizen_analysis_read_invalid');
    }
    return {
        formId: data.formId,
        fieldId: data.fieldId,
        mode: data.mode,
        language: data.language === 'en' ? 'en' : 'de',
        status: data.status as CitizenStoredAnalysis['status'],
        ...(typeof data.code === 'string' ? { code: data.code } : {}),
        ...(isRecord(data.result) ? { result: data.result } : {})
    };
}
