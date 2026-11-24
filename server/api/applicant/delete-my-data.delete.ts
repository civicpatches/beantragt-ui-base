/**
 * DELETE /api/applicant/delete-my-data
 *
 * "Alle meine Daten löschen": forwards to Drupal's DELETE /auth/gdpr/all
 * with session cookie and CSRF token. Drupal deletes the account, profiles
 * with consents, login links and unconfirmed submissions; submitted
 * applications stay with the authority. Returns the documented summary and
 * forwards the session expiry cookie.
 */
import { erasureRefusal, normalizeErasureSummary } from '~~/app/utils/citizen-erasure';
import { requireSameOriginRequest, setPrivateNoStore } from '../../utils/request-security';

export default defineEventHandler(async (event) => {
    requireSameOriginRequest(event);
    setPrivateNoStore(event);
    requireAuth(event);

    const cookieHeader = getHeader(event, 'cookie') || '';

    try {
        const csrfToken = await fetchCsrfToken(cookieHeader, event);

        // Call Drupal's GDPR deletion endpoint
        const response = await drupalSessionRequest(event, '/auth/gdpr/all', {
            method: 'DELETE',
            headers: {
                ...buildDrupalRequestHeaders(event, {
                    accept: 'application/json',
                    contentType: 'application/json',
                    cookieHeader
                }),
                'X-CSRF-Token': csrfToken
            }
        });

        if (!response.ok) {
            console.error(`[applicant/delete-my-data] Drupal returned ${response.status}`);

            const body = await response.json<unknown>().catch(() => null);
            const refusal = erasureRefusal(response.status, body, 'errors.citizen.deleteFailed');
            const statusCode = refusal.statusCode === 502 ? response.status : refusal.statusCode;
            throw createSafeError({ statusCode, message: refusal.code, data: { code: refusal.code } });
        }

        for (const cookie of response.setCookieHeaders) {
            appendResponseHeader(event, 'Set-Cookie', cookie);
        }

        const data = await response.json<unknown>().catch(() => null);
        return {
            success: true,
            ...normalizeErasureSummary(data)
        };
    } catch (e: unknown) {
        if (e && typeof e === 'object' && 'statusCode' in e) {
            throw e;
        }

        console.error('[applicant/delete-my-data] Error:', e instanceof Error ? e.message : e);
        throw createSafeError({
            statusCode: 500,
            message: 'errors.citizen.deleteFailed',
            data: { code: 'errors.citizen.deleteFailed' }
        });
    }
});
