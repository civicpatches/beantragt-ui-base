<script setup lang="ts">
import { EDIT_ICON } from '~/utils/action-icons';
import { useOrganisationChoices } from '~~/casework-layer/app/composables/useOrganisationChoices';
import { useAdminDelegationSettings } from '~~/casework-layer/app/composables/useAdminDelegationSettings';
import { isValidCitizenLabel, workflowStatusCitizenHint } from '~/utils/workflow-status';
import AccessReason from '~~/casework-layer/app/components/AccessReason.vue';
import { standardStatuses, workflowFeatureOfFlags, type WorkflowFeatureKey } from '~~/casework-layer/server/utils/schema-workflow-definition';
import { parseDeleteBlockers, type WorkflowStatusDeleteBlocker } from '~~/casework-layer/server/utils/workflow-status-delete-blockers';

definePageMeta({
    layout: 'dashboard',
    middleware: 'admin'
});

interface WorkflowStatus {
    id: string
    label: string
    machineName: string
    color: string
    icon: string
    weight: number
    version: string
    isDefault: boolean
    isTerminal: boolean
    slaDays: number
    escalationDays: number
    semanticFlags: string[]
    /** Text applicants see instead of the label; empty uses the label. */
    citizenLabel?: { de: string, en: string }
    allowedNextIds: string[]
    groupId: string | null
    /** Why it cannot be deleted; `[]` = deletable, absent = not told. */
    deleteBlockers?: WorkflowStatusDeleteBlocker[]
}

/** What a refused delete said, kept per status until the list knows better. */
type DeleteRefusal = { blockers: WorkflowStatusDeleteBlocker[] } | 'protected' | 'forbidden';

interface WorkflowStatusListResponse {
    statuses: WorkflowStatus[]
    meta: {
        workspaceType: 'jurisdiction' | 'organisation'
        workspaceLabel: string
        editable: boolean
    }
}

const { t, locale } = useI18n();
/** The status form sits in the dialog body, its save button in the footer. */
const statusFormId = 'admin-workflow-status-form';
const toast = useToast();
const { resolveApiErrorMessage } = useApiErrorMessage();
const { workspaceRoute, withWorkspaceQuery, selectedWorkspaceKey, currentWorkspace } = useWorkspaceContext();
const { organisations } = useOrganisationChoices();
const {
    noteRequired: delegationNoteRequired,
    personalAssignment,
    personalAssignmentEditable,
    setPersonalAssignment,
    isLoading: delegationSettingsLoading,
    loadError: delegationSettingsLoadError,
    permissionError: delegationSettingsPermissionError,
    isSaving: delegationSettingsSaving,
    saveError: delegationSettingsSaveError,
    setNoteRequired: setDelegationNoteRequired
} = useAdminDelegationSettings();

useHead({
    title: computed(() => `${t('admin.settings.workflow.label')} - ${t('common.settings')} - beantragt.ai`)
});

const ICON_OPTIONS = computed(() => [
    { label: t('admin.settings.workflow.iconOptions.inbox'), value: 'i-lucide-inbox' },
    { label: t('admin.settings.workflow.iconOptions.search'), value: 'i-lucide-search' },
    { label: t('admin.settings.workflow.iconOptions.check'), value: 'i-lucide-check-circle' },
    { label: t('admin.settings.workflow.iconOptions.cross'), value: 'i-lucide-x-circle' },
    { label: t('admin.settings.workflow.iconOptions.archive'), value: 'i-lucide-archive' },
    { label: t('admin.settings.workflow.iconOptions.clock'), value: 'i-lucide-clock' },
    { label: t('admin.settings.workflow.iconOptions.star'), value: 'i-lucide-star' },
    { label: t('admin.settings.workflow.iconOptions.warning'), value: 'i-lucide-alert-triangle' },
    { label: t('admin.settings.workflow.iconOptions.info'), value: 'i-lucide-info' },
    { label: t('admin.settings.workflow.iconOptions.edit'), value: EDIT_ICON },
    { label: t('admin.settings.workflow.iconOptions.send'), value: 'i-lucide-send' },
    { label: t('admin.settings.workflow.iconOptions.folder'), value: 'i-lucide-folder' },
    { label: t('admin.settings.workflow.iconOptions.tag'), value: 'i-lucide-tag' },
    { label: t('admin.settings.workflow.iconOptions.bookmark'), value: 'i-lucide-bookmark' }
]);

const SEMANTIC_FLAG_OPTIONS = computed(() => [
    { label: t('admin.settings.workflow.semanticOptions.received'), value: 'received' },
    { label: t('admin.settings.workflow.semanticOptions.requestInfo'), value: 'request_info' },
    { label: t('admin.settings.workflow.semanticOptions.documentsReceived'), value: 'documents_received' },
    { label: t('admin.settings.workflow.semanticOptionsLong.handOver'), value: 'hand_over' },
    { label: t('admin.settings.workflow.semanticOptions.inCaseSystem'), value: 'in_case_system' },
    { label: t('admin.settings.workflow.semanticOptions.decisionIssued'), value: 'decision_issued' },
    { label: t('admin.settings.workflow.semanticOptions.approved'), value: 'approved' },
    { label: t('admin.settings.workflow.semanticOptions.rejected'), value: 'rejected' },
    { label: t('admin.settings.workflow.semanticOptionsLong.filed'), value: 'filed' },
    { label: t('admin.settings.workflow.semanticOptions.closed'), value: 'closed' },
    { label: t('admin.settings.workflow.semanticOptions.withdrawn'), value: 'withdrawn' }
]);

