/**
 * DELETE /api/admin/schemas/:id
 *
 * Deletes a draft form_schema via Drupal JSON:API. Published and archived
 * forms remain records and must be handled through their workflow instead.
 */
import type { H3Event } from 'h3';

interface JsonApiCollection<T = unknown> {
    data?: T[]
}

interface SchemaSummary {
    attributes?: {
        field_workflow_status?: string
        status?: boolean
        changed?: string
    }
}

function readExpectedChanged(event: H3Event): string {
    const expectedChanged = getQuery(event).expectedChanged;
    if (typeof expectedChanged !== 'string' || !expectedChanged.trim()) {
        throw createSafeError({
            statusCode: 428,
            message: 'errors.schema.staleVersionMissing',
            data: { code: 'errors.schema.staleVersionMissing' }
        });
    }

    return expectedChanged;
}

async function loadSchemaForDeletion(event: H3Event, id: string, expectedChanged: string): Promise<void> {
    const query = new URLSearchParams({
        'filter[id]': id,
        'fields[form_schema--form_schema]': 'field_workflow_status,status,changed',
        'page[limit]': '1'
    });
    await applyAdminJurisdictionFilter(event, query, 'field_jurisdiction', { required: true });

    const response = await drupalSessionFetch<JsonApiCollection<SchemaSummary>>(
        event,
        `/jsonapi/form_schema/form_schema?${query.toString()}`
    );
    const schema = response.data?.[0];
    if (!schema) {
        throw createSafeError({
            statusCode: 404,
            message: 'errors.schema.notFound',
            data: { code: 'errors.schema.notFound' }
        });
    }

    if (schema.attributes?.field_workflow_status !== 'draft' || schema.attributes?.status !== false) {
        throw createSafeError({
            statusCode: 409,
            message: 'errors.schema.draftDeleteOnly',
            data: { code: 'errors.schema.draftDeleteOnly' }
        });
    }

    if (!schema.attributes?.changed || schema.attributes.changed !== expectedChanged) {
        throw createSafeError({
            statusCode: 409,
            message: 'errors.schema.modifiedInOtherTab',
            data: { code: 'errors.schema.modifiedInOtherTab' }
        });
    }
}

async function hasApplicationReferences(event: H3Event, id: string): Promise<boolean> {
    const query = new URLSearchParams({
        'filter[field_schema.id]': id,
        'fields[application--application]': 'field_schema',
        'page[limit]': '1'
    });
    await applyAdminJurisdictionFilter(event, query, 'field_jurisdiction', { required: true });

    const response = await drupalSessionFetch<JsonApiCollection>(
        event,
        `/jsonapi/application/application?${query.toString()}`
    );
    if (!Array.isArray(response?.data)) {
        throw createSafeError({ statusCode: 502, message: 'errors.schema.deleteFailed' });
    }
    return response.data.length > 0;
}

async function hasSchemaGroupReferences(event: H3Event, id: string): Promise<boolean> {
    const query = new URLSearchParams({
        'filter[field_schemas.id]': id,
        'fields[form_schema_group--form_schema_group]': 'field_schemas',
        'page[limit]': '1'
    });
    await applyAdminJurisdictionFilter(event, query, 'field_jurisdiction', { required: true });

    const response = await drupalSessionFetch<JsonApiCollection>(
        event,
        `/jsonapi/form_schema_group/form_schema_group?${query.toString()}`
    );
    if (!Array.isArray(response?.data)) {
        throw createSafeError({ statusCode: 502, message: 'errors.schema.deleteFailed' });
    }
    return response.data.length > 0;
}

export default defineEventHandler(async (event) => {
    setPrivateNoStore(event);
    await requireAdmin(event);
    requireSameOriginRequest(event);

    const id = getRouterParam(event, 'id');

    if (!id) {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.schema.idRequired',
            data: { code: 'errors.schema.idRequired' }
        });
    }

    validateUuid(id, 'schemaId');
    const expectedChanged = readExpectedChanged(event);

    try {
        await loadSchemaForDeletion(event, id, expectedChanged);

        if (await hasApplicationReferences(event, id)) {
            throw createSafeError({
                statusCode: 409,
                message: 'errors.schema.cannotDeleteWithApplications',
                data: { code: 'errors.schema.cannotDeleteWithApplications' }
            });
        }

        if (await hasSchemaGroupReferences(event, id)) {
            throw createSafeError({
                statusCode: 409,
                message: 'errors.schema.cannotDeleteUsedInGroup',
                data: { code: 'errors.schema.cannotDeleteUsedInGroup' }
            });
        }

        await drupalSessionFetch(
            event,
            `/jsonapi/form_schema/form_schema/${id}`,
            { method: 'DELETE' }
        );

        return { success: true };
    } catch (e: unknown) {
        console.error(`[admin] Failed to delete schema ${id}:`, e instanceof Error ? e.message : e);
        const statusCode = (e as { statusCode?: number })?.statusCode || 500;
        const existingCode = (e as { data?: { code?: unknown } })?.data?.code;
        const code = (statusCode === 404 || statusCode === 409) && typeof existingCode === 'string'
            ? existingCode
            : 'errors.schema.deleteFailed';

        throw createSafeError({
            statusCode,
            message: code,
            data: { code }
        });
    }
});
