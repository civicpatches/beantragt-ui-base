/**
 * GET /api/admin/applications/:id/assignees
 *
 * Returns assignment candidates for a workspace-scoped application.
 */
import { setPrivateNoStore } from '~~/server/utils/request-security';

export default defineEventHandler(async (event) => {
    await requireStaff(event);
    setPrivateNoStore(event);

    const id = getRouterParam(event, 'id');
    if (!id) {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.applications.idMissing',
            data: { code: 'errors.applications.idMissing' }
        });
    }
    validateUuid(id, 'applicationId');

    const apiQuery = new URLSearchParams({
        'filter[id]': id,
        'fields[application--application]': 'drupal_internal__id',
        'page[limit]': '1'
    });
    await applyAdminJurisdictionFilter(event, apiQuery, 'field_jurisdiction', { required: true });

    try {
        const scopedResponse = await drupalSessionFetch<{
            data?: Array<{ attributes?: { drupal_internal__id?: number | string } }>
        }>(event, `/jsonapi/application/application?${apiQuery.toString()}`);
        const internalId = Number(scopedResponse.data?.[0]?.attributes?.drupal_internal__id);
        if (!Number.isInteger(internalId) || internalId <= 0) {
            throw createSafeError({
                statusCode: 404,
                message: 'errors.applications.notFound',
                data: { code: 'errors.applications.notFound' }
            });
        }

        return await drupalSessionFetch(event, `/api/admin/applications/${internalId}/assignees`);
    } catch (e: unknown) {
        const upstream = (e as { statusCode?: number })?.statusCode;
        const message = upstream === 404 ? 'errors.applications.notFound' : 'errors.admin.assigneesLoadFailed';
        throw createSafeError({
            statusCode: upstream === 403 || upstream === 404 ? upstream : 500,
            message,
            data: { code: message }
        });
    }
});
