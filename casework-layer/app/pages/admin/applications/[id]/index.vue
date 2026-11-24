<script setup lang="ts">
import { shallowRef } from 'vue';
import type {
    AdminApplicationAssigneesResponse,
    AdminApplicationDetailResponse,
    AdminApplicationEventKind,
    AdminApplicationEvents,
    AdminApplicationSinceSeenKind
} from '~/types';
import { provideApplicationEvents } from '~/composables/useApplicationEvents';
import { staffFetch } from '~~/casework-layer/app/composables/api/useStaffSessionFetch';
import { useApplicationEventTargets } from '~/composables/useApplicationEventTargets';
import ApplicationEventMenu from '~~/casework-layer/app/components/admin/ApplicationEventMenu.vue';
import { APPLICATION_MESSAGE_COMPOSER, flashEventTarget, registeredApplicationEvents } from '~/utils/application-events';
import { useAdminApplicationEvents } from '~~/casework-layer/app/composables/useAdminApplicationEvents';
import type { AdminAssignmentSelection } from '~~/casework-layer/app/composables/useAdminApplicationAssignment';
import type { FormSchema } from '~/types/form';
import type { CasePendingTransfer, CaseTransferTrigger } from '~/types/case-transfers';
import { safeJsonParse } from '~/composables/useFormatters';
import { parseStoredFormSchema } from '~/utils/form-schema';
import { buildStatusMap, workflowStatusCitizenHint, type ResolvedStatus } from '~/utils/workflow-status';
import { applicantNameFromContactData } from '~~/casework-layer/app/utils/application-header';
import {
    caseDetailHandlers,
    type CaseDataSavedHandler,
    type CaseDetailPanelContext,
    type CaseResponseReleasedHandler,
    type CaseStatusChangedHandler
} from '~~/casework-layer/app/utils/case-detail-context';
import AdminCaseLayout from '~~/casework-layer/app/components/admin/CaseLayout.vue';
import { PRO_CASE_OUTLETS, type CaseSectionId } from '~~/casework-layer/app/utils/case-layout';
import { staffOutlet } from '~~/casework-layer/app/utils/staff-extensions';
import StaffExtensionOutlet from '~~/casework-layer/app/components/StaffExtensionOutlet.vue';

definePageMeta({
    layout: 'dashboard',
    middleware: 'admin'
});

const { t, locale } = useI18n();
const toast = useToast();
/** Localized yes/no labels for boolean field values. */
const booleanLabels = computed(() => ({ yes: t('common.yes'), no: t('common.no') }));
const route = useRoute();
const router = useRouter();
const { currentWorkspace, selectedWorkspaceKey, workspaceRoute, withWorkspaceQuery } = useWorkspaceContext();
const { isAdmin, isStaff, user } = useAuth();
const applicationId = route.params.id as string;
const arrangingSections = ref(false);
const layoutContextKey = computed(() => isStaff.value && user.value?.uid && selectedWorkspaceKey.value
    ? `${user.value.uid}:${selectedWorkspaceKey.value}`
    : '');
const layoutSections = computed<CaseSectionId[]>(() => [
    ...((isStaff.value && attachmentListGroups.value.length > 0) || attachmentLoadFailed.value ? ['attachments' as const] : []),
    ...(isStaff.value ? ['data' as const] : []),
    'messages', 'deadline', 'assignment', 'responses',
    ...(applicationStatus.value || Object.keys(shownWorkflowAttributes.value).length > 0 ? ['status_history' as const] : []),
    ...(application.value && (Object.keys(application.value.crmData).length > 0 || application.value.email?.trim()
      || application.value.consents?.profileConsent?.given === true || application.value.consents?.bankConsent?.given === true)
        ? ['crm' as const]
        : []),
    ...Object.entries(PRO_CASE_OUTLETS).filter(([, outlet]) => isStaff.value && staffOutlet(outlet).length > 0).map(([id]) => id as CaseSectionId)
]);
/** Panel actions in flight, by individually registered section; the page's mutations wait for them. */
const commentsCard = ref<{ focusComment: (id: string) => Promise<void>, focusComposer: () => boolean } | null>(null);
const panelBusy = ref<Record<string, boolean>>({});
const externalResponsesVersion = ref(0);
const detailHeader = ref<{ focusMoreActions: () => void } | null>(null);
const applicationQuery = computed(() => withWorkspaceQuery());
const eventScope = computed(() => JSON.stringify([selectedWorkspaceKey.value, user.value?.uid, user.value?.uuid]));
const { entryEvents, targetEvents, eventCounts, sectionCounts, markSeen, receive: receiveEventSnapshot, requestGeneration, requestAcknowledgement, beginSectionLoad } = useAdminApplicationEvents(eventScope);
const openingMessages = shallowRef<{ generation: number, events?: AdminApplicationEvents }>();
watch(eventScope, () => {
    openingMessages.value = undefined;
}, { flush: 'sync' });
const eventRequestGenerations = new WeakMap<object, { generation: number, acknowledgement: number }>();

// ── Load application with included schema ──────────────────────────
const { data: response, status, error, refresh } = await useFetch<AdminApplicationDetailResponse>(
    `/api/admin/applications/${applicationId}`,
    {
        key: `admin-application-detail-${applicationId}`,
        query: applicationQuery,
        onRequest({ options }) {
            eventRequestGenerations.set(options, { generation: requestGeneration(), acknowledgement: requestAcknowledgement() });
        },
        onResponse({ response: result, options }) {
            const generation = eventRequestGenerations.get(options);
            if (result.ok && generation !== undefined) {
                if (receiveEventSnapshot(result._data, generation.generation, generation.acknowledgement)) {
                    if (!openingMessages.value && result._data?.data?.id === applicationId) {
                        openingMessages.value = { generation: generation.generation, events: result._data.meta?.events };
                    }
                    // Attachments render directly from this detail payload.
                    beginSectionLoad('scan')();
                }
            }
        },
        getCachedData: () => undefined,
        watch: [eventScope]
    }
);

async function refreshAttachmentAnalysis(signal: AbortSignal) {
    const previous = response.value;
    const accessContext = layoutContextKey.value;
    const generation = requestGeneration();
    const acknowledgement = requestAcknowledgement();
    // A background analysis refresh must leave the open case and its form
    // state intact on a network error.
    const updated = await staffFetch<AdminApplicationDetailResponse>(`/api/admin/applications/${applicationId}`, {
        query: applicationQuery.value,
        signal,
        retry: 0
    });
    if (signal.aborted || response.value !== previous || layoutContextKey.value !== accessContext || !previous) return;
    if (updated.meta?.attachmentLoadFailed || !updated.meta?.attachments) throw new Error('Attachments unavailable');
    response.value = {
        ...previous,
        meta: {
            ...previous.meta,
            attachments: updated.meta.attachments,
            proofCompleteness: updated.meta.proofCompleteness,
            attachmentLoadFailed: false
        }
    };
    if (receiveEventSnapshot(updated, generation, acknowledgement)) beginSectionLoad('scan')();
}

