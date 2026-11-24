/**
 * GET /api/applicant/delete-preview
 *
 * Shows the authenticated citizen what "Alle meine Daten löschen" deletes
 * and which submitted applications stay with the authority (reference
 * number, Stelle, contact, expected deletion date). Proxies Drupal's
 * GET /auth/gdpr/preview with the session cookie and passes only the
 * documented shape.
 */
import { erasureRefusal, normalizeErasurePreview } from '~~/app/utils/citizen-erasure';
import { createSafeError } from '../../utils/error-handling';
import { setPrivateNoStore } from '../../utils/request-security';

export default defineEventHandler(async (event) => {
    setPrivateNoStore(event);
    requireAuth(event);

    const cookieHeader = getHeader(event, 'cookie') || '';

    try {
        const response = await drupalSessionRequest(event, '/auth/gdpr/preview', {
            headers: buildDrupalRequestHeaders(event, { accept: 'application/json', cookieHeader })
        });

        if (!response.ok) {
            const body = await response.json<unknown>().catch(() => null);
            const { statusCode, code } = erasureRefusal(response.status, body, 'errors.citizen.loadFailed');
            throw createSafeError({ statusCode, message: code, data: { code } });
        }

        return normalizeErasurePreview(await response.json<unknown>().catch(() => null));
    } catch (e: unknown) {
        if (e && typeof e === 'object' && 'statusCode' in e) {
            throw e;
        }

        console.error('[applicant/delete-preview] Error:', e instanceof Error ? e.message : e);
        throw createSafeError({
            statusCode: 500,
            message: 'errors.citizen.loadFailed',
            data: { code: 'errors.citizen.loadFailed' }
        });
    }
});
