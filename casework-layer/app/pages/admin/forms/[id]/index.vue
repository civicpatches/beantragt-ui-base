<script setup lang="ts">
import { staffFormFeatures } from '~~/casework-layer/app/utils/staff-extensions';
import { EDIT_ICON } from '~/utils/action-icons';
import type { FormSchema } from '~/types/form';
import type { FormSchemaSingleResponse, AdminApplicationsResponse, ApplicationRow } from '~/types';
import { buildStatusMap, uniqueStatusesByMachineName, workflowStatusDisplayLabel } from '~/utils/workflow-status';
import { publicFormPath } from '~/utils/public-form-path';
import { parseStoredFormSchema } from '~/utils/form-schema';
import { namedBlockerFields, publishBlockers, publishRefusalKind, type PublishBlockers } from '~~/casework-layer/app/utils/publish-blockers';
import { loadFormApplicationCount, publishSuccessDescription } from '~~/casework-layer/app/utils/publish-success';
import { hasApplicationAssignmentRelationship } from '~~/casework-layer/app/utils/application-assignment-filter';
import { applicationListRows } from '~~/casework-layer/app/utils/application-list-rows';
import type { WorkflowTransitionsEditorStatus } from '~~/casework-layer/app/components/admin/WorkflowTransitionsEditor.vue';
import type { DropdownMenuItem } from '@nuxt/ui';
import { usePublishRule } from '~~/casework-layer/app/composables/usePublishRule';
import {
    disableWorkflowFeature,
    enableWorkflowFeature,
    isStandardWorkflow,
    standardStatuses,
    workflowFeatureOf,
    workflowFeatureStates,
    type WorkflowFeatureKey,
    type WorkflowFeatureState
} from '~~/casework-layer/server/utils/schema-workflow-definition';

definePageMeta({
    layout: 'dashboard',
    middleware: 'admin'
});

const { t, locale } = useI18n();
const toast = useToast();
const { resolveApiErrorMessage } = useApiErrorMessage();
const route = useRoute();
const { selectedWorkspaceKey, currentWorkspace, withWorkspaceQuery, workspaceRoute } = useWorkspaceContext();
const { user, isAdmin } = useAuth();
const schemaId = route.params.id as string;
const formFeatures = staffFormFeatures();
const schemaQuery = computed(() => withWorkspaceQuery());
const canonicalRouteLoading = ref(false);
const canonicalRedirectPending = ref(false);
const currentUserId = computed(() => user.value?.uuid ?? null);
const currentTeamIds = computed(() =>
    currentWorkspace.value?.type === 'organisation' ? [currentWorkspace.value.id] : []
);

// ── Load form schema (via server proxy) ──────────────────────────
const { data: schemaResponse, status: schemaStatus, error: schemaError, refresh: refreshSchema } = await useFetch<FormSchemaSingleResponse>(`/api/admin/schemas/${schemaId}`, {
    key: `admin-schema-${schemaId}`,
    query: computed(() => withWorkspaceQuery(formFeatures ? {} : { capabilities: '1' })),
    watch: [selectedWorkspaceKey]
});

function isNotFoundError(errorValue: unknown): boolean {
    if (!errorValue || typeof errorValue !== 'object') return false;
    const error = errorValue as {
        statusCode?: number
        status?: number
        data?: { code?: string, data?: { code?: string } }
    };
    return error.statusCode === 404
      || error.status === 404
      || error.data?.code === 'errors.schema.notFound'
      || error.data?.data?.code === 'errors.schema.notFound';
}

// The setup pages are children of this page (they open in a modal over
// it): the form's own path is the route path without the setup part, and
// a move to the canonical workspace keeps that part.
const SETUP_PATH_SUFFIX = /\/setup(?:\/.*)?$/u;

async function redirectToCanonicalSchemaRoute() {
    if (canonicalRouteLoading.value || canonicalRedirectPending.value || !isNotFoundError(schemaError.value)) return;
    canonicalRouteLoading.value = true;
    try {
        const resolved = await $fetch<{ path: string }>(`/api/admin/schemas/${schemaId}/route`);
        const currentPath = String(route.path);
        const formPath = currentPath.replace(SETUP_PATH_SUFFIX, '');
        if (resolved.path && resolved.path !== formPath) {
            const target = `${resolved.path}${currentPath.slice(formPath.length)}`;
            canonicalRedirectPending.value = true;
            if (import.meta.client) {
                window.location.replace(target);
                return;
            }
            await navigateTo(target, { replace: true });
        }
    } catch (error) {
        console.warn('[admin] Failed to resolve canonical schema route:', error);
    } finally {
        if (!canonicalRedirectPending.value) {
            canonicalRouteLoading.value = false;
        }
    }
}

await redirectToCanonicalSchemaRoute();

watch(schemaError, () => {
    void redirectToCanonicalSchemaRoute();
});

const schema = computed<FormSchema | null>(() => {
    if (!schemaResponse.value?.data) return null;
    const attrs = schemaResponse.value.data.attributes;
    try {
        const fieldValue = typeof attrs.field_schema === 'string'
            ? attrs.field_schema
            : attrs.field_schema?.value;
        if (!fieldValue) return null;
        return parseStoredFormSchema(fieldValue, schemaResponse.value!.data.id);
    } catch (e) {
        console.error('[admin] Failed to parse schema:', e);
        return null;
    }
});

const schemaLabel = computed(() => schemaResponse.value?.data?.attributes?.label ?? t('common.forms'));
// Badges and actions only make sense once the schema has loaded.
const headerReady = computed(() =>
    !canonicalRouteLoading.value && schemaStatus.value !== 'pending' && !schemaError.value
);

const schemaWorkflowStatus = computed(() =>
    schemaResponse.value?.data?.attributes?.field_workflow_status ?? 'draft'
);
const isDraftSchema = computed(() => schemaWorkflowStatus.value === 'draft');
const isPublishedSchema = computed(() => schemaWorkflowStatus.value === 'published');
const isArchivedSchema = computed(() => schemaWorkflowStatus.value === 'archived');

const schemaPublicationScope = computed(() =>
    schemaResponse.value?.data?.attributes?.field_publication_scope === 'internet' ? 'internet' : 'intranet'
);

const schemaPublicationScopeLabel = computed(() =>
    t(`admin.forms.publicationScopes.${schemaPublicationScope.value}`)
);

const canPublishSchema = computed(() =>
    schemaWorkflowStatus.value === 'published' || schema.value !== null
);

const setup = formFeatures?.useSetupView(schemaId);
const setupView = setup?.data;
const draftSetupView = computed(() =>
    isDraftSchema.value && schemaResponse.value?.data && !schemaError.value && !setup?.error.value
        ? setupView?.value
        : null
);
const setupEligible = computed(() => draftSetupView.value?.eligible === true);
const setupWorkspaceMismatch = computed(() => {
    const view = draftSetupView.value;
    return view && 'workspaceMismatch' in view ? view.workspaceMismatch : null;
});
const setupIneligibleReason = computed(() =>
    draftSetupView.value?.eligible === false ? draftSetupView.value.ineligibleReason : null
);
const publishForbidden = computed(() => {
    const capabilities = schemaResponse.value?.capabilities;
    return (setupView?.value?.canPublish ?? (capabilities && capabilities.canEdit && capabilities.canPublish)) === false;
});

interface WorkflowEditorStatus {
    id: string
    label: string
    machineName: string
    color: string
    icon: string
    weight: number
    isDefault: boolean
    isTerminal: boolean
    semanticFlags: string[]
    allowedNextIds: string[]
    citizenLabel?: { de: string, en: string }
}

type WorkflowAttributeDatatype = 'string' | 'number' | 'text' | 'datetime' | 'singlevaluelist' | 'multivaluelist' | 'imagelist';

interface WorkflowEditorAttributeValue {
    key: string
    name: string
}

interface WorkflowEditorAttribute {
    code: string
    variable: boolean
    datatype: WorkflowAttributeDatatype
    required: boolean
    description: string
    order: number
    values?: WorkflowEditorAttributeValue[]
    media_type?: string
    media_group?: string
    datatype_description?: string
    default_value?: string | number
}

interface WorkflowEditorStatusDefinition {
    machineName: string
    description?: string
    attributes?: WorkflowEditorAttribute[]
}

interface WorkflowEditorDefinition {
    mode: 'catalog'
    defaultStatus: string
    statuses: WorkflowEditorStatusDefinition[]
    transitions: Array<{ from: string, to: string, condition?: string, attributes?: WorkflowEditorAttribute[] }>
}

interface WorkflowEditorResponse {
    workflow: WorkflowEditorDefinition
    statuses: WorkflowEditorStatus[]
    standard?: { statuses: string[], followed: boolean }
    features?: WorkflowFeatureState[]
    meta: {
        editable: boolean
        workspaceLabel: string
        schemaChanged: string | null
    }
}

const {
    data: workflowResult,
    status: workflowStatus,
    error: workflowError,
    refresh: refreshWorkflow
} = await useFetch<WorkflowEditorResponse | { organisationRequired: true }>(`/api/admin/schemas/${schemaId}/workflow`, {
    key: `admin-schema-workflow-${schemaId}`,
    query: schemaQuery,
    watch: [selectedWorkspaceKey]
});

// Workspaces above an organisation cannot own statuses. That is an expected
// state, not a failure, so it gets the same notice as the workflow settings.
// A status that the stored workflow lists was deleted in the settings: the
// route answers 422 `errors.workflow.statusNotFound` with its technical name.
// Say the cause and the way out instead of the general load error.
const workflowDeletedStatus = computed(() => {
    const data = workflowError.value?.data as { code?: unknown, status?: unknown, data?: { code?: unknown, status?: unknown } } | undefined;
    const code = data?.data?.code ?? data?.code;
    if (code !== 'errors.workflow.statusNotFound') return null;
    const name = data?.data?.status ?? data?.status;
    return typeof name === 'string' && name ? name : '';
});
const workflowOrganisationRequired = computed(() => Boolean(workflowResult.value && 'organisationRequired' in workflowResult.value));
const workflowResponse = computed(() => workflowResult.value && !('organisationRequired' in workflowResult.value)
    ? workflowResult.value
    : null);

const workflowDraft = ref<WorkflowEditorDefinition | null>(null);
// A transition removed from the draft keeps its
// condition and fields here, with its place in the list, until the page is
// saved, reset or reloaded; adding the same pair again restores it, so a
// slip of the X loses nothing and leaves the draft as it was.
type WorkflowEditorTransition = WorkflowEditorDefinition['transitions'][number];
const removedTransitions = new Map<string, WorkflowEditorTransition>();
const workflowSaving = ref(false);
const workflowReadOnlyOpen = ref(false);
const selectedWorkflowStatusMachineName = ref<string | undefined>(undefined);
// Description and Zusatzangaben of one status open in a
// panel from the pencil of its row; the panel edits the draft, "Speichern"
// in the card saves it.
const workflowStatusPanelOpen = ref(false);

watch(workflowResponse, (response) => {
    workflowDraft.value = response ? structuredClone(response.workflow) : null;
    removedTransitions.clear();
}, { immediate: true });