const assigneeEventLoads = new WeakMap<object, () => void>();
const {
    data: assigneeResponse,
    status: assigneesStatus,
    error: assigneesError,
    refresh: refreshAssignees
} = await useFetch<AdminApplicationAssigneesResponse>(
    `/api/admin/applications/${applicationId}/assignees`,
    {
        key: `admin-application-assignees-${applicationId}`,
        query: applicationQuery,
        onRequest({ options }) {
            assigneeEventLoads.set(options, beginSectionLoad('assigned'));
        },
        onResponse({ response: result, options }) {
            if (result.ok) assigneeEventLoads.get(options)?.();
        },
        watch: [selectedWorkspaceKey]
    }
);

/** Who filed the application, from its contact data only. */
const applicantName = computed(() => applicantNameFromContactData(application.value?.crmData));

const workflowStatuses = computed(() =>
    buildStatusMap(response.value?.included as Parameters<typeof buildStatusMap>[0])
);

const application = computed(() => {
    if (!response.value?.data) return null;
    const attrs = response.value.data.attributes;
    const statusRel = response.value.data.relationships?.field_workflow_status?.data;
    const schemaRel = response.value.data.relationships?.field_schema?.data;
    const statusId = statusRel && !Array.isArray(statusRel) ? statusRel.id : null;
    const schemaId = schemaRel && !Array.isArray(schemaRel) ? schemaRel.id : null;
    const statusInfo = statusRel && !Array.isArray(statusRel)
        ? workflowStatuses.value.get(statusRel.id)
        : null;
    const allowedNextIds = statusId && schemaId
        ? response.value.meta?.effectiveAllowedNext?.[schemaId]?.[statusId] ?? []
        : undefined;
    return {
        id: response.value.data.id,
        referenceNumber: attrs.field_reference_number ?? '',
        statusId,
        schemaId,
        status: statusInfo?.machineName ?? 'new',
        statusLabel: statusInfo?.label,
        statusColor: statusInfo?.color,
        statusIcon: statusInfo?.icon,
        statusFlags: statusInfo?.semanticFlags ?? [],
        // What applicants see instead of the internal label, when it differs.
        statusCitizenHint: statusInfo ? workflowStatusCitizenHint(statusInfo, locale.value) : '',
        allowedNextIds,
        email: attrs.field_applicant_email ?? null,
        origin: attrs.field_origin ?? null,
        data: safeJsonParse(attrs.field_data),
        crmData: safeJsonParse(attrs.field_crm_data),
        workflowAttributes: safeJsonParse(attrs.field_workflow_attributes),
        dueDate: typeof attrs.field_due_date === 'string' ? attrs.field_due_date : '',
        created: attrs.created,
        changed: attrs.changed ?? '',
        revisionId: response.value.meta?.assignmentRevisionId ?? null,
        consents: response.value.meta?.consents ?? null
    };
});

/** The card "Ablauf" of the form, where its functions are switched on (admins only). */
const formWorkflowTo = computed(() => isAdmin.value && application.value?.schemaId
    ? { ...workspaceRoute(`/admin/forms/${application.value.schemaId}`), hash: '#ablauf' }
    : null);

/** The case is shown unless the first load runs or a load failed (same order as before: loading, error, content). */
const showContent = computed(() => !(status.value === 'pending' && !application.value) && !error.value && Boolean(application.value));

const applicationStatus = computed(() => {
    if (!application.value?.statusId) return null;
    const current = workflowStatuses.value.get(application.value.statusId);
    if (!current) return null;
    const allowedNext = (application.value.allowedNextIds ?? current.allowedNext.map(status => status.id))
        .map(id => workflowStatuses.value.get(id))
        .filter((status): status is ResolvedStatus => Boolean(status))
        .map(status => ({
            id: status.id,
            machineName: status.machineName,
            label: status.label,
            color: status.color,
            icon: status.icon
        }));

    return {
        ...current,
        allowedNext
    };
});

function detailLoadStatusCode(): number | null {
    const detailError = error.value as { statusCode?: unknown, status?: unknown } | null | undefined;
    if (typeof detailError?.statusCode === 'number') return detailError.statusCode;
    if (typeof detailError?.status === 'number') return detailError.status;
    return null;
}

/** Set while the page leaves after this person handed the case over: it never shows "not in this office" then. */
const leavingAfterHandOver = ref(false);
async function refreshApplicationForDelegation() {
    await refresh();
    if (detailLoadStatusCode() === 404) {
        leavingAfterHandOver.value = true;
        throw Object.assign(new Error('Application moved out of scope.'), { statusCode: 404 });
    }
}

/**
 * 02 state "not in this office": the server answers 404 for a case handed to another office, a
 * deleted one and a wrong address alike, so the page says what is true for all three, names only the open
 * workspace, and shows nothing of the case. Other failures (5xx, network) stay an error with "Erneut versuchen".
 */
const notInThisOffice = computed(() => Boolean(error.value) && detailLoadStatusCode() === 404);
const accessDenied = computed(() => Boolean(error.value) && detailLoadStatusCode() === 403);
const workspaceName = computed(() =>
    currentWorkspace.value?.organisationLabel
    || currentWorkspace.value?.jurisdictionLabel
    || currentWorkspace.value?.label
    || ''
);

async function handleApplicationMovedOutOfScope() {
    toast.add({
        title: t('admin.detail.delegation.movedOutOfScope'),
        color: 'info'
    });
    await navigateTo(workspaceRoute('/admin/applications'));
}

const {
    currentAssignee,
    personalAssignmentEnabled,
    assigneeCandidates,
    assigneeTeamCandidates,
    isSavingAssignee,
    assigneeSaveError,
    assigneeSaveErrorSource,
    assignmentSaveAnnouncement,
    assigneeDisplayLabel,
    hasAssigneeCandidates,
    canChangeAssignment,
    currentAssigneeOutOfScope,
    clearAssigneeSaveError,
    canAssignSelf,
    selfAssignTakesOverFrom,
    assignSelf,
    assignTo
} = useAdminApplicationAssignment({
    applicationId,
    application,
    assigneeResponse,
    applicationQuery,
    refreshApplication: refresh,
    refreshAssignees,
    currentUserUuid: computed(() => user.value?.uuid ?? null)
});

