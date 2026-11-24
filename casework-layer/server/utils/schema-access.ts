import type { H3Event } from 'h3';
import { drupalSessionFetch } from '~~/server/utils/auth';
import type { AdminWorkspace } from '~~/casework-layer/server/utils/admin-workspace';

interface FormSchemaAccessResponse {
    data?: {
        id?: string
        relationships?: {
            field_jurisdiction?: JsonApiRelationship
            field_organisation?: JsonApiRelationship
            field_group?: JsonApiRelationship
        }
    }
}

interface JsonApiRelationship {
    data?: { id?: string, type?: string } | null
}

export interface SchemaScope {
    type: 'organisation' | 'jurisdiction'
    id: string
}

function getRelationshipId(relationship?: JsonApiRelationship): string | null {
    return relationship?.data?.id || null;
}

function createSchemaScopeError(): Error {
    return createError({
        statusCode: 400,
        message: 'errors.schema.crossTenant',
        data: { code: 'errors.schema.crossTenant' }
    });
}

function resolveSchemaScope(schema: FormSchemaAccessResponse): SchemaScope | null {
    const relationships = schema.data?.relationships;
    if (!relationships) return null;

    const organisationId = getRelationshipId(relationships.field_organisation);
    if (organisationId) {
        return { type: 'organisation', id: organisationId };
    }

    const jurisdictionId = getRelationshipId(relationships.field_jurisdiction);
    if (jurisdictionId) {
        return { type: 'jurisdiction', id: jurisdictionId };
    }

    const legacyGroupId = getRelationshipId(relationships.field_group);
    if (legacyGroupId) {
        const legacyGroupType = relationships.field_group?.data?.type;
        if (legacyGroupType === 'group--org') {
            return { type: 'organisation', id: legacyGroupId };
        }
        if (legacyGroupType === 'group--jur') {
            return { type: 'jurisdiction', id: legacyGroupId };
        }
    }

    return null;
}

export function schemaScopeForWorkspace(workspace: AdminWorkspace): SchemaScope {
    return workspace.type === 'organisation'
        ? { type: 'organisation', id: workspace.id }
        : { type: 'jurisdiction', id: workspace.jurisdictionId };
}

function assertSameSchemaScope(schemas: FormSchemaAccessResponse[]): SchemaScope {
    const referenceScope = resolveSchemaScope(schemas[0] ?? {});
    if (!referenceScope) {
        throw createSchemaScopeError();
    }

    for (const schema of schemas.slice(1)) {
        const scope = resolveSchemaScope(schema);
        if (!scope || scope.type !== referenceScope.type || scope.id !== referenceScope.id) {
            throw createSchemaScopeError();
        }
    }

    return referenceScope;
}

export async function assertFormSchemasAccessible(
    event: H3Event,
    schemaIds: string[],
    expectedScope?: SchemaScope
): Promise<void> {
    const schemas: FormSchemaAccessResponse[] = [];

    for (const schemaId of schemaIds) {
        const schema = await drupalSessionFetch<FormSchemaAccessResponse>(
            event,
            `/jsonapi/form_schema/form_schema/${schemaId}?fields[form_schema--form_schema]=id,field_jurisdiction,field_organisation,field_group`
        );
        schemas.push(schema);
    }

    const schemaScope = assertSameSchemaScope(schemas);
    if (
        expectedScope
        && (schemaScope.type !== expectedScope.type || schemaScope.id !== expectedScope.id)
    ) {
        throw createSchemaScopeError();
    }
}
