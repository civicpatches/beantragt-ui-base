/**
 * GET /api/auth/status
 *
 * Proxies auth status check to Drupal.
 * Forwards session cookies to determine if the user is authenticated.
 */
import { setPrivateNoStore } from '../../utils/request-security';

import { requireCitizenSession } from '../../utils/citizen-session';
import { serverUiMode } from '../../utils/ui-mode';
import { hasValidDrupalSession, drupalSessionCookieHeader } from '../../utils/session';
import { STAFF_HOST_ERROR } from '../../../shared/ui-mode';
import { withCitizenAccountName, type CitizenAuthResponse } from '../../utils/citizen-account-name';

export default defineEventHandler(async (event) => {
    setPrivateNoStore(event);
    const cookieHeader = getHeader(event, 'cookie') || '';

    if (serverUiMode() === 'citizen' && hasValidDrupalSession(event)) {
        try {
            const user = await requireCitizenSession(event);
            return await withCitizenAccountName(event, { authenticated: true, user }, cookieHeader);
        } catch (error) {
            if (event.context.drupalConfirmedAnonymous === true) {
                const cookies = drupalSessionCookieHeader(getHeader(event, 'cookie') || '');
                for (const pair of cookies.split('; ')) deleteCookie(event, pair.split('=')[0]!, { path: '/' });
                return { authenticated: false, user: null };
            }
            const code = (error as { data?: { code?: string } }).data?.code;
            return { authenticated: false, user: null, notAllowedOnHost: true, code: code === STAFF_HOST_ERROR ? code : 'errors.auth.statusUnavailable' };
        }
    }

    // Forward the client's cookies to Drupal.
    try {
        const response = await drupalSessionRequest(event, '/auth/status', {
            headers: buildDrupalRequestHeaders(event, { accept: 'application/json', cookieHeader })
        });

        const data = await response.json<CitizenAuthResponse>();

        if (!response.ok) {
            return {
                authenticated: false,
                user: null
            };
        }

        return await withCitizenAccountName(event, data, cookieHeader);
    } catch (e: unknown) {
        console.error('[auth/status] Proxy error:', e instanceof Error ? e.message : e);

        return {
            authenticated: false,
            user: null
        };
    }
});