/** Errors of "Mir zuweisen" stay on the card; the dialog keeps showing its own. */
const selfAssignError = computed(() => assigneeSaveErrorSource.value === 'self' ? assigneeSaveError.value : null);

const isAssignModalOpen = ref(false);
const isDelegationModalOpen = ref(false);

watch(canChangeAssignment, (canChange) => {
    if (!canChange) isAssignModalOpen.value = false;
});

const {
    delegationTargets,
    hasDelegationTargets,
    canDelegate,
    delegationNoteRequired,
    isDelegating,
    delegateTo
} = useAdminApplicationDelegation({
    applicationId,
    application,
    assigneeResponse,
    applicationQuery,
    refreshApplication: refreshApplicationForDelegation,
    refreshAssignees
});

const showDelegationTrigger = computed(() => hasDelegationTargets.value && canDelegate.value);

watch(showDelegationTrigger, (canShow) => {
    if (!canShow) {
        isDelegationModalOpen.value = false;
    }
});

const currentResponsibilityLabel = computed(() =>
    assigneeResponse.value?.responsibility?.label
    || currentWorkspace.value?.organisationLabel
    || currentWorkspace.value?.jurisdictionLabel
    || currentWorkspace.value?.label
    || null
);

async function handleDelegation(targetUuid: string, note: string) {
    const delegated = await delegateTo(targetUuid, note);
    if (delegated) {
        isDelegationModalOpen.value = false;
    }
}

async function handleAssignment(selection: AdminAssignmentSelection) {
    const assigned = await assignTo(selection);
    if (assigned) {
        isAssignModalOpen.value = false;
    }
}

async function reloadAssignmentPicker() {
    clearAssigneeSaveError();
    await refresh();
    if (detailLoadStatusCode() === 404) {
        await handleApplicationMovedOutOfScope();
        return;
    }
    await refreshAssignees();
}

const {
    dueDateInput,
    isSavingDueDate,
    dueDateChanged,
    applicationOverdue,
    dueDatePastPending,
    dueDateConflict,
    saveApplicationDueDate,
    confirmPastDueDate,
    cancelPastDueDate,
    reloadAfterDueDateConflict
} = useAdminApplicationDeadline({
    applicationId,
    application,
    applicationQuery,
    refreshApplication: refresh
});

const {
    comments,
    commentsLoading,
    commentsLoaded,
    commentsLoadFailed,
    fetchComments,
    commentPublicHint,
    commentInitialVisibility,
    commentPublicSendLabel,
    onCommentAdded
} = useAdminApplicationComments({
    refreshAttachments: refresh,
    application,
    workspaceKey: selectedWorkspaceKey,
    // The help line names the request-info status only when this case may move there.
    allowedNextStatuses: computed(() => (applicationStatus.value?.allowedNext ?? []).map(next => ({
        label: next.label,
        semanticFlags: workflowStatuses.value.get(next.id)?.semanticFlags ?? []
    }))),
    // A function declaration below: hoisted, called only after setup.
    refreshAfterStatusChange: () => refreshAfterStatusChange()
});

const eventRoot = ref<HTMLElement | null>(null);
onMounted(() => {
    eventRoot.value = document.getElementById('application-header');
});
let receiptQueue = Promise.resolve();
function acknowledgeEvents(kind: AdminApplicationSinceSeenKind, tokens: string[], generation: number) {
    const query = withWorkspaceQuery();
    // Serialize receipts: out-of-order pre-write snapshots must not resurrect a count.
    const result = receiptQueue.then(async () => {
        if (generation !== requestGeneration()) return false;
        try {
            const result = await staffFetch<Pick<AdminApplicationDetailResponse, 'meta'>>(`/api/admin/applications/${applicationId}/events/${kind}/seen`, {
                method: 'POST', query, body: { tokens }
            });
            markSeen(kind, generation, result, tokens);
            return true;
        } catch {
            return false;
        }
    });
    receiptQueue = result.then(() => {});
    return result;
}
function acknowledgeEvent(kind: AdminApplicationEventKind, id: string): Promise<boolean> {
    if (kind === 'transfer' || kind === 'release') return Promise.resolve(true);
    if (kind === 'message') return Promise.resolve(false);
    const snapshot = targetEvents.value;
    const ids = snapshot?.newEventIds?.[kind] ?? [];
    const token = snapshot?.seenTokens?.[kind]?.[ids.indexOf(id)];
    return token ? acknowledgeEvents(kind, [token], requestGeneration()) : Promise.resolve(false);
}

const detailMounted = ref(false);
onMounted(() => {
    detailMounted.value = true;
});
const visitMessageEvents = computed(() => openingMessages.value?.events);
let openingReceipt: Promise<boolean> | undefined;
let acknowledgedGeneration: number | undefined;
watch([detailMounted, showContent, openingMessages], ([mounted, visible, opening]) => {
    if (!mounted || !visible || !opening || opening.generation === acknowledgedGeneration) return;
    acknowledgedGeneration = opening.generation;
    const tokens = opening.events?.seenTokens?.message;
    if (tokens?.length) openingReceipt = acknowledgeEvents('message', tokens, opening.generation);
});
onBeforeRouteLeave(async (to) => {
    // The returning list must request the reader's state after the opening receipt settles.
    if (/\/admin\/(?:applications|forms\/[^/]+)\/?$/.test(to.path)) await openingReceipt;
});
const jumpEventCounts = computed(() => {
    const counts = { ...eventCounts.value };
    Reflect.deleteProperty(counts, 'message');
    return counts;
});
const eventTargets = useApplicationEventTargets({ root: eventRoot, counts: jumpEventCounts, snapshot: targetEvents, scope: eventScope, acknowledge: acknowledgeEvent });
async function refreshEventCounts() {
    const generation = requestGeneration();
    const acknowledgement = requestAcknowledgement();
    const updated = await staffFetch<Pick<AdminApplicationDetailResponse, 'meta'>>(`/api/admin/applications/${applicationId}/events`, { query: withWorkspaceQuery() });
    receiveEventSnapshot(updated, generation, acknowledgement);
}
provideApplicationEvents({ counts: sectionCounts, snapshot: entryEvents, targets: targetEvents, refresh: refreshEventCounts, beginSectionLoad });