const statuses = ref<WorkflowStatus[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const meta = ref<WorkflowStatusListResponse['meta'] | null>(null);
let loadRequestId = 0;

const editable = computed(() => Boolean(meta.value?.editable && currentWorkspace.value?.type === 'organisation'));

// The standard is what the start status reaches (the one
// standard helper, also behind `defaultWorkflow`); everything else is
// the library of statuses a form can switch on.
const standardGroup = computed(() => standardStatuses(statuses.value));
const standardIds = computed(() => new Set(standardGroup.value.map(status => status.id)));
const libraryGroup = computed(() => statuses.value.filter(status => !standardIds.value.has(status.id)));
const libraryOpen = ref(false);
const FEATURE_LABEL_KEYS: Record<WorkflowFeatureKey, string> = {
    requestInfo: 'admin.forms.workflowFeatures.requestInfo.label',
    handOver: 'admin.forms.workflowFeatures.handOver.label',
    outcome: 'admin.forms.workflowFeatures.outcome.label',
    withdrawal: 'admin.forms.workflowFeatures.withdrawal.label'
};
function isStandardStatus(status: WorkflowStatus): boolean {
    return standardIds.value.has(status.id);
}
// One grey line of text per status, no badges.
function statusMetaLine(status: WorkflowStatus): string {
    const standard = isStandardStatus(status);
    const parts: string[] = [];
    if (!standard) {
        const feature = workflowFeatureOfFlags(status.semanticFlags);
        parts.push(feature
            ? t('admin.settings.workflow.origin', { feature: t(FEATURE_LABEL_KEYS[feature]) })
            : t('admin.settings.workflow.ownStatus'));
    }
    const hint = citizenHint(status);
    if (standard || hint) parts.push(t('admin.settings.workflow.citizenSees', { label: hint || status.label }));
    if (status.slaDays > 0) parts.push(t('admin.settings.workflow.slaText', { days: status.slaDays }, status.slaDays));
    else if (standard && !status.isTerminal) parts.push(t('admin.settings.workflow.noSla'));
    if (status.escalationDays > 0) parts.push(t('admin.settings.workflow.escalationText', { days: status.escalationDays }, status.escalationDays));
    if (status.isTerminal) parts.push(t('admin.settings.workflow.terminal'));
    return parts.join(' · ');
}
// No standard status is deleted
// here. The row has no bin, only this reason (as every blocked status).
function deleteReasonId(status: WorkflowStatus): string | null {
    if (!isStandardStatus(status)) return null;
    return status.isDefault ? `workflow-status-default-reason-${status.id}` : `workflow-status-standard-reason-${status.id}`;
}
function deleteReasonText(status: WorkflowStatus): string {
    return t(status.isDefault ? 'admin.settings.workflow.defaultDeleteReason' : 'admin.settings.workflow.standardDeleteReason');
}

// Why a library status cannot be deleted, said before the click. The
// list's `delete_blockers` wins when the list carries it; without it (the
// person may not see it) the bin stays and a refused delete says its reason
// here until the list knows better.
const deleteRefusals = ref<Record<string, DeleteRefusal>>({});
function deleteBlockedState(status: WorkflowStatus): DeleteRefusal | null {
    if (status.deleteBlockers) return status.deleteBlockers.length ? { blockers: status.deleteBlockers } : null;
    return deleteRefusals.value[status.id] ?? null;
}
function deleteBlockedReasonId(status: WorkflowStatus): string {
    return `workflow-status-delete-reason-${status.id}`;
}
function blockedByForm(status: WorkflowStatus): boolean {
    const state = deleteBlockedState(status);
    return Boolean(state && typeof state === 'object' && state.blockers.includes('form_workflow_reference'));
}
/** The statuses of this list that name the status as their next step. */
function statusesPointingTo(status: WorkflowStatus): string[] {
    return statuses.value
        .filter(other => other.id !== status.id && other.allowedNextIds.includes(status.id))
        .map(other => other.label);
}
function deleteBlockerFragments(status: WorkflowStatus, blockers: WorkflowStatusDeleteBlocker[]): string[] {
    const fragments: string[] = [];
    if (blockers.includes('default')) fragments.push(t('admin.settings.workflow.deleteBlockers.default'));
    const current = blockers.includes('application_reference');
    const history = blockers.includes('application_revision_reference');
    // Both application codes usually come together: one fragment, not "Anträge" twice.
    if (current && history) fragments.push(t('admin.settings.workflow.deleteBlockers.applicationsBoth'));
    else if (current) fragments.push(t('admin.settings.workflow.deleteBlockers.applicationsCurrent'));
    else if (history) fragments.push(t('admin.settings.workflow.deleteBlockers.applicationsHistory'));
    if (blockers.includes('transition_reference')) {
        const pointing = statusesPointingTo(status);
        fragments.push(pointing.length
            ? t('admin.settings.workflow.deleteBlockers.transitionFrom', { statuses: joinList(pointing.map(label => t('admin.settings.workflow.deleteBlockers.quoted', { label }))) })
            : t('admin.settings.workflow.deleteBlockers.transition'));
    }
    if (blockers.includes('form_workflow_reference')) fragments.push(t('admin.settings.workflow.deleteBlockers.form'));
    return fragments;
}
function joinList(items: string[]): string {
    return new Intl.ListFormat(locale.value, { type: 'conjunction' }).format(items);
}
function deleteBlockedText(status: WorkflowStatus): string {
    const state = deleteBlockedState(status);
    if (!state) return '';
    if (state === 'forbidden') return t('errors.workflow.deleteForbidden');
    if (state === 'protected') return t('admin.settings.workflow.deleteBlockers.protected');
    return t('admin.settings.workflow.deleteBlocked', { reasons: joinList(deleteBlockerFragments(status, state.blockers)) });
}
/** Reads the refusal the DELETE route sends (`data.data.code`, `data.data.blockers`). */
function deleteRefusalOf(error: unknown): DeleteRefusal | null {
    const data = (error as { data?: { data?: { code?: unknown, blockers?: unknown } } } | null)?.data?.data;
    if (!data) return null;
    if (data.code === 'errors.workflow.deleteForbidden') return 'forbidden';
    if (data.code === 'errors.workflow.statusProtected') return 'protected';
    const blockers = parseDeleteBlockers(data.blockers);
    return blockers?.length ? { blockers } : null;
}

function applyResponse(response: WorkflowStatusListResponse) {
    statuses.value = [...response.statuses].sort((a, b) => a.weight - b.weight || a.label.localeCompare(b.label, 'de'));
    meta.value = response.meta;
}

async function loadStatuses() {
    const requestId = ++loadRequestId;
    loading.value = true;
    error.value = null;

    try {
        const response = await $fetch<WorkflowStatusListResponse>('/api/admin/workflow-statuses', {
            query: withWorkspaceQuery()
        });
        if (requestId !== loadRequestId) return;
        applyResponse(response);
    } catch (e) {
        if (requestId !== loadRequestId) return;
        error.value = resolveApiErrorMessage(e, 'admin.settings.workflow.loadError');
    } finally {
        if (requestId === loadRequestId) {
            loading.value = false;
        }
    }
}

onMounted(loadStatuses);
watch(selectedWorkspaceKey, () => {
    deleteRefusals.value = {};
    return loadStatuses();
});

const isModalOpen = ref(false);
const editingStatus = ref<WorkflowStatus | null>(null);
const saving = ref(false);
const deletingId = ref<string | null>(null);

const formLabel = ref('');
const formMachineName = ref('');
const formColor = ref('#6b7280');
const formIcon = ref('i-lucide-tag');
const formWeight = ref(0);
const formIsTerminal = ref(false);
const formSlaDays = ref(0);
const formEscalationDays = ref(0);
const formSemanticFlags = ref<string[]>([]);
const formCitizenLabelDe = ref('');
const formCitizenLabelEn = ref('');
const citizenLabelErrors = computed(() => ({
    de: !isValidCitizenLabel(formCitizenLabelDe.value),
    en: !isValidCitizenLabel(formCitizenLabelEn.value)
}));
const machineNameTouched = ref(false);
const isNewStatus = computed(() => !editingStatus.value);
// What defines the standard
// (meaning and final status) is shown, not edited, for a standard status.
const editingStandard = computed(() => Boolean(editingStatus.value && isStandardStatus(editingStatus.value)));
// "Weitere Angaben": open for a new status (the technical name is asked there).
const moreFieldsOpen = ref(false);
const statusDialogTitle = computed(() => editingStatus.value
    ? t('admin.settings.workflow.editTitleNamed', { label: editingStatus.value.label })
    : t('admin.settings.workflow.createTitle'));

function machineNameFromLabel(value: string): string {
    const normalized = value
        .trim()
        .replace(/ß/gu, 'ss')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/gu, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/gu, '_')
        .replace(/^_+|_+$/gu, '')
        .replace(/_+/gu, '_');

    return normalized || 'status';
}

