<script setup lang="ts">
import { formatIsoDate } from '~/composables/useFormatters';
import AppCard from '~/components/app/Card.vue';

const props = defineProps<{
    dueDate: string
    modelValue: string
    isOverdue: boolean
    changed: boolean
    isSaving: boolean
    readOnly?: boolean
    /** The typed date lies in the past: ask once before saving. */
    pastPending?: boolean
    /** Saving met a newer version of the case: offer "Neu laden". */
    conflict?: boolean
}>();

const emit = defineEmits<{
    (event: 'update:modelValue', value: string): void
    (event: 'save' | 'clear' | 'confirm-past' | 'cancel-past' | 'reload'): void
}>();

const { t, locale } = useI18n();
const inputId = 'application-due-date';

/**
 * A deadline is overdue from the day after it (`isOverdue` compares with today). The day is built from the
 * date parts of the stored `YYYY-MM-DD`, never through a time zone, so the shown day cannot shift.
 */
function dayText(isoDate: string, addDays = 0): string {
    return formatIsoDate(isoDate, locale?.value, addDays) ?? '';
}
const overdueSince = computed(() => dayText(props.dueDate, 1));
/**
 * The field holds another date than the stored one (typed, or kept after "Neu laden" of a conflict): the
 * stored deadline stays readable in one muted line. With one date the card shows it once.
 */
const storedDateText = computed(() => props.changed && props.dueDate ? dayText(props.dueDate) : '');

// "Frist löschen" goes away with the stored deadline: focus moves to the date field, not to the page start.
const clearRequested = ref(false);
function clear() {
    clearRequested.value = true;
    emit('clear');
}
watch(() => props.dueDate, (now) => {
    if (clearRequested.value && !now) focusDateInput();
    if (!now || !props.isSaving) clearRequested.value = false;
});

function updateModelValue(value: unknown) {
    emit('update:modelValue', typeof value === 'string' ? value : '');
}

function focusDateInput() {
    if (typeof document === 'undefined') return;
    nextTick(() => document.getElementById(inputId)?.focus());
}

function changeDate() {
    emit('cancel-past');
    focusDateInput();
}

// After "Neu laden" the alert and its button go away; focus returns to the field that kept the date.
const reloadRequested = ref(false);
function reload() {
    reloadRequested.value = true;
    emit('reload');
}
watch(() => props.conflict, (now) => {
    if (!now && reloadRequested.value) {
        reloadRequested.value = false;
        focusDateInput();
    }
});

// "Trotzdem speichern" removes the question with its button: once saving ends, focus goes back to the date field.
const confirmRequested = ref(false);
function confirmPast() {
    confirmRequested.value = true;
    emit('confirm-past');
}
watch(() => props.isSaving, (saving) => {
    if (!saving && confirmRequested.value) {
        confirmRequested.value = false;
        focusDateInput();
    }
});

const pastActions = computed(() => [
    { label: t('admin.detail.dueDatePastConfirm'), color: 'warning' as const, variant: 'solid' as const, onClick: confirmPast },
    { label: t('admin.detail.dueDatePastChange'), color: 'neutral' as const, variant: 'ghost' as const, onClick: changeDate }
]);
const conflictActions = computed(() => [
    { label: t('admin.detail.dueDateReload'), color: 'neutral' as const, variant: 'outline' as const, onClick: reload }
]);
</script>

<template>
  <!-- The stored date is read in the field, once; two quiet buttons of natural width. -->
  <AppCard
    :title="t('admin.detail.deadlineTitle')"
    icon="i-lucide-calendar-clock"
  >
    <!-- No visible label: the card heading already says "Frist"; the input keeps its name. -->
    <p v-if="readOnly">
      {{ dayText(dueDate) || '-' }}
    </p>
    <UFormField v-else>
      <UInput
        :id="inputId"
        :model-value="props.modelValue"
        name="application-due-date"
        type="date"
        class="w-40"
        :aria-label="t('admin.detail.dueDate')"
        :disabled="isSaving"
        @update:model-value="updateModelValue"
      />
    </UFormField>
    <p
      v-if="dueDate && isOverdue"
      class="flex items-center gap-1.5 text-sm text-error"
      data-testid="due-date-overdue"
    >
      <UIcon
        name="i-lucide-alert-triangle"
        class="size-4 shrink-0"
        aria-hidden="true"
      />
      {{ overdueSince ? t('admin.detail.deadlineOverdueSince', { date: overdueSince }) : t('admin.detail.deadlineOverdue') }}
    </p>
    <p
      v-if="!readOnly && storedDateText"
      class="text-sm text-muted"
      data-testid="due-date-stored"
    >
      {{ t('admin.detail.dueDateStored', { date: storedDateText }) }}
    </p>
    <div
      v-if="!readOnly"
      class="flex flex-wrap gap-2"
    >
      <UButton
        color="neutral"
        variant="outline"
        :loading="isSaving"
        :disabled="!changed || isSaving"
        @click="emit('save')"
      >
        {{ t('admin.detail.saveDueDate') }}
      </UButton>
      <UButton
        v-if="dueDate"
        color="neutral"
        variant="outline"
        :disabled="isSaving"
        @click="clear"
      >
        {{ t('admin.detail.clearDueDate') }}
      </UButton>
    </div>
    <UAlert
      v-if="!readOnly && pastPending"
      role="status"
      color="warning"
      icon="i-lucide-triangle-alert"
      :title="t('admin.detail.dueDatePastTitle')"
      :description="t('admin.detail.dueDatePastDescription')"
      :actions="pastActions"
      data-testid="due-date-past-question"
    />
    <UAlert
      v-if="!readOnly && conflict"
      role="status"
      color="warning"
      icon="i-lucide-triangle-alert"
      :title="t('admin.detail.dueDateConflictTitle')"
      :description="t('admin.detail.dueDateConflictKeeps')"
      :actions="conflictActions"
      data-testid="due-date-conflict"
    />
  </AppCard>
</template>
