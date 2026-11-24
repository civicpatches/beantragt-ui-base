type Translate = (key: string, params?: Record<string, unknown>) => string;

/**
 * Second line of the success toast after a publish. It names
 * what is true for this form: an internet form accepts applications
 * (the submit route takes only published internet forms, `server/api/submit.post.ts`),
 * and the form's workflow reaches its running applications only when there
 * are any. A count that could not be loaded keeps that sentence, so a form
 * with applications is never published without it.
 */
export function publishSuccessDescription(
    t: Translate,
    options: { scope: string | null | undefined, applicationCount: number | null }
): string | undefined {
    const parts: string[] = [];
    if (options.scope === 'internet') parts.push(t('admin.forms.publishAcceptsApplications'));
    if (options.applicationCount !== 0) parts.push(t('admin.forms.publishReachesRunningApplications'));
    return parts.length > 0 ? parts.join(' ') : undefined;
}

/**
 * Applications of the form in the active workspace, or null when the count
 * could not be loaded. The count is keyed by the form's UUID; the route id
 * may be another id of the same form, so every id given is looked up.
 */
export async function loadFormApplicationCount(formIds: string[], query: Record<string, unknown>): Promise<number | null> {
    try {
        const response = await $fetch<{ counts?: Record<string, number> }>('/api/admin/application-counts', { query });
        if (!response?.counts || typeof response.counts !== 'object') return null;
        return Math.max(0, ...formIds.map(id => Number(response.counts?.[id] ?? 0) || 0));
    } catch {
        return null;
    }
}