watch(formLabel, (value) => {
    if (isNewStatus.value && !machineNameTouched.value) {
        formMachineName.value = machineNameFromLabel(value);
    }
});

watch(formIsTerminal, (isTerminal) => {
    if (isTerminal) {
        formSlaDays.value = 0;
        formEscalationDays.value = 0;
    }
});

function openCreateModal() {
    editingStatus.value = null;
    formLabel.value = '';
    formMachineName.value = '';
    formColor.value = '#6b7280';
    formIcon.value = 'i-lucide-tag';
    formWeight.value = statuses.value.length ? Math.max(...statuses.value.map(status => status.weight)) + 10 : 0;
    formIsTerminal.value = false;
    formSlaDays.value = 0;
    formEscalationDays.value = 0;
    formSemanticFlags.value = [];
    formCitizenLabelDe.value = '';
    formCitizenLabelEn.value = '';
    machineNameTouched.value = false;
    moreFieldsOpen.value = true;
    isModalOpen.value = true;
}

function openEditModal(status: WorkflowStatus) {
    editingStatus.value = status;
    formLabel.value = status.label;
    formMachineName.value = status.machineName;
    formColor.value = status.color;
    formIcon.value = status.icon;
    formWeight.value = status.weight;
    formIsTerminal.value = status.isTerminal;
    formSlaDays.value = status.slaDays;
    formEscalationDays.value = status.escalationDays;
    formSemanticFlags.value = [...status.semanticFlags];
    formCitizenLabelDe.value = status.citizenLabel?.de ?? '';
    formCitizenLabelEn.value = status.citizenLabel?.en ?? '';
    machineNameTouched.value = true;
    moreFieldsOpen.value = false;
    isModalOpen.value = true;
}

