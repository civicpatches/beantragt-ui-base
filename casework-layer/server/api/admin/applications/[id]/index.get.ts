/**
 * Internal staff response for the Nuxt UI, not part of /api/v1.
 * GET /api/admin/applications/:id
 *
 * Proxies a single application with included schema from Drupal JSON:API.
 * Requires staff authentication.
 *
 * The included form schema is the intake revision (fields, validation,
 * display). Transitions come from the form's governing workflow revision
 * through Drupal's internal `/workflow` route; if that route
 * fails, the page still loads without transitions, never with the intake
 * workflow.
 *
 * `meta.attachments[]`: the plain fields of each row (`PLAIN_ATTACHMENT_FIELDS`)
 * plus what a layer registered for the row (`caseAttachmentResponseExtras`,
 * contract 4.2). Pro adds analysis, guard and the batch pre-check; the
 * open build sends the plain fields only.
 */
import { setPrivateNoStore } from '~~/server/utils/request-security';
import { normalizeApplicationConsents } from '~~/app/utils/application-consent';
import type { AdminApplicationProof, AdminApplicationProofCompleteness, ApplicationDataEditBlockedReason } from '~~/app/types/admin';
import {
    buildEffectiveApplicationWorkflow,
    type ApplicationWorkflowJsonApiResource,
    type EffectiveAllowedNext,
    type EffectiveApplicationTransitions
} from '../../../../utils/application-workflow-transitions';
import {
    allowedNextWithoutAttributes,
    fetchApplicationWorkflowSource,
    transitionsForAllowedTargets,
    type ApplicationWorkflowSource
} from '../../../../utils/application-workflow-source';
import {
    fetchStaffApplicationDetail,
    staffApplicationJsonApiAttributes,
    stripDrupalInternalId
} from '../../../../utils/staff-applications';
import { caseAttachmentResponseExtras } from '../../../../utils/case-response-extensions';
import { toPublicDrupalUrl } from '../../../../utils/public-drupal-url';

interface StatusRollbackTargetResponse {
    available?: boolean
    /** Expose only the rollback refusal reasons the page can display. */
    reason?: unknown
    currentStatus?: {
        id?: string
        internalId?: number
        label?: string
        machineName?: string
        color?: string
        icon?: string
    }
    targetStatus?: {
        id?: string
        internalId?: number
        label?: string
        machineName?: string
        color?: string
        icon?: string
    }
    currentStatusRevision?: {
        id?: number
        created?: number
        authorName?: string
        authorSystem?: boolean
    }
}

/** The fields of an attachment row the route passes on itself; every other key comes from a registered extension. */
const PLAIN_ATTACHMENT_FIELDS: ReadonlySet<string> = new Set([
    'id', 'type', 'fieldId', 'fileId', 'comment', 'filename', 'url', 'mimeType', 'size', 'scanStatus', 'scanMessage', 'canResolveQuarantine', 'createdAt'
]);

interface AdminAttachmentRow {
    id?: string
    type?: 'application_attachment'
    fieldId?: string
    filename?: string
    url?: string
    mimeType?: string
    size?: number
    scanStatus?: string
    scanMessage?: string
    canResolveQuarantine?: boolean
    createdAt?: string
    /** Keys only an extension passes on (analysis, guard, pre-check). */
    [key: string]: unknown
}

interface AdminAttachmentResponse {
    data?: AdminAttachmentRow[]
    meta?: { proofCompleteness?: AdminApplicationProofCompleteness }
}

function attachmentProofCompleteness(
    projection: AdminApplicationProofCompleteness | undefined,
    visibleIds: ReadonlySet<unknown>
): AdminApplicationProofCompleteness | undefined {
    if (projection === undefined) return undefined;
    const isCount = (value: number) => Number.isSafeInteger(value) && value >= 0;
    const statuses: AdminApplicationProof['status'][] = ['present', 'missing', 'illegible', 'needs_review'];
    if (projection?.available !== true || !isCount(projection.required) || !isCount(projection.present)
      || !isCount(projection.missing) || projection.present + projection.missing > projection.required
      || !Array.isArray(projection.proofs) || !Array.isArray(projection.unassignedAttachmentIds)
      || projection.proofs.some(proof => !proof || typeof proof.fieldId !== 'string' || typeof proof.label !== 'string'
        || typeof proof.required !== 'boolean' || (proof.personIndex !== null && !isCount(proof.personIndex))
        || !statuses.includes(proof.status) || !Array.isArray(proof.attachmentIds))) {
        return { available: false };
    }
    return {
        available: true,
        required: projection.required,
        present: projection.present,
        missing: projection.missing,
        proofs: projection.proofs.map(({ fieldId, label, required, personIndex, status, attachmentIds }) => ({
            fieldId, label, required, personIndex, status,
            attachmentIds: attachmentIds.filter(id => visibleIds.has(id))
        })),
        unassignedAttachmentIds: projection.unassignedAttachmentIds.filter(id => visibleIds.has(id))
    };
}

