/** Creates an unpublished FormSchema draft from one UTF-8 JSON file (up to 2 MiB). */
import { defineEventHandler, setResponseStatus } from 'h3';
import { requireAdmin } from '~~/server/utils/auth';
import { preservePrivateNoStore } from '~~/server/utils/preserve-private-no-store';
import { checkRateLimit, getClientIp } from '~~/server/utils/rate-limit';
import { requireSameOriginRequest, setPrivateNoStore } from '~~/server/utils/request-security';
import { buildAdminWorkspaceScopeRelationships, resolveExplicitAdminWorkspace } from '../../../utils/admin-workspace';
import { formCreateError, normalizeFormCreateError, postFormResourceAsSession } from '../../../utils/form-create';
import { readSchemaFileImport } from '../../../utils/schema-file-import';

export default defineEventHandler(async (event) => {
    setPrivateNoStore(event);
    preservePrivateNoStore(event);
    requireSameOriginRequest(event);
    checkRateLimit(getClientIp(event), 'admin', event);
    await requireAdmin(event);

    const schema = await readSchemaFileImport(event);
    const workspace = await resolveExplicitAdminWorkspace(event);
    if (workspace.canCreateFormSchema !== true) {
        throw formCreateError(403, 'errors.schema.writeForbidden');
    }

    try {
        const response = await postFormResourceAsSession<{ data?: { id?: string } }>(
            event,
            '/jsonapi/form_schema/form_schema',
            {
                data: {
                    type: 'form_schema--form_schema',
                    attributes: {
                        label: schema.title,
                        field_description: schema.description,
                        field_schema: schema.definition,
                        field_workflow_status: 'draft',
                        field_publication_scope: 'internet',
                        status: false
                    },
                    relationships: buildAdminWorkspaceScopeRelationships(workspace)
                }
            }
        );
        const entityId = response?.data?.id;
        if (!entityId) throw formCreateError(502, 'errors.schema.importFailed');
        setResponseStatus(event, 201);
        return { entityId };
    } catch (error: unknown) {
        throw normalizeFormCreateError(error, 'errors.schema.importFailed', { includeSchemaRefusal: false });
    }
});
