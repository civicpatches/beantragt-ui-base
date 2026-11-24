/**
 * GET /api/comments/:applicationId
 *
 * Fetches comments for an application from Drupal.
 * Drupal authorizes access using the forwarded session cookie.
 */
import { checkCommentReadLimit } from '../../utils/case-read';
import { createSafeError } from '../../utils/error-handling';
import { setPrivateNoStore } from '../../utils/request-security';

interface CommentsResponse {
    data?: unknown[]
}

export default defineEventHandler(async (event) => {
    setPrivateNoStore(event);

    const applicationId = getRouterParam(event, 'applicationId');
    if (!applicationId) {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.comments.applicationIdMissing',
            data: { code: 'errors.comments.applicationIdMissing' }
        });
    }

    validateUuid(applicationId, 'applicationId');

    await checkCommentReadLimit(event);

    const cookieHeader = getHeader(event, 'cookie') || '';

    try {
        const response = await drupalSessionRequest(event, `/api/comments/${applicationId}`, {
            headers: buildDrupalRequestHeaders(event, { accept: 'application/json', cookieHeader })
        });

        if (!response.ok) {
            throw createSafeError({
                statusCode: response.status,
                message: 'errors.comments.loadFailed',
                data: { code: 'errors.comments.loadFailed' }
            });
        }

        const data = await response.json<CommentsResponse>();
        return Array.isArray(data?.data) ? data.data : [];
    } catch (e: unknown) {
        if (e && typeof e === 'object' && 'statusCode' in e) {
            throw e;
        }

        console.error(`[comments/${applicationId}] GET error:`, e instanceof Error ? e.message : e);
        throw createSafeError({
            statusCode: 500,
            message: 'errors.comments.loadFailed',
            data: { code: 'errors.comments.loadFailed' }
        });
    }
});
