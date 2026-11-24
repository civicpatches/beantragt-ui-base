<script setup lang="ts">
import { useId } from 'vue';
import type { AdminApplicationTransition } from '~/types';
import type { WorkflowAttributeDefinition } from '~/types/form';
import type { CaseTransferTrigger } from '~/types/case-transfers';
import { workflowStatusCitizenHint, type ResolvedStatus } from '~/utils/workflow-status';
import { applicantNoteNoticeKey, applicantStatusNotice, type ApplicantMailContext } from '~~/casework-layer/app/utils/applicant-notice';

type CurrentStatus = {
    status: string
    label?: string | null
    color?: string | null
    icon?: string | null
};

type StatusTransitionAction = AdminApplicationTransition & { status: ResolvedStatus, fromStatus?: ResolvedStatus | null, mailContext?: ApplicantMailContext };

type SelectItem = {
    label: string
    value: string
};
/** A target of the dialog: its status gives the radio option its second line (02c). */
type TargetItem = SelectItem & {
    status?: ResolvedStatus
    targetDescription?: string | null
};

const props = defineProps<{
    open: boolean
    referenceLabel: string
    currentStatus: CurrentStatus
    /** The chosen target; null until the person picks one (no preselection). */
    transition: StatusTransitionAction | null
    transitionAttributes: WorkflowAttributeDefinition[]
    transitionItems: TargetItem[]
    attributeValues: Record<string, unknown>
    showBoilerplateSelect: boolean
    boilerplateItems: SelectItem[]
    selectedBoilerplateId: string | null
    isLoadingBoilerplates: boolean
    note: string
    isSaving: boolean
    submitDisabled: boolean
    /** When the rule waits for a status: the target may start the transfer. */
    transferTrigger?: CaseTransferTrigger | null
    /** Whether this person may approve dispatch in this case. */
    canApproveDispatch?: boolean
    /** The note of a refused undo, shown read-only above the note field; never filled into it. */
    keptNote?: string | null
}>();

const emit = defineEmits<{
    (event: 'update:open', value: boolean): void
    (event: 'update:note' | 'select-transition' | 'apply-boilerplate', value: string): void
    (event: 'update-attribute', attribute: WorkflowAttributeDefinition, value: unknown): void
    (event: 'apply' | 'close'): void
}>();

const { t, locale } = useI18n();
const targetSelectId = `status-target-${useId()}`;
const body = ref<HTMLElement | null>(null);

/**
 * The control follows the number of targets: one target is a fact and chosen from the start,
 * two to four are radio options readable at once, five and more stay a select.
 */
const targetShape = computed<'fact' | 'radio' | 'select'>(() => props.transitionItems.length === 1
    ? 'fact'
    : props.transitionItems.length <= 4 ? 'radio' : 'select');
/** Second line of an option: what the applicant sees when it differs from the name, else the definition. */
function targetLine(item: TargetItem): string | undefined {
    const citizen = item.status ? workflowStatusCitizenHint(item.status, locale.value) : '';
    if (citizen) return t('admin.detail.citizenSees', { label: citizen });
    return item.targetDescription || undefined;
}
const radioItems = computed(() => props.transitionItems.map(item => ({ label: item.label, value: item.value, description: targetLine(item) })));
const soleTarget = computed(() => targetShape.value === 'fact' ? props.transitionItems[0] ?? null : null);
/** A press without a choice says what is missing at the control and moves the focus there. */
const targetError = ref('');
watch(() => props.transition?.targetStatusId, (value) => {
    if (value) targetError.value = '';
});
watch(() => props.open, (open) => {
    if (open) targetError.value = '';
});

