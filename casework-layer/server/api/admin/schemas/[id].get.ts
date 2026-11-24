/**
 * GET /api/admin/schemas/:id
 *
 * Proxies single form_schema from Drupal JSON:API.
 * Requires admin authentication.
 */
import { fetchSetupCapabilities } from '../../../utils/schema-publish-capability';

export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    setPrivateNoStore(event);
    const id = getRouterParam(event, 'id');

    if (!id) {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.schema.idRequired',
            data: { code: 'errors.schema.idRequired' }
        });
    }

    validateUuid(id, 'schemaId');

    try {
        const apiQuery = new URLSearchParams({
            'filter[id]': id,
            'page[limit]': '1'
        });
        await applyAdminJurisdictionFilter(event, apiQuery);

        const response = await drupalSessionFetch<{
            data?: unknown[]
            included?: unknown[]
        }>(
            event,
            `/jsonapi/form_schema/form_schema?${apiQuery.toString()}`
        );

        const data = Array.isArray(response.data) ? response.data[0] : null;
        if (!data) {
            throw createSafeError({
                statusCode: 404,
                message: 'errors.schema.notFound',
                data: { code: 'errors.schema.notFound' }
            });
        }

        const capabilities = getQuery(event).capabilities === '1'
            ? await fetchSetupCapabilities(event, id).catch(() => undefined)
            : undefined;
        return {
            data,
            ...(capabilities && { capabilities }),
            included: response.included || []
        };
    } catch (e: unknown) {
        const status = (e as { statusCode?: number })?.statusCode || 500;
        const code = status === 404 ? 'errors.schema.notFound' : 'errors.schema.loadFailed';
        throw createSafeError({
            statusCode: status === 404 ? 404 : 500,
            message: code,
            data: { code }
        });
    }
});
