/**
 * POST /api/admin/form-schema-groups
 *
 * Creates a form_schema_group through Drupal JSON:API.
 * Requires admin authentication and same-origin request headers.
 */
import { formCreateError, normalizeFormCreateError, postFormResourceAsSession } from '~~/casework-layer/server/utils/form-create';

interface CreateFormSchemaGroupBody {
    title?: unknown
    description?: unknown
    schemaIds?: unknown
}

function validateSchemaIds(value: unknown): string[] {
    if (!Array.isArray(value) || value.length === 0 || value.length > 50) {
        throw formCreateError(422, 'errors.schema.invalid');
    }

    try {
        return [...new Set(value.map(id => validateUuid(id, 'schemaId')))];
    } catch {
        throw formCreateError(422, 'errors.schema.invalid');
    }
}

export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    requireSameOriginRequest(event);
    setPrivateNoStore(event);

    const body = await readBody<CreateFormSchemaGroupBody>(event) || {};
    const title = sanitizeString(body.title, 255).trim();
    const description = sanitizeString(body.description, 2000).trim();
    const schemaIds = validateSchemaIds(body.schemaIds);

    if (title.length < 3) {
        throw formCreateError(422, 'errors.schema.invalid');
    }

    const workspace = await resolveExplicitAdminWorkspace(event);
    try {
        // Drupal validates the visibility and scope of the references in the POST.
        const result = await postFormResourceAsSession<{ data?: { id?: string } }>(
            event,
            '/jsonapi/form_schema_group/form_schema_group',
            {
                data: {
                    type: 'form_schema_group--form_schema_group',
                    attributes: {
                        label: title,
                        field_description: description,
                        field_workflow_status: 'draft'
                    },
                    relationships: {
                        ...buildAdminWorkspaceScopeRelationships(workspace),
                        field_schemas: {
                            data: schemaIds.map(id => ({
                                type: 'form_schema--form_schema',
                                id
                            }))
                        }
                    }
                }
            }
        );
        if (!result?.data?.id) throw formCreateError(502, 'errors.formGroups.createFailed');
        setResponseStatus(event, 201);
        return result;
    } catch (e: unknown) {
        throw normalizeFormCreateError(e, 'errors.formGroups.createFailed');
    }
});