const workflowEditable = computed(() =>
    Boolean(workflowResponse.value?.meta.editable)
    && isDraftSchema.value
    && !schemaStatusUpdating.value
);
const workflowCatalog = computed(() =>
    [...(workflowResponse.value?.statuses ?? [])].sort((a, b) =>
        a.weight - b.weight
        || workflowStatusLabel(a).localeCompare(workflowStatusLabel(b), 'de')
    )
);
const workflowActiveMachineNames = computed(() =>
    new Set((workflowDraft.value?.statuses ?? []).map(status => status.machineName))
);
const workflowActiveStatuses = computed(() =>
    workflowCatalog.value.filter(status => workflowActiveMachineNames.value.has(status.machineName))
);
const workflowInactiveStatusItems = computed(() =>
    workflowCatalog.value
        .filter(status => !workflowActiveMachineNames.value.has(status.machineName))
        .map(status => ({ label: workflowStatusLabel(status), value: status.machineName, dotColor: status.color }))
);
// "Weiteren Status hinzufügen" is a menu of the
// catalogue statuses the form does not use, each with its dot (slot
// `status-leading`).
const workflowAddStatusMenuItems = computed<DropdownMenuItem[][]>(() => [
    workflowInactiveStatusItems.value.map(item => ({
        label: item.label,
        slot: 'status',
        dotColor: item.dotColor,
        onSelect: () => addWorkflowStatusByMachineName(item.value)
    }))
]);
const workflowActiveDefinitions = computed(() =>
    workflowActiveStatuses.value.map((status) => {
        const definition = workflowDraft.value?.statuses.find(item => item.machineName === status.machineName);
        return definition ? { status, definition } : null;
    }).filter((item): item is { status: WorkflowEditorStatus, definition: WorkflowEditorStatusDefinition } => Boolean(item))
);
// ── Standard workflow and form functions ─────────────────────
// The helpers are the server's (`schema-workflow-definition.ts`), so the page
// and the editor response read one table by flag. The server stays the
// authority: it validates and stores the draft (E4: the standard empty).
const workflowStandardStatuses = computed(() => standardStatuses(workflowResponse.value?.statuses ?? []));
const workflowStandardMachineNames = computed(() => new Set(workflowStandardStatuses.value.map(status => status.machineName)));
// The functions against the draft, so a tick shows at once.
const workflowFeatures = computed<WorkflowFeatureState[]>(() =>
    workflowFeatureStates(workflowResponse.value?.statuses ?? [], workflowDraft.value)
);
const workflowFollowsStandard = computed(() =>
    Boolean(workflowDraft.value) && isStandardWorkflow(workflowDraft.value!, workflowResponse.value?.statuses ?? [])
);
const workflowEnabledFeatures = computed(() => workflowFeatures.value.filter(feature => feature.enabled));
// The standard line names the standard statuses the form uses, then what it has more.
const workflowStandardInForm = computed(() =>
    workflowStandardStatuses.value.filter(status => workflowActiveMachineNames.value.has(status.machineName))
);
const workflowExtraStatuses = computed(() =>
    workflowActiveStatuses.value.filter(status => !workflowStandardMachineNames.value.has(status.machineName))
);
const WORKFLOW_FEATURE_LABEL_KEYS: Record<WorkflowFeatureKey, string> = {
    requestInfo: 'admin.forms.workflowFeatures.requestInfo.label',
    handOver: 'admin.forms.workflowFeatures.handOver.label',
    outcome: 'admin.forms.workflowFeatures.outcome.label',
    withdrawal: 'admin.forms.workflowFeatures.withdrawal.label'
};
function workflowFeatureLabel(key: WorkflowFeatureKey): string {
    return t(WORKFLOW_FEATURE_LABEL_KEYS[key]);
}
function catalogueStatus(machineName: string | undefined): WorkflowEditorStatus | undefined {
    return machineName ? workflowResponse.value?.statuses.find(status => status.machineName === machineName) : undefined;
}
function catalogueStatusLabel(machineName: string | undefined): string {
    const status = catalogueStatus(machineName);
    return status ? workflowStatusLabel(status) : '';
}
// What citizens read for a status: its own text in the page language, else German, else its name.
function citizenStatusText(machineName: string | undefined): string {
    const status = catalogueStatus(machineName);
    if (!status) return '';
    const language = String(locale?.value ?? 'de') === 'en' ? 'en' : 'de';
    return status.citizenLabel?.[language] || status.citizenLabel?.de || workflowStatusLabel(status);
}
// The neutral end of the standard ("statt mit „…“").
const workflowStandardEndLabel = computed(() => {
    const end = workflowStandardStatuses.value.find(status => status.isTerminal);
    return end ? workflowStatusLabel(end) : '';
});
// The description of a function, with the names of the statuses it brings
// from the catalogue (never typed into the text).
function workflowFeatureDescription(feature: WorkflowFeatureState): string {
    const [first, second] = feature.statuses;
    const closed = workflowStandardEndLabel.value;
    if (feature.key === 'requestInfo') return t('admin.forms.workflowFeatures.requestInfo.description', { status: catalogueStatusLabel(first) });
    if (feature.key === 'handOver') {
        return t('admin.forms.workflowFeatures.handOver.description', {
            handOver: catalogueStatusLabel(first),
            inCaseSystem: catalogueStatusLabel(second),
            citizenHandOver: citizenStatusText(first),
            citizenInCaseSystem: citizenStatusText(second)
        });
    }
    if (feature.key === 'outcome') {
        return t('admin.forms.workflowFeatures.outcome.description', {
            approved: catalogueStatusLabel(first),
            rejected: catalogueStatusLabel(second),
            closed,
            citizenApproved: citizenStatusText(first),
            citizenRejected: citizenStatusText(second)
        });
    }
    return t('admin.forms.workflowFeatures.withdrawal.description', { withdrawn: catalogueStatusLabel(first), closed, citizen: citizenStatusText(first) });
}
function workflowFeatureReason(feature: WorkflowFeatureState): string | null {
    if (feature.inStandard) return t('admin.forms.workflowFeatures.inStandard');
    if (!feature.available) return t('admin.forms.workflowFeatures.unavailable', { settings: t('admin.settings.workflow.label') });
    return null;
}
// A tick adds the function's statuses and edges to the draft; unticking takes
// them out with every edge that touches them. Saved with "Speichern".
function setWorkflowFeature(key: WorkflowFeatureKey, on: boolean) {
    if (!workflowDraft.value || !workflowEditable.value) return;
    const feature = workflowFeatures.value.find(item => item.key === key);
    if (!feature || !feature.available) return;
    const catalogue = workflowResponse.value?.statuses ?? [];
    workflowDraft.value = on
        ? enableWorkflowFeature(workflowDraft.value, feature, catalogue, workflowFeatures.value)
        : disableWorkflowFeature(workflowDraft.value, feature);
}
// Cross-stack review, blocker 1: open applications in a status the draft
// takes out get "Bitte ansehen" after publishing and can only be set to a
// status of the workflow that then governs (the standard when the draft is
// stored empty). Said before saving; no count (contract section 8).
const workflowRemovesOpenStatuses = computed(() => {
    const loaded = workflowResponse.value?.workflow.statuses ?? [];
    return loaded.some((item) => {
        if (workflowActiveMachineNames.value.has(item.machineName)) return false;
        return catalogueStatus(item.machineName)?.isTerminal !== true;
    });
});
// "Ablauf anpassen": closed until asked for; opens with `#ablauf-anpassen`.
const workflowCustomizeOpen = ref(false);
onMounted(() => {
    if (route.hash === '#ablauf-anpassen') workflowCustomizeOpen.value = true;
});
// A status that came with a ticked function is removed by its checkbox.
function workflowStatusFromFeature(machineName: string): boolean {
    const key = workflowFeatureOf(machineName, workflowEnabledFeatures.value);
    return key !== null;
}

// One muted line per status row: start, where it comes from, end, number of
// Zusatzangaben.
function workflowStatusMeta(status: WorkflowEditorStatus): string {
    const parts: string[] = [];
    if (status.machineName === workflowDraft.value?.defaultStatus) parts.push(t('admin.forms.workflowStatusStart'));
    const feature = workflowFeatureOf(status.machineName, workflowFeatures.value);
    if (workflowStandardMachineNames.value.has(status.machineName)) parts.push(t('admin.forms.workflowOrigin.standard'));
    else if (feature) parts.push(t('admin.forms.workflowOrigin.feature', { feature: workflowFeatureLabel(feature) }));
    else parts.push(t('admin.forms.workflowOrigin.own'));
    if (status.isTerminal) parts.push(t('admin.forms.workflowStatusEnd'));
    const attributes = workflowDefinitionFor(status.machineName)?.attributes?.length ?? 0;
    if (attributes > 0) parts.push(t('admin.forms.workflowAttributeCount', { count: attributes }, attributes));
    return parts.join(' · ');
}

function openWorkflowStatusPanel(machineName: string) {
    selectedWorkflowStatusMachineName.value = machineName;
    workflowStatusPanelOpen.value = true;
}

// Back to the pencil of the row the panel was opened from.
function focusWorkflowStatusPencil() {
    const machineName = selectedWorkflowDefinition.value?.status.machineName;
    if (machineName) document.getElementById(`workflow-status-edit-${machineName}`)?.focus();
}

function preventCloseAutoFocus(event: Event) {
    event.preventDefault();
}

const selectedWorkflowDefinition = computed(() =>
    workflowActiveDefinitions.value.find(item => item.status.machineName === selectedWorkflowStatusMachineName.value)
    ?? workflowActiveDefinitions.value[0]
    ?? null
);
// One row per active status in catalogue order; the row is the "Von".
const workflowEditorStatuses = computed<WorkflowTransitionsEditorStatus[]>(() =>
    workflowActiveStatuses.value.map(status => ({
        key: status.machineName,
        label: workflowStatusLabel(status),
        color: status.color,
        isTerminal: status.isTerminal,
        isStart: status.machineName === workflowDraft.value?.defaultStatus
    }))
);
// Why the workflow is read-only, said next to "Schreibgeschützt". A draft
// that is only switching its state says nothing.
const workflowReadOnlyReason = computed(() => {
    if (workflowEditable.value) return null;
    if (isPublishedSchema.value) {
        return t('admin.forms.workflowReadOnlyPublished', { action: t('admin.forms.moveToDraft'), menu: t('common.moreActions') });
    }
    if (schemaWorkflowStatus.value === 'archived') return t('admin.forms.workflowReadOnlyArchived');
    return null;
});
const attributeDatatypeItems = computed(() => [
    { label: t('admin.forms.workflowAttributeTypes.string'), value: 'string' },
    { label: t('admin.forms.workflowAttributeTypes.number'), value: 'number' },
    { label: t('admin.forms.workflowAttributeTypes.text'), value: 'text' },
    { label: t('admin.forms.workflowAttributeTypes.datetime'), value: 'datetime' },
    { label: t('admin.forms.workflowAttributeTypes.singlevaluelist'), value: 'singlevaluelist' },
    { label: t('admin.forms.workflowAttributeTypes.multivaluelist'), value: 'multivaluelist' },
    { label: t('admin.forms.workflowAttributeTypes.imagelist'), value: 'imagelist' }
]);