/** The target status starts the transfer when the rule waits for its flag. */
const startsTransfer = computed(() => {
    const trigger = props.transferTrigger;
    return Boolean(trigger && trigger.mode === 'status' && trigger.pending && props.transition?.status.semanticFlags.includes(trigger.flag));
});
/** The backend policy determines whether the status plans or approves a transfer. */
const triggerConsequence = computed(() => props.transferTrigger?.blockedBy === 'integration.handover_approval_mode_required'
    ? props.transferTrigger.blockedBy
    : props.transferTrigger?.blockedBy
        ? 'admin.detail.statusTriggerAgentStopped'
        : props.transferTrigger?.dispatchMode === 'automatic'
            ? 'admin.detail.statusTriggerAutomatic'
            : props.canApproveDispatch && props.transferTrigger?.autoApprove !== false ? 'admin.detail.statusTriggerApproves' : 'admin.detail.statusTriggerAwaitsApproval');
const targetCitizenHint = computed(() => props.transition ? workflowStatusCitizenHint(props.transition.status, locale.value) : '');
/** What reaches the applicant: one line under the target, one under the note. */
const statusNotice = computed(() => applicantStatusNotice(props.transition?.fromStatus, props.transition?.status, locale.value, props.transition?.mailContext));
/** Precise when the citizen texts tell what changes; then it names the text and replaces the "Antragstellende sehen" line. */
const PRECISE_NOTICES = new Set(['admin.applicantNotice.statusChanged', 'admin.applicantNotice.statusChangedNoMailBatch', 'admin.applicantNotice.statusUnchanged']);
const statusNoticeIsPrecise = computed(() => PRECISE_NOTICES.has(statusNotice.value.key));
const statusMailHint = computed(() => statusNotice.value.params ? t(statusNotice.value.key, statusNotice.value.params) : t(statusNotice.value.key));
// No mail, no reason in a mail: the note line follows the status line.
const noteHint = computed(() => t(applicantNoteNoticeKey(props.transition?.status.semanticFlags ?? [], statusNotice.value)));

/** Focus starts on the choice: the first radio, the select, or with a single target the note field. */
function focusTarget() {
    const root = body.value;
    if (targetShape.value === 'radio') root?.querySelector<HTMLElement>('[role="radio"]')?.focus();
    else if (targetShape.value === 'fact') root?.querySelector<HTMLElement>('textarea')?.focus();
    else document.getElementById(targetSelectId)?.focus();
}
function focusTargetSelect(event: Event) {
    event.preventDefault();
    void nextTick(focusTarget);
}
function apply() {
    if (!props.transition) {
        targetError.value = t('admin.detail.targetStatusRequired');
        void nextTick(focusTarget);
        return;
    }
    emit('apply');
}

function emitString(event: 'select-transition' | 'apply-boilerplate', value: unknown) {
    if (typeof value === 'string') {
        emit(event, value);
        return;
    }
    if (value && typeof value === 'object' && 'value' in value) {
        const itemValue = (value as { value?: unknown }).value;
        if (typeof itemValue === 'string') {
            emit(event, itemValue);
        }
    }
}

function updateNote(value: unknown) {
    emit('update:note', String(value ?? ''));
}

function workflowAttributeInputType(datatype: WorkflowAttributeDefinition['datatype']): 'text' | 'number' | 'datetime-local' {
    if (datatype === 'number') return 'number';
    if (datatype === 'datetime') return 'datetime-local';
    return 'text';
}

function workflowAttributeOptions(attribute: WorkflowAttributeDefinition): SelectItem[] {
    return (attribute.values ?? []).map(option => ({
        label: option.name,
        value: option.key
    }));
}

function workflowAttributeFieldValue(
    attribute: WorkflowAttributeDefinition,
    values: Record<string, unknown>
): string | string[] {
    const value = values[attribute.code];
    if (attribute.datatype === 'multivaluelist' || attribute.datatype === 'imagelist') {
        return Array.isArray(value) ? value.map(String) : [];
    }
    return String(value ?? '');
}
</script>

