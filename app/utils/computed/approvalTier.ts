/**
 * Preview mirror of the backend `approvalTier` compute plugin.
 *
 * IMPORTANT: this is a frontend-only live preview. The authoritative value
 * is always computed server-side by the Drupal beantragt_compute module.
 * Keep the thresholds and return values in sync with the backend plugin;
 * drift here only affects the preview, never the stored application data.
 *
 * Machine values must remain stable across versions -- they are stored and
 * displayed as-is (or via i18n keys).
 */
export function approvalTier(amount: unknown): string {
    const numeric = typeof amount === 'number'
        ? amount
        : parseFloat(String(amount ?? ''));

    if (!Number.isFinite(numeric)) return 'team_lead';
    if (numeric < 500) return 'team_lead';
    if (numeric <= 5000) return 'department_head';
    return 'management';
}
