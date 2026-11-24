/**
 * PATCH /api/admin/applications/:id/status-rollback
 *
 * Reverts an application to the latest earlier revision with a different
 * workflow status. Drupal remains responsible for entity access, revision
 * creation and the guarded workflow-status reset.
 */
import { sameChangedTimestamp } from '~~/casework-layer/server/utils/application-concurrency';

export default defineEventHandler(async (event) => {
    await requireStaff(event);
    requireSameOriginRequest(event);
    setPrivateNoStore(event);

    const id = getRouterParam(event, 'id');
    if (!id) {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.applications.idMissing',
            data: { code: 'errors.applications.idMissing' }
        });
    }
    validateUuid(id, 'applicationId');

    const body = await readBody<{
        expectedStatusId?: string
        expectedChanged?: string
        note?: string
    }>(event);

    if (!body.expectedStatusId || typeof body.expectedStatusId !== 'string') {
        throw createSafeError({
            statusCode: 428,
            message: 'errors.admin.statusConflict',
            data: { code: 'errors.admin.statusConflict' }
        });
    }
    validateUuid(body.expectedStatusId, 'expectedStatusId');
    if (typeof body.expectedChanged !== 'string' || body.expectedChanged === '') {
        throw createSafeError({
            statusCode: 428,
            message: 'errors.admin.statusConflict',
            data: { code: 'errors.admin.statusConflict' }
        });
    }
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 2000) : '';

    try {
        const scopeQuery = new URLSearchParams({
            'filter[id]': id,
            'include': 'field_workflow_status',
            'fields[application--application]': 'drupal_internal__id,changed,field_workflow_status',
            'fields[workflow_status--workflow_status]': 'drupal_internal__id,label,field_machine_name,field_color,field_icon',
            'page[limit]': '1'
        });
        await applyAdminJurisdictionFilter(event, scopeQuery, 'field_jurisdiction', { required: true });

        const scopedResponse = await drupalSessionFetch<{
            data?: Array<{
                relationships?: {
                    field_workflow_status?: {
                        data?: { id: string } | null
                    }
                }
                attributes?: {
                    drupal_internal__id?: number | string
                    changed?: string
                }
            }>
            included?: Array<{
                type?: string
                id?: string
                attributes?: {
                    drupal_internal__id?: number | string
                }
            }>
        }>(
            event,
            `/jsonapi/application/application?${scopeQuery.toString()}`
        );

        const current = scopedResponse.data?.[0];
        if (!current) {
            throw createSafeError({
                statusCode: 404,
                message: 'errors.applications.notFound',
                data: { code: 'errors.applications.notFound' }
            });
        }

        const currentStatusId = current.relationships?.field_workflow_status?.data?.id ?? null;
        if (currentStatusId !== body.expectedStatusId) {
            throw createSafeError({
                statusCode: 409,
                message: 'errors.admin.statusConflict',
                data: { code: 'errors.admin.statusConflict' }
            });
        }
        const currentChanged = current.attributes?.changed ?? '';
        if (!sameChangedTimestamp(currentChanged, body.expectedChanged)) {
            throw createSafeError({
                statusCode: 409,
                message: 'errors.admin.statusConflict',
                data: { code: 'errors.admin.statusConflict' }
            });
        }

        const applicationInternalId = Number(current.attributes?.drupal_internal__id);
        const currentStatusInternalId = Number(scopedResponse.included?.find(resource =>
            resource.type === 'workflow_status--workflow_status' && resource.id === currentStatusId
        )?.attributes?.drupal_internal__id);
        if (
            !Number.isInteger(applicationInternalId)
            || applicationInternalId <= 0
            || !Number.isInteger(currentStatusInternalId)
            || currentStatusInternalId <= 0
        ) {
            throw createSafeError({
                statusCode: 502,
                message: 'errors.server.drupalRequestFailed',
                data: { code: 'errors.server.drupalRequestFailed' }
            });
        }

        return await drupalSessionFetch(event, `/api/admin/applications/${applicationInternalId}/status-rollback`, {
            method: 'PATCH',
            body: {
                expected_status_id: currentStatusInternalId,
                expected_changed: body.expectedChanged,
                note
            }
        });
    } catch (e: unknown) {
        const upstream = (e as { statusCode?: number })?.statusCode;
        const upstreamCode = (e as { data?: { upstreamCode?: unknown } })?.data?.upstreamCode;
        // The previous status is outside the workflow that
        // governs the form; nothing was saved, no mail went out.
        if (upstream === 422 && upstreamCode === 'workflow.rollback_target_not_in_workflow') {
            throw createSafeError({
                statusCode: 422,
                message: 'errors.admin.statusRollbackTargetNotInWorkflow',
                data: { code: 'errors.admin.statusRollbackTargetNotInWorkflow' }
            });
        }
        // 423: a running transfer holds the case; nothing was stored.
        const code = upstream === 403
            ? 'errors.admin.accessDenied'
            : upstream === 423
                ? 'errors.applications.dataBusy'
                : upstream === 409 || upstream === 428
                    ? 'errors.admin.statusConflict'
                    : upstream === 404
                        ? 'errors.applications.notFound'
                        : 'errors.admin.statusRollbackFailed';
        console.error(`[admin] Failed to roll back application ${id} status:`, e instanceof Error ? e.message : e);
        throw createSafeError({
            statusCode: upstream === 403 || upstream === 404 || upstream === 409 || upstream === 422 || upstream === 423 || upstream === 428 ? upstream : 500,
            message: code,
            data: { code }
        });
    }
});