<template>
  <UModal
    :open="open"
    :title="t('admin.detail.statusDialogTitle')"
    :description="t('admin.detail.statusDialogDescription', { ref: referenceLabel })"
    :content="{ onOpenAutoFocus: focusTargetSelect }"
    :dismissible="!isSaving"
    :close="!isSaving"
    @update:open="value => emit('update:open', value)"
  >
    <template #body>
      <div
        ref="body"
        class="space-y-5"
      >
        <div
          data-test="status-dialog-current"
          class="flex flex-wrap items-center gap-2 text-sm"
        >
          <span class="text-muted">{{ t('admin.detail.currentStatus') }}</span>
          <StatusBadge
            :status="currentStatus.status"
            :label="currentStatus.label ?? undefined"
            :color="currentStatus.color ?? undefined"
            :icon="currentStatus.icon ?? undefined"
            size="md"
          />
        </div>

        <!-- Target: the group, the fact or the select is named "Zielstatus" in every shape. -->
        <UFormField
          v-if="targetShape === 'radio'"
          :error="targetError || undefined"
          data-test="status-target"
        >
          <URadioGroup
            :model-value="transition?.targetStatusId"
            :legend="t('admin.detail.targetStatus')"
            orientation="vertical"
            :items="radioItems"
            value-key="value"
            @update:model-value="value => emitString('select-transition', value)"
          />
        </UFormField>
        <div
          v-else-if="targetShape === 'fact' && soleTarget"
          class="space-y-1"
          data-test="status-target"
        >
          <p class="text-sm font-medium text-default">
            {{ t('admin.detail.targetStatus') }}
          </p>
          <p class="text-sm">
            {{ soleTarget.label }}
          </p>
          <p
            v-if="targetLine(soleTarget)"
            class="text-sm text-muted"
          >
            {{ targetLine(soleTarget) }}
          </p>
        </div>
        <UFormField
          v-else
          :label="t('admin.detail.targetStatus')"
          :error="targetError || undefined"
          data-test="status-target"
        >
          <USelect
            :id="targetSelectId"
            :model-value="transition?.targetStatusId"
            :items="transitionItems"
            value-key="value"
            :placeholder="t('admin.detail.targetStatusPlaceholder')"
            class="w-full"
            @update:model-value="value => emitString('select-transition', value)"
          />
        </UFormField>

        <!-- What reaches the applicant depends on the target and on the application (batch origin): nothing is
             claimed before a choice. -->
        <template v-if="transition">
          <p
            v-if="targetShape !== 'select' && transition.condition"
            class="text-sm text-muted"
            data-test="status-transition-condition"
          >
            {{ transition.condition }}
          </p>
          <dl
            v-if="targetShape === 'select' && (transition.targetDescription || transition.condition)"
            class="space-y-2 text-sm"
          >
            <div v-if="transition.targetDescription">
              <dt class="font-medium">
                {{ t('admin.detail.statusDefinition') }}
              </dt>
              <dd class="text-muted">
                {{ transition.targetDescription }}
              </dd>
            </div>
            <div v-if="transition.condition">
              <dt class="font-medium">
                {{ t('admin.detail.transitionCondition') }}
              </dt>
              <dd class="text-muted">
                {{ transition.condition }}
              </dd>
            </div>
          </dl>

          <!-- Consequence: one muted block; a transfer that blocks or waits for a release is a warning. -->
          <div
            class="space-y-1 text-sm text-muted"
            data-test="status-consequence"
          >
            <p
              v-if="statusNoticeIsPrecise"
              data-test="target-citizen-hint"
              :data-notice="statusNotice.key"
            >
              {{ statusMailHint }}
            </p>
            <template v-else>
              <p
                v-if="targetCitizenHint"
                data-test="target-citizen-hint"
              >
                {{ t('admin.detail.citizenSees', { label: targetCitizenHint }) }}
              </p>
              <p data-test="status-mail-hint">
                {{ statusMailHint }}
              </p>
            </template>
            <p
              v-if="startsTransfer && !transferTrigger?.blockedBy"
              data-test="status-trigger-hint"
              class="flex items-start gap-1.5"
            >
              <UIcon
                name="i-lucide-forward"
                class="mt-0.5 size-4 shrink-0"
                aria-hidden="true"
              />
              <span>{{ t('admin.detail.statusTriggersTransfer') }} {{ t(triggerConsequence) }}</span>
            </p>
          </div>
          <UAlert
            v-if="startsTransfer && transferTrigger?.blockedBy"
            role="status"
            data-test="status-trigger-hint"
            color="warning"
            icon="i-lucide-triangle-alert"
            :title="t(triggerConsequence)"
          />

          <section
            v-if="transitionAttributes.length > 0"
            data-test="status-transition-attributes"
            class="space-y-4"
          >
            <h3 class="text-sm font-semibold">
              {{ t('admin.detail.transitionAttributes') }}
            </h3>
            <UFormField
              v-for="attribute in transitionAttributes"
              :key="attribute.code"
              :label="attribute.description"
              :required="attribute.required"
              :help="attribute.datatype_description"
            >
              <UTextarea
                v-if="attribute.datatype === 'text'"
                :model-value="String(attributeValues[attribute.code] ?? '')"
                :rows="3"
                class="w-full"
                @update:model-value="value => emit('update-attribute', attribute, value)"
              />
              <USelect
                v-else-if="attribute.datatype === 'singlevaluelist'"
                :model-value="String(attributeValues[attribute.code] ?? '')"
                :items="workflowAttributeOptions(attribute)"
                value-key="value"
                class="w-full"
                @update:model-value="value => emit('update-attribute', attribute, value)"
              />
              <UCheckboxGroup
                v-else-if="attribute.datatype === 'multivaluelist'"
                :model-value="workflowAttributeFieldValue(attribute, attributeValues) as string[]"
                :items="workflowAttributeOptions(attribute)"
                @update:model-value="value => emit('update-attribute', attribute, value)"
              />
              <UTextarea
                v-else-if="attribute.datatype === 'imagelist'"
                :model-value="String(attributeValues[attribute.code] ?? '')"
                :rows="2"
                class="w-full"
                :placeholder="t('admin.detail.imagelistPlaceholder')"
                @update:model-value="value => emit('update-attribute', attribute, value ? [value] : [])"
              />
              <UInput
                v-else
                :model-value="workflowAttributeFieldValue(attribute, attributeValues) as string"
                :type="workflowAttributeInputType(attribute.datatype)"
                class="w-full"
                @update:model-value="value => emit('update-attribute', attribute, value)"
              />
            </UFormField>
          </section>

          <UFormField
            v-if="showBoilerplateSelect"
            :label="t('admin.detail.statusBoilerplate')"
          >
            <USelect
              :model-value="selectedBoilerplateId ?? undefined"
              :items="boilerplateItems"
              value-key="value"
              :placeholder="t('admin.detail.statusBoilerplatePlaceholder')"
              :loading="isLoadingBoilerplates"
              :aria-label="t('admin.detail.statusBoilerplate')"
              class="w-full"
              @update:model-value="value => emitString('apply-boilerplate', value)"
            />
          </UFormField>

          <!-- The note of a refused undo: text to read or copy, never in the field. -->
          <p
            v-if="keptNote"
            class="select-text whitespace-pre-line break-words text-sm text-muted"
            data-test="rollback-kept-note"
          >
            {{ t('admin.detail.rollbackKeptNoteDialog') }} {{ keptNote }}
          </p>

          <!-- Note: "optional" beside the label, what happens to it above the field. -->
          <UFormField
            :label="t('admin.detail.statusNote')"
            :hint="t('admin.detail.statusNoteOptional')"
          >
            <template #description>
              <span data-test="status-note-hint">{{ noteHint }}</span>
            </template>
            <UTextarea
              :model-value="note"
              :rows="3"
              autoresize
              :maxrows="8"
              :maxlength="2000"
              class="w-full"
              @update:model-value="updateNote"
            />
          </UFormField>
        </template>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <UButton
          color="neutral"
          variant="ghost"
          :disabled="isSaving"
          @click="emit('close')"
        >
          {{ t('common.cancel') }}
        </UButton>
        <!-- Not disabled for a missing choice: the press says what is missing. -->
        <UButton
          :loading="isSaving"
          :disabled="isSaving || (!!transition && submitDisabled)"
          data-test="status-apply"
          @click="apply"
        >
          {{ t('admin.detail.applyStatusTransition') }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
