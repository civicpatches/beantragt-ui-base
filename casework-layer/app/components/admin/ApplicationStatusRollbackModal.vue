<script setup lang="ts">
import type { AdminApplicationRollbackStatus } from '~/types';

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
    rollbackStatus: AdminApplicationRollbackStatus | null
    isRollingBack: boolean
}>();

const emit = defineEmits<{
    (event: 'update:open', value: boolean): void
    (event: 'update:note', value: string): void
    (event: 'apply' | 'close'): void
}>();

const { t } = useI18n();

const rollbackTargetLabel = computed(() => props.rollbackStatus?.label ?? '');

const modalDescription = computed(() =>
    rollbackTargetLabel.value
        ? t('admin.detail.statusRollbackDescriptionFor', { status: rollbackTargetLabel.value })
        : t('admin.detail.statusRollbackDescription')
);

const applyLabel = computed(() =>
    rollbackTargetLabel.value
        ? t('admin.detail.applyStatusRollbackTo', { status: rollbackTargetLabel.value })
        : t('admin.detail.applyStatusRollback')
);

function updateOpen(value: boolean) {
    emit('update:open', value);
}

function updateNote(value: unknown) {
    emit('update:note', typeof value === 'string' ? value : String(value ?? ''));
}
</script>

<template>
  <UModal
    :open="open"
    :title="t('admin.detail.statusRollbackTitle')"
    :description="modalDescription"
    :close="!isRollingBack"
    @update:open="updateOpen"
  >
    <template #body>
      <div
        v-if="rollbackStatus"
        class="space-y-5"
      >
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
              {{ t('admin.detail.previousStatus') }}
            </p>
            <StatusBadge
              :status="rollbackStatus.machineName || 'previous'"
              :label="rollbackStatus.label"
              :color="rollbackStatus.color"
              :icon="rollbackStatus.icon"
              size="md"
            />
          </div>
        </div>

        <UAlert
          icon="i-lucide-info"
          :title="t('admin.detail.statusRollbackRevisionNotice')"
        />

        <UFormField :label="t('admin.detail.statusNote')">
          <UTextarea
            :model-value="note"
            :rows="2"
            :maxlength="2000"
            class="w-full"
            :placeholder="t('admin.detail.statusRollbackNotePlaceholder')"
            @update:model-value="updateNote"
          />
        </UFormField>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <UButton
          color="neutral"
          variant="ghost"
          :disabled="isRollingBack"
          @click="emit('close')"
        >
          {{ t('common.cancel') }}
        </UButton>
        <UButton
          icon="i-lucide-undo-2"
          :loading="isRollingBack"
          :disabled="!rollbackStatus || isRollingBack"
          @click="emit('apply')"
        >
          {{ applyLabel }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
