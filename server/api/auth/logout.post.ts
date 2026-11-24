/**
 * POST /api/auth/logout
 *
 * Proxies logout request to Drupal.
 * Forwards session cookies and clears them on response.
 */
import { clearChallengeCookies } from '../../utils/citizen-session';
import { serverUiMode } from '../../utils/ui-mode';
import { requireSameOriginRequest, setPrivateNoStore } from '../../utils/request-security';

export default defineEventHandler(async (event) => {
    requireSameOriginRequest(event);
    setPrivateNoStore(event);

    const cookieHeader = getHeader(event, 'cookie') || '';
    if (!cookieHeader) {
        return { success: true };
    }

    try {
        // Fetch CSRF token for Drupal mutation (required after backend hardening).
        const csrfToken = await fetchCsrfToken(cookieHeader, event);

        const response = await drupalSessionRequest(event, '/auth/logout', {
            method: 'POST',
            headers: {
                ...buildDrupalRequestHeaders(event, { accept: 'application/json', cookieHeader }),
                'X-CSRF-Token': csrfToken
            }
        });

        if (!response.ok) {
            throw createSafeError({
                statusCode: response.status,
                message: 'errors.server.drupalRequestFailed',
                data: { code: 'errors.server.drupalRequestFailed' }
            });
        }

        if (serverUiMode() === 'citizen') clearChallengeCookies(event);
        // Forward Set-Cookie headers (Drupal will send cookie expiry)
        for (const cookie of response.setCookieHeaders) {
            appendResponseHeader(event, 'Set-Cookie', cookie);
        }

        const data = await response.json<Record<string, unknown>>().catch(() => ({}));

        return { success: true, ...data };
    } catch (e: unknown) {
        console.error('[auth/logout] Proxy error:', e instanceof Error ? e.message : e);

        if (e && typeof e === 'object' && 'statusCode' in e) {
            throw e;
        }

        throw createSafeError({
            statusCode: 502,
            message: 'errors.server.drupalRequestFailed',
            data: { code: 'errors.server.drupalRequestFailed' }
        });
    }
});