let stopEventFocus: (() => void) | undefined;
/** A later action cancels both a section load and waiting for its DOM target. */
async function focusEvent(kind: AdminApplicationEventKind) {
    if (arrangingSections.value) return;
    stopEventFocus?.();
    const generation = requestGeneration();
    const sectionId = registeredApplicationEvents().find(event => event.kind === kind)?.sectionId;
    if (!sectionId || typeof document === 'undefined') return;
    let cancelled = false;
    // Cancellation can run during the await, before an observer exists.
    // eslint-disable-next-line prefer-const
    let observer: MutationObserver | undefined;
    const stop = () => {
        cancelled = true;
        observer?.disconnect();
        for (const type of ['pointerdown', 'keydown', 'wheel', 'touchmove']) document.removeEventListener(type, stop, true);
        if (stopEventFocus === stop) stopEventFocus = undefined;
    };
    stopEventFocus = stop;
    // Install before awaiting comments: another pill or typing supersedes this jump.
    for (const type of ['pointerdown', 'keydown', 'wheel', 'touchmove']) document.addEventListener(type, stop, { capture: true, passive: true });
    const current = () => !cancelled && generation === requestGeneration();
    if (kind === 'message') {
        await fetchComments();
        await nextTick();
        if (!current()) {
            stop();
            return;
        }
    }
    const focus = () => {
        const section = document.getElementById(sectionId);
        if (!current() || !section || (kind !== 'message' && section.getAttribute('data-event-ready') === 'false')) return false;
        if (kind === 'message') {
            section.focus({ preventScroll: true });
            section.scrollIntoView({ block: 'nearest' });
            flashEventTarget(section);
        }
        const reached = kind === 'message' || eventTargets.focus(kind);
        if (reached) {
            stop();
            if (route.hash === `#${sectionId}`) void router.replace({ path: route.path, query: route.query, hash: '' });
        }
        return reached;
    };
    if (focus()) return;
    observer = new MutationObserver(() => {
        focus();
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-event-ready', 'data-event-target'] });
}
watch([showContent, () => route.hash], async ([ready, hash]) => {
    stopEventFocus?.();
    const event = registeredApplicationEvents().find(event => `#${event.sectionId}` === hash);
    if (!ready || !event) return;
    await nextTick();
    if (route.hash === hash) focusEvent(event.kind);
}, { immediate: true });
const composerFocusPending = ref(false);
let cancelComposerFocus: (() => void) | undefined;
watch(() => route.hash, (hash, _oldHash, onCleanup) => {
    if (hash !== `#${APPLICATION_MESSAGE_COMPOSER}` || typeof document === 'undefined') return;
    const events = ['pointerdown', 'keydown', 'wheel', 'touchmove'] as const;
    const cancel = () => {
        composerFocusPending.value = false;
        for (const type of events) document.removeEventListener(type, cancel, true);
        cancelComposerFocus = undefined;
    };
    cancelComposerFocus = cancel;
    onCleanup(cancel);
    composerFocusPending.value = true;
    for (const type of events) document.addEventListener(type, cancel, { capture: true, passive: true });
}, { immediate: true });
watch(selectedWorkspaceKey, () => cancelComposerFocus?.());
watch([showContent, commentsCard, commentsLoaded, commentsLoading, composerFocusPending], ([ready, card, loaded, loading, pending]) => {
    if (pending && ready && loaded && !loading && card?.focusComposer()) cancelComposerFocus?.();
}, { flush: 'post' });
let disconnectEventVisibility: (() => void) | undefined;
onMounted(() => {
    const onAnchor = (event: MouseEvent) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const anchor = (event.target as Element | null)?.closest('a[href^="#"]');
        const kind = registeredApplicationEvents().find(item => `#${item.sectionId}` === anchor?.getAttribute('href'))?.kind;
        if (kind) {
            event.preventDefault();
            focusEvent(kind);
        }
    };
    const stopWorkspace = watch(selectedWorkspaceKey, () => {
        stopEventFocus?.();
    });
    document.addEventListener('click', onAnchor);
    disconnectEventVisibility = () => {
        stopWorkspace();
        document.removeEventListener('click', onAnchor);
    };
});
onUnmounted(() => {
    stopEventFocus?.();
    disconnectEventVisibility?.();
});

type IncludedFormSchemaResource = {
    id?: string
    type: string
    attributes?: {
        label?: string
        field_schema?: string | { value?: string } | null
    }
};

function isIncludedFormSchema(resource: unknown): resource is IncludedFormSchemaResource {
    return Boolean(resource && typeof resource === 'object' && (resource as { type?: unknown }).type === 'form_schema--form_schema');
}

const schemaLabel = computed(() => {
    if (!response.value?.included?.length) return t('common.forms');
    const schemaEntity = response.value.included.find(isIncludedFormSchema) as IncludedFormSchemaResource | undefined;
    return (schemaEntity?.attributes?.label as string) ?? t('common.forms');
});

const schema = computed<FormSchema | null>(() => {
    if (!response.value?.included?.length) return null;
    const schemaEntity = response.value.included.find(isIncludedFormSchema) as IncludedFormSchemaResource | undefined;
    const rawSchema = schemaEntity?.attributes?.field_schema;
    const rawValue = typeof rawSchema === 'string'
        ? rawSchema
        : (rawSchema as { value?: string } | undefined)?.value;

    if (!rawValue) return null;

    try {
        return parseStoredFormSchema(rawValue, schemaEntity?.id);
    } catch {
        return null;
    }
});

const {
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
    rollbackAvailable,
    rollbackRefusal,
    rollbackKeptNoteShown,
    rollbackKeptNoteForDialog,
    manualStatusWay,
    rollbackStatusRevision,
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
    statusCorrectionNote,
    isStatusCorrectionDialogOpen,
    isCorrectingStatus,
    openStatusCorrectionDialog,
    closeStatusCorrectionDialog,
    correctApplicationStatus
} = useAdminApplicationStatusWorkflow({
    applicationId,
    application,
    applicationResponse: response,
    applicationQuery,
    currentWorkspace,
    schema,
    workflowStatuses,
    // A status change may plan a transfer after commit: reload the panel too.
    refreshApplication: refreshAfterStatusChange
});

/**
 * "Statusangaben" never shows a raw key. The one system value the backend
 * writes at submit, the language of the application, gets a label and the language's name; any other key
 * without a label from the workflow gets no row. Values recorded with a status change keep their label.
 */
const SUBMISSION_LOCALE_ATTRIBUTE = 'submissionLocale';
function languageName(value: unknown): unknown {
    if (typeof value !== 'string' || !value) return value;
    try {
        return new Intl.DisplayNames([locale.value], { type: 'language' }).of(value) ?? value;
    } catch {
        return value;
    }
}
const shownWorkflowAttributes = computed<Record<string, unknown>>(() => {
    const shown: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(application.value?.workflowAttributes ?? {})) {
        if (key === SUBMISSION_LOCALE_ATTRIBUTE) shown[key] = languageName(value);
        else if (getWorkflowAttributeLabel(key) !== key) shown[key] = value;
    }
    return shown;
});
function workflowAttributeListLabel(key: string): string {
    return key === SUBMISSION_LOCALE_ATTRIBUTE ? t('admin.detail.submissionLocale') : getWorkflowAttributeLabel(key);
}

