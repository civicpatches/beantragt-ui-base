import type { ComputedRef, Ref } from 'vue';
import type {
    AdminApplicationDetailResponse,
    AdminApplicationRollbackStatus,
    AdminApplicationTransition
} from '~/types';
import type { AdminWorkspace } from '~~/casework-layer/app/composables/useWorkspaceContext';
import type { FormSchema, WorkflowAttributeDefinition, WorkflowConfig } from '~/types/form';
import type { ResolvedStatus } from '~/utils/workflow-status';
import { safeJsonParse } from '~/composables/useFormatters';
import {
    recommendStatusBoilerplate,
    statusBoilerplateText,
    type StatusBoilerplateCandidate
} from '~~/casework-layer/app/utils/status-boilerplates';
import { applicantStatusNotice, type ApplicantMailContext } from '~~/casework-layer/app/utils/applicant-notice';

type MaybeComputedRef<T> = Ref<T> | ComputedRef<T>;
type StatusWorkflowQuery = Record<string, unknown>;

interface ApplicationStatusWorkflowState {
    changed: string
    schemaId: string | null
    statusId: string | null
    /** `field_origin`; applications from batch processing never get a status mail. */
    origin?: string | null
}

/** A target with its status, the current status and what the page knows about mail, so the dialog can say what the applicant sees and receives. */
type StatusTransitionAction = AdminApplicationTransition & { status: ResolvedStatus, fromStatus: ResolvedStatus | null, mailContext: ApplicantMailContext };

interface StatusBoilerplate extends StatusBoilerplateCandidate {
    id: string
    internalId: number
    title: string
    type: string
    text: string
    body?: StatusBoilerplateCandidate['body'] & { format?: string | null }
}

type IncludedFormSchemaResource = {
    id?: string
    type: string
    attributes?: {
        field_workflow_definition?: string | { value?: string } | null
    }
};

function isIncludedFormSchema(resource: unknown): resource is IncludedFormSchemaResource {
    return Boolean(resource && typeof resource === 'object' && (resource as { type?: unknown }).type === 'form_schema--form_schema');
}

function includedFieldText(value: unknown): string {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object' && 'value' in value) {
        const nested = (value as { value?: unknown }).value;
        return typeof nested === 'string' ? nested : '';
    }
    return '';
}

