import { resolveAdminSchemaRoute } from '../../../../utils/admin-schema-route';

/**
 * GET /api/admin/schemas/:id/route
 *
 * Resolves the canonical admin workspace route for a form schema that is
 * visible to the current Verwaltung session.
 */
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

    return resolveAdminSchemaRoute(event, id);
});
