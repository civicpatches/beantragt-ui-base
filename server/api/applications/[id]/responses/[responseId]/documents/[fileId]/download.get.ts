import { resolveExternalResponseApplicationId } from '../../../../../../../utils/external-response-application';
import { setPrivateNoStore } from '../../../../../../../utils/request-security';

export default defineEventHandler(async (event) => {
    setPrivateNoStore(event);
    const id = getRouterParam(event, 'id');
    const responseId = getRouterParam(event, 'responseId');
    const fileId = getRouterParam(event, 'fileId');
    validateUuid(id, 'applicationId');
    validateUuid(responseId, 'responseId');
    validateUuid(fileId, 'fileId');
    await getAuthenticatedUser(event);
    const internalId = await resolveExternalResponseApplicationId(event, id);
    const upstream = await drupalSessionRequest(event,
        `/api/applications/${internalId}/responses/${responseId}/documents/${fileId}/download`, {
            headers: buildDrupalRequestHeaders(event, {
                accept: 'application/octet-stream',
                cookieHeader: getHeader(event, 'cookie') || ''
            })
        });
    if (!upstream.ok) {
        throw createSafeError({
            statusCode: upstream.status,
            message: 'externalResponses.downloadError',
            data: { code: 'externalResponses.downloadError' }
        });
    }
    const headers = new Headers({
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': 'sandbox; default-src \'none\'',
        'Content-Disposition': 'attachment'
    });
    for (const name of ['content-type', 'content-length', 'content-disposition']) {
        const value = upstream.headers[name];
        const scalar = Array.isArray(value) ? value[0] : value;
        if (scalar && (name !== 'content-disposition' || /^attachment(?:;|$)/i.test(scalar))) {
            headers.set(name, scalar);
        }
    }
    return new Response(await upstream.arrayBuffer(), { status: upstream.status, headers });
});