watch(workflowActiveDefinitions, (definitions) => {
    if (definitions.length === 0) {
        selectedWorkflowStatusMachineName.value = undefined;
        return;
    }
    if (selectedWorkflowStatusMachineName.value && definitions.some(item => item.status.machineName === selectedWorkflowStatusMachineName.value)) {
        return;
    }
    const defaultDefinition = definitions.find(item => item.status.machineName === workflowDraft.value?.defaultStatus);
    selectedWorkflowStatusMachineName.value = defaultDefinition?.status.machineName ?? definitions[0]!.status.machineName;
}, { immediate: true });

function workflowStatusLabel(status: Pick<WorkflowEditorStatus, 'label' | 'machineName'>): string {
    return workflowStatusDisplayLabel(status);
}

function workflowDefinitionFor(machineName: string): WorkflowEditorStatusDefinition | undefined {
    return workflowDraft.value?.statuses.find(item => item.machineName === machineName);
}

function updateSelectedWorkflowStatusDescription(value: unknown): void {
    const selected = selectedWorkflowDefinition.value;
    if (!selected) return;

    updateWorkflowStatusDescription(selected.definition, String(value));
}

function setWorkflowDefault(machineName: string) {
    if (!workflowDraft.value || !workflowActiveMachineNames.value.has(machineName)) return;
    workflowDraft.value.defaultStatus = machineName;
}

// "Speichern" is filled only once the draft differs from what was loaded.
const workflowDirty = computed(() =>
    Boolean(workflowDraft.value && workflowResponse.value)
    && JSON.stringify(workflowDraft.value) !== JSON.stringify(workflowResponse.value?.workflow)
);

function resetWorkflowDraft() {
    workflowDraft.value = workflowResponse.value ? structuredClone(workflowResponse.value.workflow) : null;
    removedTransitions.clear();
}

function toggleWorkflowStatus(status: WorkflowEditorStatus) {
    if (!workflowDraft.value || status.machineName === workflowDraft.value.defaultStatus) return;
    const active = workflowActiveMachineNames.value.has(status.machineName);
    if (active) {
        workflowDraft.value.statuses = workflowDraft.value.statuses.filter(item => item.machineName !== status.machineName);
        workflowDraft.value.transitions = workflowDraft.value.transitions
            .filter(item => item.from !== status.machineName && item.to !== status.machineName);
        return;
    }
    workflowDraft.value.statuses.push({ machineName: status.machineName });
    workflowDraft.value.statuses.sort((a, b) => {
        const aw = workflowCatalog.value.find(item => item.machineName === a.machineName)?.weight ?? 999;
        const bw = workflowCatalog.value.find(item => item.machineName === b.machineName)?.weight ?? 999;
        return aw - bw;
    });
}

// A status added by hand comes with the catalogue's own edges between it and
// the statuses of the form, so it is reachable at once; every edge is
// visible and removable in "Erlaubte Übergänge".
function addWorkflowStatusByMachineName(machineName: string) {
    const status = workflowCatalog.value.find(item => item.machineName === machineName);
    if (!status || !workflowDraft.value || workflowActiveMachineNames.value.has(machineName)) return;
    toggleWorkflowStatus(status);
    const draft = workflowDraft.value;
    const active = workflowActiveStatuses.value;
    const has = (from: string, to: string) => draft.transitions.some(item => item.from === from && item.to === to);
    for (const other of active) {
        if (other.machineName === machineName) continue;
        if (!other.isTerminal && other.allowedNextIds.includes(status.id) && !has(other.machineName, machineName)) {
            draft.transitions.push({ from: other.machineName, to: machineName });
        }
        if (!status.isTerminal && status.allowedNextIds.includes(other.id) && !has(machineName, other.machineName)) {
            draft.transitions.push({ from: machineName, to: other.machineName });
        }
    }
}

function updateWorkflowStatusDescription(definition: WorkflowEditorStatusDefinition, value: string) {
    const description = value.trim();
    if (description) definition.description = description;
    else delete definition.description;
}

function normalizeAttributeCode(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_]+/gu, '_')
        .replace(/^_+|_+$/gu, '')
        .slice(0, 64);
}

function workflowAttributeNeedsValues(datatype: WorkflowAttributeDatatype): boolean {
    return datatype === 'singlevaluelist' || datatype === 'multivaluelist';
}

function workflowAttributeNeedsMediaType(datatype: WorkflowAttributeDatatype): boolean {
    return datatype === 'imagelist';
}

function updateWorkflowAttributeDatatype(attribute: WorkflowEditorAttribute, value: string) {
    attribute.datatype = value as WorkflowAttributeDatatype;
    if (!workflowAttributeNeedsValues(attribute.datatype)) {
        delete attribute.values;
    } else {
        attribute.values ??= [];
    }
    if (!workflowAttributeNeedsMediaType(attribute.datatype)) {
        delete attribute.media_type;
        delete attribute.media_group;
    }
}

function addWorkflowStatusAttribute(definition: WorkflowEditorStatusDefinition) {
    definition.attributes ??= [];
    const nextIndex = definition.attributes.length + 1;
    definition.attributes.push({
        code: `attribut_${nextIndex}`,
        description: `Attribut ${nextIndex}`,
        datatype: 'string',
        variable: true,
        required: false,
        order: nextIndex * 10
    });
}

function removeWorkflowStatusAttribute(definition: WorkflowEditorStatusDefinition, index: number) {
    definition.attributes = (definition.attributes ?? []).filter((_, itemIndex) => itemIndex !== index);
    if (definition.attributes.length === 0) {
        delete definition.attributes;
    }
}

function addWorkflowAttributeValue(attribute: WorkflowEditorAttribute) {
    attribute.values ??= [];
    const nextIndex = attribute.values.length + 1;
    attribute.values.push({ key: `option_${nextIndex}`, name: '' });
}

function updateWorkflowAttributeValue(
    attribute: WorkflowEditorAttribute,
    index: number,
    field: keyof WorkflowEditorAttributeValue,
    value: string
) {
    const values = [...(attribute.values ?? [])];
    const current = values[index] ?? { key: '', name: '' };
    values[index] = {
        ...current,
        [field]: field === 'key' ? normalizeAttributeCode(value) : value
    };
    attribute.values = values;
}

function removeWorkflowAttributeValue(attribute: WorkflowEditorAttribute, index: number) {
    attribute.values = (attribute.values ?? []).filter((_, itemIndex) => itemIndex !== index);
    if (attribute.values.length === 0) {
        delete attribute.values;
    }
}

function transitionExists(from: string, to: string): boolean {
    return Boolean(workflowDraft.value?.transitions.some(item => item.from === from && item.to === to));
}

// The same rules the "Von"/"Nach" selects had: no final status as origin,
// no transition to itself, no duplicate, both statuses active in the form.
function addWorkflowTransition(from: string, to: string) {
    if (!workflowDraft.value || !workflowEditable.value) return;
    const fromStatus = workflowActiveStatuses.value.find(status => status.machineName === from);
    if (!fromStatus || fromStatus.isTerminal || from === to || !workflowActiveMachineNames.value.has(to) || transitionExists(from, to)) {
        return;
    }
    const key = `${from}>${to}`;
    const removed = removedTransitions.get(key);
    removedTransitions.delete(key);
    if (removed) {
        workflowDraft.value.transitions = restoreLoadedOrder([...workflowDraft.value.transitions, removed]);
        return;
    }
    workflowDraft.value.transitions.push({ from, to });
}

/**
 * Loaded transitions back in the order they were loaded, new ones after them
 * in the order they were added, so that removing and adding again in any
 * order leaves the draft as it was.
 */
function restoreLoadedOrder(transitions: WorkflowEditorTransition[]): WorkflowEditorTransition[] {
    const loaded = workflowResponse.value?.workflow.transitions ?? [];
    const position = (item: WorkflowEditorTransition) => {
        const index = loaded.findIndex(entry => entry.from === item.from && entry.to === item.to);
        return index < 0 ? Number.MAX_SAFE_INTEGER : index;
    };
    return transitions
        .map((item, order) => ({ item, order }))
        .sort((a, b) => position(a.item) - position(b.item) || a.order - b.order)
        .map(entry => entry.item);
}

function removeWorkflowTransition(from: string, to: string) {
    if (!workflowDraft.value || !workflowEditable.value) return;
    const index = workflowDraft.value.transitions.findIndex(item => item.from === from && item.to === to);
    const transition = workflowDraft.value.transitions[index];
    if (!transition) return;
    removedTransitions.set(`${from}>${to}`, transition);
    workflowDraft.value.transitions = workflowDraft.value.transitions.filter((_, itemIndex) => itemIndex !== index);
}

function updateWorkflowTransitionCondition(from: string, to: string, value: string) {
    if (!workflowDraft.value || !workflowEditable.value) return;
    const index = workflowDraft.value.transitions.findIndex(item => item.from === from && item.to === to);
    const transition = workflowDraft.value.transitions[index];
    if (!transition) return;
    const condition = value.trim();
    workflowDraft.value.transitions[index] = condition
        ? { ...transition, condition }
        : { from: transition.from, to: transition.to, attributes: transition.attributes };
}

async function saveWorkflowDefinition() {
    if (!workflowDraft.value || !workflowEditable.value) return;
    workflowSaving.value = true;
    try {
        await $fetch(`/api/admin/schemas/${schemaId}/workflow`, {
            method: 'PATCH',
            query: withWorkspaceQuery(),
            body: {
                workflow: workflowDraft.value,
                expectedChanged: workflowResponse.value?.meta.schemaChanged
            }
        });
        await refreshWorkflow();
        await loadApplications();
        toast.add({ title: t('admin.forms.workflowSaved'), color: 'success' });
    } catch (e) {
        toast.add({
            title: t('admin.forms.workflowSaveError'),
            description: resolveApiErrorMessage(e),
            color: 'error'
        });
    } finally {
        workflowSaving.value = false;
    }
}

useHead({
    title: computed(() => `${schemaLabel.value} - Admin - beantragt.ai`)
});

// ── Load applications ──────────────────────────────────────────────
const rows = ref<ApplicationRow[]>([]);
const statusMap = ref(new Map());
const applicationsLoading = ref(true);
const applicationsError = ref<string | null>(null);
const applicationsTruncated = ref(false);
const unreadFilterActive = ref(false);
const schemaStatusUpdating = ref(false);
const assignmentFilterAvailable = ref(false);
let applicationRequestId = 0;

async function loadApplications() {
    const requestId = ++applicationRequestId;
    applicationsLoading.value = true;
    applicationsError.value = null;

    try {
        const res = await $fetch<AdminApplicationsResponse>('/api/admin/applications', {
            query: withWorkspaceQuery({ schemaId })
        });

        if (requestId !== applicationRequestId) return;
        const applications = res.data || [];
        applicationsTruncated.value = Boolean(res.meta?.truncated);
        assignmentFilterAvailable.value = applications.some(hasApplicationAssignmentRelationship);
        statusMap.value = buildStatusMap(res.included as Parameters<typeof buildStatusMap>[0]);
        rows.value = applicationListRows(res, schemaId);
    } catch (e) {
        if (requestId !== applicationRequestId) return;
        console.error('[admin] Failed to load applications:', e);
        applicationsError.value = resolveApiErrorMessage(e, 'admin.applications.loadError');
        applicationsTruncated.value = false;
        assignmentFilterAvailable.value = false;
    } finally {
        if (requestId === applicationRequestId) {
            applicationsLoading.value = false;
        }
    }
}

