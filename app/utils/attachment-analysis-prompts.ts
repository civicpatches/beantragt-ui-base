import type { FormAttachmentAnalysisProfile } from '~/types/form';

export type AttachmentAnalysisPromptMode = 'legacy' | 'story';

export interface AttachmentAnalysisPrompts {
    mode: AttachmentAnalysisPromptMode
    /** Story A, check right after the upload. Empty in legacy mode. */
    citizen: string
    /** Story B, purpose-bound reading for staff. Empty in legacy mode. */
    staff: string
}

function promptText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

/**
 * Splits an analysis profile into its two check instructions. The mode is
 * decided by the new prompt keys alone: as soon as citizenPrompt or
 * staffPrompt carries text, the profile runs in story mode and the legacy
 * promptSuggestion is ignored at runtime (it stays stored and readable).
 * Without either key the profile keeps today's single legacy run.
 */
export function attachmentAnalysisPrompts(
    profile: Pick<FormAttachmentAnalysisProfile, 'citizenPrompt' | 'staffPrompt'> | null | undefined
): AttachmentAnalysisPrompts {
    const citizen = promptText(profile?.citizenPrompt);
    const staff = promptText(profile?.staffPrompt);
    if (!citizen && !staff) {
        return { mode: 'legacy', citizen: '', staff: '' };
    }
    return { mode: 'story', citizen, staff };
}
