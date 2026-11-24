/**
 * POST /api/comments/:applicationId
 *
 * Creates a new comment on an application.
 * Forwards body { body, visibility?, attachmentIds? } to Drupal.
 * Requires session cookie + CSRF token.
 * Rate limited as 'application' type (10/min).
 */
import { createSafeError } from '../../utils/error-handling';
import { requireSameOriginRequest, setPrivateNoStore } from '../../utils/request-security';

export default defineEventHandler(async (event) => {
    requireSameOriginRequest(event);
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

    // Rate limit
    const ip = getClientIp(event);
    checkRateLimit(ip, 'application', event);

    const cookieHeader = getHeader(event, 'cookie') || '';

    const rawBody = await readBody(event);

    if (!rawBody || typeof rawBody !== 'object') {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.comments.invalidRequest',
            data: { code: 'errors.comments.invalidRequest' }
        });
    }

    const rawCommentBody = typeof rawBody.body === 'string' ? rawBody.body : '';
    const body = sanitizeString(rawCommentBody, 5000);
    const visibility = sanitizeString(rawBody.visibility, 16).trim();
    const rawAttachmentIds = (rawBody as { attachmentIds?: unknown, attachment_ids?: unknown }).attachmentIds
      ?? (rawBody as { attachment_ids?: unknown }).attachment_ids
      ?? [];

    if (rawCommentBody.length > 5000) {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.comments.bodyTooLong',
            data: { code: 'errors.comments.bodyTooLong' }
        });
    }

    if (visibility && !['public', 'internal'].includes(visibility)) {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.comments.invalidRequest',
            data: { code: 'errors.comments.invalidRequest' }
        });
    }

    const attachmentIds = Array.isArray(rawAttachmentIds)
        ? [...new Set(rawAttachmentIds.map(item => Number(item)))]
            .filter(item => Number.isInteger(item) && item > 0)
        : [];
    if (
        (Array.isArray(rawAttachmentIds) && attachmentIds.length !== rawAttachmentIds.length)
        || attachmentIds.length > 5
    ) {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.comments.invalidRequest',
            data: { code: 'errors.comments.invalidRequest' }
        });
    }

    if (body.trim().length === 0 && attachmentIds.length === 0) {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.comments.bodyEmpty',
            data: { code: 'errors.comments.bodyEmpty' }
        });
    }

    // author_role is NOT sent from client. Drupal derives it from the
    // authenticated session's roles (prevents citizen impersonating staff).

    const csrfToken = await fetchCsrfToken(cookieHeader, event);

    try {
        const response = await drupalSessionRequest(event, `/api/comments/${applicationId}`, {
            method: 'POST',
            headers: {
                ...buildDrupalRequestHeaders(event, {
                    accept: 'application/json',
                    contentType: 'application/json',
                    cookieHeader
                }),
                'X-CSRF-Token': csrfToken
            },
            body: JSON.stringify({
                body: body.trim(),
                ...(visibility ? { visibility } : {}),
                ...(attachmentIds.length > 0 ? { attachment_ids: attachmentIds } : {})
            })
        });

        if (!response.ok) {
            console.error(`[comments/${applicationId}] POST ${response.status}`);
            throw createSafeError({
                statusCode: response.status,
                message: 'errors.comments.sendFailed',
                data: { code: 'errors.comments.sendFailed' }
            });
        }

        const data = await response.json();
        return data;
    } catch (e: unknown) {
        if (e && typeof e === 'object' && 'statusCode' in e) {
            throw e;
        }

        console.error(`[comments/${applicationId}] POST error:`, e instanceof Error ? e.message : 'Unknown error');
        throw createSafeError({
            statusCode: 500,
            message: 'errors.comments.sendFailed',
            data: { code: 'errors.comments.sendFailed' }
        });
    }
});