onMounted(loadApplications);
watch([selectedWorkspaceKey, currentUserId], loadApplications);

// The form's own organisation (`relationships.field_organisation`, as in the
// editor). The municipality workspace also opens forms of its organisations;
// an organisation workspace opens only its own (`applyAdminJurisdictionFilter`),
// so there the workspace stands in when the answer carries no relationship.
const formOrganisationId = computed(() => {
    const relation = schemaResponse.value?.data?.relationships?.field_organisation?.data;
    if (relation && !Array.isArray(relation) && typeof relation.id === 'string') return relation.id;
    return currentWorkspace.value?.type === 'organisation' ? currentWorkspace.value.id : null;
});
const bulkActions = formFeatures?.useBulkActions(schemaId, formOrganisationId);
const bulkUploadRoute = computed(() => bulkActions?.bulkUploadRoute.value ?? null);
const bulkUploadAvailable = computed(() => bulkActions?.bulkUploadAvailable.value ?? false);
const bulkUploadElsewhereReason = computed(() => bulkActions?.bulkUploadElsewhereReason.value ?? null);
const bulkIneligibleReason = computed(() => bulkActions?.bulkIneligibleReason.value ?? null);
const bulkIneligibleHasReason = computed(() => bulkActions?.bulkIneligibleHasReason.value ?? false);
// The header links of a published or archived form, by
// rank; what does not fit in two goes into "Weitere Aktionen".
type FormHeaderLink = 'public' | 'bulk' | 'view';
const publicViewRoute = computed(() => isPublishedSchema.value && schemaPublicationScope.value === 'internet'
    ? publicFormPath({
        id: schemaId,
        jurisdictionSlug: currentWorkspace.value?.jurisdictionSlug,
        organisationSlug: currentWorkspace.value?.organisationSlug
    })
    : null);
const publishedLinks = computed<FormHeaderLink[]>(() => [
    ...(publicViewRoute.value ? ['public' as const] : []),
    ...(bulkUploadAvailable.value ? ['bulk' as const] : []),
    'view'
]);
const headerLinks = computed<FormHeaderLink[]>(() => {
    if (isPublishedSchema.value) return publishedLinks.value.slice(0, 2);
    if (isArchivedSchema.value) return ['view'];
    return [];
});
const menuLinks = computed<FormHeaderLink[]>(() => {
    if (isPublishedSchema.value) return publishedLinks.value.slice(2);
    if (isDraftSchema.value && bulkUploadAvailable.value) return ['bulk'];
    return [];
});
function headerLinkItem(kind: FormHeaderLink): DropdownMenuItem {
    if (kind === 'public') return { label: t('admin.forms.openPublicForm'), to: publicViewRoute.value ?? undefined };
    if (kind === 'bulk') return { label: bulkActions?.label, to: bulkUploadRoute.value ?? undefined };
    return { label: t('admin.forms.viewSchema'), to: workspaceRoute(`/admin/forms/${schemaId}/edit`) };
}
// One meta line under the title, scope and organisation.
const formMetaLine = computed(() => [
    schemaPublicationScopeLabel.value,
    workflowResponse.value?.meta.workspaceLabel || null
].filter((part): part is string => Boolean(part)).join(' · '));

// ── Schema publish/draft ─────────────────────────────────────────
// before the click, say which fields keep the form from going live,
// with the editor's check (privacy first, then a CRM key on several fields).
const draftPublishBlockers = computed(() => isDraftSchema.value ? publishBlockers(schema.value) : null);
function publishBlockerText(blockers: PublishBlockers): string {
    const count = blockers.issues.length;
    const { names } = namedBlockerFields(blockers);
    return blockers.kind === 'privacy'
        ? t('admin.forms.publishRefused.privacy', { count, fields: names }, count)
        : t('admin.forms.publishRefused.duplicateCrmKey', { count, fields: names });
}
const draftPublishBlockerText = computed(() => draftPublishBlockers.value ? publishBlockerText(draftPublishBlockers.value) : '');
// The editor opens the first open field with `?focus=privacy`.
const editorFocusRoute = computed(() => ({
    path: workspaceRoute(`/admin/forms/${schemaId}/edit`).path,
    query: { focus: 'privacy' }
}));
// The editor's form settings and decision templates, by name.
function editorPanelRoute(panel: 'settings' | 'decisions') {
    return { path: workspaceRoute(`/admin/forms/${schemaId}/edit`).path, query: { panel } };
}

// ── Publish: the same rule and question as the guided setup ───────
// (review 3-6, points 1 and 3; `usePublishRule`, `PublishConfirm`).
const { organisationMissing: publishOrganisationMissing, receiverText: publishReceiverText } = usePublishRule(formOrganisationId);
const confirmingPublish = ref(false);
// Where the focus goes once the publish dialog is gone:
// back to "Veröffentlichen", or where the result points.
let publishCloseFocus: (() => void) | null = null;

function focusPublishButton() {
    document.getElementById('form-publish')?.focus();
}

function onPublishDialogClosed() {
    const focus = publishCloseFocus ?? focusPublishButton;
    publishCloseFocus = null;
    focus();
}

function askPublish() {
    if (schemaStatusUpdating.value || publishOrganisationMissing.value || draftPublishBlockers.value || !canPublishSchema.value) return;
    confirmingPublish.value = true;
}

function cancelPublish() {
    if (schemaStatusUpdating.value) return;
    publishCloseFocus = focusPublishButton;
    confirmingPublish.value = false;
}

async function confirmPublish() {
    if (!confirmingPublish.value || schemaStatusUpdating.value) return;
    const published = await updateSchemaStatus('published');
    await nextTick();
    // After a publish the button is gone: the focus goes to the page heading;
    // after a refusal back to "Veröffentlichen". A refusal that named open
    // fields locks the button: the focus goes to the way to the first one.
    if (published) publishCloseFocus = focusAfterSetup;
    else if (draftPublishBlockers.value) publishCloseFocus = () => document.querySelector<HTMLElement>('[data-test="publish-blockers-link"]')?.focus();
    else publishCloseFocus = focusPublishButton;
    confirmingPublish.value = false;
}

// The organisation notice on this page can assign the form; after that the
// form has its organisation, and the publish lock must see it.
async function onFormOrganisationAssigned() {
    await Promise.all([refreshSchema(), refreshWorkflow()]);
}
// Where the notice with its assign control stands on this page, the lock
// line points there instead of to the editor.
const organisationAssignOnPage = computed(() => !workflowDraft.value && workflowOrganisationRequired.value);

// A lock that appears meanwhile takes the question back. While the publish
// itself runs, `confirmPublish` closes the dialog and decides the focus.
watch([publishOrganisationMissing, () => Boolean(draftPublishBlockers.value), isDraftSchema], ([missing, blocked, draft]) => {
    if ((missing || blocked || !draft) && !schemaStatusUpdating.value) confirmingPublish.value = false;
});

// ── Archive, reopen, back to draft ──────────────────────────
// "Archivieren" takes a form off the offer and keeps its applications. It is
// offered for a published form and for a draft that has applications; a
// draft without applications is deleted instead (the delete rule). An
// archived form can be reopened as a draft; a published form can be set back
// to a draft. All three ask first, in a dialog, from the
// menu "Weitere Aktionen" of rarer actions.
type FormStatusChange = 'archive' | 'reopen' | 'draft';
const statusChangeKind = ref<FormStatusChange>('archive');
const statusChangeOpen = ref(false);
const moreActionsTrigger = ref<{ $el?: HTMLElement } | null>(null);
const draftHasApplications = computed(() => !applicationsLoading.value && !applicationsError.value
  && (rows.value.length > 0 || applicationsTruncated.value));
const canArchive = computed(() => isPublishedSchema.value || (isDraftSchema.value && draftHasApplications.value));
const moreActionItems = computed<DropdownMenuItem[]>(() => {
    const items: DropdownMenuItem[] = menuLinks.value.map(headerLinkItem);
    if (isPublishedSchema.value) {
        items.push({ label: t('admin.forms.moveToDraft'), disabled: schemaStatusUpdating.value, onSelect: () => askStatusChange('draft') });
    }
    if (canArchive.value) {
        items.push({ label: t('admin.forms.archive.action'), disabled: schemaStatusUpdating.value, onSelect: () => askStatusChange('archive') });
    }
    if (isArchivedSchema.value) {
        items.push({ label: t('admin.forms.archive.reopen'), disabled: schemaStatusUpdating.value, onSelect: () => askStatusChange('reopen') });
    }
    return items;
});
const statusChangeTexts = computed(() => {
    const title = schemaLabel.value;
    if (statusChangeKind.value === 'reopen') {
        return { title: t('admin.forms.archive.reopenTitle'), description: t('admin.forms.archive.reopenDescription'), confirm: t('admin.forms.archive.reopenConfirm') };
    }
    if (statusChangeKind.value === 'draft') {
        // What happens, as far as the code keeps it: the form leaves the offer
        // and takes no submissions; existing applications stay and are
        // processed (the last published revision keeps governing them).
        return {
            title: t('admin.forms.moveToDraftTitle', { title }),
            description: [
                t(schemaPublicationScope.value === 'internet' ? 'admin.forms.moveToDraftInternet' : 'admin.forms.moveToDraftIntranet'),
                t('admin.forms.archive.applicationsStay')
            ].join(' '),
            confirm: t('admin.forms.moveToDraft')
        };
    }
    // Citizens lose the form only if it was published; applications stay and
    // can be processed; no new batches (BulkEligibility `form_archived`); it
    // can be taken back.
    const parts = [
        isPublishedSchema.value
            ? t(schemaPublicationScope.value === 'internet' ? 'admin.forms.archive.citizensPublished' : 'admin.forms.archive.citizensIntranet')
            : t('admin.forms.archive.citizensDraft'),
        t('admin.forms.archive.applicationsStay'),
        t('admin.forms.archive.noBatches'),
        t('admin.forms.archive.reversible')
    ];
    return { title: t('admin.forms.archive.title'), description: parts.join(' '), confirm: t('admin.forms.archive.confirm') };
});

// The menu stays after most changes (archived forms can be reopened, a draft
// with applications can be archived); where it is gone the focus goes to
// "Einrichtung fortsetzen" or the page heading.
function focusMoreActions() {
    const element = moreActionsTrigger.value?.$el;
    if (element instanceof HTMLElement && element.isConnected) element.focus();
    else focusAfterSetup();
}

function askStatusChange(kind: FormStatusChange) {
    if (schemaStatusUpdating.value) return;
    statusChangeKind.value = kind;
    statusChangeOpen.value = true;
}

