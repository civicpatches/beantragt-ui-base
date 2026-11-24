import { REDACTION_NOT_POSSIBLE } from './attachment-analysis-source';
import type { H3Event } from 'h3';
import type { AttachmentAnalysisMediaType, AttachmentAnalysisSourceKind } from './attachment-analysis-contract';
import {
    intelligenceServiceAuthorization,
    IntelligenceServiceRequestError,
    intelligenceServiceUrl
} from './intelligence-service';

const INTELLIGENCE_REQUEST_TIMEOUT_MS = 240_000;

type AttachmentAnalysisLanguage = 'de' | 'en';

export interface IntelligenceAttachmentAnalysisRequest {
    attachmentId: string
    applicationId?: string
    formId: string
    fieldId: string
    analysisRunId?: string
    /** Story of a story-profile run; 'citizen' is story A. */
    story?: 'legacy' | 'citizen' | 'staff'
    mediaType: AttachmentAnalysisMediaType
    size: number
    data?: Buffer
    /**
     * Rendered page images of a PDF that Drupal prepared (sovereign or local
     * story A). They replace data; mediaType still names the source type.
     */
    pages?: IntelligenceAttachmentAnalysisPages
    sourceKind: AttachmentAnalysisSourceKind
    citizenConsent?: boolean
    language?: AttachmentAnalysisLanguage
    tenant?: {
        jurisdictionSlug: string | null
        organisationSlug: string | null
    }
}

export interface IntelligenceAttachmentAnalysisPages {
    /** Page images, base64 encoded as Drupal sent them; never decoded here. */
    pages: Array<{ mediaType: 'image/jpeg' | 'image/png', data: string }>
    renderedFrom: 'derivative' | 'original'
    pageCount: number
    truncated: boolean
    redaction: 'redacted' | 'unredacted_needs_review' | 'none'
}

export interface IntelligenceAttachmentAnalysisResult {
    status: 'pending' | 'complete' | 'failed' | 'skipped' | typeof REDACTION_NOT_POSSIBLE.status
    code: string
    result?: Record<string, unknown>
}

interface IntelligenceAnalysisResponse {
    data?: {
        analysisStatus?: unknown
        analysisCode?: unknown
        analysisResult?: unknown
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function parseAnalysisResponse(payload: unknown): IntelligenceAttachmentAnalysisResult {
    const data = isRecord(payload) && isRecord((payload as IntelligenceAnalysisResponse).data)
        ? (payload as IntelligenceAnalysisResponse).data
        : null;
    const status = data?.analysisStatus;
    const code = data?.analysisCode;
    if (
        typeof status !== 'string'
        || !['pending', 'complete', 'failed', 'skipped', REDACTION_NOT_POSSIBLE.status].includes(status)
        || typeof code !== 'string'
        || !code
    ) {
        throw new IntelligenceServiceRequestError('invalid_response');
    }
    if (status === REDACTION_NOT_POSSIBLE.status) return REDACTION_NOT_POSSIBLE;
    return {
        status: status as IntelligenceAttachmentAnalysisResult['status'],
        code,
        ...(isRecord(data.analysisResult) ? { result: data.analysisResult } : {})
    };
}

export async function requestIntelligenceAttachmentAnalysis(
    _event: H3Event,
    request: IntelligenceAttachmentAnalysisRequest
): Promise<IntelligenceAttachmentAnalysisResult> {
    const url = intelligenceServiceUrl('/api/internal/attachments/analyze');
    const authorization = intelligenceServiceAuthorization(url);
    if (!authorization) {
        throw new IntelligenceServiceRequestError('configuration');
    }

    let response: Response;
    try {
        response = await fetch(url, {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Authorization': authorization,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                attachmentId: request.attachmentId,
                ...(request.applicationId ? { applicationId: request.applicationId } : {}),
                formId: request.formId,
                fieldId: request.fieldId,
                ...(request.analysisRunId ? { analysisRunId: request.analysisRunId } : {}),
                ...(request.story ? { story: request.story } : {}),
                mediaType: request.mediaType,
                size: request.size,
                sourceKind: request.sourceKind,
                ...(request.citizenConsent === undefined
                    ? {}
                    : { citizenConsent: request.citizenConsent === true }),
                language: request.language || 'de',
                ...(request.tenant ? { tenant: request.tenant } : {}),
                ...(request.pages
                    ? {
                        pages: request.pages.pages,
                        renderedFrom: request.pages.renderedFrom,
                        pageCount: request.pages.pageCount,
                        truncated: request.pages.truncated,
                        redaction: request.pages.redaction
                    }
                    : request.data ? { data: request.data.toString('base64') } : {}),
                returnResult: true
            }),
            redirect: 'error',
            signal: AbortSignal.timeout(INTELLIGENCE_REQUEST_TIMEOUT_MS)
        });
    } catch (error: unknown) {
        if (error instanceof IntelligenceServiceRequestError) throw error;
        if (
            (error instanceof DOMException && error.name === 'TimeoutError')
            || (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name))
        ) {
            throw new IntelligenceServiceRequestError('timeout');
        }
        throw new IntelligenceServiceRequestError('unavailable');
    }

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
        throw new IntelligenceServiceRequestError('rejected', response.status);
    }
    return parseAnalysisResponse(payload);
}
