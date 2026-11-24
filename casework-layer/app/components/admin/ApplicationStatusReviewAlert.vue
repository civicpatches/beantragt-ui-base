<script setup lang="ts">
import type { AdminApplicationWorkflowReview } from '~/types';

/**
 * Warning in the status area of the detail page: the current
 * status is no longer part of the form's published workflow. The system does
 * not move the application; a person with the right to change statuses sets a
 * valid one by hand.
 */
const props = defineProps<{
    review: AdminApplicationWorkflowReview
    statusLabel: string
    /** Correction targets that resolved to a status of the catalogue. */
    targetCount: number
    busy: boolean
}>();

const emit = defineEmits<{
    (event: 'correct'): void
}>();

const { t } = useI18n();

const canSetStatus = computed(() => props.review.canCorrect && props.targetCount > 0);
const followUp = computed(() => {
    if (!props.review.canCorrect) return t('admin.detail.statusReviewNoPermission');
    if (props.targetCount === 0) return t('admin.detail.statusReviewNoTargets');
    return '';
});
const actions = computed(() => canSetStatus.value
    ? [{
        label: t('admin.detail.statusReviewAction'),
        // House pattern for actions inside a warning alert: white text on the
        // solid warning token fails WCAG 1.4.3 contrast.
        color: 'neutral' as const,
        variant: 'subtle' as const,
        icon: 'i-lucide-list-checks',
        disabled: props.busy,
        onClick: () => emit('correct')
    }]
    : []);
</script>

<template>
  <UAlert
    role="status"
    data-test="status-review-alert"
    color="warning"
    icon="i-lucide-triangle-alert"
    :title="t('admin.detail.statusReviewTitle')"
    :actions="actions"
  >
    <template #description>
      <p>
        {{ t('admin.detail.statusReviewDescription', { status: statusLabel }) }}
        <!-- Ask for a status only where the person can set one. -->
        <template v-if="canSetStatus">
          {{ t('admin.detail.statusReviewPrompt') }}
        </template>
      </p>
      <p
        v-if="followUp"
        data-test="status-review-follow-up"
        class="mt-1"
      >
        {{ followUp }}
      </p>
    </template>
  </UAlert>
</template>
