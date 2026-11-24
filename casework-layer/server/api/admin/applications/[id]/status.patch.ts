/**
 * PATCH /api/admin/applications/:id/status
 *
 * Updates the workflow status of an application through Drupal's guarded
 * status route.
 *
 * The scoped JSON:API read checks the workspace and the expected version.
 * Which targets exist comes from Drupal's internal `/workflow` route, which
 * resolves the form's current published workflow; the numeric
 * target id is taken from its `allowed_next`, so a form transition to a status
 * that is no organisation edge of the current status still resolves. The
 * Drupal backend enforces group membership and the transition again
 * (WorkflowManager). A failed or malformed `/workflow` answer is a 502
 * `errors.server.drupalRequestFailed`. Requires staff authentication,
 * same-origin and CSRF.
 */
import { sameChangedTimestamp } from '../../../../utils/application-concurrency';

import {
    applicationEffectiveTransitions,
    buildEffectiveApplicationWorkflow,
    type EffectiveApplicationTransition,
    type ApplicationWorkflowJsonApiResource
} from '../../../../utils/application-workflow-transitions';
import {
    fetchApplicationWorkflowSource,
    isApplicationWorkflowSourceFailure
} from '../../../../utils/application-workflow-source';

function emptyAttributeValue(value: unknown): boolean {
    return value === null
      || value === undefined
      || value === ''
      || (Array.isArray(value) && value.length === 0);
}

