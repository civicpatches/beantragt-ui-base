/**
 * File fetch of the staff area: a blob through a staff proxy route, with the
 * file name from its Content-Disposition header. Used by the document viewer
 * and, through the re-export in docgen.ts, by every docgen download.
 */
import { useGlobalMaintenance } from '~/composables/useGlobalMaintenance';
import { redirectStaffSessionOnUnauthorized } from '~~/casework-layer/app/composables/api/useStaffSessionFetch';

/** File name from a Content-Disposition header (the proxy already sanitized it). */
export function dispositionFilename(header: string | null, fallback: string): string {
    if (!header) return fallback;
    const extended = header.match(/filename\*=UTF-8''([^;]+)/iu)?.[1];
    if (extended) {
        try {
            return decodeURIComponent(extended);
        } catch {
            // Fall through to the plain name.
        }
    }
    return header.match(/filename="([^"]+)"/iu)?.[1] || fallback;
}

/**
 * Fetches a docgen file through the proxy. Errors are thrown in the shape of
 * an ofetch error ({ statusCode, data }), so useApiErrorMessage maps them.
 * Like staffFetch, an expired session (401) leads to the login and the
 * maintenance mode takes over the page; downloads use raw fetch because
 * they need the blob and the Content-Disposition header.
 */
export async function fetchStaffFile(url: string, query: Record<string, string | undefined>, fallback: string, headers: Record<string, string> = {}): Promise<{ blob: Blob, filename: string }> {
    const search = new URLSearchParams(Object.entries(query).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
    const response = await fetch(search.size ? `${url}?${search.toString()}` : url, { credentials: 'same-origin', headers: { ...headers, Accept: 'application/pdf, application/vnd.openxmlformats-officedocument.wordprocessingml.document, application/json' } });
    if (!response.ok) {
        let data: unknown = null;
        try {
            data = await response.json();
        } catch {
            data = null;
        }
        const error = Object.assign(new Error('docgen file request failed'), { statusCode: response.status, status: response.status, data });
        if (!await redirectStaffSessionOnUnauthorized(error)) await useGlobalMaintenance().handleRequestError(error);
        throw error;
    }
    return { blob: await response.blob(), filename: dispositionFilename(response.headers.get('content-disposition'), fallback) };
}
