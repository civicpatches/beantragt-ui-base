/**
 * POST /api/admin/fim/import
 *
 * Imports one official FITKO/FIM JSON Schema into Drupal form_schema.
 * Requires admin authentication.
 */
import { formCreateError } from '~~/casework-layer/server/utils/form-create';

export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    setPrivateNoStore(event);
    requireSameOriginRequest(event);
    checkRateLimit(getClientIp(event), 'admin', event);

    const body = await readBody<{ file?: string, url?: string }>(event);
    const input = body?.file || body?.url;

    try {
        // No workspace, no write: the scope of the new
        // draft always comes from a workspace resolved for this session.
        const workspace = await resolveExplicitAdminWorkspace(event);
        const result = await importFimSchema(event, input, buildAdminWorkspaceScopeRelationships(workspace));
        setResponseStatus(event, 201);
        return result;
    } catch (e: unknown) {
        if (e && typeof e === 'object' && 'statusCode' in e) {
            throw e;
        }

        throw formCreateError(500, 'errors.fim.importFailed');
    }
});