function validateTransitionAttributes(
    transition: EffectiveApplicationTransition | undefined,
    values: Record<string, unknown>
): void {
    if (!transition) return;

    const allowedCodes = new Set(transition.attributes.map(attribute => attribute.code));
    for (const code of Object.keys(values)) {
        if (!allowedCodes.has(code)) {
            throw createSafeError({
                statusCode: 422,
                message: 'errors.validation.invalidField',
                data: { code: 'errors.validation.invalidField', field: `attributes.${code}` }
            });
        }
    }

    const missing = transition.attributes.find(attribute =>
        attribute.required && emptyAttributeValue(values[attribute.code])
    );
    if (missing) {
        throw createSafeError({
            statusCode: 422,
            message: 'errors.validation.invalidField',
            data: { code: 'errors.validation.invalidField', field: `attributes.${missing.code}` }
        });
    }
}

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
        attributes?: Record<string, unknown>
        note?: string
    }>(event);
    const statusId = body.statusId;

    if (!statusId || typeof statusId !== 'string') {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.admin.statusRequired',
            data: { code: 'errors.admin.statusRequired' }
        });
    }

    validateUuid(statusId, 'statusId');
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
    if (body.attributes !== undefined) {
        if (!body.attributes || typeof body.attributes !== 'object' || Array.isArray(body.attributes)) {
            throw createSafeError({
                statusCode: 400,
                message: 'errors.validation.invalidField',
                data: { code: 'errors.validation.invalidField', field: 'attributes' }
            });
        }
        const serialized = JSON.stringify(body.attributes);
        if (serialized.length > 16_384) {
            throw createSafeError({
                statusCode: 413,
                message: 'errors.validation.payloadTooLarge',
                data: { code: 'errors.validation.payloadTooLarge' }
            });
        }
    }
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 2000) : '';

    try {
        // The form schema relationship only keys the builder result; the
        // workflow text comes from `/workflow`, never from this read.
        const scopeQuery = new URLSearchParams({
            'filter[id]': id,
            'include': 'field_workflow_status,field_workflow_status.field_group',
            'fields[application--application]': 'drupal_internal__id,changed,field_schema,field_workflow_status',
            'fields[workflow_status--workflow_status]': 'drupal_internal__id,label,field_machine_name,field_color,field_icon,field_weight,field_semantic_flags,field_group',
            'page[limit]': '1'
        });
        await applyAdminJurisdictionFilter(event, scopeQuery, 'field_jurisdiction', { required: true });
        const scopedResponse = await drupalSessionFetch<{ data?: unknown[], included?: unknown[] }>(
            event,
            `/jsonapi/application/application?${scopeQuery.toString()}`
        );

        if (!Array.isArray(scopedResponse.data) || scopedResponse.data.length === 0) {
            throw createSafeError({
                statusCode: 404,
                message: 'errors.applications.notFound',
                data: { code: 'errors.applications.notFound' }
            });
        }
        const current = scopedResponse.data[0] as ApplicationWorkflowJsonApiResource & {
            attributes?: {
                drupal_internal__id?: number | string
                changed?: string
            }
            relationships?: {
                field_workflow_status?: {
                    data?: { id: string } | null
                }
            }
        };
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
        if (currentStatusId === statusId && body.attributes !== undefined) {
            throw createSafeError({
                statusCode: 400,
                message: 'errors.validation.invalidField',
                data: { code: 'errors.validation.invalidField', field: 'attributes' }
            });
        }

        const includedByKey = new Map<string, unknown>();
        for (const item of (scopedResponse.included ?? []) as ApplicationWorkflowJsonApiResource[]) {
            if (item.id && item.type) {
                includedByKey.set(`${item.type}:${item.id}`, item);
            }
        }
        const applicationInternalId = Number(current.attributes?.drupal_internal__id);
        // Read before the builder runs: it replaces the included statuses with
        // catalogue entries that carry no internal id.
        const currentInternalId = Number((includedByKey.get(`workflow_status--workflow_status:${currentStatusId}`) as { attributes?: { drupal_internal__id?: number | string } } | undefined)?.attributes?.drupal_internal__id);
        if (
            !Number.isInteger(applicationInternalId)
            || applicationInternalId <= 0
            || !Number.isInteger(currentInternalId)
            || currentInternalId <= 0
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
        let targetInternalId = currentInternalId;
        let targetTransition: EffectiveApplicationTransition | undefined;
        if (currentStatusId !== statusId) {
            // Drupal's allowed targets replace the graph pre-check.
            const allowedTarget = workflowSource.allowedNext.find(target => target.uuid === statusId);
            if (!allowedTarget) {
                throw createSafeError({
                    statusCode: 422,
                    message: 'errors.admin.statusUpdateFailed',
                    data: { code: 'errors.admin.statusUpdateFailed' }
                });
            }
            targetInternalId = allowedTarget.id;

            const schemaRelationship = current.relationships?.field_schema?.data;
            const schemaId = schemaRelationship && !Array.isArray(schemaRelationship) ? schemaRelationship.id : null;
            const effectiveWorkflow = await buildEffectiveApplicationWorkflow(
                event,
                [current],
                includedByKey,
                undefined,
                schemaId ? { [schemaId]: workflowSource.definition } : undefined
            );
            targetTransition = applicationEffectiveTransitions(effectiveWorkflow.transitions, current)
                .find(transition => transition.targetStatusId === statusId);
        }
        validateTransitionAttributes(targetTransition, body.attributes ?? {});

        return await drupalSessionFetch(
            event,
            `/api/admin/applications/${applicationInternalId}/status`,
            {
                method: 'PATCH',
                body: {
                    expected_status_id: currentInternalId,
                    expected_changed: body.expectedChanged,
                    target_status_id: targetInternalId,
                    attributes: body.attributes ?? {},
                    note
                }
            }
        );
    } catch (e: unknown) {
        // A failed or malformed `/workflow` answer stays a 502 for the client.
        if (isApplicationWorkflowSourceFailure(e)) throw e;
        const upstream = (e as { statusCode?: number })?.statusCode;
        const code = (e as { data?: { code?: unknown } })?.data?.code;
        const safeCode = typeof code === 'string' && code.startsWith('errors.') && code !== 'errors.server.drupalRequestFailed'
            ? code
            : null;
        console.error(`[admin] Failed to update application ${id} status:`, e instanceof Error ? e.message : e);
        // 400, 403, 404 (outside the active workspace), 409 (stale row), 413,
        // 422 (invalid transition / out-of-group), 423 (a running transfer
        // holds the case, nothing was stored) and 428 are meaningful to the
        // client; everything else collapses to a generic 500.
        const message = upstream === 403 ? 'errors.admin.accessDenied' : upstream === 423 ? 'errors.applications.dataBusy' : upstream === 409 ? 'errors.admin.statusConflict' : safeCode ?? 'errors.admin.statusUpdateFailed';
        throw createSafeError({
            statusCode: upstream === 400 || upstream === 403 || upstream === 404 || upstream === 409 || upstream === 413 || upstream === 422 || upstream === 423 || upstream === 428 ? upstream : 500,
            message,
            data: { code: message }
        });
    }
});
