/**
 * PATCH /api/admin/schemas/:id/organisation
 *
 * Assigns a form of the current jurisdiction workspace to one of its
 * organisations, so the organisation's processing statuses apply. This route
 * offers only the first assignment: moving a form between organisations would
 * leave its workflow definition pointing at the old organisation's statuses.
 * The write is fenced on the revision read here, so a concurrent assignment
 * fails (Drupal answers with a generic error) instead of moving the form. Drupal checks the rest
 * (FormSchemaWorkspaceScope): the organisation must be active and belong to
 * the form's jurisdiction, the actor must administer it or its jurisdiction,
 * and no case of the form may still lack an organisation. The form editor
 * also sends the `changed` value it knows, so an assignment from there never
 * hides an edit made in another tab, and adopts the returned one.
 */

import { invalidatePublicCatalogCache } from '~~/server/utils/schema-catalog';

const UNASSIGNED_APPLICATIONS = 'Applications of this form have no organisation yet.';

interface SchemaOrganisationResponse {
    data?: Array<{
        attributes?: { drupal_internal__revision_id?: number | string, changed?: string }
        relationships?: {
            field_organisation?: { data?: { id?: string } | null }
        }
    }>
}

function fail(statusCode: number, code: string): never {
    throw createSafeError({ statusCode, message: code, data: { code } });
}

export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    requireSameOriginRequest(event);
    setPrivateNoStore(event);

    const id = getRouterParam(event, 'id');
    if (!id) fail(400, 'errors.schema.idRequired');
    validateUuid(id, 'schemaId');

    const body = await readBody<{ organisationId?: unknown, expectedChanged?: unknown }>(event);
    if (!body || typeof body !== 'object' || Object.keys(body).some(key => key !== 'organisationId' && key !== 'expectedChanged')
      || typeof body.organisationId !== 'string'
      || (body.expectedChanged !== undefined && body.expectedChanged !== null && typeof body.expectedChanged !== 'string')) {
        fail(400, 'errors.schema.organisationRequired');
    }
    const organisationId = body.organisationId;
    const expectedChanged = typeof body.expectedChanged === 'string' ? body.expectedChanged : null;
    validateUuid(organisationId, 'organisationId');

    const workspace = await resolveRequiredAdminWorkspace(event);
    if (workspace.type !== 'jurisdiction') fail(409, 'errors.schema.organisationAssignFromJurisdiction');

    const organisations = await fetchVisibleAdminWorkspaces(event);
    const organisation = organisations.find(item => item.type === 'organisation' && item.id === organisationId);
    if (!organisation || organisation.jurisdictionId !== workspace.jurisdictionId) {
        fail(404, 'errors.schema.organisationNotFound');
    }

    const query = new URLSearchParams({
        'filter[id]': id,
        'fields[form_schema--form_schema]': 'changed,drupal_internal__revision_id,field_organisation',
        'page[limit]': '1'
    });
    await applyAdminJurisdictionFilter(event, query);
    const current = await drupalSessionFetch<SchemaOrganisationResponse>(event, `/jsonapi/form_schema/form_schema?${query.toString()}`);
    const schema = current.data?.[0];
    if (!schema) fail(404, 'errors.schema.notFound');
    if (schema.relationships?.field_organisation?.data?.id) fail(409, 'errors.schema.organisationAlreadyAssigned');
    if (expectedChanged && schema.attributes?.changed && schema.attributes.changed !== expectedChanged) fail(409, 'errors.schema.modifiedInOtherTab');
    const revisionId = Number(schema.attributes?.drupal_internal__revision_id);
    if (!Number.isSafeInteger(revisionId) || revisionId < 1) fail(502, 'errors.schema.organisationAssignFailed');

    let changed: string | null = null;
    try {
        const saved = await drupalSessionFetch<{ data?: { attributes?: { changed?: string } } }>(event, `/jsonapi/form_schema/form_schema/${id}`, {
            method: 'PATCH',
            expectedRevisionId: revisionId,
            body: {
                data: {
                    type: 'form_schema--form_schema',
                    id,
                    relationships: {
                        field_organisation: { data: { type: 'group--org', id: organisationId } },
                        field_group: { data: { type: 'group--org', id: organisationId } }
                    }
                }
            }
        });
        changed = saved?.data?.attributes?.changed ?? null;
    } catch (e: unknown) {
        const failure = e as { statusCode?: number, data?: { detail?: unknown } };
        const statusCode = failure?.statusCode;
        const detail = typeof failure?.data?.detail === 'string' ? failure.data.detail : '';
        console.error(`[admin] Failed to assign schema ${id} to an organisation:`, e instanceof Error ? e.message : e);
        if (detail.includes(UNASSIGNED_APPLICATIONS)) fail(409, 'errors.schema.organisationUnassignedApplications');
        if (statusCode === 403) fail(403, 'errors.admin.accessDenied');
        if (statusCode === 404) fail(404, 'errors.schema.notFound');
        if (statusCode === 422) fail(422, 'errors.schema.organisationInvalid');
        fail(statusCode || 500, 'errors.schema.organisationAssignFailed');
    }

    invalidatePublicCatalogCache();
    return { success: true, changed, organisation: { id: organisation.id, key: organisation.key, label: organisation.label } };
});
