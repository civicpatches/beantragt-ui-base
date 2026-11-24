/**
 * DELETE /api/admin/applications/:id
 *
 * Permanently deletes one tenant-scoped application through Drupal's audited
 * entity endpoint. The public UUID is resolved to an internal ID only after
 * applying the active administrative workspace filter.
 */
import { sameChangedTimestamp } from '../../../../utils/application-concurrency';

import { applyAdminJurisdictionFilter } from '~~/casework-layer/server/utils/admin-workspace';
import { drupalSessionFetch } from '~~/server/utils/auth';
import { requireSameOriginRequest, setPrivateNoStore } from '~~/server/utils/request-security';
import { validateUuid } from '~~/server/utils/validation';

interface ApplicationLookupResponse {
    data?: Array<{
        attributes?: {
            drupal_internal__id?: number | string
            changed?: string
        }
    }>
}

export default defineEventHandler(async (event) => {
    await requireStaff(event);
    requireSameOriginRequest(event);
    setPrivateNoStore(event);

    const applicationId = validateUuid(getRouterParam(event, 'id'), 'applicationId');
    const body = await readBody<{ expectedChanged?: unknown }>(event);
    if (typeof body?.expectedChanged !== 'string' || body.expectedChanged === '') {
        throw createSafeError({
            statusCode: 428,
            message: 'errors.applications.deleteConflict',
            data: { code: 'errors.applications.deleteConflict' }
        });
    }

    try {
        const scopeQuery = new URLSearchParams({
            'filter[id]': applicationId,
            'fields[application--application]': 'drupal_internal__id,changed',
            'page[limit]': '1'
        });
        await applyAdminJurisdictionFilter(event, scopeQuery, 'field_jurisdiction', { required: true });

        const scopedResponse = await drupalSessionFetch<ApplicationLookupResponse>(
            event,
            `/jsonapi/application/application?${scopeQuery.toString()}`
        );
        const application = scopedResponse.data?.[0];
        if (!application) {
            throw createSafeError({
                statusCode: 404,
                message: 'errors.applications.notFound',
                data: { code: 'errors.applications.notFound' }
            });
        }

        const internalId = Number(application.attributes?.drupal_internal__id);
        if (!Number.isInteger(internalId) || internalId <= 0) {
            throw createSafeError({
                statusCode: 502,
                message: 'errors.applications.deleteFailed',
                data: { code: 'errors.applications.deleteFailed' }
            });
        }
        if (!sameChangedTimestamp(application.attributes?.changed, body.expectedChanged)) {
            throw createSafeError({
                statusCode: 409,
                message: 'errors.applications.deleteConflict',
                data: { code: 'errors.applications.deleteConflict' }
            });
        }

        await drupalSessionFetch(event, `/api/admin/applications/${internalId}`, {
            method: 'DELETE',
            body: { expected_changed: body.expectedChanged }
        });

        return { success: true, id: applicationId };
    } catch (error: unknown) {
        const statusCode = (error as { statusCode?: number })?.statusCode;
        const code = (error as { data?: { code?: unknown } })?.data?.code;
        const safeCode = typeof code === 'string' && code.startsWith('errors.')
          && code !== 'errors.server.drupalRequestFailed'
            ? code
            : null;
        const safeStatusCode = statusCode && statusCode >= 400 && statusCode < 500
            ? statusCode
            : 502;
        const fallbackCode = statusCode === 403
            ? 'errors.admin.accessDenied'
            : statusCode === 409 || statusCode === 428
                ? 'errors.applications.deleteConflict'
                : statusCode === 404
                    ? 'errors.applications.notFound'
                    : 'errors.applications.deleteFailed';

        console.error(
            `[admin] Failed to delete application ${applicationId}:`,
            error instanceof Error ? error.message : error
        );
        throw createSafeError({
            statusCode: safeStatusCode,
            message: safeCode || fallbackCode,
            data: { code: safeCode || fallbackCode }
        });
    }
});