// What a panel of the outlet `case-detail-panels` wants to hear from the page (it removes its handlers on unmount).
const statusChangedHandlers = caseDetailHandlers<CaseStatusChangedHandler>();
const dataSavedHandlers = caseDetailHandlers<CaseDataSavedHandler>();
const responseReleasedHandlers = caseDetailHandlers<CaseResponseReleasedHandler>();

async function refreshAfterStatusChange() {
    await refresh();
    for (const handler of statusChangedHandlers.current()) await handler();
}

const {
    applicationAttachments,
    analysisAttachment,
    attachmentSlideoverDetails,
    attachmentSlideoverClosed,
    attachmentsOpen,
    openAttachmentSlideover,
    openFieldAttachments,
    setAttachmentsOpen,
    applicationDataRows,
    applicationDataSections,
    attachmentAnalysisBusy,
    attachmentFileKind,
    attachmentListGroups,
    attachmentListSummary,
    attachmentLoadFailed,
    attachmentRowState,
    attachmentsForField,
    attachmentViewerDocument,
    deleteQuarantinedAttachment,
    deletingQuarantineAttachmentId,
    formatApplicationDataValue,
    formatAttachmentSize,
    getFieldLabel,
    isQuarantinedAttachment,
    orderedAttachments,
    refreshAnalysis,
    rerunAttachmentAnalysisStoryFromModal,
    showAttachmentDetails,
    startAttachmentAnalysis
} = useAdminApplicationAttachments({
    applicationId,
    application,
    schema,
    applicationResponse: response,
    applicationQuery,
    isAdmin,
    booleanLabels,
    refreshApplication: refresh,
    refreshAttachmentAnalysis
});

const {
    isEditingData,
    isSavingData,
    isDataEditReasonOpen,
    dataEditReason,
    dataEditReasonError,
    dataEditNotice,
    openDataEditReason,
    editData,
    editFieldInlineErrors,
    editFieldErrorMessages,
    editEntryErrors,
    editEntrySections,
    editErrorTargets,
    focusEditField,
    hiddenEditFieldRemovals,
    hiddenEditFieldRemovalLabels,
    protectedDataRedacted,
    dataEditDisabled,
    dataEditDisabledReason,
    dataEditDisabledTitle,
    startDataEdit,
    cancelDataEdit,
    saveApplicationData
} = useAdminApplicationDataEdit({
    applicationId,
    application,
    applicationResponse: response,
    schema,
    applicationQuery,
    refreshApplication: refresh
});

/**
 * A refresh keeps the page mounted (the attachments slide-over stays open on its attachment). The cards
 * that load their own data only on mount are remounted after every completed refresh, as the skeleton did
 * before, so they still show the state after a status change, a data save or an assignment.
 */
function openMessageAttachment(file: { id?: string }, commentId: string) {
    const attachment = applicationAttachments.value.find(item => item.fileId === file.id && item.comment?.id === commentId);
    if (attachment) openAttachmentSlideover(attachment, { kind: 'message', commentId, fileId: file.id! });
}

const contentGeneration = ref(0);
watch(status, (value, previous) => {
    if (previous === 'pending' && value === 'success') contentGeneration.value += 1;
});

/** A provided response changes the delivery evidence: the panels reload what depends on it, never the list. */
function onResponseReleased() {
    void refreshEventCounts().catch(() => {});
    for (const handler of responseReleasedHandlers.current()) handler();
}

/** Unsent transfers reported by the transfer panel; a data edit stops them. */
const pendingTransfers = ref<CasePendingTransfer[]>([]);
/** When the transfer starts, reported by the transfer panel for the status dialog. */
const transferTrigger = ref<CaseTransferTrigger | null>(null);
const transferCanApprove = ref(false);
function onTransferTrigger(trigger: CaseTransferTrigger | null, canApprove: boolean) {
    transferTrigger.value = trigger;
    transferCanApprove.value = canApprove;
}
const pendingTransferConnections = computed(() => pendingTransfers.value.map(transfer => transfer.connection));

/** Every save reloads the transfer panel: a colleague may have planned a transfer meanwhile. */
async function saveData(reason: string) {
    const waiting = pendingTransfers.value.map(transfer => transfer.uuid);
    const before = JSON.stringify(application.value?.data ?? null);
    if (!await saveApplicationData(reason)) return;
    const dataChanged = JSON.stringify(application.value?.data ?? null) !== before;
    for (const handler of dataSavedHandlers.current()) await handler(waiting, dataChanged);
}

async function restoreDataEditFocus() {
    await nextTick();
    const firstError = editErrorTargets.value[0];
    if (isEditingData.value && firstError) {
        await focusEditField(firstError);
        return;
    }
    document.getElementById(isEditingData.value ? 'application-data-save' : 'application-data-edit')?.focus();
}

