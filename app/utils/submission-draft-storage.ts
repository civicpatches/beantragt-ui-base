export const SUBMISSION_DRAFT_PREFIX = 'beantragt.assistantSubmissionDraft.';

export function submissionDraftStorage(): Storage | null {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
}

/**
 * Removes every assistant draft of this browser tab.
 *
 * Used after "Alle meine Daten löschen": drafts never left the browser, so
 * the page removes them here.
 */
export function clearSubmissionDrafts(): void {
    const store = submissionDraftStorage();
    if (!store) return;
    try {
        const keys: string[] = [];
        for (let index = 0; index < store.length; index++) {
            const key = store.key(index);
            if (key?.startsWith(SUBMISSION_DRAFT_PREFIX)) keys.push(key);
        }
        keys.forEach(key => store.removeItem(key));
    } catch {
        // Storage may be unavailable (private mode); nothing to remove then.
    }
}
