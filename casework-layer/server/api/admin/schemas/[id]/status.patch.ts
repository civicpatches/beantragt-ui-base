/**
 * PATCH /api/admin/schemas/:id/status
 *
 * Updates the publication workflow status of a form schema: `draft`,
 * `published` or `archived`.
 */
import type { H3Event } from 'h3';
import type { FormSchemaLifecycleStatus, FormSchemaStatusResponse } from '~~/app/types/api';
import type { FormSchema } from '~~/app/types/form';
import { fetchSetupCapabilities } from '~~/casework-layer/server/utils/schema-publish-capability';
import { assertSchemaPublishable, type StoredSchemaValue } from '~~/casework-layer/server/utils/schema-publish-check';
import { preservePrivateNoStore } from '~~/server/utils/preserve-private-no-store';
import { invalidatePublicCatalogCache } from '~~/server/utils/schema-catalog';

const ALLOWED_STATUSES: readonly FormSchemaLifecycleStatus[] = ['draft', 'published', 'archived'];

function isLifecycleStatus(status: string): status is FormSchemaLifecycleStatus {
    return ALLOWED_STATUSES.some(allowed => allowed === status);
}

interface SchemaForPublishResponse {
    data?: Array<{
        attributes?: {
            field_schema?: StoredSchemaValue
            drupal_internal__revision_id?: number | string
            field_workflow_status?: string
        }
    }>
}

/** Errors of this route that must reach the client unchanged. */
const PASSTHROUGH_CODES: ReadonlySet<string> = new Set([
    'errors.schema.publishForbidden',
    'errors.schema.modifiedInOtherTab',
    'errors.schemaSetup.loadFailed'
]);

function modifiedInOtherTab(): Error {
    return createSafeError({
        statusCode: 409,
        message: 'errors.schema.modifiedInOtherTab',
        data: { code: 'errors.schema.modifiedInOtherTab' }
    });
}

/**
 * Loads the stored schema and runs the complete Nitro pre-gate
 * (`assessSchemaPublishable`, shared with the setup review).
 */