async function editFromTransfer() {
    startDataEdit();
    await nextTick();
    const card = document.getElementById('application-data-card');
    card?.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
    card?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

const applicationMutationBusy = computed(() =>
    statusActionBusy.value
    || isSavingData.value
    || isSavingDueDate.value
    || isSavingAssignee.value
    || isDelegating.value
    || Object.values(panelBusy.value).some(Boolean)
    || attachmentAnalysisBusy.value
    || Boolean(deletingQuarantineAttachmentId.value)
);
const canDeleteApplication = computed(() => response.value?.meta?.canDelete === true);
const canChangeApplicationStatus = computed(() => response.value?.meta?.canChangeStatus === true);
const {
    isDeleteDialogOpen,
    isDeletingApplication,
    deleteActionDisabled,
    openDeleteDialog,
    closeDeleteDialog,
    deleteApplication
} = useAdminApplicationDeletion({
    applicationId,
    application,
    applicationQuery,
    canDelete: canDeleteApplication,
    mutationBusy: applicationMutationBusy,
    listRoute: () => workspaceRoute('/admin/applications')
});

/**
 * What the Pro panels (decisions, delivery, transfers, Nachreichung) read and tell the page, through the outlet
 * the case section outlets. Without them the outlet renders nothing and none of this is used.
 */
const caseDetailPanelContext: CaseDetailPanelContext = {
    applicationId,
    application: computed(() => application.value
        ? { id: application.value.id, schemaId: application.value.schemaId, created: application.value.created, statusFlags: application.value.statusFlags }
        : null),
    isStaff,
    isAdmin,
    canEditData: computed(() => !dataEditDisabled.value),
    formWorkflowTo,
    manualStatusAction: computed(() => manualStatusWay.value === 'correction' ? t('admin.detail.statusReviewAction') : manualStatusWay.value === 'change' ? t('admin.detail.changeStatus') : null),
    workspaceRoute: path => workspaceRoute(path),
    setBusy: (source, busy) => {
        panelBusy.value = { ...panelBusy.value, [source]: busy };
    },
    refreshApplication: () => refresh(),
    bumpResponses: () => {
        externalResponsesVersion.value += 1;
    },
    requestDataEdit: editFromTransfer,
    setPendingTransfers: (list) => {
        pendingTransfers.value = [...list];
    },
    setTransferTrigger: onTransferTrigger,
    onStatusChanged: handler => statusChangedHandlers.add(handler),
    onDataSaved: handler => dataSavedHandlers.add(handler),
    onResponseReleased: handler => responseReleasedHandlers.add(handler)
};

useHead({
    title: computed(() =>
        showContent.value && application.value
            ? `${application.value.referenceNumber} - ${t('nav.applications')} - beantragt.ai`
            : `${t('nav.applications')} - beantragt.ai`
    )
});
</script>

<template>
  <!-- One frame for every state: breadcrumb, title and header controls come from AppPageLayout. -->
  <AdminApplicationDetailHeader
    id="application-header"
    ref="detailHeader"
    :application="showContent ? application : null"
    :loading="(status === 'pending' && !application) || leavingAfterHandOver"
    :fallback-title="notInThisOffice ? t('admin.detail.notHere.title') : t('admin.detail.applicationCrumb')"
    :list-to="workspaceRoute('/admin/applications')"
    :breadcrumb-label="showContent ? (application?.referenceNumber || applicationId.slice(0, 8)) : t('admin.detail.applicationCrumb')"
    :schema-label="schemaLabel"
    :applicant-name="applicantName"
    :has-status="Boolean(applicationStatus)"
    :unread-message-count="visitMessageEvents?.counts.message"
    :transition-count="statusTransitionActions.length"
    :may-change-status="canChangeApplicationStatus"
    :show-rollback-action="rollbackAvailable"
    :is-saving-status="isSavingStatus"
    :status-action-busy="statusActionBusy"
    :print-to="workspaceRoute(`/admin/applications/${applicationId}/print`)"
    :can-delete="canDeleteApplication"
    :is-deleting="isDeletingApplication"
    :delete-disabled="deleteActionDisabled"
    @change-status="openStatusDialog"
    @focus-messages="focusEvent('message')"
    @delete="openDeleteDialog"
  >
    <template #event-actions>
      <ApplicationEventMenu
        v-if="showContent && !arrangingSections"
        :items="eventTargets.items.value"
        @select="focusEvent"
      />
    </template>
    <!-- Loading -->
    <div
      v-if="status === 'pending' && !application"
      class="space-y-4"
    >
      <USkeleton class="h-64 w-full rounded-lg" />
    </div>

    <!-- Handed over by this person: the page goes to the list, no state in between. -->
    <div
      v-else-if="leavingAfterHandOver"
      class="space-y-4"
    >
      <USkeleton class="h-64 w-full rounded-lg" />
    </div>

    <!-- Not in this office (404): neutral, nothing of the case, one way back. -->
    <UEmpty
      v-else-if="notInThisOffice"
      icon="i-lucide-inbox"
      :title="workspaceName ? t('admin.detail.notHere.heading', { workspace: workspaceName }) : t('admin.detail.notHere.headingNoWorkspace')"
      :description="t('admin.detail.notHere.description')"
      data-testid="application-not-here"
    >
      <template #actions>
        <UButton
          color="neutral"
          variant="outline"
          :to="workspaceRoute('/admin/applications')"
        >
          {{ t('admin.detail.notHere.action') }}
        </UButton>
      </template>
    </UEmpty>

    <UEmpty
      v-else-if="accessDenied"
      icon="i-lucide-lock"
      :title="t('errors.applications.accessDenied')"
      data-testid="application-access-denied"
    >
      <template #actions>
        <UButton
          color="neutral"
          variant="outline"
          :to="workspaceRoute('/admin/applications')"
        >
          {{ t('admin.detail.notHere.action') }}
        </UButton>
      </template>
    </UEmpty>

    <!-- A real failure (5xx, network): an error with the way to try again. -->
    <UAlert
      v-else-if="error"
      class="max-w-3xl"
      color="error"
      icon="i-lucide-circle-x"
      :title="t('errors.applications.loadFailed')"
      :actions="[{ label: t('common.retry'), color: 'neutral', variant: 'outline', onClick: () => refresh() }]"
      data-testid="application-load-error"
    />

    <!-- Content -->
    <template v-else-if="application">
      <AdminApplicationStatusReviewAlert
        v-if="workflowReview"
        class="mb-6"
        :review="workflowReview"
        :status-label="application.statusLabel || application.status"
        :target-count="statusCorrectionTargets.length"
        :busy="statusActionBusy"
        @correct="openStatusCorrectionDialog"
      />

      <AdminApplicationStatusCorrectionModal
        v-model:open="isStatusCorrectionDialogOpen"
        v-model:note="statusCorrectionNote"
        :kept-note="rollbackKeptNoteForDialog"
        :current-status="{
          status: application.status,
          label: application.statusLabel,
          color: application.statusColor,
          icon: application.statusIcon,
        }"
        :targets="statusCorrectionTargets"
        :selected-target-id="statusCorrectionTargetId"
        :is-saving="isCorrectingStatus"
        @select-target="statusCorrectionTargetId = $event"
        @close="closeStatusCorrectionDialog"
        @apply="correctApplicationStatus"
      />

      <UModal
        :open="isDeleteDialogOpen"
        :title="t('admin.detail.deleteApplicationTitle')"
        :description="t('admin.detail.deleteApplicationDescription')"
        @update:open="(value: boolean) => !value && closeDeleteDialog()"
        @after:leave="detailHeader?.focusMoreActions()"
      >
        <template #body>
          <div class="space-y-3 text-sm">
            <p class="font-medium text-(--ui-text-highlighted)">
              {{ application.referenceNumber || application.id.slice(0, 8) }}
            </p>
            <UAlert
              role="status"
              color="warning"
              icon="i-lucide-triangle-alert"
              :title="t('admin.detail.deleteApplicationDeliveryWarningTitle')"
              :description="t('admin.detail.deleteApplicationDeliveryWarning')"
            />
          </div>
        </template>

        <template #footer>
          <div class="flex w-full flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <UButton
              color="neutral"
              variant="ghost"
              :disabled="isDeletingApplication"
              @click="closeDeleteDialog"
            >
              {{ t('common.cancel') }}
            </UButton>
            <UButton
              color="error"
              icon="i-lucide-trash-2"
              :loading="isDeletingApplication"
              :disabled="deleteActionDisabled"
              data-test="delete-application-confirm"
              @click="deleteApplication"
            >
              {{ t('admin.detail.deleteApplicationConfirm') }}
            </UButton>
          </div>
        </template>
      </UModal>

      <AdminApplicationAttachmentsSlideover
        v-if="isStaff"
        :open="attachmentsOpen"
        :groups="attachmentListGroups"
        :ordered="orderedAttachments"
        :summary="attachmentListSummary"
        :current="analysisAttachment"
        :details="attachmentSlideoverDetails"
        :row-state="attachmentRowState"
        :file-kind="attachmentFileKind"
        :viewer-document="attachmentViewerDocument"
        :is-quarantined-attachment="isQuarantinedAttachment"
        @update:open="setAttachmentsOpen"
        @select="showAttachmentDetails"
        @run-analysis="startAttachmentAnalysis"
        @rerun-story="rerunAttachmentAnalysisStoryFromModal"
        @refresh-analysis="refreshAnalysis"
        @delete-quarantine="deleteQuarantinedAttachment"
        @closed="attachmentSlideoverClosed"
      />

      <AdminApplicationDataEditReasonModal
        v-model:open="isDataEditReasonOpen"
        v-model:reason="dataEditReason"
        :saving="isSavingData"
        :error="dataEditReasonError"
        @save="saveData"
        @restore-focus="restoreDataEditFocus"
        @input="dataEditReasonError = ''"
      />
      <AdminApplicationStatusTransitionModal
        v-model:open="isStatusDialogOpen"
        :note="statusNote"
        :kept-note="rollbackKeptNoteForDialog"
        :reference-label="application.referenceNumber || application.id.slice(0, 8)"
        :current-status="{
          status: application.status,
          label: application.statusLabel,
          color: application.statusColor,
          icon: application.statusIcon,
        }"
        :transition="selectedStatusTransition"
        :transition-attributes="selectedTransitionAttributes"
        :transition-items="statusTransitionItems"
        :attribute-values="statusAttributeValues"
        :show-boilerplate-select="isLoadingStatusBoilerplates || statusBoilerplates.length > 0"
        :boilerplate-items="statusBoilerplateItems"
        :selected-boilerplate-id="selectedStatusBoilerplateId"
        :is-loading-boilerplates="isLoadingStatusBoilerplates"
        :is-saving="isSavingStatus"
        :submit-disabled="statusSubmitDisabled"
        :transfer-trigger="transferTrigger"
        :can-approve-dispatch="transferCanApprove"
        @update:note="updateStatusNote"
        @select-transition="selectedTransitionStatusId = $event"
        @update-attribute="updateWorkflowAttributeValue"
        @apply-boilerplate="applyStatusBoilerplate"
        @close="closeStatusDialog"
        @apply="updateApplicationStatus"
      />

      <AdminApplicationStatusRollbackModal
        v-model:open="isStatusRollbackDialogOpen"
        v-model:note="statusRollbackNote"
        :current-status="{
          status: application.status,
          label: application.statusLabel,
          color: application.statusColor,
          icon: application.statusIcon,
        }"
        :rollback-status="rollbackStatusDisplay"
        :is-rolling-back="isRollingBackStatus"
        @close="closeStatusRollbackDialog"
        @apply="rollbackApplicationStatus"
      />

      <AdminApplicationAssignModal
        v-model:open="isAssignModalOpen"
        :current-assignee="currentAssignee"
        :candidates="assigneeCandidates"
        :team-candidates="assigneeTeamCandidates"
        :display-label="assigneeDisplayLabel"
        :has-candidates="hasAssigneeCandidates"
        :personal-assignment-enabled="personalAssignmentEnabled"
        :current-assignee-out-of-scope="currentAssigneeOutOfScope"
        :current-responsibility-label="currentResponsibilityLabel"
        :delegation-available="showDelegationTrigger"
        :jurisdiction-slug="currentWorkspace?.jurisdictionSlug"
        :is-saving="isSavingAssignee"
        :error="assigneeSaveError"
        @assign="handleAssignment"
        @reload="reloadAssignmentPicker"
        @clear-error="clearAssigneeSaveError"
      />

      <AdminApplicationDelegationModal
        v-model:open="isDelegationModalOpen"
        :delegation-targets="delegationTargets"
        :current-responsibility-label="currentResponsibilityLabel"
        :jurisdiction-slug="currentWorkspace?.jurisdictionSlug"
        :note-required="delegationNoteRequired"
        :busy="isDelegating"
        @delegate="handleDelegation"
      />

      <p
        class="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {{ assignmentSaveAnnouncement }}
      </p>

      <AdminCaseLayout
        :context-key="layoutContextKey"
        :query="applicationQuery"
        :visible-sections="layoutSections"
        @arranging="arrangingSections = $event"
      >
        <template #attachments>
          <UAlert
            v-if="attachmentLoadFailed && !isStaff"
            role="status"
            color="warning"
            icon="i-lucide-triangle-alert"
            :title="t('admin.detail.attachmentLoadFailedTitle')"
            :description="t('admin.detail.attachmentLoadFailedDescription')"
          />
          <AdminApplicationAttachmentList
            v-if="isStaff && (attachmentListGroups.length > 0 || attachmentLoadFailed)"
            id="application-attachments"
            :groups="attachmentListGroups"
            :summary="attachmentListSummary"
            :load-failed="attachmentLoadFailed"
            :messages-loading="!commentsLoaded || commentsLoadFailed"
            :row-state="attachmentRowState"
            :file-kind="attachmentFileKind"
            :format-attachment-size="formatAttachmentSize"
            :is-quarantined-attachment="isQuarantinedAttachment"
            @open="openAttachmentSlideover"
            @message="commentsCard?.focusComment($event)"
          />
        </template>
        <template #data>
          <AdminApplicationDataCard
            v-if="isStaff"
            id="application-data-card"
            v-model:edit-data="editData"
            tabindex="-1"
            :is-editing="isEditingData"
            :is-saving="isSavingData"
            :schema="schema"
            :edit-field-errors="editFieldInlineErrors"
            :edit-field-error-messages="editFieldErrorMessages"
            :show-hidden-edit-field-removal-warning="hiddenEditFieldRemovals.length > 0"
            :hidden-edit-field-removal-labels="hiddenEditFieldRemovalLabels"
            :data-edit-disabled="dataEditDisabled"
            :data-edit-disabled-title="dataEditDisabledTitle"
            :data-edit-disabled-reason="dataEditDisabledReason"
            :data-edit-notice="dataEditNotice"
            :correction-history="{ applicationId, query: applicationQuery, origin: application.origin }"
            :protected-data-redacted="protectedDataRedacted"
            :application-data-rows="applicationDataRows"
            :application-data-sections="applicationDataSections"
            :get-field-label="getFieldLabel"
            :format-application-data-value="formatApplicationDataValue"
            :attachments-for-field="attachmentsForField"
            :pending-transfer-connections="pendingTransferConnections"
            :edit-entry-sections="editEntrySections"
            :edit-entry-errors="editEntryErrors"
            :edit-error-targets="editErrorTargets"
            :attachments-card-shown="attachmentListGroups.length > 0 || attachmentLoadFailed"
            @edit="startDataEdit"
            @cancel="cancelDataEdit"
            @save="openDataEditReason"
            @open-attachments="openFieldAttachments"
            @focus-field="focusEditField"
          />
        </template>
        <template #messages>
          <AdminApplicationCommentsCard
            id="application-messages"
            ref="commentsCard"
            :preview-file-ids="applicationAttachments.flatMap(file => file.fileId ? [file.fileId] : [])"
            :comments="comments"
            v-bind="visitMessageEvents ? { events: visitMessageEvents } : {}"
            :loading="commentsLoading"
            :loaded="commentsLoaded"
            :load-failed="commentsLoadFailed"
            :application-id="application.id"
            :public-hint="commentPublicHint"
            :initial-visibility="commentInitialVisibility"
            :public-send-label="commentPublicSendLabel"
            @attachment="openMessageAttachment"
            @comment-added="onCommentAdded"
          />
        </template>
        <template #deadline>
          <AdminApplicationDeadlineCard
            id="application-deadline"
            v-model="dueDateInput"
            :due-date="application.dueDate"
            :is-overdue="applicationOverdue"
            :read-only="!canChangeApplicationStatus"
            :changed="dueDateChanged"
            :is-saving="isSavingDueDate"
            :past-pending="dueDatePastPending"
            :conflict="dueDateConflict"
            @save="saveApplicationDueDate()"
            @clear="saveApplicationDueDate(null)"
            @confirm-past="confirmPastDueDate()"
            @cancel-past="cancelPastDueDate()"
            @reload="reloadAfterDueDateConflict()"
          />
        </template>
        <template #assignment>
          <AdminApplicationAssignmentCard
            id="application-assignment"
            :status="assigneesStatus"
            :has-error="Boolean(assigneesError)"
            :display-label="assigneeDisplayLabel"
            :has-candidates="hasAssigneeCandidates"
            :can-change="canChangeAssignment"
            :personal-assignment-enabled="personalAssignmentEnabled"
            :is-saving="isSavingAssignee"
            :has-delegation-targets="showDelegationTrigger"
            :can-delegate="assigneesStatus === 'success' ? canDelegate : undefined"
            :current-responsibility-label="currentResponsibilityLabel"
            :is-delegating="isDelegating"
            :can-assign-self="canAssignSelf"
            :self-assign-takes-over-from="selfAssignTakesOverFrom"
            :self-assign-error="selfAssignError"
            @retry="refreshAssignees"
            @open-assign="clearAssigneeSaveError(); isAssignModalOpen = true"
            @open-delegation="isDelegationModalOpen = true"
            @assign-self="assignSelf()"
            @reload="reloadAssignmentPicker"
          />
        </template>
        <template #status_history>
          <AdminApplicationStatusHistoryCard
            v-if="applicationStatus || Object.keys(shownWorkflowAttributes).length > 0"
            id="application-status-history"
            :current-status="{
              id: application.id,
              referenceNumber: application.referenceNumber,
              status: application.status,
              label: application.statusLabel,
              color: application.statusColor,
              icon: application.statusIcon,
              citizenHint: application.statusCitizenHint,
            }"
            :rollback-status="rollbackStatusDisplay"
            :rollback-revision="rollbackStatusRevision"
            :rollback-refusal="rollbackRefusal"
            :rollback-kept-note="rollbackKeptNoteShown"
            :status-action-busy="statusActionBusy"
            :is-rolling-back="isRollingBackStatus"
            :workflow-attributes="shownWorkflowAttributes"
            :workflow-attribute-label="workflowAttributeListLabel"
            :boolean-labels="booleanLabels"
            @rollback="openStatusRollbackDialog"
          />
        </template>
        <template #crm>
          <AdminApplicationCrmDataCard
            id="application-crm"
            :crm-data="application.crmData"
            :consents="application.consents"
            :email="application.email"
            :boolean-labels="booleanLabels"
            :field-label="getFieldLabel"
            :format-crm-value="formatApplicationDataValue"
          />
        </template>
        <template #docgen>
          <StaffExtensionOutlet
            :key="`docgen-${contentGeneration}`"
            name="case-docgen"
            :context="caseDetailPanelContext"
          />
        </template>
        <template #delivery>
          <StaffExtensionOutlet
            :key="`delivery-${contentGeneration}`"
            name="case-delivery"
            :context="caseDetailPanelContext"
          />
        </template>
        <template #transfers>
          <StaffExtensionOutlet
            :key="`transfers-${contentGeneration}`"
            name="case-transfers"
            :context="caseDetailPanelContext"
          />
        </template>
        <template #supplements>
          <StaffExtensionOutlet
            :key="`supplements-${contentGeneration}`"
            name="case-supplements"
            :context="caseDetailPanelContext"
          />
        </template>
        <template #responses>
          <div
            :key="`responses-${contentGeneration}`"
            class="contents"
          >
            <ExternalResponseList
              id="application-responses"
              :key="`external-responses-${externalResponsesVersion}`"
              :application-id="application.id"
              staff
              class="mb-6"
              @released="onResponseReleased"
            />
          </div>
        </template>
      </AdminCaseLayout>
    </template>
  </AdminApplicationDetailHeader>
</template>
