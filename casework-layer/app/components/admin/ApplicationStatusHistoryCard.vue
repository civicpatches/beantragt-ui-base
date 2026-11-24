<script setup lang="ts">
import type { AdminApplicationRollbackRevision, AdminApplicationRollbackStatus } from '~/types';
import AppCard from '~/components/app/Card.vue';
import { formatDateTime, formatValue, type BooleanLabels } from '~/composables/useFormatters';

type CurrentStatus = {
    id: string
    referenceNumber?: string
    status: string
    label?: string | null
    color?: string | null
    icon?: string | null
    /** Text applicants see instead of the internal label, when it differs. */
    citizenHint?: string | null
};

const props = defineProps<{
    currentStatus: CurrentStatus
    rollbackStatus: AdminApplicationRollbackStatus | null
    rollbackRevision: AdminApplicationRollbackRevision | null
    statusActionBusy: boolean
    isRollingBack: boolean
    /**
     * Why "Rückgängig" is not possible (the previous status is outside the
     * workflow that governs the form); said in place of the
     * action, never offered as an action that fails.
     */
    rollbackRefusal?: string | null
    /** The note of a refused undo, when the sentence has no way on to carry it to. */
    rollbackKeptNote?: string | null
    /** Values recorded with status changes. */
    workflowAttributes?: Record<string, unknown>
    workflowAttributeLabel?: (key: string) => string
    booleanLabels?: BooleanLabels
}>();

const emit = defineEmits<{
    (event: 'rollback'): void
}>();

const { t, locale } = useI18n();

const attributeEntries = computed(() => Object.entries(props.workflowAttributes ?? {}));

const currentStatusReference = computed(() =>
    props.currentStatus.referenceNumber || props.currentStatus.id.slice(0, 8)
);

const rollbackRevisionCreated = computed(() => {
    const created = props.rollbackRevision?.created;
    return created ? formatDateTime(new Date(created * 1000).toISOString(), locale?.value) : '-';
});

const rollbackRevisionAuthor = computed(() => {
    const name = props.rollbackRevision?.authorName?.trim();
    if (name) return name;
    return props.rollbackRevision?.authorSystem ? t('admin.detail.statusChangedBySystem') : '';
});

function isWorkflowStatusHexColor(color?: string | null): color is `#${string}` {
    return typeof color === 'string' && /^#([0-9a-fA-F]{6})$/.test(color);
}

/** The small dot of a status name: the tenant's colour, or none when the colour is not a plain hex value. */
function statusDotStyle(color?: string | null): Record<string, string> | undefined {
    return isWorkflowStatusHexColor(color) ? { backgroundColor: color } : undefined;
}
</script>

<template>
  <!-- The last change as one line, date and person as a second, no box in the card. -->
  <AppCard
    :title="t('admin.detail.statusHistoryTitle')"
    icon="i-lucide-history"
  >
    <template v-if="rollbackStatus">
      <div data-testid="status-history-change">
        <p class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-highlighted">
          <span class="sr-only">{{ t('admin.detail.latestStatusChange') }}:</span>
          <span class="inline-flex min-w-0 items-center gap-1.5">
            <span
              v-if="statusDotStyle(rollbackStatus.color)"
              class="size-2 shrink-0 rounded-full"
              :style="statusDotStyle(rollbackStatus.color)"
              aria-hidden="true"
            />
            <span class="sr-only">{{ t('admin.detail.statusChangeFrom') }}</span>
            <span class="break-words">{{ rollbackStatus.label }}</span>
          </span>
          <UIcon
            name="i-lucide-arrow-right"
            class="size-4 shrink-0 text-muted"
            aria-hidden="true"
          />
          <span class="inline-flex min-w-0 items-center gap-1.5">
            <span
              v-if="statusDotStyle(currentStatus.color)"
              class="size-2 shrink-0 rounded-full"
              :style="statusDotStyle(currentStatus.color)"
              aria-hidden="true"
            />
            <span class="sr-only">{{ t('admin.detail.statusChangeTo') }}</span>
            <span class="break-words">{{ currentStatus.label }}</span>
          </span>
        </p>
        <p
          v-if="rollbackRevision"
          class="mt-1 text-sm text-muted"
          data-testid="status-history-when-who"
        >
          <span class="sr-only">{{ t('admin.detail.statusChangedAt') }} </span>
          {{ rollbackRevisionCreated }}<template v-if="rollbackRevisionAuthor">
            · <span class="sr-only">{{ t('admin.detail.statusChangedBy') }} </span>{{ rollbackRevisionAuthor }}
          </template>
        </p>
        <p
          v-if="currentStatus.citizenHint"
          data-test="status-citizen-hint"
          class="mt-1 text-sm text-muted"
        >
          {{ t('admin.detail.citizenSees', { label: currentStatus.citizenHint }) }}
        </p>
      </div>
      <AccessReason
        v-if="rollbackRefusal"
        id="status-rollback-refusal"
        :text="rollbackRefusal"
        data-testid="status-rollback-refusal"
      >
        <span
          v-if="rollbackKeptNote"
          class="mt-1 block select-text whitespace-pre-line break-words"
          data-testid="status-rollback-kept-note"
        >
          {{ t('admin.detail.rollbackKeptNote') }} {{ rollbackKeptNote }}
        </span>
      </AccessReason>
      <div v-else>
        <UButton
          color="neutral"
          variant="outline"
          :loading="isRollingBack"
          :disabled="statusActionBusy"
          :label="t('admin.detail.rollbackStatusShort')"
          :aria-label="t('admin.detail.rollbackStatusFor', {
            ref: currentStatusReference,
            status: rollbackStatus.label || '',
          })"
          data-testid="status-rollback"
          @click="emit('rollback')"
        />
      </div>
    </template>
    <p
      v-else
      class="max-w-prose text-sm text-muted"
      data-testid="status-history-empty"
    >
      {{ t('admin.detail.noStatusHistory') }}
    </p>

    <!-- Facts list, stacked: the side column is too narrow for label and value side by side. -->
    <div
      v-if="attributeEntries.length > 0"
      class="border-t border-default pt-4"
      data-testid="status-workflow-attributes"
    >
      <h3 class="text-sm font-semibold text-highlighted">
        {{ t('admin.detail.workflowAttributes') }}
      </h3>
      <dl class="mt-1">
        <div
          v-for="([key, value], position) in attributeEntries"
          :key="key"
          class="grid min-w-0 gap-1 py-2.5"
          :class="position > 0 ? 'border-t border-default' : undefined"
        >
          <dt class="break-normal text-sm text-muted">
            {{ workflowAttributeLabel ? workflowAttributeLabel(key) : key }}
          </dt>
          <dd class="break-words text-sm font-medium text-default">
            {{ formatValue(value, booleanLabels) || '-' }}
          </dd>
        </div>
      </dl>
    </div>
  </AppCard>
</template>
