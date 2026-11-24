import { citizenSourceFailure, type SourceFailureCode } from './attachment-analysis-source';
import { serviceProxyHeaders } from './public-status-proxy';

interface AttachmentAnalysisPersistenceIdentity {
    attachmentId: string
    formId: string
    fieldId: string
    analysisRunId?: string
    /** Story of a story-profile run; Drupal writes only stories.{story}. */
    story?: 'legacy' | 'citizen' | 'staff'
    ip: string
}

type AttachmentAnalysisLanguage = 'de' | 'en';
type AttachmentAnalysisStatus = 'pending' | 'complete' | 'failed';

export async function persistAttachmentAnalysis(
    upload: AttachmentAnalysisPersistenceIdentity,
    status: AttachmentAnalysisStatus,
    metadata: Record<string, unknown>
): Promise<void> {
    const config = useRuntimeConfig();
    const apiBase = config.apiBase;

    if (!apiBase) {
        throw new Error('api_base_missing');
    }

    const response = await fetch(`${apiBase}/api/internal/attachments/${encodeURIComponent(upload.attachmentId)}/analysis`, {
        method: 'POST',
        headers: {
            ...serviceProxyHeaders('application-attachment-analysis', upload.ip),
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            status,
            metadata,
            ...(upload.story && upload.story !== 'legacy' ? { story: upload.story } : {}),
            ...(upload.analysisRunId
                ? {
                    analysisRunId: upload.analysisRunId,
                    formId: upload.formId,
                    fieldId: upload.fieldId
                }
                : {})
        })
    });
    if (!response.ok) {
        console.warn('[attachments] Attachment analysis metadata update failed:', response.status);
        throw new Error(`analysis_persist_failed:${response.status}`);
    }
}

/**
 * Releases a run-bound Drupal reservation when canonical-byte validation
 * fails before the provider pipeline can start.
 */
export async function failAttachmentAnalysisRun(
    upload: AttachmentAnalysisPersistenceIdentity,
    language: AttachmentAnalysisLanguage
): Promise<void> {
    await persistAttachmentAnalysis(upload, 'failed', {
        version: 1,
        status: 'failed',
        code: 'analysis_failed',
        language,
        ...(upload.analysisRunId ? { analysisRunId: upload.analysisRunId } : {})
    });
}

/** Drupal's terminal status plus a bounded reason round-trip through the citizen poll. */
export async function recordAttachmentSourceFailure(
    upload: AttachmentAnalysisPersistenceIdentity,
    language: AttachmentAnalysisLanguage,
    code: SourceFailureCode
) {
    await persistAttachmentAnalysis(upload, 'failed', {
        version: 1,
        status: 'failed',
        code,
        requiresHumanReview: true,
        language
    });
    return citizenSourceFailure(code);
}