/**
 * One row of `meta.attachments`. Keys keep Drupal's order: a plain field or an extension key stands where Drupal sent
 * it; extension keys Drupal did not send follow the last plain field (before the pre-check block Drupal appends last),
 * which is where the route put them before the seam. An extension cannot replace a plain field.
 */
function attachmentResponseRow(raw: AdminAttachmentRow & { fieldId: string, url: string }): Record<string, unknown> {
    const extras = caseAttachmentResponseExtras(raw, { fieldId: raw.fieldId });
    const entries: Array<[string, unknown]> = [];
    let afterLastPlain = 0;
    for (const key of Object.keys(raw)) {
        if (PLAIN_ATTACHMENT_FIELDS.has(key)) {
            entries.push([key, key === 'url' ? toPublicDrupalUrl(raw.url) : raw[key]]);
            afterLastPlain = entries.length;
        } else if (Object.hasOwn(extras, key)) {
            entries.push([key, extras[key]]);
        }
    }
    const added = Object.entries(extras).filter(([key]) => !PLAIN_ATTACHMENT_FIELDS.has(key) && !Object.hasOwn(raw, key));
    entries.splice(afterLastPlain, 0, ...added);
    return Object.fromEntries(entries);
}

interface ProtectedApplicationDataResponse {
    data?: Record<string, unknown>
    meta?: {
        protected_data_redacted?: boolean
        can_edit_data?: boolean
        can_delete?: boolean
        edit_data_blocked_reason?: unknown
        schema?: {
            id?: string
            type?: 'form_schema--form_schema'
            attributes?: Record<string, unknown>
        } | null
    }
}

type PublicRollbackStatus = Omit<NonNullable<StatusRollbackTargetResponse['targetStatus']>, 'internalId'>;
type PublicRollbackRevision = Omit<NonNullable<StatusRollbackTargetResponse['currentStatusRevision']>, 'id'>;

function publicRollbackStatus(
    status: StatusRollbackTargetResponse['targetStatus']
): PublicRollbackStatus | undefined {
    if (!status) return undefined;
    const { internalId: _internalId, ...publicStatus } = status;
    return publicStatus;
}

function publicRollbackRevision(
    revision: StatusRollbackTargetResponse['currentStatusRevision']
): PublicRollbackRevision | undefined {
    if (!revision) return undefined;
    const { id: _id, ...publicRevision } = revision;
    return publicRevision;
}

