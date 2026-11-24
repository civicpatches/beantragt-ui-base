/**
 * DELETE /api/admin/applications/:id/attachments/:attachmentId
 *
 * Resolves a quarantined attachment by deleting the blocked file through the
 * scoped Drupal admin endpoint.
 */
import { applyAdminJurisdictionFilter } from '~~/casework-layer/server/utils/admin-workspace';
import { drupalSessionFetch } from '~~/server/utils/auth';
import { requireSameOriginRequest, setPrivateNoStore } from '~~/server/utils/request-security';
import { validateUuid } from '~~/server/utils/validation';

interface ApplicationLookupResponse {
    data?: Array<{
        attributes?: {
            drupal_internal__id?: number | string
        }
    }>
}

function mapAttachmentErrorCode(code: unknown): string | null {
    if (typeof code !== 'string') return null;
    switch (code) {
        case 'attachment.not_found':
            return 'errors.attachments.notFound';
        case 'attachment.not_quarantined':
            return 'errors.attachments.notQuarantined';
        case 'attachment.invalid_request':
            return 'errors.attachments.invalidRequest';
        case 'attachment.access_denied':
            return 'errors.auth.accessDenied';
        case 'attachment.delete_failed':
            return 'errors.admin.attachmentQuarantineDeleteFailed';
        case 'application.locked':
            return 'errors.applications.dataBusy';
        default:
            return code.startsWith('errors.') ? code : null;
    }
}

export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    requireSameOriginRequest(event);
    setPrivateNoStore(event);

    const applicationId = validateUuid(getRouterParam(event, 'id'), 'applicationId');
    const attachmentId = validateUuid(getRouterParam(event, 'attachmentId'), 'attachmentId');

    let parsedBody: unknown;
    try {
        parsedBody = await readBody(event);
    } catch {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.admin.attachmentQuarantineDeleteFailed',
            data: { code: 'errors.admin.attachmentQuarantineDeleteFailed' }
        });
    }

    const body = parsedBody === undefined || parsedBody === null ? {} : parsedBody;
    if (typeof body !== 'object' || Array.isArray(body)) {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.admin.attachmentQuarantineDeleteFailed',
            data: { code: 'errors.admin.attachmentQuarantineDeleteFailed' }
        });
    }

    const reason = (body as { reason?: unknown }).reason;
    if (reason !== undefined && typeof reason !== 'string') {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.admin.attachmentQuarantineDeleteFailed',
            data: { code: 'errors.admin.attachmentQuarantineDeleteFailed' }
        });
    }

    const apiQuery = new URLSearchParams({
        'filter[id]': applicationId,
        'fields[application--application]': 'drupal_internal__id',
        'page[limit]': '1'
    });
    await applyAdminJurisdictionFilter(event, apiQuery, 'field_jurisdiction', { required: true });

    try {
        const scopedResponse = await drupalSessionFetch<ApplicationLookupResponse>(
            event,
            `/jsonapi/application/application?${apiQuery.toString()}`
        );
        const internalId = Number(scopedResponse.data?.[0]?.attributes?.drupal_internal__id);
        if (!Number.isInteger(internalId) || internalId <= 0) {
            throw createSafeError({
                statusCode: 404,
                message: 'errors.applications.notFound',
                data: { code: 'errors.applications.notFound' }
            });
        }

        return await drupalSessionFetch(event, `/api/admin/applications/${internalId}/attachments/${attachmentId}`, {
            method: 'DELETE',
            body: {
                reason: typeof reason === 'string' ? reason.slice(0, 500) : ''
            }
        });
    } catch (e: unknown) {
        const upstream = (e as { statusCode?: number })?.statusCode;
        const errorData = (e as { data?: { code?: unknown, upstreamCode?: unknown } })?.data;
        const code = errorData?.code;
        const upstreamCode = errorData?.upstreamCode;
        const safeCode = code !== 'errors.server.drupalRequestFailed'
            ? mapAttachmentErrorCode(code)
            : null;
        const safeUpstreamCode = mapAttachmentErrorCode(upstreamCode);
        const message = safeCode ?? 'errors.admin.attachmentQuarantineDeleteFailed';
        // 423: a running transfer holds the case; nothing was deleted.
        const mappedMessage = upstream === 423 ? 'errors.applications.dataBusy' : safeCode ?? safeUpstreamCode ?? message;
        const safeStatusCode = [400, 403, 404, 409, 422, 423].includes(upstream ?? 0) && upstream !== undefined
            ? upstream
            : 500;
        throw createSafeError({
            statusCode: safeStatusCode,
            message: mappedMessage,
            data: { code: mappedMessage }
        });
    }
});
