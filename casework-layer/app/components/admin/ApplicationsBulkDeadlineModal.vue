<script setup lang="ts">
import type { ApplicationRow } from '~/types';
import { localDateKey } from '../../utils/local-date-key';

/**
 * "Frist setzen" for the selection of the application list.
 *
 * Writes go one after another through the same route the deadline card uses
 * (`PATCH /api/admin/applications/:id/deadline`), each with its own
 * concurrency token. A conflict or any other failure counts for that row
 * only; the dialog then stays open and lists the failed references with
 * their reason. The table keeps the failed rows selected and reloads once.
 */
const props = defineProps<{
    open: boolean
    /** Snapshot of the selected rows, taken when the dialog opened. */
    rows: ApplicationRow[]
}>();

const emit = defineEmits<{
    'update:open': [value: boolean]
    /** True while the writes run; the selection bar stays locked meanwhile. */
    'busy': [value: boolean]
    /** Once per run, after the last write: the rows that kept their old deadline. */
    'finished': [failedIds: string[]]
    /** The dialog closed; the table puts the focus back. */
    'closed': []
}>();

const { t } = useI18n();
const toast = useToast();
const { withWorkspaceQuery } = useWorkspaceContext();
const { resolveApiErrorMessage } = useApiErrorMessage();

const dateInputId = 'applications-bulk-deadline-date';
const cancelId = 'applications-bulk-deadline-cancel';
const missingDateId = 'applications-bulk-deadline-missing';
const closeId = 'applications-bulk-deadline-close';

type Mode = 'set' | 'clear';
interface Failure { id: string, reference: string, reason: string }

const mode = ref<Mode>('set');
const date = ref('');
/** A past date waits for one confirmation (decision, as in the deadline card). */
const pastPending = ref(false);
const running = ref(false);
const done = ref(0);
const runTotal = ref(0);
const result = ref<{ applied: number, total: number, failures: Failure[] } | null>(null);
const announcement = ref('');

/** Same day key as the deadline card: the browser's calendar day, read at save time. */
function referenceOf(row: ApplicationRow): string {
    return row.referenceNumber || row.id.slice(0, 8);
}

const count = computed(() => props.rows.length);
/** "Frist löschen" is a choice only while a selected application has a deadline (the card disables it otherwise). */
const canClear = computed(() => props.rows.some(row => Boolean(row.dueDate)));
const nextDueDate = computed<string | null>(() => mode.value === 'clear' ? null : (date.value || null));

/** Rows that change. Without a chosen date every row is still a candidate. */
const targetRows = computed(() => {
    if (mode.value === 'clear') return props.rows.filter(row => Boolean(row.dueDate));
    if (!date.value) return props.rows;
    return props.rows.filter(row => (row.dueDate || null) !== date.value);
});
const replaceCount = computed(() => mode.value === 'set'
    ? targetRows.value.filter(row => Boolean(row.dueDate)).length
    : 0);
const unchangedCount = computed(() => count.value - targetRows.value.length);
const missingDate = computed(() => mode.value === 'set' && !date.value);
const canApply = computed(() => !running.value && !missingDate.value && targetRows.value.length > 0);

const modeItems = computed(() => [
    { label: t('admin.table.bulkDeadlineModeSet'), value: 'set' },
    { label: t('admin.detail.clearDueDate'), value: 'clear' }
]);
const title = computed(() => t('admin.table.bulkDeadlineTitle', { count: count.value }, count.value));
const applyLabel = computed(() => mode.value === 'clear' ? t('admin.detail.clearDueDate') : t('admin.table.bulkSetDeadline'));
const pastActions = computed(() => [
    { label: t('admin.detail.dueDatePastConfirm'), color: 'warning' as const, variant: 'solid' as const, onClick: (): void => {
        void run(true);
    } },
    { label: t('admin.detail.dueDatePastChange'), color: 'neutral' as const, variant: 'ghost' as const, onClick: changeDate }
]);

// A new date or a new choice is a new question.
watch([date, mode], () => {
    pastPending.value = false;
}, { flush: 'sync' });

watch(() => props.open, (open) => {
    if (!open) return;
    mode.value = 'set';
    date.value = '';
    pastPending.value = false;
    done.value = 0;
    runTotal.value = 0;
    result.value = null;
    announcement.value = '';
});

function focusDateInput() {
    void nextTick(() => document.getElementById(dateInputId)?.focus());
}

function changeDate() {
    pastPending.value = false;
    focusDateInput();
}

/** The dialog opens on the date field, the one thing to fill in. */
function onOpenAutoFocus(event: Event) {
    event.preventDefault();
    focusDateInput();
}

function onCloseAutoFocus(event: Event) {
    event.preventDefault();
    emit('closed');
}

function requestClose() {
    // While the writes run the dialog cannot be closed; afterwards it is safe.
    if (running.value) return;
    emit('update:open', false);
}

async function writeDeadline(row: ApplicationRow, dueDate: string | null, query: Record<string, unknown>): Promise<string | null> {
    if (!row.changed) return t('errors.admin.deadlineConflict');
    try {
        await $fetch(`/api/admin/applications/${row.id}/deadline`, {
            method: 'PATCH',
            query,
            body: { dueDate, expectedChanged: row.changed }
        });
        return null;
    } catch (error) {
        console.error('[admin] bulk deadline update failed', error);
        // A 409 or 428 resolves to "errors.admin.deadlineConflict", as on the card.
        return resolveApiErrorMessage(error, 'admin.detail.dueDateSaveError');
    }
}

