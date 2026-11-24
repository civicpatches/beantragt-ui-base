/**
 * Maps Drupal's staff attachment addresses to the same-origin UI download proxies.
 * Neither a public nor an internal Drupal origin belongs in a browser link.
 */
export function toPublicDrupalUrl(path: string): string {
    try {
        const url = new URL(path, 'https://ui.invalid');
        return /^\/api\/admin\/applications\/[^/]+\/attachments\/[^/]+\/(?:download|derivative)$/u.test(url.pathname)
            ? url.pathname
            : '';
    } catch {
        return '';
    }
}
