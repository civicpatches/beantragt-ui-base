import type { H3Event } from 'h3';
import { applyAdminJurisdictionFilter } from './admin-workspace';
import { buildDrupalRequestHeaders, drupalSessionFetch, drupalSessionStreamRequest, requireStaff } from '~~/server/utils/auth';
import { createSafeError } from '~~/server/utils/error-handling';
import { setPrivateNoStore } from '~~/server/utils/request-security';
import { validateUuid } from '~~/server/utils/validation';

/** Only these two file operations cross the UI boundary; Drupal checks file access and audits the download. */
export async function downloadApplicationAttachment(event: H3Event, operation: 'download' | 'derivative') {
    setPrivateNoStore(event);
    await requireStaff(event);

    const id = getRouterParam(event, 'id') || '';
    const attachmentId = validateUuid(getRouterParam(event, 'attachmentId'), 'attachmentId');
    // Drupal's attachment list supplies numeric application IDs. The UI also uses UUIDs.
    const numericId = /^[1-9]\d*$/u.test(id) && Number.isSafeInteger(Number(id));
    if (!numericId) validateUuid(id, 'applicationId');
    const query = new URLSearchParams({
        [numericId ? 'filter[drupal_internal__id]' : 'filter[id]']: id,
        'fields[application--application]': 'drupal_internal__id',
        'page[limit]': '1'
    });
    await applyAdminJurisdictionFilter(event, query, 'field_jurisdiction', { required: true });
    const application = await drupalSessionFetch<{
        data?: Array<{ attributes?: { drupal_internal__id?: number | string } }>
    }>(event, `/jsonapi/application/application?${query}`);
    const internalId = Number(application.data?.[0]?.attributes?.drupal_internal__id);
    if (!Number.isSafeInteger(internalId) || internalId <= 0) {
        throw createSafeError({ statusCode: 404, message: 'errors.applications.notFound' });
    }

    const upstream = await drupalSessionStreamRequest(event,
        `/api/admin/applications/${internalId}/attachments/${attachmentId}/${operation}`, {
            headers: buildDrupalRequestHeaders(event, {
                accept: 'application/octet-stream',
                cookieHeader: getHeader(event, 'cookie') || ''
            })
        });
    if (upstream.statusCode !== 200) {
        upstream.destroy();
        const statusCode = [401, 403, 404, 409].includes(upstream.statusCode || 0) ? upstream.statusCode! : 502;
        throw createSafeError({
            statusCode,
            message: statusCode === 401 || statusCode === 403 ? 'errors.auth.accessDenied' : 'errors.attachments.notFound'
        });
    }

    const disposition = upstream.headers['content-disposition'];
    setHeader(event, 'Content-Disposition', typeof disposition === 'string'
    && /^attachment(?:;|$)/iu.test(disposition) && !/[\r\n]/u.test(disposition)
        ? disposition
        : 'attachment');
    const length = upstream.headers['content-length'];
    if (typeof length === 'string' && /^\d+$/u.test(length) && Number.isSafeInteger(Number(length))) {
        setHeader(event, 'Content-Length', Number(length));
    }
    setHeader(event, 'Content-Type', 'application/octet-stream');
    setHeader(event, 'X-Content-Type-Options', 'nosniff');
    setHeader(event, 'Content-Security-Policy', 'sandbox; default-src \'none\'');
    return sendStream(event, upstream);
}