async function run(confirmedPast = false) {
    // A second click, a late click while closing, or a click after the result starts nothing.
    if (!props.open || running.value || result.value || !canApply.value) return;
    const dueDate = nextDueDate.value;
    if (dueDate && dueDate < localDateKey(new Date()) && !confirmedPast) {
        pastPending.value = true;
        return;
    }
    pastPending.value = false;

    const targets = [...targetRows.value];
    const query = { ...withWorkspaceQuery() };
    running.value = true;
    emit('busy', true);
    done.value = 0;
    runTotal.value = targets.length;

    const failures: Failure[] = [];
    for (const row of targets) {
        const reason = await writeDeadline(row, dueDate, query);
        if (reason) failures.push({ id: row.id, reference: referenceOf(row), reason });
        done.value++;
    }
    const applied = targets.length - failures.length;

    running.value = false;
    emit('busy', false);
    emit('finished', failures.map(failure => failure.id));

    if (failures.length === 0) {
        toast.add({
            title: t(dueDate ? 'admin.table.bulkDeadlineSetDone' : 'admin.table.bulkDeadlineClearDone', { count: applied }, applied),
            color: 'success'
        });
        emit('update:open', false);
        return;
    }

    result.value = { applied, total: targets.length, failures };
    announcement.value = [
        t('admin.table.bulkDeadlineResult', { applied, total: targets.length }),
        t('admin.table.bulkDeadlineFailedStay', { count: failures.length }, failures.length)
    ].join(' ');
    // The focused button left with the form; "Schließen" is the one control of the result.
    void nextTick(() => document.getElementById(closeId)?.focus());
}
</script>

<template>
  <UModal
    :open="open"
    :title="title"
    :description="t('admin.table.bulkDeadlineDescription')"
    :close="!running"
    :dismissible="!running"
    :content="{ onOpenAutoFocus, onCloseAutoFocus }"
    @update:open="(value: boolean) => !value && requestClose()"
  >
    <template #body>
      <div
        data-test="bulk-deadline-modal"
        class="space-y-4 text-sm"
      >
        <template v-if="!result">
          <URadioGroup
            v-if="canClear"
            v-model="mode"
            :items="modeItems"
            value-key="value"
            :legend="t('admin.table.bulkDeadlineChoice')"
            :disabled="running"
            data-test="bulk-deadline-mode"
          />
          <UFormField
            v-if="mode === 'set'"
            :label="t('admin.detail.dueDate')"
          >
            <UInput
              :id="dateInputId"
              v-model="date"
              name="applications-bulk-deadline-date"
              type="date"
              :aria-label="t('admin.detail.dueDate')"
              :disabled="running"
              data-test="bulk-deadline-date"
            />
          </UFormField>
          <p
            v-if="replaceCount > 0"
            data-test="bulk-deadline-replaces"
          >
            {{ t('admin.table.bulkDeadlineReplaces', { count: replaceCount }, replaceCount) }}
          </p>
          <p
            v-if="mode === 'clear'"
            data-test="bulk-deadline-clears"
          >
            {{ t('admin.table.bulkDeadlineClears', { count: targetRows.length }, targetRows.length) }}
          </p>
          <p
            v-if="unchangedCount > 0"
            data-test="bulk-deadline-unchanged"
            class="text-(--ui-text-muted)"
          >
            {{ t('admin.table.bulkStatusConfirmUnchanged', { count: unchangedCount }, unchangedCount) }}
          </p>
          <UAlert
            v-if="pastPending"
            role="status"
            color="warning"
            icon="i-lucide-triangle-alert"
            :title="t('admin.detail.dueDatePastTitle')"
            :description="t('admin.table.bulkDeadlinePastDescription', { count: targetRows.length }, targetRows.length)"
            :actions="pastActions"
            data-test="bulk-deadline-past"
          />
          <div
            v-if="running"
            data-test="bulk-deadline-progress"
            class="space-y-1"
          >
            <UProgress
              :model-value="done"
              :max="runTotal"
              size="sm"
              :aria-label="t('admin.table.bulkDeadlineProgress', { done, total: runTotal })"
            />
            <p class="text-(--ui-text-muted)">
              {{ t('admin.table.bulkDeadlineProgress', { done, total: runTotal }) }}
            </p>
          </div>
        </template>

        <div
          v-else
          data-test="bulk-deadline-result"
          class="space-y-2"
        >
          <p class="font-medium">
            {{ t('admin.table.bulkDeadlineResult', { applied: result.applied, total: result.total }) }}
          </p>
          <ul class="space-y-1">
            <li
              v-for="failure in result.failures"
              :key="failure.id"
              data-test="bulk-deadline-failure"
            >
              <span class="font-mono">{{ failure.reference }}</span>: {{ failure.reason }}
            </li>
          </ul>
          <p class="text-(--ui-text-muted)">
            {{ t('admin.table.bulkDeadlineFailedStay', { count: result.failures.length }, result.failures.length) }}
          </p>
        </div>

        <p
          class="sr-only"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          data-test="bulk-deadline-announcement"
        >
          {{ announcement }}
        </p>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <template v-if="!result">
          <UButton
            :id="cancelId"
            color="neutral"
            variant="ghost"
            data-test="bulk-deadline-cancel"
            :disabled="running"
            @click="requestClose"
          >
            {{ t('common.cancel') }}
          </UButton>
          <UButton
            icon="i-lucide-calendar-check"
            data-test="bulk-deadline-apply"
            :loading="running"
            :disabled="!canApply"
            :aria-describedby="missingDate ? missingDateId : undefined"
            @click="run()"
          >
            {{ applyLabel }}
          </UButton>
          <span
            v-if="missingDate"
            :id="missingDateId"
            class="sr-only"
          >{{ t('admin.table.bulkDeadlineDateMissing') }}</span>
        </template>
        <UButton
          v-else
          :id="closeId"
          color="neutral"
          variant="outline"
          data-test="bulk-deadline-close"
          @click="requestClose"
        >
          {{ t('common.close') }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