function closeModal() {
    if (saving.value) return;
    isModalOpen.value = false;
    editingStatus.value = null;
}

function apiBody() {
    return {
        label: formLabel.value.trim(),
        machineName: formMachineName.value.trim(),
        color: formColor.value,
        icon: formIcon.value,
        weight: Number(formWeight.value) || 0,
        isTerminal: formIsTerminal.value,
        slaDays: formIsTerminal.value ? 0 : Math.max(0, Number(formSlaDays.value) || 0),
        escalationDays: formIsTerminal.value ? 0 : Math.max(0, Number(formEscalationDays.value) || 0),
        semanticFlags: formSemanticFlags.value,
        citizenLabel: { de: formCitizenLabelDe.value.trim(), en: formCitizenLabelEn.value.trim() },
        allowedNextIds: formIsTerminal.value ? [] : undefined
    };
}

async function handleSaveStatus() {
    if (!formLabel.value.trim()) {
        toast.add({ title: t('admin.settings.workflow.nameRequired'), color: 'error' });
        return;
    }
    if (citizenLabelErrors.value.de || citizenLabelErrors.value.en) return;

    saving.value = true;
    try {
        const current = editingStatus.value;
        const response = current
            ? await $fetch<WorkflowStatusListResponse>(`/api/admin/workflow-statuses/${current.id}`, {
                method: 'PATCH',
                query: withWorkspaceQuery(),
                body: {
                    ...apiBody(),
                    machineName: undefined,
                    expectedVersion: current.version
                }
            })
            : await $fetch<WorkflowStatusListResponse>('/api/admin/workflow-statuses', {
                method: 'POST',
                query: withWorkspaceQuery(),
                body: apiBody()
            });

        applyResponse(response);
        isModalOpen.value = false;
        editingStatus.value = null;
        // A new status is a library status: the card opens and shows it.
        if (!current) libraryOpen.value = true;
        toast.add({
            title: current ? t('admin.settings.workflow.statusUpdated') : t('admin.settings.workflow.statusCreated'),
            color: 'success'
        });
    } catch (e) {
        toast.add({
            title: t('admin.settings.workflow.saveError'),
            description: resolveApiErrorMessage(e),
            color: 'error'
        });
    } finally {
        saving.value = false;
    }
}

// Deleting asks in a dialog, not with the browser question.
const deleteTarget = ref<WorkflowStatus | null>(null);
const deleteDialogOpen = ref(false);
function askDeleteStatus(status: WorkflowStatus) {
    if (isStandardStatus(status) || deleteBlockedState(status)) return;
    deleteTarget.value = status;
    deleteDialogOpen.value = true;
}
function focusDeleteCancel(event: Event) {
    event.preventDefault();
    void nextTick(() => document.getElementById('workflow-status-delete-cancel')?.focus());
}
async function confirmDeleteStatus() {
    const status = deleteTarget.value;
    if (!status || deletingId.value) return;
    await deleteStatus(status);
    deleteDialogOpen.value = false;
}

async function deleteStatus(status: WorkflowStatus) {
    if (status.isDefault) {
        toast.add({ title: t('admin.settings.workflow.defaultCannotDelete'), color: 'error' });
        return;
    }

    deletingId.value = status.id;
    try {
        const response = await $fetch<WorkflowStatusListResponse>(`/api/admin/workflow-statuses/${status.id}`, {
            method: 'DELETE',
            query: withWorkspaceQuery()
        });
        applyResponse(response);
        toast.add({ title: t('admin.settings.workflow.statusDeleted'), color: 'success' });
    } catch (e) {
        const refusal = deleteRefusalOf(e);
        if (refusal) {
            // Said at the row, not in a toast; the list is loaded again.
            deleteRefusals.value = { ...deleteRefusals.value, [status.id]: refusal };
            void loadStatuses();
            return;
        }
        toast.add({
            title: t('admin.settings.workflow.deleteError'),
            description: resolveApiErrorMessage(e),
            color: 'error'
        });
    } finally {
        deletingId.value = null;
    }
}