export default defineEventHandler(async (event) => {
    await requireStaff(event);
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

    try {
        const workspace = await resolveRequiredAdminWorkspace(event);
        const apiQuery = new URLSearchParams({
            'filter[id]': id,
            'include': 'field_schema,field_workflow_status,field_workflow_status.field_allowed_next,field_workflow_status.field_group',
            'fields[application--application]': [
                'drupal_internal__id',
                'drupal_internal__revision_id',
                'field_reference_number',
                'field_origin',
                'field_schema_version',
                'changed',
                'created',
                'field_schema',
                'field_workflow_status',
                'field_due_date'
            ].join(','),
            'fields[form_schema--form_schema]': 'label,field_schema,field_workflow_definition,field_version,changed',
            'fields[workflow_status--workflow_status]': 'label,field_machine_name,field_color,field_icon,field_weight,field_semantic_flags,field_citizen_label_de,field_citizen_label_en,field_allowed_next,field_group',
            'page[limit]': '1'
        });
        await applyAdminJurisdictionFilter(event, apiQuery, 'field_jurisdiction', { required: true });

        const response = await drupalSessionFetch<{
            data?: unknown[]
            included?: unknown[]
            meta?: unknown
            links?: unknown
        }>(
            event,
            `/jsonapi/application/application?${apiQuery.toString()}`
        );

        const data = Array.isArray(response.data) ? response.data[0] : null;
        if (!data) {
            throw createSafeError({
                statusCode: 404,
                message: 'errors.applications.notFound',
                data: { code: 'errors.applications.notFound' }
            });
        }
        const includedByKey = new Map<string, unknown>();
        const included = Array.isArray(response.included) ? response.included : [];
        for (const item of included as ApplicationWorkflowJsonApiResource[]) {
            if (item.id && item.type) {
                includedByKey.set(`${item.type}:${item.id}`, item);
            }
        }

        const applicationResource = data as {
            attributes?: Record<string, unknown>
            relationships?: Record<string, { data?: { id?: string, type?: string } | Array<{ id?: string, type?: string }> | null }>
        };
        const assignmentRevisionId = Number(applicationResource.attributes?.drupal_internal__revision_id);
        const { application: staffApplication, events: pendingEvents } = await fetchStaffApplicationDetail(event, workspace, id);
        applicationResource.attributes = {
            ...(applicationResource.attributes || {}),
            ...staffApplicationJsonApiAttributes(staffApplication, {
                includeCrm: true,
                includeWorkflowAttributes: true
            })
        };
        const internalId = Number((data as { attributes?: { drupal_internal__id?: number | string } }).attributes?.drupal_internal__id);
        let protectedDataRedacted = false;
        let canEditData = false;
        let canDelete = false;
        let editDataBlockedReason: ApplicationDataEditBlockedReason | null = null;
        let attachments: Array<Record<string, unknown>> = [];
        let proofCompleteness: AdminApplicationProofCompleteness | undefined;
        let attachmentLoadFailed = false;
        let workflowSource: ApplicationWorkflowSource | null = null;
        if (Number.isInteger(internalId) && internalId > 0) {
            const protectedData = await drupalSessionFetch<ProtectedApplicationDataResponse>(
                event,
                `/api/admin/applications/${internalId}/data`
            );
            protectedDataRedacted = protectedData.meta?.protected_data_redacted === true;
            canEditData = protectedData.meta?.can_edit_data === true;
            canDelete = protectedData.meta?.can_delete === true;
            const blockedReason = protectedData.meta?.edit_data_blocked_reason;
            if (blockedReason === 'permission' || blockedReason === 'protected' || blockedReason === 'transfer' || blockedReason === 'schema') {
                editDataBlockedReason = blockedReason;
            }
            applicationResource.attributes = {
                ...(applicationResource.attributes || {}),
                field_data: JSON.stringify(protectedData.data || {})
            };
            const revisionSchema = protectedData.meta?.schema;
            if (revisionSchema?.id && revisionSchema.type === 'form_schema--form_schema') {
                includedByKey.set(`form_schema--form_schema:${revisionSchema.id}`, {
                    id: revisionSchema.id,
                    type: revisionSchema.type,
                    attributes: revisionSchema.attributes || {}
                });
            }

            try {
                workflowSource = await fetchApplicationWorkflowSource(event, internalId);
            } catch {
                // Logged by the helper. Fail closed: no transitions, no review.
                workflowSource = null;
            }

            try {
                const attachmentResponse = await drupalSessionFetch<AdminAttachmentResponse>(
                    event,
                    `/api/admin/applications/${internalId}/attachments`
                );
                attachments = (attachmentResponse.data || []).filter((attachment): attachment is AdminAttachmentRow & { fieldId: string, url: string } =>
                    attachment.type === 'application_attachment'
                    && typeof attachment.id === 'string'
                    && typeof attachment.fieldId === 'string'
                    && typeof attachment.filename === 'string'
                    && typeof attachment.url === 'string'
                ).map(attachmentResponseRow);
                proofCompleteness = attachmentProofCompleteness(attachmentResponse.meta?.proofCompleteness, new Set(attachments.map(row => row.id)));
            } catch (attachmentError: unknown) {
                attachmentLoadFailed = true;
                console.warn(
                    `[admin] Could not load attachments for application ${id}:`,
                    attachmentError instanceof Error ? attachmentError.message : attachmentError
                );
            }
        }

        const workflowApplication = data as ApplicationWorkflowJsonApiResource;
        const schemaRelationship = workflowApplication.relationships?.field_schema?.data;
        const statusRelationship = workflowApplication.relationships?.field_workflow_status?.data;
        const workflowSchemaId = schemaRelationship && !Array.isArray(schemaRelationship) ? schemaRelationship.id : null;
        const workflowStatusId = statusRelationship && !Array.isArray(statusRelationship) ? statusRelationship.id : null;
        const effectiveAllowedNext: EffectiveAllowedNext = {};
        const effectiveTransitions: EffectiveApplicationTransitions = {};
        if (workflowSchemaId && workflowStatusId) {
            effectiveAllowedNext[workflowSchemaId] = { [workflowStatusId]: [] };
            effectiveTransitions[workflowSchemaId] = { [workflowStatusId]: [] };
        }
        if (workflowSource?.canChangeStatus && workflowSchemaId && workflowStatusId) {
            const built = await buildEffectiveApplicationWorkflow(
                event,
                [workflowApplication],
                includedByKey,
                undefined,
                { [workflowSchemaId]: workflowSource.definition }
            );
            const machineNameOf = (statusUuid: string): string => String(
                (includedByKey.get(`workflow_status--workflow_status:${statusUuid}`) as ApplicationWorkflowJsonApiResource | undefined)
                    ?.attributes?.field_machine_name ?? ''
            );
            const transitions = transitionsForAllowedTargets(
                built.transitions[workflowSchemaId]?.[workflowStatusId] ?? [],
                workflowSource.allowedNext,
                { from: machineNameOf(workflowStatusId), machineNameOf }
            );
            effectiveTransitions[workflowSchemaId]![workflowStatusId] = transitions;
            effectiveAllowedNext[workflowSchemaId]![workflowStatusId] = allowedNextWithoutAttributes(transitions);
        }
        const workflowReview = workflowSource?.review
            ? {
                code: workflowSource.review.code,
                canCorrect: workflowSource.canChangeStatus && workflowSource.review.canCorrect,
                targetIds: workflowSource.canChangeStatus && workflowSource.review.canCorrect
                    ? workflowSource.review.targets.map(target => target.uuid)
                    : []
            }
            : null;
        let rollbackResponse: StatusRollbackTargetResponse | null = null;
        if (Number.isInteger(internalId) && internalId > 0) {
            try {
                rollbackResponse = await drupalSessionFetch<StatusRollbackTargetResponse>(
                    event,
                    `/api/admin/applications/${internalId}/status-rollback-target`
                );
            } catch (rollbackError: unknown) {
                const rollbackStatus = (rollbackError as { statusCode?: number })?.statusCode;
                if (rollbackStatus !== 403 && rollbackStatus !== 404) {
                    throw rollbackError;
                }
                console.warn(
                    `[admin] Could not load rollback target for application ${id}:`,
                    rollbackError instanceof Error ? rollbackError.message : rollbackError
                );
            }
        }
        // "Rückgängig" is available, or refused because the previous status is
        // outside the workflow that governs the form; then
        // both summaries come along, so the page can say which status. Any
        // other reason is dropped: an unavailable undo without it is null.
        const rollbackRefused = rollbackResponse?.available === false && rollbackResponse.reason === 'target_not_in_workflow';
        const statusRollbackTarget = (rollbackResponse?.available || rollbackRefused) && rollbackResponse?.targetStatus
            ? {
                currentStatus: publicRollbackStatus(rollbackResponse.currentStatus),
                targetStatus: publicRollbackStatus(rollbackResponse.targetStatus),
                currentStatusRevision: publicRollbackRevision(rollbackResponse.currentStatusRevision),
                ...(rollbackRefused ? { unavailableReason: 'target_not_in_workflow' as const } : {})
            }
            : null;
        stripDrupalInternalId(applicationResource);
        Reflect.deleteProperty(applicationResource.attributes || {}, 'drupal_internal__revision_id');
        for (const item of includedByKey.values()) {
            stripDrupalInternalId(item);
        }

        // Only acknowledge once every required part of the page has loaded.
        // Reading the detail never acknowledges events. Sections use a separate CSRF-protected POST.
        const events = pendingEvents;

        return {
            data,
            included: [...includedByKey.values()],
            meta: {
                effectiveAllowedNext,
                effectiveTransitions,
                workflowReview,
                events,
                statusRollbackTarget,
                assignmentRevisionId: Number.isInteger(assignmentRevisionId) && assignmentRevisionId > 0 ? assignmentRevisionId : null,
                protectedDataRedacted,
                canEditData,
                canChangeStatus: workflowSource?.canChangeStatus === true,
                canDelete,
                editDataBlockedReason,
                attachments,
                ...(proofCompleteness ? { proofCompleteness } : {}),
                attachmentLoadFailed,
                consents: normalizeApplicationConsents(staffApplication)
            }
        };
    } catch (e: unknown) {
        const upstreamStatus = (e as { statusCode?: number } | null)?.statusCode;
        const statusCode = upstreamStatus === 403 || upstreamStatus === 404 ? upstreamStatus : 500;
        const code = statusCode === 403
            ? 'errors.applications.accessDenied'
            : statusCode === 404
                ? 'errors.applications.notFound'
                : 'errors.applications.loadFailed';
        throw createSafeError({
            statusCode,
            message: code,
            data: { code }
        });
    }
});
