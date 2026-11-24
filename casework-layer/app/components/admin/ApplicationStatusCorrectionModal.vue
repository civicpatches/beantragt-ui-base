<script setup lang="ts">
import type { ResolvedStatus } from '~/utils/workflow-status';

/**
 * "Status setzen": sets a valid status for an application whose
 * status left the form's published workflow. A repair, not a decision: the
 * targets never include approval or rejection statuses, no transfer starts
 * and the note stays internal.
 */
type CurrentStatus = {
    status: string
    label?: string | null
    color?: string | null
    icon?: string | null
};

const props = defineProps<{
    open: boolean
    note: string
    currentStatus: CurrentStatus
    targets: ResolvedStatus[]
    selectedTargetId: string | null
    isSaving: boolean
    /** The note of a refused undo, shown read-only above the note field; never filled into it. */
    keptNote?: string | null
}>();

const emit = defineEmits<{
    (event: 'update:open', value: boolean): void
    (event: 'update:note' | 'select-target', value: string): void
    (event: 'apply' | 'close'): void
}>();

const { t } = useI18n();

const selectedTarget = computed(() =>
    props.targets.find(target => target.id === props.selectedTargetId) ?? null
);
const targetItems = computed(() => props.targets.map(target => ({ label: target.label, value: target.id })));
// A select needs a real choice; a single target is shown as plain text.
const hasTargetChoice = computed(() => props.targets.length > 1);

function updateOpen(value: boolean) {
    emit('update:open', value);
}

function updateNote(value: unknown) {
    emit('update:note', typeof value === 'string' ? value : String(value ?? ''));
}

function selectTarget(value: unknown) {
    if (typeof value === 'string') emit('select-target', value);
}
</script>

<template>
  <UModal
    :open="open"
    :title="t('admin.detail.statusReviewDialogTitle')"
    :description="t('admin.detail.statusReviewDecisionHint')"
    :close="!isSaving"
    @update:open="updateOpen"
  >
    <template #body>
      <div data-test="status-correction-dialog">
        <div class="space-y-5">
          <div class="flex flex-col gap-3 rounded-lg border border-(--ui-border) bg-(--ui-bg-muted) p-3 sm:flex-row sm:items-center sm:justify-between">
            <div class="min-w-0">
              <p class="mb-1 text-xs font-medium uppercase text-(--ui-text-muted)">
                {{ t('admin.detail.currentStatus') }}
              </p>
              <StatusBadge
                :status="currentStatus.status"
                :label="currentStatus.label ?? undefined"
                :color="currentStatus.color ?? undefined"
                :icon="currentStatus.icon ?? undefined"
                size="md"
              />
            </div>
            <UIcon
              name="i-lucide-arrow-right"
              class="hidden size-4 shrink-0 text-(--ui-text-muted) sm:block"
            />
            <div class="min-w-0">
              <p class="mb-1 text-xs font-medium uppercase text-(--ui-text-muted)">
                {{ t('admin.detail.statusReviewTargetLabel') }}
              </p>
              <StatusBadge
                v-if="selectedTarget"
                data-test="status-correction-target"
                :status="selectedTarget.machineName"
                :label="selectedTarget.label"
                :color="selectedTarget.color"
                :icon="selectedTarget.icon"
                size="md"
              />
            </div>
          </div>

          <UFormField
            v-if="hasTargetChoice"
            :label="t('admin.detail.statusReviewTargetLabel')"
          >
            <USelect
              :model-value="selectedTargetId ?? undefined"
              :items="targetItems"
              :placeholder="t('admin.detail.statusReviewTargetPlaceholder')"
              value-key="value"
              class="w-full"
              data-test="status-correction-target-select"
              @update:model-value="selectTarget"
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

          <UFormField :label="t('admin.detail.statusReviewNoteLabel')">
            <UTextarea
              :model-value="note"
              :rows="2"
              :maxlength="2000"
              class="w-full"
              @update:model-value="updateNote"
            />
          </UFormField>

          <UAlert
            icon="i-lucide-info"
          >
            <template #description>
              <p data-test="status-correction-transfer-hint">
                {{ t('admin.detail.statusReviewNoTransferHint') }}
              </p>
              <p class="mt-1">
                {{ t('admin.detail.statusReviewMailHint') }}
              </p>
            </template>
          </UAlert>
        </div>
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
        <UButton
          icon="i-lucide-check"
          data-test="status-correction-apply"
          :loading="isSaving"
          :disabled="!selectedTarget || isSaving"
          @click="emit('apply')"
        >
          {{ t('admin.detail.statusReviewAction') }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