function cancelStatusChange() {
    if (schemaStatusUpdating.value) return;
    statusChangeOpen.value = false;
}

async function confirmStatusChange() {
    if (!statusChangeOpen.value || schemaStatusUpdating.value) return;
    const kind = statusChangeKind.value;
    await updateSchemaStatus(kind === 'archive' ? 'archived' : 'draft', { successKey: kind === 'reopen' ? 'admin.forms.archive.reopenSuccess' : undefined });
    statusChangeOpen.value = false;
}

async function updateSchemaStatus(newStatus: 'draft' | 'published' | 'archived', options: { successKey?: string } = {}): Promise<boolean> {
    if (newStatus === 'published' && !canPublishSchema.value) {
        toast.add({ title: t('admin.forms.publishInvalidSchema'), color: 'error' });
        return false;
    }
    if (newStatus === 'published' && publishForbidden.value) {
        toast.add({ title: t('errors.schema.publishForbidden'), color: 'error' });
        return false;
    }
    if (newStatus === 'published' && publishOrganisationMissing.value) return false;

    schemaStatusUpdating.value = true;
    try {
        await $fetch(`/api/admin/schemas/${schemaId}/status`, {
            method: 'PATCH',
            query: withWorkspaceQuery(),
            body: { status: newStatus }
        });
        await refreshSchema();
        await refreshWorkflow();
        await refreshNuxtData('admin-schemas');
        void setup?.refresh();
        if (newStatus === 'published') {
            // The second line fits the form; the workflow sentence
            // only with applications. Counts are keyed by the form's UUID.
            const scope = schemaPublicationScope.value;
            const formIds = [...new Set([schemaResponse.value?.data?.id, schemaId].filter((id): id is string => typeof id === 'string'))];
            void loadFormApplicationCount(formIds, withWorkspaceQuery()).then((applicationCount) => {
                const description = publishSuccessDescription(t, { scope, applicationCount });
                toast.add({
                    title: t('admin.forms.publishSuccess'),
                    ...(description ? { description } : {}),
                    color: 'success'
                });
            });
        } else if (newStatus === 'archived') {
            toast.add({ title: t('admin.forms.archive.success'), color: 'success' });
        } else {
            toast.add({ title: t(options.successKey ?? 'admin.forms.draftSuccess'), color: 'success' });
        }
        return true;
    } catch (e) {
        console.error('[admin] Failed to update schema status:', e);
        // A refusal names the open fields readably and leads to the first one.
        // The page's copy may be older than the stored form (another tab saved),
        // so it reloads before it reads the fields; the line above the button follows.
        const refusalKind = publishRefusalKind(e);
        if (refusalKind) await refreshSchema();
        const blockers = refusalKind ? publishBlockers(schema.value, refusalKind) : null;
        if (newStatus === 'published' && blockers) {
            toast.add({
                title: t('admin.forms.publishRefused.title'),
                description: publishBlockerText(blockers),
                color: 'error',
                actions: [{
                    label: t('admin.forms.publishRefused.openFirst'),
                    color: 'neutral',
                    variant: 'outline',
                    onClick: () => {
                        void navigateTo(editorFocusRoute.value);
                    }
                }]
            });
        } else {
            toast.add({
                title: t('admin.forms.statusUpdateError'),
                description: resolveApiErrorMessage(e),
                color: 'error'
            });
        }
        return false;
    } finally {
        schemaStatusUpdating.value = false;
    }
}

// ── Guided setup as a routed modal (Holger 10.11.2026) ─────
// The setup pages are children of this page and keep their URLs; while one
// of them is open, this page shows it in a fullscreen modal over itself.
// X "Schließen", Escape and browser back are one navigation back here; the
// setup screen saves in its leave guard and refuses the navigation when the
// save fails, so the modal stays open. A close goes back through the
// history to the entry the setup opened from, so browser back afterwards
// leaves this page instead of opening a setup step again.
const setupOverlay = formFeatures?.useSetupOverlay(schemaId);
const setupModal = setupOverlay?.state;
const setupDialog = computed(() => formFeatures?.setupDialog(t, schemaLabel.value));
// The visible label is also the accessible name; without it Nuxt UI announces its own close text.
// Returned from a function because ButtonProps rejects aria attributes in an inline literal.
function setupCloseButton(label: string, loading: boolean) {
    return { label, 'aria-label': label, loading };
}
const setupOpen = computed(() => Boolean(formFeatures) && route.meta?.setupModal === true);
const formPath = () => String(route.path).replace(SETUP_PATH_SUFFIX, '');
const pageLayout = ref<{ $el?: Element } | null>(null);

watch(setupOpen, (open) => {
    if (open) setupOverlay?.noteOpener(formPath());
}, { immediate: true });

// Leaving with an unsaved workflow asks first, also for the
// links into the editor. Moves that start inside the setup (its steps, its
// close) pass; opening the setup asks, because a setup that changes the form
// reloads the workflow afterwards.
useUnsavedChangesGuard(workflowDirty, {
    messageKey: 'admin.forms.workflowUnsavedLeave',
    allow: (_to, from) => SETUP_PATH_SUFFIX.test(String(from.path))
});

async function closeSetup(open: boolean) {
    // A screen that is saving decides itself. A second Escape, or one while
    // the screen closes ("Ohne Speichern schließen", "Erneut versuchen"),
    // finds the close lock of the modal taken and does nothing: a second
    // step back would leave the page.
    if (open || !setupOverlay || setupModal?.value.busy) return;
    await setupOverlay.close(workspaceRoute(`/admin/forms/${schemaId}`));
}

// Back on the form page: load what the setup changed (status after a
// publish, the draft after a save) and the setup state behind "Einrichtung
// fortsetzen", then return the focus there, or to the page heading when the
// button is gone. Without a change only the setup state loads, so the form
// does not flash its loading state.
function focusAfterSetup() {
    const resume = document.getElementById('form-setup-resume');
    if (resume) {
        resume.focus();
        return;
    }
    const heading = pageLayout.value?.$el instanceof Element ? pageLayout.value.$el.querySelector<HTMLElement>('h1') : null;
    if (!heading) return;
    heading.setAttribute('tabindex', '-1');
    heading.focus();
}

watch(setupOpen, async (open, wasOpen) => {
    if (open || !wasOpen) return;
    // Back on this page itself (not on the way to the editor) the opener is
    // used up; the next open notes it again.
    if (!setupModal) return;
    if (String(route.path).endsWith(`/admin/forms/${schemaId}`)) setupModal.value.openerPosition = null;
    const changed = setupModal.value.changed;
    setupModal.value.changed = false;
    await Promise.all([
        changed ? refreshSchema() : undefined,
        changed ? refreshWorkflow() : undefined,
        setup?.refresh()
    ]);
    await nextTick();
    focusAfterSetup();
});

// ── Stats ───────────────────────────────────────────────────────
function countByMachineName(machineName: string): number {
    return rows.value.filter(r => r.statusId && statusMap.value.get(r.statusId)?.machineName === machineName).length;
}
// Show the application count after the complete list has loaded. If the list was truncated, show the notice instead.
// The card hides a zero count.
const applicationsCountLabel = computed(() =>
    applicationsLoading.value || applicationsError.value || applicationsTruncated.value ? undefined : rows.value.length
);
// A form without any application: one sentence in place of the table.
const applicationsEmpty = computed(() =>
    !applicationsLoading.value && !applicationsError.value && !applicationsTruncated.value && rows.value.length === 0
);
// Settings of the form: the transfer rules (municipality workspace, admins)
// and the workflow. The section shows only when one of them is there.
const statusStats = computed(() =>
    uniqueStatusesByMachineName(statusMap.value)
        .map(status => ({
            ...status,
            count: countByMachineName(status.machineName)
        }))
        .filter(status => status.count > 0)
);
</script>