export function useAdminApplicationStatusWorkflow(options: {
    applicationId: string
    application: MaybeComputedRef<ApplicationStatusWorkflowState | null>
    applicationResponse: MaybeComputedRef<AdminApplicationDetailResponse | null | undefined>
    applicationQuery: MaybeComputedRef<StatusWorkflowQuery>
    currentWorkspace: MaybeComputedRef<AdminWorkspace | null>
    schema: MaybeComputedRef<FormSchema | null>
    workflowStatuses: MaybeComputedRef<Map<string, ResolvedStatus>>
    refreshApplication: () => Promise<unknown>
}) {
    const { t, locale } = useI18n();
    const toast = useToast();
    const { resolveApiErrorMessage } = useApiErrorMessage();

    const isSavingStatus = ref(false);
    const isStatusDialogOpen = ref(false);
    const selectedTransitionStatusId = ref<string | null>(null);
    const statusAttributeValues = ref<Record<string, unknown>>({});
    const statusNote = ref('');
    const statusBoilerplates = ref<StatusBoilerplate[]>([]);
    const selectedStatusBoilerplateId = ref<string | null>(null);
    const statusBoilerplateAutoSelected = ref(false);
    const isLoadingStatusBoilerplates = ref(false);
    const isStatusRollbackDialogOpen = ref(false);
    const isRollingBackStatus = ref(false);
    const statusRollbackNote = ref('');
    // The PATCH refused the undo although the load offered it (the form
    // changed meanwhile): the sentence stands at the action for exactly that
    // change (previous status and time of the change), whatever the reload says.
    const rollbackRefusedChange = ref<string | null>(null);
    // The note typed into the refused undo. Kept in the page's memory only and
    // shown as text: under the sentence, and above the note field of "Status
    // ändern" and "Status setzen". It is NEVER filled into a field: a note
    // written for an internal undo could otherwise reach the applicant (the
    // note of a rejection goes into the rejection mail). The person retypes
    // or pastes it under that field's own hint.
    const rollbackKeptNote = ref('');
    const isStatusCorrectionDialogOpen = ref(false);
    const isCorrectingStatus = ref(false);
    const statusCorrectionTargetId = ref<string | null>(null);
    const statusCorrectionNote = ref('');
    let statusBoilerplateRequestId = 0;

    function workflowDefinitionForDisplay(): WorkflowConfig | null {
        const schemaEntity = options.applicationResponse.value?.included?.find(isIncludedFormSchema) as IncludedFormSchemaResource | undefined;
        const explicitWorkflow = includedFieldText(schemaEntity?.attributes?.field_workflow_definition).trim();
        if (explicitWorkflow) {
            const parsed = safeJsonParse(explicitWorkflow);
            return parsed && typeof parsed === 'object' ? parsed as unknown as WorkflowConfig : null;
        }
        return options.schema.value?.workflow ?? null;
    }

    const applicationTransitions = computed<AdminApplicationTransition[]>(() => {
        if (!options.application.value?.schemaId || !options.application.value.statusId) return [];
        return options.applicationResponse.value?.meta?.effectiveTransitions?.[options.application.value.schemaId]?.[options.application.value.statusId] ?? [];
    });

    const statusTransitionActions = computed<StatusTransitionAction[]>(() => {
        const currentId = options.application.value?.statusId;
        const fromStatus = currentId ? options.workflowStatuses.value.get(currentId) ?? null : null;
        const mailContext: ApplicantMailContext = { origin: options.application.value?.origin ?? null };
        return applicationTransitions.value
            .map((transition) => {
                const status = options.workflowStatuses.value.get(transition.targetStatusId);
                return status ? { ...transition, status, fromStatus, mailContext } : null;
            })
            .filter((transition): transition is StatusTransitionAction => Boolean(transition));
    });

    /** Targets of the status dialog; status and definition give each radio option its second line (02c). */
    const statusTransitionItems = computed(() =>
        statusTransitionActions.value.map(transition => ({
            label: transition.status.label,
            value: transition.targetStatusId,
            status: transition.status,
            targetDescription: transition.targetDescription ?? null
        }))
    );

    const statusBoilerplateItems = computed(() =>
        statusBoilerplates.value.map(boilerplate => ({
            label: boilerplate.title,
            value: boilerplate.id
        }))
    );

    const statusActionBusy = computed(() => isSavingStatus.value || isRollingBackStatus.value || isCorrectingStatus.value);

    /** Review state for a status outside the form's published workflow. */
    const workflowReview = computed(() => options.applicationResponse.value?.meta?.workflowReview ?? null);

    /** Statuses that may be set by hand, labelled from the catalogue. */
    const statusCorrectionTargets = computed<ResolvedStatus[]>(() =>
        (workflowReview.value?.canCorrect ? workflowReview.value.targetIds : [])
            .map(id => options.workflowStatuses.value.get(id))
            .filter((status): status is ResolvedStatus => Boolean(status))
    );

    const selectedStatusCorrectionTarget = computed(() =>
        statusCorrectionTargets.value.find(status => status.id === statusCorrectionTargetId.value)
        ?? null
    );

    // No fallback to the first target: a preselected entry made Enter a
    // status change. Saving needs a deliberate choice.
    const selectedStatusTransition = computed(() =>
        statusTransitionActions.value.find(transition => transition.targetStatusId === selectedTransitionStatusId.value)
        ?? null
    );

    const selectedStatusBoilerplate = computed(() =>
        statusBoilerplates.value.find(item => item.id === selectedStatusBoilerplateId.value) ?? null
    );

    const statusRollbackTarget = computed(() => options.applicationResponse.value?.meta?.statusRollbackTarget ?? null);

    const rollbackStatusDisplay = computed<AdminApplicationRollbackStatus | null>(() => {
        const target = statusRollbackTarget.value?.targetStatus;
        if (!target) return null;
        const resolved = target.id ? options.workflowStatuses.value.get(target.id) : null;
        return {
            id: target.id,
            internalId: target.internalId,
            label: resolved?.label ?? target.label,
            machineName: resolved?.machineName ?? target.machineName,
            color: resolved?.color ?? target.color,
            icon: resolved?.icon ?? target.icon
        };
    });

    const rollbackStatusRevision = computed(() => statusRollbackTarget.value?.currentStatusRevision ?? null);

    // Drupal refuses to undo the status change when the previous status is
    // outside the workflow that governs the form. Then the page offers no
    // action that fails; it says why where the action would stand, and
    // points to the status control the page already has.
    const rollbackChangeKey = computed(() => {
        const target = statusRollbackTarget.value;
        return target ? `${target.targetStatus?.id ?? ''}|${target.currentStatusRevision?.created ?? ''}` : null;
    });
    const rollbackAvailable = computed(() =>
        Boolean(rollbackStatusDisplay.value)
        && statusRollbackTarget.value?.unavailableReason !== 'target_not_in_workflow'
        && rollbackRefusedChange.value !== rollbackChangeKey.value
    );
    // The way on, named in the same sentence: "Status setzen" where the page
    // offers a correction, else "Status ändern" where the status has a next
    // step; never a control the page does not show.
    const rollbackWayOn = computed<'correction' | 'change' | null>(() => {
        if (statusCorrectionTargets.value.length) return 'correction';
        return statusTransitionActions.value.length ? 'change' : null;
    });
    /** The kept note under the sentence on the page. */
    const rollbackKeptNoteShown = computed(() =>
        rollbackRefusal.value && rollbackKeptNote.value ? rollbackKeptNote.value : null
    );
    /** The kept note as a read-only line in the status dialogs. */
    const rollbackKeptNoteForDialog = computed(() => rollbackKeptNote.value || null);
    const rollbackRefusal = computed<string | null>(() => {
        if (!rollbackStatusDisplay.value || rollbackAvailable.value) return null;
        // The tenant's own status name; no technical name in this sentence.
        const status = rollbackStatusDisplay.value.label?.trim();
        const action = rollbackWayOn.value === 'correction'
            ? t('admin.detail.statusReviewAction')
            : rollbackWayOn.value === 'change' ? t('admin.detail.changeStatus') : '';
        if (action) {
            return status
                ? t('admin.detail.rollbackNotInWorkflowWith', { status, action })
                : t('admin.detail.rollbackNotInWorkflowUnnamedWith', { action });
        }
        return status
            ? t('admin.detail.rollbackNotInWorkflow', { status })
            : t('admin.detail.rollbackNotInWorkflowUnnamed');
    });

    const selectedTransitionAttributes = computed(() =>
        [...(selectedStatusTransition.value?.attributes ?? [])].sort((a, b) => a.order - b.order)
    );

    const statusSubmitDisabled = computed(() => {
        if (!selectedStatusTransition.value || isSavingStatus.value) return true;
        return selectedTransitionAttributes.value.some(attribute =>
            attribute.required && emptyWorkflowAttributeValue(statusAttributeValues.value[attribute.code])
        );
    });

    const workflowAttributeLabelMap = computed(() => {
        const labels: Record<string, string> = {};
        for (const transition of applicationTransitions.value) {
            for (const attribute of transition.attributes ?? []) {
                labels[attribute.code] = attribute.description;
            }
        }
        const workflow = workflowDefinitionForDisplay();
        for (const status of workflow?.statuses ?? []) {
            for (const attribute of status.attributes ?? []) {
                labels[attribute.code] = attribute.description;
            }
        }
        for (const transition of workflow?.transitions ?? []) {
            for (const attribute of transition.attributes ?? []) {
                labels[attribute.code] = attribute.description;
            }
        }
        return labels;
    });

    function emptyWorkflowAttributeValue(value: unknown): boolean {
        return value === null
          || value === undefined
          || value === ''
          || (Array.isArray(value) && value.length === 0);
    }

    function workflowAttributeDefaultValue(attribute: WorkflowAttributeDefinition): unknown {
        if (attribute.default_value !== undefined) return attribute.default_value;
        if (attribute.datatype === 'multivaluelist' || attribute.datatype === 'imagelist') return [];
        return '';
    }

    function resetStatusAttributeValues(transition: StatusTransitionAction | null) {
        const next: Record<string, unknown> = {};
        for (const attribute of transition?.attributes ?? []) {
            next[attribute.code] = workflowAttributeDefaultValue(attribute);
        }
        statusAttributeValues.value = next;
    }

    async function loadStatusBoilerplates() {
        const workspace = options.currentWorkspace.value;
        const requestId = ++statusBoilerplateRequestId;
        if (!workspace?.jurisdictionSlug) {
            statusBoilerplates.value = [];
            return;
        }

        const jurisdictionSlug = workspace.jurisdictionSlug;
        const organisationSlug = workspace.organisationSlug ?? null;
        isLoadingStatusBoilerplates.value = true;
        try {
            const response = await $fetch<{ data?: StatusBoilerplate[] }>(
                `/api/admin/jurisdictions/${jurisdictionSlug}/boilerplates`,
                {
                    query: {
                        type: 'status_notes',
                        ...(organisationSlug ? { organisation: organisationSlug } : {})
                    }
                }
            );
            if (!isActiveStatusBoilerplateRequest(requestId, jurisdictionSlug, organisationSlug)) return;
            statusBoilerplates.value = response.data ?? [];
            applyRecommendedStatusBoilerplate();
        } catch (e: unknown) {
            if (!isActiveStatusBoilerplateRequest(requestId, jurisdictionSlug, organisationSlug)) return;
            statusBoilerplates.value = [];
            toast.add({
                title: t('admin.detail.statusBoilerplatesLoadError'),
                description: resolveApiErrorMessage(e, 'admin.detail.statusBoilerplatesLoadError'),
                color: 'error'
            });
        } finally {
            if (requestId === statusBoilerplateRequestId) {
                isLoadingStatusBoilerplates.value = false;
            }
        }
    }

    function isActiveStatusBoilerplateRequest(
        requestId: number,
        jurisdictionSlug: string,
        organisationSlug: string | null
    ): boolean {
        const workspace = options.currentWorkspace.value;
        return requestId === statusBoilerplateRequestId
          && isStatusDialogOpen.value
          && workspace?.jurisdictionSlug === jurisdictionSlug
          && (workspace.organisationSlug ?? null) === organisationSlug;
    }

    function setStatusBoilerplate(boilerplate: StatusBoilerplate, autoSelected: boolean) {
        selectedStatusBoilerplateId.value = boilerplate.id;
        statusBoilerplateAutoSelected.value = autoSelected;
        statusNote.value = statusBoilerplateText(boilerplate);
    }

    function applyStatusBoilerplate(id: string) {
        const boilerplate = statusBoilerplates.value.find(item => item.id === id);
        if (!boilerplate) return;
        setStatusBoilerplate(boilerplate, false);
    }

    function canReplaceStatusNoteWithRecommendation(): boolean {
        if (!statusNote.value.trim()) return true;
        if (!statusBoilerplateAutoSelected.value || !selectedStatusBoilerplate.value) return false;
        return statusNote.value === statusBoilerplateText(selectedStatusBoilerplate.value);
    }

    function applyRecommendedStatusBoilerplate() {
        if (!selectedStatusTransition.value || !canReplaceStatusNoteWithRecommendation()) return;
        const recommendation = recommendStatusBoilerplate(
            statusBoilerplates.value,
            selectedStatusTransition.value.status
        ) as StatusBoilerplate | null;
        if (!recommendation) {
            if (statusBoilerplateAutoSelected.value) {
                selectedStatusBoilerplateId.value = null;
                statusBoilerplateAutoSelected.value = false;
                statusNote.value = '';
            }
            return;
        }
        setStatusBoilerplate(recommendation, true);
    }

    function updateStatusNote(value: string | number | null | undefined) {
        statusNote.value = String(value ?? '');
        statusBoilerplateAutoSelected.value = false;
    }

    function openStatusDialog() {
        if (!statusTransitionActions.value.length) return;
        // No preselection among several targets. With exactly one target there is nothing to choose: the
        // dialog shows it as text, chosen from the start, and saving still needs the press on "Status ändern" (02c).
        selectedTransitionStatusId.value = statusTransitionActions.value.length === 1 ? statusTransitionActions.value[0]!.targetStatusId : null;
        statusNote.value = '';
        selectedStatusBoilerplateId.value = null;
        statusBoilerplateAutoSelected.value = false;
        resetStatusAttributeValues(selectedStatusTransition.value);
        isStatusDialogOpen.value = true;
        loadStatusBoilerplates();
    }

    function closeStatusDialog() {
        statusBoilerplateRequestId += 1;
        isLoadingStatusBoilerplates.value = false;
        isStatusDialogOpen.value = false;
        selectedTransitionStatusId.value = null;
        statusAttributeValues.value = {};
        statusNote.value = '';
        selectedStatusBoilerplateId.value = null;
        statusBoilerplateAutoSelected.value = false;
    }

    watch(selectedStatusTransition, (transition, previous) => {
        if (!isStatusDialogOpen.value || transition?.targetStatusId === previous?.targetStatusId) return;
        resetStatusAttributeValues(transition);
        applyRecommendedStatusBoilerplate();
    });

    function updateWorkflowAttributeValue(attribute: WorkflowAttributeDefinition, value: unknown) {
        statusAttributeValues.value = {
            ...statusAttributeValues.value,
            [attribute.code]: value
        };
    }

    function normalizedStatusAttributes(): Record<string, unknown> {
        const values: Record<string, unknown> = {};
        for (const attribute of selectedTransitionAttributes.value) {
            const raw = statusAttributeValues.value[attribute.code];
            if (emptyWorkflowAttributeValue(raw)) continue;

            if (attribute.datatype === 'number') {
                values[attribute.code] = Number(raw);
                continue;
            }
            if (attribute.datatype === 'multivaluelist' || attribute.datatype === 'imagelist') {
                values[attribute.code] = Array.isArray(raw) ? raw.map(String) : [];
                continue;
            }
            values[attribute.code] = String(raw);
        }
        return values;
    }

    async function updateApplicationStatus() {
        const chosen = selectedStatusTransition.value;
        if (!options.application.value?.statusId || !chosen || isSavingStatus.value) return;

        isSavingStatus.value = true;
        const notice = applicantStatusNotice(chosen.fromStatus, chosen.status, unref(locale) ?? 'de', chosen.mailContext);
        try {
            const attributes = normalizedStatusAttributes();
            await $fetch(`/api/admin/applications/${options.applicationId}/status`, {
                method: 'PATCH',
                query: options.applicationQuery.value,
                body: {
                    statusId: chosen.targetStatusId,
                    expectedStatusId: options.application.value.statusId,
                    expectedChanged: options.application.value.changed,
                    attributes,
                    note: statusNote.value
                }
            });
            await options.refreshApplication();
            closeStatusDialog();
            rollbackKeptNote.value = '';
            toast.add({ title: t('admin.table.statusUpdated'), description: notice.params ? t(notice.key, notice.params) : t(notice.key), color: 'success' });
        } catch (e: unknown) {
            toast.add({
                title: t('admin.table.statusUpdateError'),
                description: resolveApiErrorMessage(e, 'admin.table.statusUpdateError'),
                color: 'error'
            });
        } finally {
            isSavingStatus.value = false;
        }
    }

    function openStatusRollbackDialog() {
        if (!options.application.value?.statusId || !rollbackStatusDisplay.value || !rollbackAvailable.value) return;
        statusRollbackNote.value = '';
        isStatusRollbackDialogOpen.value = true;
    }

    function closeStatusRollbackDialog() {
        isStatusRollbackDialogOpen.value = false;
        statusRollbackNote.value = '';
    }

    async function rollbackApplicationStatus() {
        if (!options.application.value?.statusId || !options.application.value.changed || !rollbackStatusDisplay.value || isRollingBackStatus.value) return;

        isRollingBackStatus.value = true;
        try {
            await $fetch(`/api/admin/applications/${options.applicationId}/status-rollback`, {
                method: 'PATCH',
                query: options.applicationQuery.value,
                body: {
                    expectedStatusId: options.application.value.statusId,
                    expectedChanged: options.application.value.changed,
                    note: statusRollbackNote.value
                }
            });
            await options.refreshApplication();
            closeStatusRollbackDialog();
            toast.add({ title: t('admin.detail.statusRolledBack'), color: 'success' });
        } catch (e: unknown) {
            const data = (e as { data?: { code?: unknown, data?: { code?: unknown } } })?.data;
            if ((data?.data?.code ?? data?.code) === 'errors.admin.statusRollbackTargetNotInWorkflow') {
                // Nothing was saved. Say it at the action, not in a toast, and
                // load the status data again.
                rollbackRefusedChange.value = rollbackChangeKey.value;
                rollbackKeptNote.value = statusRollbackNote.value.trim();
                closeStatusRollbackDialog();
                try {
                    await options.refreshApplication();
                } catch (refreshError: unknown) {
                    // The sentence stands for this change either way.
                    console.error('[admin] Could not reload the application after the refused undo:', refreshError);
                }
            } else {
                toast.add({
                    title: t('admin.detail.statusRollbackError'),
                    description: resolveApiErrorMessage(e, 'admin.detail.statusRollbackError'),
                    color: 'error'
                });
            }
        } finally {
            isRollingBackStatus.value = false;
        }
    }

    function openStatusCorrectionDialog() {
        const first = statusCorrectionTargets.value[0];
        if (!options.application.value?.statusId || !first) return;
        statusCorrectionTargetId.value = statusCorrectionTargets.value.length === 1 ? first.id : null;
        statusCorrectionNote.value = '';
        isStatusCorrectionDialogOpen.value = true;
    }

    function closeStatusCorrectionDialog() {
        isStatusCorrectionDialogOpen.value = false;
        statusCorrectionTargetId.value = null;
        statusCorrectionNote.value = '';
    }

    async function correctApplicationStatus() {
        const target = selectedStatusCorrectionTarget.value;
        if (!options.application.value?.statusId || !options.application.value.changed || !target || isCorrectingStatus.value) return;

        isCorrectingStatus.value = true;
        try {
            await $fetch(`/api/admin/applications/${options.applicationId}/status-correction`, {
                method: 'PATCH',
                query: options.applicationQuery.value,
                body: {
                    statusId: target.id,
                    expectedStatusId: options.application.value.statusId,
                    expectedChanged: options.application.value.changed,
                    note: statusCorrectionNote.value
                }
            });
            await options.refreshApplication();
            closeStatusCorrectionDialog();
            rollbackKeptNote.value = '';
            toast.add({ title: t('admin.detail.statusReviewSuccess'), color: 'success' });
        } catch (e: unknown) {
            toast.add({
                title: resolveApiErrorMessage(e, 'errors.admin.statusCorrectionFailed'),
                color: 'error'
            });
        } finally {
            isCorrectingStatus.value = false;
        }
    }

    function getWorkflowAttributeLabel(key: string): string {
        return workflowAttributeLabelMap.value[key] ?? key;
    }

    return {
        isSavingStatus,
        isStatusDialogOpen,
        selectedTransitionStatusId,
        statusAttributeValues,
        statusNote,
        statusBoilerplates,
        selectedStatusBoilerplateId,
        isLoadingStatusBoilerplates,
        isStatusRollbackDialogOpen,
        isRollingBackStatus,
        statusRollbackNote,
        statusTransitionActions,
        statusTransitionItems,
        statusBoilerplateItems,
        statusActionBusy,
        selectedStatusTransition,
        rollbackStatusDisplay,
        rollbackStatusRevision,
        rollbackAvailable,
        rollbackRefusal,
        rollbackKeptNoteShown,
        rollbackKeptNoteForDialog,
        /** The control the page shows for setting the status by hand, if any. */
        manualStatusWay: rollbackWayOn,
        selectedTransitionAttributes,
        statusSubmitDisabled,
        getWorkflowAttributeLabel,
        openStatusDialog,
        closeStatusDialog,
        updateStatusNote,
        updateWorkflowAttributeValue,
        applyStatusBoilerplate,
        updateApplicationStatus,
        openStatusRollbackDialog,
        closeStatusRollbackDialog,
        rollbackApplicationStatus,
        workflowReview,
        statusCorrectionTargets,
        statusCorrectionTargetId,
        selectedStatusCorrectionTarget,
        statusCorrectionNote,
        isStatusCorrectionDialogOpen,
        isCorrectingStatus,
        openStatusCorrectionDialog,
        closeStatusCorrectionDialog,
        correctApplicationStatus
    };
}