function invertColor(hex: string): string {
    if (!/^#[0-9a-fA-F]{6}$/u.test(hex)) return '#ffffff';
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.5 ? '#111827' : '#ffffff';
}

/** The citizen text when it differs from the label (list hint and "internal" badge). */
function citizenHint(status: WorkflowStatus): string {
    return workflowStatusCitizenHint(status, locale.value);
}

function semanticFlagLabel(flag: string): string {
    const option = SEMANTIC_FLAG_OPTIONS.value.find(item => item.value === flag);
    return option?.label ?? flag;
}
</script>

<template>
  <AppPageLayout
    :title="t('admin.settings.workflow.title')"
    :description="t('admin.settings.workflow.subtitle')"
    :breadcrumbs="[{ label: t('common.settings'), to: workspaceRoute('/admin/settings') }, { label: t('admin.settings.workflow.label') }]"
  >
    <!-- No header action; "Neuer Status" sits on the card
         where its result appears. -->
    <div class="space-y-6">
      <UAlert
        v-if="error"
        color="error"
        icon="i-lucide-circle-x"
        :title="t('admin.settings.workflow.loadError')"
        :description="error"
      />

      <AdminOfficeWorkspaceNotice
        v-if="!loading && !error && currentWorkspace?.type === 'jurisdiction'"
        :title="t('admin.settings.workflow.organisationWorkspaceTitle')"
        :description="organisations.length ? undefined : t('admin.settings.workflow.organisationNone')"
        :additional-action="organisations.length ? undefined : {
          label: t('admin.settings.workflow.organisationCreate'),
          icon: 'i-lucide-plus',
          color: 'neutral',
          variant: 'ghost',
          to: workspaceRoute('/admin/settings/tenant'),
        }"
        class="max-w-3xl"
        data-test="workflow-organisation-required"
      />

      <div
        v-if="loading"
        class="space-y-2"
        data-test="workflow-settings-loading"
      >
        <USkeleton
          v-for="i in 5"
          :key="i"
          class="h-10 w-full"
        />
      </div>

      <template v-else>
        <template v-if="editable">
          <!-- Card 1: the standard statuses (reachable from the start). -->
          <AppCard
            :title="t('admin.settings.workflow.statusDefinitions')"
            :info="{ label: t('admin.settings.workflow.standardInfoLabel'), text: t('admin.settings.workflow.standardInfo') }"
            data-test="workflow-standard-card"
          >
            <ul
              v-if="standardGroup.length"
              data-test="workflow-standard-list"
            >
              <li
                v-for="status in standardGroup"
                :key="status.id"
                class="flex items-start gap-3 border-t border-default py-3 first:border-t-0 first:pt-0 last:pb-0"
                data-test="workflow-status-row"
              >
                <div
                  class="flex size-8 shrink-0 items-center justify-center rounded-full ring-1 ring-accented"
                  :style="{ backgroundColor: status.color }"
                  aria-hidden="true"
                >
                  <UIcon
                    :name="status.icon"
                    class="size-4"
                    :style="{ color: invertColor(status.color) }"
                  />
                </div>
                <div class="min-w-0 flex-1">
                  <div class="flex items-start gap-3">
                    <h3 class="min-w-0 flex-1 break-words text-sm font-semibold text-highlighted">
                      {{ status.label }}
                    </h3>
                    <div class="flex shrink-0 items-center gap-1">
                      <UTooltip :text="t('common.edit')">
                        <UButton
                          :icon="EDIT_ICON"
                          variant="ghost"
                          color="neutral"
                          :aria-label="t('admin.settings.workflow.editStatusNamed', { label: status.label })"
                          data-test="workflow-status-edit"
                          @click="openEditModal(status)"
                        />
                      </UTooltip>
                      <!-- No bin for what is not possible:
                           the reason stands under the row; the place keeps the pencil
                           on the same vertical line as in the library rows. -->
                      <span
                        class="size-8 shrink-0"
                        aria-hidden="true"
                      />
                    </div>
                  </div>
                  <p
                    class="mt-0.5 text-sm text-muted"
                    data-test="workflow-status-meta"
                  >
                    <span data-test="status-citizen-hint">{{ statusMetaLine(status) }}</span>
                  </p>
                  <AccessReason
                    :id="deleteReasonId(status) ?? `workflow-status-standard-reason-${status.id}`"
                    class="mt-1 max-w-prose"
                    :text="deleteReasonText(status)"
                  />
                </div>
              </li>
            </ul>
            <p
              v-else
              class="text-sm text-muted"
            >
              {{ t('admin.settings.workflow.empty') }}
            </p>
          </AppCard>

          <!-- Card 2: the library, folded; "Neuer Status" creates one here. -->
          <AppCard
            v-model:open="libraryOpen"
            :title="t('admin.settings.workflow.moreStatuses')"
            :count="libraryGroup.length"
            collapsible
            data-test="workflow-library-card"
          >
            <template #lead>
              {{ t(libraryGroup.length ? 'admin.settings.workflow.moreStatusesLead' : 'admin.settings.workflow.moreStatusesEmpty') }}
            </template>
            <template #actions>
              <UButton
                color="neutral"
                variant="outline"
                icon="i-lucide-plus"
                :disabled="!editable"
                data-test="workflow-new-status"
                @click="openCreateModal"
              >
                {{ t('admin.settings.workflow.newStatus') }}
              </UButton>
            </template>
            <ul
              v-if="libraryGroup.length"
              data-test="workflow-library-list"
            >
              <li
                v-for="status in libraryGroup"
                :key="status.id"
                class="flex items-start gap-3 border-t border-default py-3 first:border-t-0 first:pt-0 last:pb-0"
                data-test="workflow-status-row"
              >
                <div
                  class="flex size-8 shrink-0 items-center justify-center rounded-full ring-1 ring-accented"
                  :style="{ backgroundColor: status.color }"
                  aria-hidden="true"
                >
                  <UIcon
                    :name="status.icon"
                    class="size-4"
                    :style="{ color: invertColor(status.color) }"
                  />
                </div>
                <div class="min-w-0 flex-1">
                  <div class="flex items-start gap-3">
                    <h3 class="min-w-0 flex-1 break-words text-sm font-semibold text-highlighted">
                      {{ status.label }}
                    </h3>
                    <div class="flex shrink-0 items-center gap-1">
                      <UTooltip :text="t('common.edit')">
                        <UButton
                          :icon="EDIT_ICON"
                          variant="ghost"
                          color="neutral"
                          :aria-label="t('admin.settings.workflow.editStatusNamed', { label: status.label })"
                          data-test="workflow-status-edit"
                          @click="openEditModal(status)"
                        />
                      </UTooltip>
                      <UTooltip
                        v-if="!deleteBlockedState(status)"
                        :text="t('common.delete')"
                      >
                        <UButton
                          icon="i-lucide-trash-2"
                          variant="ghost"
                          color="neutral"
                          :loading="deletingId === status.id"
                          :aria-label="t('admin.settings.workflow.deleteStatusNamed', { label: status.label })"
                          data-test="workflow-status-delete"
                          @click="askDeleteStatus(status)"
                        />
                      </UTooltip>
                      <!-- No bin for what is not possible; the place keeps the pencil where it was. -->
                      <span
                        v-else
                        class="size-8 shrink-0"
                        aria-hidden="true"
                      />
                    </div>
                  </div>
                  <p
                    class="mt-0.5 text-sm text-muted"
                    data-test="workflow-status-meta"
                  >
                    <span data-test="status-citizen-hint">{{ statusMetaLine(status) }}</span>
                  </p>
                  <AccessReason
                    v-if="deleteBlockedState(status)"
                    :id="deleteBlockedReasonId(status)"
                    class="mt-1 max-w-prose"
                    :text="deleteBlockedText(status)"
                    data-test="workflow-status-delete-reason"
                  >
                    <ULink
                      v-if="blockedByForm(status)"
                      :to="workspaceRoute('/admin/forms')"
                      class="font-medium text-default underline underline-offset-2"
                      data-test="workflow-status-delete-forms-link"
                    >{{ t('admin.settings.workflow.deleteBlockers.formsLink') }}</ULink>
                  </AccessReason>
                </div>
              </li>
            </ul>
          </AppCard>
        </template>

        <!-- Card 3: assignment and hand-on; also in the
             municipality workspace. -->
        <AppCard
          :title="t('admin.settings.workflow.delegationSettingsTitle')"
          class="max-w-3xl"
          data-test="workflow-delegation-card"
        >
          <AccessReason
            v-if="delegationSettingsPermissionError"
            id="workflow-delegation-permission"
            :text="t('admin.settings.workflow.delegationSettingsPermissionDescription')"
          />
          <p
            v-else
            class="text-sm text-muted"
          >
            {{ t('admin.settings.workflow.delegationScope') }}
          </p>
          <UAlert
            v-if="delegationSettingsLoadError"
            color="error"
            icon="i-lucide-circle-x"
            :title="t('admin.settings.workflow.delegationSettingsLoadError')"
            :description="delegationSettingsLoadError"
          />
          <UAlert
            v-if="delegationSettingsSaveError"
            role="alert"
            color="error"
            icon="i-lucide-circle-x"
            :title="t('admin.settings.workflow.delegationSettingsSaveError')"
            :description="delegationSettingsSaveError"
          />
          <div>
            <USwitch
              :model-value="personalAssignment"
              :label="t('admin.settings.workflow.personalAssignmentLabel')"
              :description="t('admin.settings.workflow.personalAssignmentHelp')"
              :disabled="!personalAssignmentEditable || delegationSettingsLoading || delegationSettingsSaving || delegationSettingsPermissionError || Boolean(delegationSettingsLoadError)"
              :aria-describedby="!personalAssignmentEditable ? 'workflow-personal-assignment-inherited' : (delegationSettingsPermissionError ? 'workflow-delegation-permission' : undefined)"
              data-test="workflow-personal-assignment"
              @update:model-value="value => setPersonalAssignment(Boolean(value))"
            />
            <AccessReason
              v-if="!personalAssignmentEditable"
              id="workflow-personal-assignment-inherited"
              class="ms-11 mt-1"
              :text="t('admin.settings.workflow.personalAssignmentInherited')"
            />
          </div>
          <USwitch
            :model-value="delegationNoteRequired"
            :label="t('admin.settings.workflow.delegationNoteRequiredLabel')"
            :description="t('admin.settings.workflow.delegationNoteRequiredHelp')"
            :disabled="delegationSettingsLoading || delegationSettingsSaving || delegationSettingsPermissionError || Boolean(delegationSettingsLoadError)"
            :aria-describedby="delegationSettingsPermissionError ? 'workflow-delegation-permission' : undefined"
            data-test="workflow-note-required"
            @update:model-value="value => setDelegationNoteRequired(Boolean(value))"
          />
        </AppCard>
      </template>
    </div>

    <!-- The question before deleting a library status. -->
    <UModal
      v-model:open="deleteDialogOpen"
      :title="deleteTarget ? t('admin.settings.workflow.deleteTitleNamed', { label: deleteTarget.label }) : ''"
      :description="t('admin.settings.workflow.deleteDescription')"
      :dismissible="!deletingId"
      :close="!deletingId"
      :content="{ onOpenAutoFocus: focusDeleteCancel }"
    >
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            id="workflow-status-delete-cancel"
            color="neutral"
            variant="ghost"
            :disabled="Boolean(deletingId)"
            data-test="workflow-status-delete-cancel"
            @click="deleteDialogOpen = false"
          >
            {{ t('common.cancel') }}
          </UButton>
          <UButton
            color="error"
            :loading="Boolean(deletingId)"
            data-test="workflow-status-delete-confirm"
            @click="confirmDeleteStatus"
          >
            {{ t('common.delete') }}
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- The status dialog with Nuxt UI's own parts. -->
    <UModal
      :open="isModalOpen"
      :title="statusDialogTitle"
      :ui="{ content: 'sm:max-w-lg' }"
      @update:open="(val: boolean) => !val && closeModal()"
    >
      <template #body>
        <form
          :id="statusFormId"
          class="space-y-4"
          @submit.prevent="handleSaveStatus"
        >
          <UFormField
            :label="t('admin.settings.workflow.nameLabel')"
            name="label"
            required
          >
            <UInput
              v-model="formLabel"
              :placeholder="t('admin.settings.workflow.namePlaceholder')"
              class="w-full"
              autofocus
            />
          </UFormField>

          <section aria-labelledby="workflow-citizen-label-heading">
            <h3
              id="workflow-citizen-label-heading"
              class="text-sm font-medium text-highlighted"
            >
              {{ t('admin.settings.workflow.citizenLabelTitle') }}
            </h3>
            <p class="mt-1 text-sm text-muted">
              {{ t('admin.settings.workflow.citizenLabelHelp') }}
            </p>
            <div class="mt-3 grid gap-4 sm:grid-cols-2">
              <UFormField
                :label="t('admin.settings.workflow.citizenLabelDe')"
                name="citizenLabelDe"
                :error="citizenLabelErrors.de ? t('errors.workflow.citizenLabelInvalid') : undefined"
              >
                <UInput
                  v-model="formCitizenLabelDe"
                  :placeholder="formLabel"
                  maxlength="120"
                  class="w-full"
                />
              </UFormField>
              <UFormField
                :label="t('admin.settings.workflow.citizenLabelEn')"
                name="citizenLabelEn"
                :error="citizenLabelErrors.en ? t('errors.workflow.citizenLabelInvalid') : undefined"
              >
                <UInput
                  v-model="formCitizenLabelEn"
                  :placeholder="formCitizenLabelDe || formLabel"
                  maxlength="120"
                  class="w-full"
                />
              </UFormField>
            </div>
          </section>

          <!-- One under the other; their sentences differ in length. -->
          <div class="space-y-4">
            <UFormField
              :label="t('admin.settings.workflow.slaDaysLabel')"
              :description="formIsTerminal ? t('admin.settings.workflow.terminalScheduleHelp') : t('admin.settings.workflow.slaDaysHelp')"
              name="slaDays"
            >
              <UInput
                v-model.number="formSlaDays"
                type="number"
                min="0"
                max="3650"
                class="w-32"
                :disabled="formIsTerminal"
              />
            </UFormField>
            <UFormField
              :label="t('admin.settings.workflow.escalationDaysLabel')"
              :description="formIsTerminal ? t('admin.settings.workflow.terminalScheduleHelp') : t('admin.settings.workflow.escalationDaysHelp')"
              name="escalationDays"
            >
              <UInput
                v-model.number="formEscalationDays"
                type="number"
                min="0"
                max="3650"
                class="w-32"
                :disabled="formIsTerminal"
              />
            </UFormField>
          </div>

          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField
              :label="t('admin.settings.workflow.colorLabel')"
              name="color"
            >
              <div class="flex items-center gap-3">
                <input
                  v-model="formColor"
                  type="color"
                  class="size-8 cursor-pointer rounded-md border border-default bg-transparent p-0.5"
                  :aria-label="t('admin.settings.workflow.colorPickerAria')"
                >
                <UInput
                  v-model="formColor"
                  placeholder="#6b7280"
                  class="w-full font-mono"
                />
              </div>
            </UFormField>
            <UFormField
              :label="t('admin.settings.workflow.iconLabel')"
              name="icon"
            >
              <USelect
                v-model="formIcon"
                :items="ICON_OPTIONS"
                value-key="value"
                class="w-full sm:w-72"
              >
                <template #leading>
                  <UIcon
                    :name="formIcon"
                    class="size-4"
                  />
                </template>
              </USelect>
            </UFormField>
          </div>

          <!-- "Weitere Angaben": the disclosure of the patterns. -->
          <div>
            <UButton
              color="neutral"
              variant="ghost"
              class="group -ms-2.5"
              icon="i-lucide-chevron-right"
              :ui="{ leadingIcon: 'transition-transform group-data-[state=open]:rotate-90' }"
              :data-state="moreFieldsOpen ? 'open' : 'closed'"
              :aria-expanded="moreFieldsOpen ? 'true' : 'false'"
              aria-controls="workflow-status-more-fields"
              data-test="workflow-status-more-toggle"
              @click="moreFieldsOpen = !moreFieldsOpen"
            >
              {{ t('admin.settings.workflow.moreFields') }}
            </UButton>
            <div
              v-show="moreFieldsOpen"
              id="workflow-status-more-fields"
              class="space-y-4 pt-3"
              data-test="workflow-status-more-fields"
            >
              <template v-if="editingStandard">
                <AccessReason
                  id="workflow-status-standard-locked"
                  :text="t('admin.settings.workflow.standardLocked')"
                />
                <dl data-test="workflow-status-standard-facts">
                  <div class="grid gap-1 py-2.5 first:pt-0 sm:grid-cols-3 sm:gap-4">
                    <dt class="text-sm text-muted">
                      {{ t('admin.settings.workflow.semanticFlagsLabel') }}
                    </dt>
                    <dd class="text-sm font-medium text-default sm:col-span-2">
                      {{ formSemanticFlags.map(semanticFlagLabel).join(', ') || '-' }}
                    </dd>
                  </div>
                  <div class="grid gap-1 border-t border-default py-2.5 sm:grid-cols-3 sm:gap-4">
                    <dt class="text-sm text-muted">
                      {{ t('admin.settings.workflow.terminal') }}
                    </dt>
                    <dd class="text-sm font-medium text-default sm:col-span-2">
                      {{ t(formIsTerminal ? 'common.yes' : 'common.no') }}
                    </dd>
                  </div>
                </dl>
              </template>
              <template v-else>
                <UCheckbox
                  v-model="formIsTerminal"
                  :label="t('admin.settings.workflow.terminalLabel')"
                />
                <UFormField
                  :label="t('admin.settings.workflow.semanticFlagsLabel')"
                  :description="t('admin.settings.workflow.semanticFlagsHelp')"
                  name="semanticFlags"
                >
                  <UCheckboxGroup
                    v-model="formSemanticFlags"
                    :items="SEMANTIC_FLAG_OPTIONS"
                  />
                </UFormField>
              </template>
              <div class="grid gap-4 sm:grid-cols-2">
                <UFormField
                  :label="t('admin.settings.workflow.weightLabel')"
                  name="weight"
                >
                  <UInput
                    v-model.number="formWeight"
                    type="number"
                    class="w-32"
                  />
                </UFormField>
                <UFormField
                  :label="t('admin.settings.workflow.machineNameLabel')"
                  name="machineName"
                  :required="isNewStatus"
                >
                  <UInput
                    v-model="formMachineName"
                    :placeholder="t('admin.settings.workflow.machineNamePlaceholder')"
                    class="w-full max-w-xl font-mono"
                    :disabled="!isNewStatus"
                    @update:model-value="machineNameTouched = true"
                  />
                </UFormField>
              </div>
            </div>
          </div>
        </form>
      </template>

      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            :disabled="saving"
            @click="closeModal"
          >
            {{ t('common.cancel') }}
          </UButton>
          <!-- Outside the form element, tied to it by `form`, so Enter in a field still saves. -->
          <UButton
            type="submit"
            :form="statusFormId"
            :loading="saving"
            :disabled="!formLabel.trim() || !formMachineName.trim() || citizenLabelErrors.de || citizenLabelErrors.en"
          >
            {{ isNewStatus ? t('common.create') : t('common.save') }}
          </UButton>
        </div>
      </template>
    </UModal>
  </AppPageLayout>
</template>