<template>
  <AppPageLayout
    ref="pageLayout"
    :title="schemaLabel"
    :breadcrumbs="headerReady ? [{ label: t('nav.forms'), to: workspaceRoute('/admin/forms') }, { label: schemaLabel }] : [{ label: t('nav.forms'), to: workspaceRoute('/admin/forms') }]"
  >
    <!-- One badge at the title. -->
    <template
      v-if="headerReady"
      #titleMeta
    >
      <StatusBadge
        :status="schemaWorkflowStatus"
        type="schema"
      />
    </template>

    <!-- One meta line (scope, organisation) and at
         most one reason line, about publishing. -->
    <template
      v-if="headerReady"
      #description
    >
      <p data-test="form-meta-line">
        {{ formMetaLine }}
      </p>
      <div
        v-if="isDraftSchema && publishForbidden"
        class="mt-2 flex max-w-prose flex-wrap items-baseline gap-x-1"
        data-test="publish-forbidden"
      >
        <AccessReason
          id="form-publish-forbidden"
          :text="t('errors.schema.publishForbidden')"
        />
      </div>
      <div
        v-else-if="isDraftSchema && draftPublishBlockers"
        class="mt-2 flex max-w-prose flex-wrap items-baseline gap-x-1"
        data-test="publish-blockers"
      >
        <!-- The link stands inside the
             reason's text column, so it wraps to the sentence's edge. -->
        <AccessReason
          id="form-publish-blockers"
          :text="draftPublishBlockerText"
        >
          <ULink
            :to="editorFocusRoute"
            class="font-medium text-default underline underline-offset-2"
            data-test="publish-blockers-link"
          >{{ t('admin.forms.publishRefused.openFirst') }}</ULink>
        </AccessReason>
      </div>
      <!-- The same rule as the guided setup. -->
      <div
        v-else-if="isDraftSchema && publishOrganisationMissing"
        class="mt-2 flex max-w-prose flex-wrap items-baseline gap-x-1"
        data-test="publish-organisation-missing"
      >
        <AccessReason
          id="form-publish-organisation"
          :text="t(organisationAssignOnPage ? 'admin.forms.publishOrganisationMissingHere' : 'admin.forms.publishOrganisationMissing')"
        >
          <ULink
            v-if="!organisationAssignOnPage"
            :to="editorPanelRoute('settings')"
            class="font-medium text-default underline underline-offset-2"
          >{{ t('admin.forms.formSettings') }}</ULink>
        </AccessReason>
      </div>
    </template>

    <!-- One row of actions per state, no sentences among
         the buttons; at most one filled button (a draft's "Veröffentlichen"). -->
    <template
      v-if="headerReady"
      #actions
    >
      <template v-if="isDraftSchema">
        <UButton
          v-if="!publishForbidden"
          id="form-publish"
          :loading="schemaStatusUpdating"
          :disabled="!canPublishSchema || Boolean(draftPublishBlockers) || publishOrganisationMissing || confirmingPublish"
          :aria-describedby="draftPublishBlockers ? 'form-publish-blockers' : (publishOrganisationMissing ? 'form-publish-organisation' : undefined)"
          data-test="form-publish"
          @click="askPublish"
        >
          {{ t('admin.forms.publish') }}
        </UButton>
        <UButton
          :to="workspaceRoute(`/admin/forms/${schemaId}/edit`)"
          color="neutral"
          variant="outline"
          data-test="form-edit"
        >
          {{ t('admin.forms.editSchema') }}
        </UButton>
        <UButton
          v-if="setupEligible"
          id="form-setup-resume"
          :to="workspaceRoute(`/admin/forms/${schemaId}/setup`)"
          color="neutral"
          variant="outline"
        >
          {{ formFeatures?.setupResumeLabel(t, false) }}
        </UButton>
      </template>
      <template
        v-for="link in headerLinks"
        :key="link"
      >
        <UButton
          v-if="link === 'public'"
          :to="publicViewRoute ?? undefined"
          color="neutral"
          variant="outline"
          icon="i-lucide-external-link"
          data-test="form-public-view"
        >
          {{ t('admin.forms.openPublicForm') }}
        </UButton>
        <UButton
          v-else-if="link === 'bulk'"
          :to="bulkUploadRoute ?? undefined"
          color="neutral"
          variant="outline"
          icon="i-lucide-upload"
          data-test="form-bulk-upload"
        >
          {{ bulkActions?.label }}
        </UButton>
        <UButton
          v-else
          :to="workspaceRoute(`/admin/forms/${schemaId}/edit`)"
          color="neutral"
          variant="outline"
          data-test="form-edit"
        >
          {{ t('admin.forms.viewSchema') }}
        </UButton>
      </template>
      <!-- Rarer actions in one menu, like the application page. -->
      <UDropdownMenu
        v-if="moreActionItems.length"
        :items="[moreActionItems]"
        :content="{ align: 'end' }"
      >
        <UButton
          ref="moreActionsTrigger"
          color="neutral"
          variant="ghost"
          trailing-icon="i-lucide-chevron-down"
          :loading="schemaStatusUpdating && statusChangeOpen"
          data-test="form-more-actions"
        >
          {{ t('common.moreActions') }}
        </UButton>
      </UDropdownMenu>
    </template>

    <template
      v-if="headerReady && (setupWorkspaceMismatch || setupIneligibleReason)"
      #toolbar
    >
      <AdminOfficeWorkspaceNotice
        v-if="setupWorkspaceMismatch"
        :title="t('admin.setup.officeWorkspaceTitle')"
        :office-path="setupWorkspaceMismatch.path"
        data-test="setup-office-workspace"
      />
      <UAlert
        v-else-if="setupIneligibleReason"
        icon="i-lucide-info"
        :title="formFeatures?.setupIneligibleText(t, setupIneligibleReason)"
        data-test="setup-ineligible-reason"
      />
    </template>

    <!-- Schema loading -->
    <div
      v-if="canonicalRouteLoading || schemaStatus === 'pending'"
      class="space-y-2"
      data-test="form-page-loading"
    >
      <USkeleton class="mb-4 h-6 w-2/3" />
      <USkeleton
        v-for="i in 5"
        :key="i"
        class="h-10 w-full"
      />
    </div>

    <!-- Schema loading error -->
    <UAlert
      v-else-if="schemaError"
      color="error"
      icon="i-lucide-circle-x"
      :title="t('admin.forms.formNotFound')"
      :description="t('admin.forms.formNotFoundDescription')"
      class="mb-6 max-w-3xl"
    />

    <template v-else>
      <!-- The parse error concerns the whole form and
           stays at the top. -->
      <UAlert
        v-if="!schema?.description && !canPublishSchema"
        color="error"
        icon="i-lucide-circle-x"
        :title="t('admin.forms.schemaParseError')"
        :description="t('admin.forms.schemaParseErrorDescription')"
        class="mb-6 max-w-3xl"
      />

      <!-- Publishing and the form's workflow need an organisation; the
           notice with its assign control stays at the top. -->
      <AdminOrganisationNotice
        v-if="!workflowDraft && workflowOrganisationRequired"
        :form-id="schemaId"
        class="mb-6"
        @assigned="onFormOrganisationAssigned"
      />

      <!-- Applications of this form, directly under the
           header, as one card. -->
      <AppCard
        :title="t('admin.forms.applicationsHeading')"
        as="h2"
        icon="i-lucide-inbox"
        :count="applicationsCountLabel"
        region
        inline-actions
        data-test="form-applications-section"
      >
        <template #actions>
          <UTooltip :text="t('admin.forms.refreshApplications')">
            <UButton
              color="neutral"
              variant="ghost"
              icon="i-lucide-refresh-cw"
              :aria-label="t('admin.forms.refreshApplications')"
              :loading="applicationsLoading"
              data-test="form-applications-refresh"
              @click="loadApplications"
            />
          </UTooltip>
        </template>

        <!-- Count per status as one line; the total stands beside the heading. -->
        <ul
          v-if="statusStats.length"
          :aria-label="t('admin.forms.applicationsByStatus')"
          class="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted"
          data-test="form-status-stats"
        >
          <li
            v-for="status in statusStats"
            :key="status.machineName"
            class="inline-flex items-center gap-1.5"
          >
            <span
              class="size-3 shrink-0 rounded-full ring-1 ring-accented"
              :style="{ backgroundColor: status.color || undefined }"
              aria-hidden="true"
            />
            <span>{{ workflowStatusLabel(status) }}</span>
            <span class="font-medium text-highlighted tabular-nums">{{ status.count }}</span>
          </li>
        </ul>

        <UAlert
          v-if="applicationsTruncated"
          role="status"
          aria-live="polite"
          color="warning"
          icon="i-lucide-triangle-alert"
          :title="t(unreadFilterActive ? 'admin.forms.limitedStatusStatsTitle' : 'admin.applications.limitedTitle')"
          :description="t(unreadFilterActive ? 'admin.forms.limitedStatusStats' : 'admin.applications.limitedDescription', { count: rows.length })"
          class="max-w-3xl"
        />

        <UAlert
          v-if="applicationsError"
          color="error"
          icon="i-lucide-circle-x"
          :title="applicationsError"
          class="max-w-3xl"
        />

        <div
          v-if="!applicationsError"
          class="min-w-0"
        >
          <AdminApplicationsDataTable
            :caption="t('admin.forms.applicationsHeading')"
            :rows="rows"
            :status-map="statusMap"
            :schema="schema"
            enable-unread-messages
            :application-form-id="schemaId"
            :empty-form-message="applicationsEmpty ? t(isDraftSchema ? 'admin.forms.applicationsEmptyDraft' : 'admin.forms.applicationsEmptyPublished') : undefined"
            :current-user-id="currentUserId"
            :current-team-ids="currentTeamIds"
            :assignment-filter-available="assignmentFilterAvailable"
            :can-delete="isAdmin"
            :loading="applicationsLoading"
            @unread-filter-change="unreadFilterActive = $event"
            @refresh="loadApplications"
          />
        </div>
      </AppCard>

      <!-- Settings of the form, cards "Formular", "Ablauf",
           then the transfer rules. -->
      <section
        aria-labelledby="form-settings-heading"
        class="mt-8"
        data-test="form-settings-section"
      >
        <h2
          id="form-settings-heading"
          class="mb-3 text-lg font-semibold text-highlighted"
        >
          {{ t('admin.forms.settingsHeading') }}
        </h2>

        <div class="flex flex-col gap-6">
          <!-- Card "Formular": facts and the ways into the editor. -->
          <AppCard
            :title="t('admin.forms.factsTitle')"
            as="h3"
            icon="i-lucide-file-text"
            data-test="form-facts-card"
          >
            <dl data-test="form-editor-panel-links">
              <div class="grid gap-1 border-t border-default py-2.5 first:border-t-0 first:pt-0 last:pb-0 sm:grid-cols-3 sm:gap-4">
                <dt class="text-sm text-muted">
                  {{ t('admin.forms.facts.description') }}
                </dt>
                <dd
                  class="max-w-prose text-sm text-default sm:col-span-2"
                  data-test="form-description"
                >
                  <template v-if="schema?.description">
                    {{ schema.description }}
                  </template>
                  <span
                    v-else
                    class="text-muted"
                  >-</span>
                </dd>
              </div>
              <div class="grid gap-1 border-t border-default py-2.5 last:pb-0 sm:grid-cols-3 sm:gap-4">
                <dt class="text-sm text-muted">
                  {{ t('admin.forms.facts.settings') }}
                </dt>
                <dd class="text-sm sm:col-span-2">
                  <ULink
                    :to="editorPanelRoute('settings')"
                    class="inline-flex min-h-6 items-center font-medium text-default underline underline-offset-2"
                    data-test="form-open-settings"
                  >
                    {{ t('admin.forms.formSettings') }}
                  </ULink>
                </dd>
              </div>
              <div class="grid gap-1 border-t border-default py-2.5 last:pb-0 sm:grid-cols-3 sm:gap-4">
                <dt class="text-sm text-muted">
                  {{ t('admin.forms.facts.decisions') }}
                </dt>
                <dd class="text-sm sm:col-span-2">
                  <ULink
                    :to="editorPanelRoute('decisions')"
                    class="inline-flex min-h-6 items-center font-medium text-default underline underline-offset-2"
                    data-test="form-open-decisions"
                  >
                    {{ t('docgenUi.form.open') }}
                  </ULink>
                </dd>
              </div>
              <div
                v-if="bulkUploadAvailable || bulkUploadElsewhereReason || bulkIneligibleReason"
                class="grid gap-1 border-t border-default py-2.5 last:pb-0 sm:grid-cols-3 sm:gap-4"
              >
                <dt class="text-sm text-muted">
                  {{ t('admin.forms.facts.bulk') }}
                </dt>
                <dd
                  v-if="bulkUploadAvailable"
                  class="text-sm font-medium text-default sm:col-span-2"
                  data-test="bulk-possible"
                >
                  {{ t('admin.forms.facts.bulkPossible') }}
                </dd>
                <dd
                  v-else-if="bulkUploadElsewhereReason"
                  class="max-w-prose text-sm text-default sm:col-span-2"
                  data-test="bulk-elsewhere-reason"
                >
                  {{ t('admin.forms.facts.notPossible', { reason: bulkUploadElsewhereReason }) }}
                </dd>
                <dd
                  v-else
                  class="max-w-prose text-sm text-default sm:col-span-2"
                  data-test="bulk-ineligible-reason"
                >
                  {{ bulkIneligibleHasReason ? t('admin.forms.facts.notPossible', { reason: bulkIneligibleReason }) : bulkIneligibleReason }}
                </dd>
              </div>
            </dl>
          </AppCard>

          <!-- The workflow card shows the standard and four functions. Additional settings are available through "Ablauf anpassen". -->
          <AppCard
            v-if="workflowDraft"
            id="ablauf"
            :title="t('admin.forms.workflowTitle')"
            as="h3"
            icon="i-lucide-git-branch"
            :info="{ label: t('admin.forms.workflowInfoLabel'), text: t('admin.forms.workflowInfo', { settings: t('admin.settings.workflow.label') }) }"
            :sticky-footer="workflowEditable && workflowDirty"
            data-test="form-workflow-card"
          >
            <div
              v-if="workflowEditable"
              class="space-y-6"
            >
              <AdminWorkflowStandardLine
                :standard="workflowStandardInForm"
                :extras="workflowExtraStatuses"
                :label="workflowStatusLabel"
              />

              <!-- The four functions (E4): saved with "Speichern", effective
                   with publishing, so checkboxes and not switches. -->
              <fieldset
                class="max-w-prose"
                data-test="workflow-features"
              >
                <legend class="mb-3 text-sm font-semibold text-highlighted">
                  {{ t('admin.forms.workflowFeatures.legend') }}
                </legend>
                <div class="space-y-4">
                  <div
                    v-for="feature in workflowFeatures"
                    :key="feature.key"
                    :data-feature="feature.key"
                    data-test="workflow-feature"
                  >
                    <UCheckbox
                      :model-value="feature.enabled || feature.inStandard"
                      :label="workflowFeatureLabel(feature.key)"
                      :description="feature.available ? workflowFeatureDescription(feature) : undefined"
                      :disabled="!feature.available"
                      :aria-describedby="workflowFeatureReason(feature) ? `workflow-feature-reason-${feature.key}` : undefined"
                      @update:model-value="(value: boolean | 'indeterminate') => setWorkflowFeature(feature.key, value === true)"
                    />
                    <AccessReason
                      v-if="workflowFeatureReason(feature)"
                      :id="`workflow-feature-reason-${feature.key}`"
                      class="ms-6 mt-1"
                      :text="workflowFeatureReason(feature) ?? ''"
                    />
                  </div>
                </div>
              </fieldset>

              <!-- "Ablauf anpassen": the disclosure of the patterns, closed
                   until asked for (or opened with #ablauf-anpassen). -->
              <div id="ablauf-anpassen">
                <UButton
                  color="neutral"
                  variant="ghost"
                  class="group -ms-2.5"
                  icon="i-lucide-chevron-right"
                  :ui="{ leadingIcon: 'transition-transform group-data-[state=open]:rotate-90' }"
                  :data-state="workflowCustomizeOpen ? 'open' : 'closed'"
                  :aria-expanded="workflowCustomizeOpen ? 'true' : 'false'"
                  aria-controls="workflow-customize-content"
                  data-test="workflow-customize-toggle"
                  @click="workflowCustomizeOpen = !workflowCustomizeOpen"
                >
                  {{ t('admin.forms.workflowCustomize') }}
                </UButton>
                <div
                  v-show="workflowCustomizeOpen"
                  id="workflow-customize-content"
                  class="space-y-8 pt-3"
                  data-test="workflow-customize-content"
                >
                  <!-- The statuses as a row list. -->
                  <section aria-labelledby="workflow-statuses-heading">
                    <h4
                      id="workflow-statuses-heading"
                      class="mb-3 text-sm font-semibold text-highlighted"
                    >
                      {{ t('admin.forms.workflowFormStatuses') }}
                    </h4>
                    <ul data-test="workflow-status-list">
                      <li
                        v-for="status in workflowActiveStatuses"
                        :key="status.machineName"
                        class="flex items-start gap-3 border-t border-default py-2.5 first:border-t-0 first:pt-0"
                        data-test="workflow-status-row"
                      >
                        <span
                          class="mt-1.5 size-3 shrink-0 rounded-full ring-1 ring-accented"
                          :style="{ backgroundColor: status.color }"
                          aria-hidden="true"
                        />
                        <div class="min-w-0 flex-1">
                          <p class="break-words text-sm font-medium text-highlighted">
                            {{ workflowStatusLabel(status) }}
                          </p>
                          <p
                            v-if="workflowStatusMeta(status)"
                            class="mt-0.5 text-sm text-muted"
                            data-test="workflow-status-meta"
                          >
                            {{ workflowStatusMeta(status) }}
                          </p>
                        </div>
                        <div class="flex shrink-0 items-center gap-1">
                          <UTooltip :text="t('admin.forms.workflowStatusEditTooltip')">
                            <UButton
                              :id="`workflow-status-edit-${status.machineName}`"
                              color="neutral"
                              variant="ghost"
                              :icon="EDIT_ICON"
                              :aria-label="t('admin.forms.workflowStatusEditAria', { status: workflowStatusLabel(status) })"
                              data-test="workflow-status-edit"
                              @click="openWorkflowStatusPanel(status.machineName)"
                            />
                          </UTooltip>
                          <UTooltip
                            v-if="status.machineName !== workflowDraft.defaultStatus && !workflowStatusFromFeature(status.machineName)"
                            :text="t('admin.forms.workflowStatusRemoveTooltip')"
                          >
                            <UButton
                              color="neutral"
                              variant="ghost"
                              icon="i-lucide-x"
                              :aria-label="t('admin.forms.workflowStatusRemoveAria', { status: workflowStatusLabel(status) })"
                              data-test="workflow-status-remove"
                              @click="toggleWorkflowStatus(status)"
                            />
                          </UTooltip>
                          <!-- A row without the x
                               keeps its place, so all pencils stand under each other. -->
                          <span
                            v-else
                            class="size-8 shrink-0"
                            aria-hidden="true"
                            data-test="workflow-status-remove-placeholder"
                          />
                        </div>
                      </li>
                    </ul>
                    <UDropdownMenu
                      v-if="workflowInactiveStatusItems.length"
                      :items="workflowAddStatusMenuItems"
                      :content="{ align: 'start' }"
                    >
                      <template #status-leading="{ item }">
                        <span
                          class="size-3 shrink-0 rounded-full ring-1 ring-accented"
                          :style="{ backgroundColor: (item as { dotColor?: string }).dotColor }"
                          aria-hidden="true"
                          data-test="workflow-add-status-dot"
                        />
                      </template>
                      <UButton
                        class="mt-3"
                        color="neutral"
                        variant="outline"
                        icon="i-lucide-plus"
                        trailing-icon="i-lucide-chevron-down"
                        data-test="workflow-add-status"
                      >
                        {{ t('admin.forms.workflowAddStatus') }}
                      </UButton>
                    </UDropdownMenu>
                  </section>

                  <UFormField
                    :label="t('admin.forms.workflowDefault')"
                    :description="t('admin.forms.workflowDefaultDescription')"
                    name="workflow-default-status"
                  >
                    <USelect
                      :model-value="workflowDraft.defaultStatus"
                      :items="workflowActiveStatuses.map(status => ({ label: workflowStatusLabel(status), value: status.machineName }))"
                      value-key="value"
                      class="w-full sm:w-72"
                      data-test="workflow-default-status"
                      @update:model-value="value => setWorkflowDefault(String(value))"
                    />
                  </UFormField>

                  <!-- Only a form with more than the standard shows its edges
                   (contract section 2); on the standard every move among the
                   three is allowed. -->
                  <section
                    v-if="!workflowFollowsStandard"
                    aria-labelledby="workflow-transitions-heading"
                  >
                    <h4
                      id="workflow-transitions-heading"
                      class="mb-3 text-sm font-semibold text-highlighted"
                    >
                      {{ t('admin.forms.workflowTransitions') }}
                    </h4>
                    <AdminWorkflowTransitionsEditor
                      :statuses="workflowEditorStatuses"
                      :transitions="workflowDraft.transitions"
                      save-mode="deferred"
                      conditions
                      data-test="workflow-transitions-editor"
                      @add="addWorkflowTransition"
                      @remove="removeWorkflowTransition"
                      @update-condition="updateWorkflowTransitionCondition"
                    />
                  </section>
                </div>
              </div>
            </div>

            <!-- State C (published, archived): the reason first, then the
                 read-only workflow behind "Ablauf ansehen". -->
            <template v-else>
              <AccessReason
                v-if="workflowReadOnlyReason"
                id="workflow-read-only-reason"
                :text="workflowReadOnlyReason"
                data-test="workflow-read-only-reason"
              />
              <AdminWorkflowStandardLine
                :standard="workflowStandardInForm"
                :extras="workflowExtraStatuses"
                :label="workflowStatusLabel"
              />
              <p
                v-if="workflowEnabledFeatures.length"
                class="max-w-prose text-sm text-default"
                data-test="workflow-features-on"
              >
                {{ t('admin.forms.workflowFeatures.onLine', { features: workflowEnabledFeatures.map(feature => workflowFeatureLabel(feature.key)).join(', ') }) }}
              </p>
              <div>
                <UButton
                  color="neutral"
                  variant="ghost"
                  class="group -ms-2.5"
                  icon="i-lucide-chevron-right"
                  :ui="{ leadingIcon: 'transition-transform group-data-[state=open]:rotate-90' }"
                  :data-state="workflowReadOnlyOpen ? 'open' : 'closed'"
                  :aria-expanded="workflowReadOnlyOpen ? 'true' : 'false'"
                  aria-controls="workflow-read-only-content"
                  data-test="workflow-read-only-toggle"
                  @click="workflowReadOnlyOpen = !workflowReadOnlyOpen"
                >
                  {{ t('admin.forms.workflowShowDetails') }}
                </UButton>
                <div
                  v-show="workflowReadOnlyOpen"
                  id="workflow-read-only-content"
                  class="pt-3"
                  data-test="workflow-read-only-content"
                >
                  <AdminWorkflowTransitionsEditor
                    :statuses="workflowEditorStatuses"
                    :transitions="workflowDraft.transitions"
                    conditions
                    read-only
                  >
                    <template #status-details="{ status }">
                      <p
                        v-if="workflowDefinitionFor(status.key)?.description"
                        class="mt-0.5 text-sm text-muted"
                      >
                        {{ workflowDefinitionFor(status.key)?.description }}
                      </p>
                      <p
                        v-if="workflowDefinitionFor(status.key)?.attributes?.length"
                        class="mt-0.5 text-sm text-muted"
                      >
                        {{ t('admin.forms.workflowAttributeCount', { count: workflowDefinitionFor(status.key)?.attributes?.length ?? 0 }, workflowDefinitionFor(status.key)?.attributes?.length ?? 0) }}
                      </p>
                    </template>
                  </AdminWorkflowTransitionsEditor>
                </div>
              </div>
            </template>

            <!-- Save row: "Speichern" always filled, enabled once
                 something changed; "Zurücksetzen" discards the changes. -->
            <template
              v-if="workflowEditable"
              #footer
            >
              <UButton
                :loading="workflowSaving"
                :disabled="!workflowDirty || workflowStatus === 'pending'"
                data-test="workflow-save"
                @click="saveWorkflowDefinition"
              >
                {{ t('common.save') }}
              </UButton>
              <UButton
                color="neutral"
                variant="ghost"
                :disabled="!workflowDirty || workflowSaving || workflowStatus === 'pending'"
                data-test="workflow-reset"
                @click="resetWorkflowDraft"
              >
                {{ t('common.reset') }}
              </UButton>
              <UBadge
                v-if="workflowDirty"
                color="warning"
                role="status"
                data-test="workflow-unsaved"
              >
                {{ t('admin.workflowTransitions.unsaved') }}
              </UBadge>
              <span
                v-else
                class="text-sm text-muted"
                data-test="workflow-save-hint"
              >
                {{ t('admin.forms.workflowAppliesOnPublish') }}
              </span>
              <p
                v-if="workflowDirty && workflowRemovesOpenStatuses"
                class="w-full max-w-prose text-sm text-muted"
                data-test="workflow-removed-statuses-note"
              >
                {{ t(workflowFollowsStandard ? 'admin.forms.workflowRemovedToStandard' : 'admin.forms.workflowRemovedStatuses') }}
              </p>
            </template>
          </AppCard>

          <!-- State D: a form without organisation keeps the standard. -->
          <AppCard
            v-else-if="workflowOrganisationRequired"
            id="ablauf"
            :title="t('admin.forms.workflowTitle')"
            as="h3"
            icon="i-lucide-git-branch"
            data-test="form-workflow-card"
          >
            <p
              class="max-w-prose text-sm text-default"
              data-test="workflow-organisation-standard"
            >
              {{ t('admin.forms.workflowWithoutOrganisation') }}
            </p>
          </AppCard>

          <!-- State E: the workflow could not be loaded; the applications
               above stay usable. -->
          <UAlert
            v-else-if="workflowError"
            color="error"
            icon="i-lucide-circle-x"
            :title="t(workflowDeletedStatus !== null ? 'admin.forms.workflowDeletedStatusTitle' : 'admin.forms.workflowLoadError')"
            :description="workflowDeletedStatus !== null ? undefined : resolveApiErrorMessage(workflowError)"
            :actions="workflowDeletedStatus !== null
              ? [{ label: t('admin.forms.workflowOpenStatusSettings'), color: 'neutral', variant: 'outline', to: workspaceRoute('/admin/settings/workflow') }, { label: t('admin.forms.workflowReload'), color: 'neutral', variant: 'ghost', onClick: () => refreshWorkflow() }]
              : [{ label: t('admin.forms.workflowReload'), color: 'neutral', variant: 'outline', onClick: () => refreshWorkflow() }]"
            class="max-w-3xl"
            data-test="workflow-load-error"
          >
            <!-- What happened and what to do first; the technical name is the
                 detail someone needs to recreate the status. -->
            <template
              v-if="workflowDeletedStatus !== null"
              #description
            >
              <span class="block">{{ t('admin.forms.workflowDeletedStatus', { settings: t('admin.settings.workflow.label') }) }}</span>
              <span
                v-if="workflowDeletedStatus"
                class="mt-1 block"
                data-test="workflow-deleted-status-name"
              >{{ t('admin.forms.workflowDeletedStatusDetail', { status: workflowDeletedStatus }) }}</span>
            </template>
          </UAlert>

          <StaffExtensionOutlet
            name="form-integration-hint"
            :context="{ formId: schemaId }"
          />
        </div>
      </section>

      <!-- Description and Zusatzangaben of one status. -->
      <USlideover
        v-if="workflowEditable && selectedWorkflowDefinition"
        v-model:open="workflowStatusPanelOpen"
        side="right"
        :title="t('admin.forms.workflowStatusPanelTitle', { status: workflowStatusLabel(selectedWorkflowDefinition.status) })"
        :description="t('admin.forms.workflowStatusPanelDescription')"
        :ui="{ content: 'max-w-2xl' }"
        :content="{ onCloseAutoFocus: preventCloseAutoFocus }"
        @after:leave="focusWorkflowStatusPencil"
      >
        <template #body>
          <div
            class="space-y-8"
            data-test="workflow-status-panel"
          >
            <UFormField :label="t('admin.forms.workflowStatusDescription')">
              <UTextarea
                :model-value="selectedWorkflowDefinition.definition.description || ''"
                :rows="3"
                class="w-full"
                @update:model-value="updateSelectedWorkflowStatusDescription"
              />
            </UFormField>

            <section aria-labelledby="workflow-attributes-heading">
              <h3
                id="workflow-attributes-heading"
                class="text-sm font-semibold text-highlighted"
              >
                {{ t('admin.forms.workflowStatusAttributes') }}
              </h3>
              <p class="mt-1 text-sm text-muted">
                {{ t('admin.forms.workflowStatusAttributesHint') }}
              </p>

              <div
                v-if="selectedWorkflowDefinition.definition.attributes?.length"
                class="mt-4 space-y-6"
              >
                <div
                  v-for="(attribute, index) in selectedWorkflowDefinition.definition.attributes"
                  :key="`${selectedWorkflowDefinition.definition.machineName}-${index}`"
                  class="space-y-4 border-s-2 border-default ps-4"
                  data-test="workflow-attribute"
                >
                  <div class="flex items-center justify-between gap-2">
                    <span class="text-sm font-medium text-highlighted">
                      {{ t('admin.forms.workflowAttributeHeading', { number: index + 1 }) }}
                    </span>
                    <UButton
                      color="neutral"
                      variant="ghost"
                      icon="i-lucide-x"
                      :aria-label="t('admin.forms.workflowAttributeRemove', { number: index + 1 })"
                      @click="removeWorkflowStatusAttribute(selectedWorkflowDefinition.definition, index)"
                    />
                  </div>
                  <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField :label="t('admin.forms.workflowAttributeLabel')">
                      <UInput
                        v-model="attribute.description"
                        class="w-full"
                      />
                    </UFormField>
                    <UFormField :label="t('admin.forms.workflowAttributeType')">
                      <USelect
                        :model-value="attribute.datatype"
                        :items="attributeDatatypeItems"
                        value-key="value"
                        class="w-full"
                        @update:model-value="value => updateWorkflowAttributeDatatype(attribute, String(value))"
                      />
                    </UFormField>
                  </div>
                  <UFormField
                    :label="t('admin.forms.workflowAttributeCode')"
                    class="max-w-xl"
                  >
                    <UInput
                      :model-value="attribute.code"
                      class="w-full font-mono"
                      @update:model-value="value => attribute.code = normalizeAttributeCode(String(value))"
                    />
                  </UFormField>
                  <UFormField :label="t('admin.forms.workflowAttributeHelp')">
                    <UInput
                      v-model="attribute.datatype_description"
                      class="w-full"
                    />
                  </UFormField>
                  <div
                    v-if="workflowAttributeNeedsMediaType(attribute.datatype)"
                    class="grid gap-4 sm:grid-cols-2"
                  >
                    <UFormField :label="t('admin.forms.workflowAttributeMediaType')">
                      <UInput
                        v-model="attribute.media_type"
                        class="w-full"
                      />
                    </UFormField>
                    <UFormField :label="t('admin.forms.workflowAttributeMediaGroup')">
                      <UInput
                        v-model="attribute.media_group"
                        class="w-full"
                      />
                    </UFormField>
                  </div>
                  <div class="flex flex-wrap gap-x-6 gap-y-2">
                    <UCheckbox
                      v-model="attribute.required"
                      :label="t('admin.forms.workflowAttributeRequired')"
                    />
                    <UCheckbox
                      v-model="attribute.variable"
                      :label="t('admin.forms.workflowAttributeVariable')"
                    />
                  </div>
                  <div
                    v-if="workflowAttributeNeedsValues(attribute.datatype)"
                    class="space-y-2"
                  >
                    <p class="text-sm font-medium text-highlighted">
                      {{ t('admin.forms.workflowAttributeOptions') }}
                    </p>
                    <div
                      v-for="(value, valueIndex) in attribute.values"
                      :key="`${attribute.code}-${valueIndex}`"
                      class="flex items-start gap-2"
                    >
                      <div class="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
                        <UInput
                          :model-value="value.key"
                          :placeholder="t('admin.forms.workflowAttributeOptionKey')"
                          :aria-label="t('admin.forms.workflowAttributeOptionKey')"
                          class="w-full"
                          @update:model-value="next => updateWorkflowAttributeValue(attribute, valueIndex, 'key', String(next))"
                        />
                        <UInput
                          :model-value="value.name"
                          :placeholder="t('admin.forms.workflowAttributeOptionName')"
                          :aria-label="t('admin.forms.workflowAttributeOptionName')"
                          class="w-full"
                          @update:model-value="next => updateWorkflowAttributeValue(attribute, valueIndex, 'name', String(next))"
                        />
                      </div>
                      <UButton
                        color="neutral"
                        variant="ghost"
                        icon="i-lucide-x"
                        :aria-label="t('common.remove')"
                        @click="removeWorkflowAttributeValue(attribute, valueIndex)"
                      />
                    </div>
                    <UButton
                      color="neutral"
                      variant="outline"
                      icon="i-lucide-plus"
                      @click="addWorkflowAttributeValue(attribute)"
                    >
                      {{ t('admin.forms.workflowAttributeAddOption') }}
                    </UButton>
                  </div>
                </div>
              </div>
              <p
                v-else
                class="mt-4 text-sm text-muted"
                data-test="workflow-no-attributes"
              >
                {{ t('admin.forms.workflowNoAttributes') }}
              </p>

              <UButton
                class="mt-4"
                color="neutral"
                variant="outline"
                icon="i-lucide-plus"
                :aria-label="t('admin.forms.workflowAddAttributeFor', { status: workflowStatusLabel(selectedWorkflowDefinition.status) })"
                data-test="workflow-add-attribute"
                @click="addWorkflowStatusAttribute(selectedWorkflowDefinition.definition)"
              >
                {{ t('admin.forms.workflowAddAttribute') }}
              </UButton>
            </section>
          </div>
        </template>
        <template #footer>
          <div class="flex w-full justify-end">
            <UButton
              color="neutral"
              variant="outline"
              data-test="workflow-status-panel-done"
              @click="workflowStatusPanelOpen = false"
            >
              {{ t('admin.forms.workflowStatusPanelDone') }}
            </UButton>
          </div>
        </template>
      </USlideover>

      <!-- The questions before a state change, as dialogs. -->
      <AdminPublishConfirm
        v-model:open="confirmingPublish"
        dialog
        :form-title="schemaLabel"
        :scope="schemaPublicationScope"
        :receiver-text="publishReceiverText"
        :note="workflowDirty ? t('admin.forms.publishDropsWorkflowDraft') : undefined"
        :publishing="schemaStatusUpdating"
        @confirm="confirmPublish"
        @cancel="cancelPublish"
        @closed="onPublishDialogClosed"
      />
      <AdminFormStatusConfirm
        v-model:open="statusChangeOpen"
        :title="statusChangeTexts.title"
        :description="statusChangeTexts.description"
        :confirm-label="statusChangeTexts.confirm"
        :busy="schemaStatusUpdating"
        @confirm="confirmStatusChange"
        @cancel="cancelStatusChange"
        @closed="focusMoreActions"
      />
    </template>

    <!-- The guided setup over this page: one close control, the X
         carrying the word; the body scrolls, and its scroll padding keeps a
         focused control above the sticky footer of a screen. -->
    <UModal
      v-if="setupDialog && setupModal"
      :open="setupOpen"
      fullscreen
      :transition="false"
      :title="setupDialog.title"
      :description="setupDialog.description"
      :close="setupCloseButton(setupDialog.close, setupModal.busy)"
      :ui="{ wrapper: 'min-w-0 flex-1', title: 'truncate', description: 'sr-only', close: 'static shrink-0', body: 'scroll-pb-36' }"
      @update:open="closeSetup"
    >
      <template #body>
        <NuxtPage />
      </template>
    </UModal>
  </AppPageLayout>
</template>
