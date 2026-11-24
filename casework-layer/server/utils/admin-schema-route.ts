import type { H3Event } from 'h3';
import type { AdminWorkspace } from '~~/casework-layer/server/utils/admin-workspace';
import { fetchVisibleAdminWorkspaces } from '~~/casework-layer/server/utils/admin-workspace';
import { drupalSessionFetch } from '~~/server/utils/auth';
import { createSafeError } from '~~/server/utils/error-handling';
import { validateUuid } from '~~/server/utils/validation';

interface JsonApiRelationshipData {
    id?: string
    type?: string
}

interface FormSchemaRouteResource {
    id?: string
    relationships?: {
        field_jurisdiction?: { data?: JsonApiRelationshipData | null }
        field_organisation?: { data?: JsonApiRelationshipData | null }
        field_group?: { data?: JsonApiRelationshipData | null }
    }
}

interface FormSchemaRouteResponse {
    data?: FormSchemaRouteResource[]
}

export interface AdminSchemaRouteResponse {
    path: string
    workspace: {
        key: string
        label: string
        type: AdminWorkspace['type']
    }
}

function relationshipData(resource: FormSchemaRouteResource, field: keyof NonNullable<FormSchemaRouteResource['relationships']>): JsonApiRelationshipData | null {
    const data = resource.relationships?.[field]?.data;
    return data && !Array.isArray(data) ? data : null;
}

function relationshipId(resource: FormSchemaRouteResource, field: keyof NonNullable<FormSchemaRouteResource['relationships']>): string | null {
    return relationshipData(resource, field)?.id ?? null;
}

function visibleWorkspaceForSchema(
    schema: FormSchemaRouteResource,
    workspaces: readonly AdminWorkspace[]
): AdminWorkspace | null {
    const group = relationshipData(schema, 'field_group');
    const organisationId = relationshipId(schema, 'field_organisation') || (group?.type === 'group--org' ? group.id ?? null : null);
    const jurisdictionId = relationshipId(schema, 'field_jurisdiction') || (group?.type === 'group--jur' ? group.id ?? null : null);

    if (organisationId) {
        const organisationWorkspace = workspaces.find(workspace =>
            workspace.type === 'organisation'
            && workspace.id === organisationId
            && (!jurisdictionId || workspace.jurisdictionId === jurisdictionId)
        );
        if (organisationWorkspace) return organisationWorkspace;
    }

    if (jurisdictionId) {
        return workspaces.find(workspace =>
            workspace.type === 'jurisdiction'
            && workspace.jurisdictionId === jurisdictionId
        ) ?? null;
    }

    return null;
}

export async function resolveAdminSchemaRoute(
    event: H3Event,
    schemaId: string
): Promise<AdminSchemaRouteResponse> {
    validateUuid(schemaId, 'schemaId');
    const workspaces = await fetchVisibleAdminWorkspaces(event);

    const query = new URLSearchParams({
        'filter[id]': schemaId,
        'include': 'field_jurisdiction,field_organisation,field_group',
        'fields[form_schema--form_schema]': 'id,field_jurisdiction,field_organisation,field_group',
        'page[limit]': '1'
    });

    let response: FormSchemaRouteResponse;
    try {
        response = await drupalSessionFetch<FormSchemaRouteResponse>(
            event,
            `/jsonapi/form_schema/form_schema?${query.toString()}`
        );
    } catch (error: unknown) {
        const statusCode = error && typeof error === 'object' && 'statusCode' in error
            ? Number((error as { statusCode?: unknown }).statusCode)
            : 500;
        if (statusCode === 403 || statusCode === 404) {
            throw createSafeError({
                statusCode: 404,
                message: 'errors.schema.notFound',
                data: { code: 'errors.schema.notFound' }
            });
        }
        throw error;
    }

    const schema = response.data?.[0];
    const id = schema?.id;
    if (!schema || !id) {
        throw createSafeError({
            statusCode: 404,
            message: 'errors.schema.notFound',
            data: { code: 'errors.schema.notFound' }
        });
    }

    const workspace = visibleWorkspaceForSchema(schema, workspaces);
    if (!workspace) {
        throw createSafeError({
            statusCode: 404,
            message: 'errors.schema.notFound',
            data: { code: 'errors.schema.notFound' }
        });
    }

    return {
        path: `${workspace.path}/admin/forms/${id}`,
        workspace: {
            key: workspace.key,
            label: workspace.label,
            type: workspace.type
        }
    };
}
