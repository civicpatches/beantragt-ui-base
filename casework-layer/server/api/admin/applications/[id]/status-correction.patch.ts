/**
 * PATCH /api/admin/applications/:id/status-correction
 *
 * Sets a valid status for an application whose current status is no longer
 * part of its form's published workflow (review code
 * `status_not_in_workflow`). Drupal saves it as an administrative reset: no
 * transition or attribute validation, no transfer start, never an approval or
 * rejection status.
 *
 * Built like the rollback route: workspace-scoped read, expectation checks,
 * then the review state and the allowed correction targets from Drupal's
 * internal `/workflow` route. A failed or malformed `/workflow` answer is a
 * 502 `errors.server.drupalRequestFailed`, passed through the catch block
 * unchanged. Drupal remains responsible for entity access, the permission,
 * the scope check and the guarded save.
 *
 * Internal admin route for the staff UI only (not part of `/api/v1`), so it
 * has no OpenAPI entry and no Bruno request.
 */
import { sameChangedTimestamp } from '~~/casework-layer/server/utils/application-concurrency';
import {
    fetchApplicationWorkflowSource,
    isApplicationWorkflowSourceFailure
} from '~~/casework-layer/server/utils/application-workflow-source';

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
        statusId?: string
        expectedStatusId?: string
        expectedChanged?: string
        note?: string
    }>(event);

    if (!body?.statusId || typeof body.statusId !== 'string') {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.admin.statusRequired',
            data: { code: 'errors.admin.statusRequired' }
        });
    }
    validateUuid(body.statusId, 'statusId');
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
    const statusId = body.statusId;
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 2000) : '';

    try {
        const scopeQuery = new URLSearchParams({
            'filter[id]': id,
            'include': 'field_workflow_status',
            'fields[application--application]': 'drupal_internal__id,changed,field_workflow_status',
            'fields[workflow_status--workflow_status]': 'drupal_internal__id',
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
        if (!sameChangedTimestamp(current.attributes?.changed ?? '', body.expectedChanged)) {
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

        const workflowSource = await fetchApplicationWorkflowSource(event, applicationInternalId);
        if (!workflowSource.canChangeStatus) {
            throw createSafeError({
                statusCode: 403,
                message: 'errors.admin.accessDenied',
                data: { code: 'errors.admin.accessDenied' }
            });
        }
        if (!workflowSource.review) {
            // The application is no longer in the review state.
            throw createSafeError({
                statusCode: 409,
                message: 'errors.admin.statusConflict',
                data: { code: 'errors.admin.statusConflict' }
            });
        }
        const target = workflowSource.review.targets.find(candidate => candidate.uuid === statusId);
        if (!target || statusId === currentStatusId) {
            throw createSafeError({
                statusCode: 422,
                message: 'errors.admin.statusCorrectionFailed',
                data: { code: 'errors.admin.statusCorrectionFailed' }
            });
        }

        await drupalSessionFetch(event, `/api/admin/applications/${applicationInternalId}/status-correction`, {
            method: 'PATCH',
            body: {
                expected_status_id: currentStatusInternalId,
                expected_changed: body.expectedChanged,
                target_status_id: target.id,
                note
            }
        });
        return { success: true };
    } catch (e: unknown) {
        if (isApplicationWorkflowSourceFailure(e)) throw e;
        const upstream = (e as { statusCode?: number })?.statusCode;
        // 423: a running transfer holds the case; nothing was stored.
        const code = upstream === 403
            ? 'errors.admin.accessDenied'
            : upstream === 423
                ? 'errors.applications.dataBusy'
                : upstream === 409 || upstream === 428
                    ? 'errors.admin.statusConflict'
                    : upstream === 404
                        ? 'errors.applications.notFound'
                        : 'errors.admin.statusCorrectionFailed';
        console.error(`[admin] Failed to correct application ${id} status:`, e instanceof Error ? e.message : e);
        throw createSafeError({
            statusCode: upstream === 403 || upstream === 404 || upstream === 409 || upstream === 422 || upstream === 423 || upstream === 428 ? upstream : 500,
            message: code,
            data: { code }
        });
    }
});
