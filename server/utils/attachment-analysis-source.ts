import type { FormAttachmentAnalysisProfile } from '~~/app/types/form';

export const REDACTION_NOT_POSSIBLE = {
    status: 'not_checked_redaction_impossible',
    code: 'redaction_not_possible'
} as const;

export type SourceFailureCode = typeof REDACTION_NOT_POSSIBLE.code | 'guard_blocked' | 'guard_unavailable' | 'guard_derivative_required';

export function isSourceFailure(code: unknown): code is SourceFailureCode {
    return code === REDACTION_NOT_POSSIBLE.code || code === 'guard_blocked'
      || code === 'guard_unavailable' || code === 'guard_derivative_required';
}

export function citizenSourceFailure(code: SourceFailureCode) {
    if (code === 'guard_blocked' || code === REDACTION_NOT_POSSIBLE.code) return REDACTION_NOT_POSSIBLE;
    return { status: 'failed', code } as const;
}

/** Missing or inconsistent PDF provenance alone does not establish a scan. */
export function unverifiedSourceReason(mediaType: string, pageRedaction?: string) {
    return mediaType === 'application/pdf' && pageRedaction !== 'unredacted_needs_review'
        ? 'guard_derivative_required'
        : REDACTION_NOT_POSSIBLE.code;
}

/** The preparer must attest to both the rendered source and its redaction. */
export function areVerifiedRedactedPages(renderedFrom?: string, redaction?: string): boolean {
    return renderedFrom === 'derivative' && redaction === 'redacted';
}

export function citizenPrecheckRequiresRedaction(
    profile: Pick<FormAttachmentAnalysisProfile, 'redaction' | 'egressPolicy'>,
    consent: boolean
): boolean {
    return profile.redaction === 'when_possible'
      && profile.egressPolicy !== 'no_ai'
      && !(profile.egressPolicy === 'external_allowed' && consent);
}
