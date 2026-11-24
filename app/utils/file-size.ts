/**
 * A file size in the page language: "10 MB", "2,5 MB" (de), "2.5 MB" (en), "512 KB". At most one decimal and none
 * when it would be zero. Used by the citizen form's upload hint and error and by the settings page for uploads.
 */
export function formatFileSize(size: number, locale: string | null | undefined): string {
    const tag = typeof locale === 'string' && locale.startsWith('en') ? 'en-US' : 'de-DE';
    if (!Number.isFinite(size) || size <= 0) return '0 KB';
    if (size >= 1024 * 1024) {
        return `${new Intl.NumberFormat(tag, { maximumFractionDigits: 1 }).format(size / (1024 * 1024))} MB`;
    }
    return `${new Intl.NumberFormat(tag).format(Math.ceil(size / 1024))} KB`;
}
