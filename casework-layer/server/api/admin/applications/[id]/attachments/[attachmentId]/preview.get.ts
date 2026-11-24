/**
 * GET /api/admin/applications/:id/attachments/:attachmentId/preview
 *
 * Streams a scoped application attachment for inline staff preview.
 */
import { applyAdminJurisdictionFilter } from '~~/casework-layer/server/utils/admin-workspace';
import { buildDrupalRequestHeaders, drupalSessionFetch, drupalSessionRequest } from '~~/server/utils/auth';
import { setPrivateNoStore } from '~~/server/utils/request-security';
import { validateUuid } from '~~/server/utils/validation';

interface ApplicationLookupResponse {
    data?: Array<{
        attributes?: {
            drupal_internal__id?: number | string
        }
    }>
}

interface AdminAttachmentResponse {
    data?: Array<{
        id?: string
        type?: 'application_attachment'
        filename?: string
        mimeType?: string
        scanStatus?: string
    }>
}

function headerValue(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
    const value = headers[name] ?? headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
}

function inlineContentDisposition(filename: string): string {
    const safeFilename = filename.replace(/[^\x20-\x7E]|["\\%]/g, '_') || 'attachment';
    const encodedFilename = encodeURIComponent(filename || 'attachment')
        .replace(/['()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
    return `inline; filename="${safeFilename}"; filename*=UTF-8''${encodedFilename}`;
}

function previewMediaType(mimeType: string | undefined, filename: string | undefined): string | null {
    const normalized = typeof mimeType === 'string' ? mimeType.toLowerCase() : '';
    const name = typeof filename === 'string' ? filename.toLowerCase() : '';
    if (normalized === 'application/pdf' || name.endsWith('.pdf')) return 'application/pdf';
    if (normalized === 'image/png' || name.endsWith('.png')) return 'image/png';
    if (normalized === 'image/jpeg' || /\.(jpe?g)$/.test(name)) return 'image/jpeg';
    return null;
}

export default defineEventHandler(async (event) => {
    await requireStaff(event);
    setPrivateNoStore(event);

    const applicationId = validateUuid(getRouterParam(event, 'id'), 'applicationId');
    const attachmentId = validateUuid(getRouterParam(event, 'attachmentId'), 'attachmentId');

    const apiQuery = new URLSearchParams({
        'filter[id]': applicationId,
        'fields[application--application]': 'drupal_internal__id',
        'page[limit]': '1'
    });
    await applyAdminJurisdictionFilter(event, apiQuery, 'field_jurisdiction', { required: true });

    const scopedResponse = await drupalSessionFetch<ApplicationLookupResponse>(
        event,
        `/jsonapi/application/application?${apiQuery.toString()}`
    );
    const applicationResource = scopedResponse.data?.[0];
    const internalId = Number(applicationResource?.attributes?.drupal_internal__id);
    if (!Number.isInteger(internalId) || internalId <= 0) {
        throw createSafeError({
            statusCode: 404,
            message: 'errors.applications.notFound',
            data: { code: 'errors.applications.notFound' }
        });
    }

    const attachmentResponse = await drupalSessionFetch<AdminAttachmentResponse>(
        event,
        `/api/admin/applications/${internalId}/attachments`
    );
    const attachment = (attachmentResponse.data || []).find(item =>
        item.type === 'application_attachment'
        && item.id === attachmentId
        && typeof item.filename === 'string'
    );
    if (!attachment) {
        throw createSafeError({
            statusCode: 404,
            message: 'errors.attachments.notFound',
            data: { code: 'errors.attachments.notFound' }
        });
    }
    if (attachment.scanStatus === 'quarantined') {
        throw createSafeError({
            statusCode: 409,
            message: 'errors.attachments.quarantined',
            data: { code: 'errors.attachments.quarantined' }
        });
    }

    const mediaType = previewMediaType(attachment.mimeType, attachment.filename);
    if (!mediaType) {
        throw createSafeError({
            statusCode: 415,
            message: 'errors.attachments.unsupportedType',
            data: { code: 'errors.attachments.unsupportedType' }
        });
    }

    const upstream = await drupalSessionRequest(
        event,
        `/api/admin/applications/${internalId}/attachments/${attachmentId}/download`,
        {
            headers: buildDrupalRequestHeaders(event, {
                accept: mediaType,
                cookieHeader: getHeader(event, 'cookie') || ''
            })
        }
    );
    if (!upstream.ok) {
        const statusCode = [403, 404, 409].includes(upstream.status) ? upstream.status : 502;
        throw createSafeError({
            statusCode,
            message: upstream.status === 403 ? 'errors.auth.accessDenied' : 'errors.attachments.notFound',
            data: { code: upstream.status === 403 ? 'errors.auth.accessDenied' : 'errors.attachments.notFound' }
        });
    }

    const headers = new Headers();
    headers.set('Content-Type', mediaType);
    const contentLength = headerValue(upstream.headers, 'content-length');
    if (contentLength) headers.set('Content-Length', contentLength);
    headers.set('Content-Disposition', inlineContentDisposition(attachment.filename || 'attachment'));
    headers.set('Cache-Control', 'private, no-store, max-age=0');
    headers.set('Pragma', 'no-cache');
    headers.set('Content-Security-Policy', 'sandbox allow-same-origin allow-downloads');
    headers.set('X-Content-Type-Options', 'nosniff');

    return new Response(await upstream.arrayBuffer(), {
        status: upstream.status,
        headers
    });
});