async function assertCurrentSchemaPublishable(event: H3Event, id: string, expectedRevision: number | undefined): Promise<FormSchema> {
    const query = new URLSearchParams({
        'filter[id]': id,
        'fields[form_schema--form_schema]': 'field_schema,drupal_internal__revision_id,field_workflow_status',
        'page[limit]': '1'
    });
    await applyAdminJurisdictionFilter(event, query);

    const response = await drupalSessionFetch<SchemaForPublishResponse>(
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
    if (expectedRevision !== undefined && Number(schema.attributes?.drupal_internal__revision_id) !== expectedRevision) {
        throw modifiedInOtherTab();
    }

    return assertSchemaPublishable(
        schema.attributes?.field_schema,
        expectedRevision !== undefined && schema.attributes?.field_workflow_status === 'draft'
    );
}

/**
 * Check Drupal's `publish form_schema entities` permission before PATCH so the
 * interface can explain a refusal. Drupal's constraint remains authoritative.
 * A failed capability check blocks publishing.
 */
async function assertPublishCapability(event: H3Event, id: string): Promise<void> {
    let canPublish = false;
    try {
        const { canEdit, canPublish: allowed } = await fetchSetupCapabilities(event, id);
        canPublish = canEdit && allowed;
    } catch (error: unknown) {
        const upstreamCode = (error as { data?: { upstreamCode?: unknown } })?.data?.upstreamCode;
        if (typeof upstreamCode === 'string' && upstreamCode.startsWith('form_setup.')) throw error;
        console.error(`[admin] Publish capability of schema ${id} not available:`, error instanceof Error ? error.message : error);
        throw createSafeError({
            statusCode: 502,
            message: 'errors.schemaSetup.loadFailed',
            data: { code: 'errors.schemaSetup.loadFailed' }
        });
    }
    if (!canPublish) {
        throw createSafeError({
            statusCode: 403,
            message: 'errors.schema.publishForbidden',
            data: { code: 'errors.schema.publishForbidden' }
        });
    }
}

async function currentRevisionId(event: H3Event, id: string): Promise<number | null> {
    try {
        const query = new URLSearchParams({
            'filter[id]': id,
            'fields[form_schema--form_schema]': 'drupal_internal__revision_id',
            'page[limit]': '1'
        });
        await applyAdminJurisdictionFilter(event, query);
        const response = await drupalSessionFetch<SchemaForPublishResponse>(event, `/jsonapi/form_schema/form_schema?${query.toString()}`);
        const revisionId = Number(response.data?.[0]?.attributes?.drupal_internal__revision_id);
        return Number.isSafeInteger(revisionId) && revisionId > 0 ? revisionId : null;
    } catch {
        return null;
    }
}

async function assertCurrentSchemaInWorkspace(event: H3Event, id: string, expectedRevision?: number): Promise<void> {
    const query = new URLSearchParams({
        'filter[id]': id,
        'fields[form_schema--form_schema]': expectedRevision === undefined ? 'id' : 'drupal_internal__revision_id',
        'page[limit]': '1'
    });
    await applyAdminJurisdictionFilter(event, query);

    const response = await drupalSessionFetch<SchemaForPublishResponse>(
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
    if (expectedRevision !== undefined && Number(schema.attributes?.drupal_internal__revision_id) !== expectedRevision) {
        throw modifiedInOtherTab();
    }
}

export default defineEventHandler(async (event): Promise<FormSchemaStatusResponse> => {
    setPrivateNoStore(event);
    preservePrivateNoStore(event);
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

    const body = await readBody<{ status?: unknown, expectedRevision?: unknown } | null>(event);

    if (!body?.status || typeof body.status !== 'string') {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.schema.statusRequired',
            data: { code: 'errors.schema.statusRequired' }
        });
    }

    // `archived` takes a form off the offer and keeps its applications;
    // the way back is `draft`. Both run like `draft` today: the workspace
    // check, then the PATCH through the person's session, so Drupal decides
    // who may (no publish right is needed to leave the published state).
    if (!isLifecycleStatus(body.status)) {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.schema.invalidStatus',
            data: { code: 'errors.schema.invalidStatus', status: body.status }
        });
    }

    // The list and setup review send the displayed revision. Older editor
    // and detail callers can still omit it.
    let expectedRevision: number | undefined;
    if (Object.hasOwn(body, 'expectedRevision') && body.expectedRevision !== undefined) {
        if (typeof body.expectedRevision !== 'number' || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 1) {
            throw createSafeError({
                statusCode: 400,
                message: 'errors.schema.invalid',
                data: { code: 'errors.schema.invalid' }
            });
        }
        expectedRevision = body.expectedRevision;
    }

    try {
        const normalizedSchemaForPublish = body.status === 'published'
            ? await assertCurrentSchemaPublishable(event, id, expectedRevision)
            : null;
        if (body.status !== 'published') {
            await assertCurrentSchemaInWorkspace(event, id, expectedRevision);
        } else {
            await assertPublishCapability(event, id);
        }

        await drupalSessionFetch(
            event,
            `/jsonapi/form_schema/form_schema/${id}`,
            {
                method: 'PATCH',
                body: {
                    data: {
                        type: 'form_schema--form_schema',
                        id,
                        attributes: {
                            field_workflow_status: body.status,
                            status: body.status === 'published',
                            field_schema: normalizedSchemaForPublish
                                ? JSON.stringify(normalizedSchemaForPublish)
                                : undefined
                        }
                    }
                },
                ...(expectedRevision !== undefined ? { expectedRevisionId: expectedRevision } : {})
            }
        ).catch(async (error: unknown) => {
            // Drupal refuses a stale header with a storage exception whose
            // status is not pinned; the moved revision decides.
            if (expectedRevision !== undefined) {
                const revisionId = await currentRevisionId(event, id);
                if (revisionId !== null && revisionId !== expectedRevision) throw modifiedInOtherTab();
            }
            throw error;
        });

        invalidatePublicCatalogCache();
        return {
            success: true,
            status: body.status
        };
    } catch (e: unknown) {
        const statusCode = (e as { statusCode?: number })?.statusCode;
        const code = (e as { data?: { code?: unknown } })?.data?.code;
        if (statusCode === 422 || (typeof code === 'string' && PASSTHROUGH_CODES.has(code))) {
            throw e;
        }
        console.error(`[admin] Failed to update schema ${id} status:`, e instanceof Error ? e.message : e);
        if (statusCode === 403) {
            throw createSafeError({
                statusCode: 403,
                message: 'errors.admin.accessDenied',
                data: { code: 'errors.admin.accessDenied' }
            });
        }
        if (statusCode === 404) {
            throw createSafeError({
                statusCode: 404,
                message: 'errors.schema.notFound',
                data: { code: 'errors.schema.notFound' }
            });
        }
        throw createSafeError({
            statusCode: statusCode || 500,
            message: 'errors.schema.statusUpdateFailed',
            data: { code: 'errors.schema.statusUpdateFailed' }
        });
    }
});
