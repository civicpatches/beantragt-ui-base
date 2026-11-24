/**
 * GET /api/comments/:applicationId/attachments/:fileUuid/download
 *
 * Streams a scoped comment attachment download from Drupal.
 */
import { setPrivateNoStore } from '../../../../../utils/request-security';

function headerValue(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
    const value = headers[name] ?? headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
}

export default defineEventHandler(async (event) => {
    setPrivateNoStore(event);

    const applicationId = getRouterParam(event, 'applicationId');
    const fileUuid = getRouterParam(event, 'fileUuid');
    validateUuid(applicationId, 'applicationId');
    validateUuid(fileUuid, 'fileUuid');

    const cookieHeader = getHeader(event, 'cookie') || '';
    const apiBase = getDrupalSessionApiBase(event);
    if (!apiBase) {
        throw createSafeError({
            statusCode: 500,
            message: 'errors.server.configuration',
            data: { code: 'errors.server.configuration' }
        });
    }

    const upstream = await drupalSessionRequest(
        event,
        `/api/comments/${applicationId}/attachments/${fileUuid}/download`,
        {
            headers: buildDrupalRequestHeaders(event, { accept: 'application/octet-stream', cookieHeader })
        }
    );

    if (!upstream.ok) {
        throw createSafeError({
            statusCode: upstream.status === 403 ? 403 : 404,
            message: upstream.status === 403 ? 'errors.auth.accessDenied' : 'errors.attachments.notFound',
            data: { code: upstream.status === 403 ? 'errors.auth.accessDenied' : 'errors.attachments.notFound' }
        });
    }

    const headers = new Headers();
    for (const name of ['content-type', 'content-length', 'content-disposition']) {
        const value = headerValue(upstream.headers, name);
        if (value) headers.set(name, value);
    }
    headers.set('Cache-Control', 'private, no-store, max-age=0');
    headers.set('Pragma', 'no-cache');
    headers.set('X-Content-Type-Options', 'nosniff');

    return new Response(await upstream.arrayBuffer(), {
        status: upstream.status,
        headers
    });
});
