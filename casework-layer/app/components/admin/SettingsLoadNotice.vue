<script setup lang="ts">
/**
 * What a settings page shows when its data did not load.
 *
 * A refusal states the reason once, neutral and without retry: no retry can
 * change a missing right or the wrong level. The notice has two forms:
 * - whole page refused: `UEmpty` with the lock, the title and
 *   description of `access.refusal.*` and the ways on (`actions`); the page
 *   shows nothing else;
 * - `partial`: one `AccessReason` line (the rest of the page works), placed by
 *   the page under its description.
 * `data-testid="settings-refusal"` stays on the root in both shapes.
 *
 * A technical failure keeps the error colour, and offers "Erneut versuchen"
 * only when a retry can help. Pages render nothing editable while a whole-page
 * notice stands.
 */
import type { ButtonProps } from '@nuxt/ui';
import { useId } from 'vue';
import type { SettingsRefusal } from '~~/casework-layer/app/composables/useSettingsLoadState';
import AccessReason from '~~/casework-layer/app/components/AccessReason.vue';

const props = defineProps<{
    refusal?: SettingsRefusal | null
    /** Message of a technical failure. */
    error?: string | null
    retryable?: boolean
    /** Replaces the description of a refusal, for a sentence that names the concrete setting. */
    description?: string
    /** Ways on from a whole-page refusal, for example the switch to the municipality. */
    actions?: ButtonProps[]
    /** Only a part of the page is refused: one reason line instead of the empty state. */
    partial?: boolean
    /** Id of the reason line in `partial`, for `aria-describedby` on a locked control. */
    reasonId?: string
}>();

const emit = defineEmits<{ retry: [] }>();

const { t } = useI18n();

const fallbackReasonId = `settings-refusal-${useId()}`;
const refusalDescription = computed(() => props.refusal
    ? props.description || t(`access.refusal.${props.refusal}.description`)
    : '');

const retryActions = computed<ButtonProps[]>(() => props.retryable === false
    ? []
    : [{ label: t('common.retry'), color: 'neutral', variant: 'subtle', onClick: () => emit('retry') }]);
</script>

<template>
  <AccessReason
    v-if="refusal && partial"
    :id="reasonId || fallbackReasonId"
    :text="refusalDescription"
    data-testid="settings-refusal"
    data-shape="partial"
  />
  <UEmpty
    v-else-if="refusal"
    icon="i-lucide-lock"
    :title="t(`access.refusal.${refusal}.title`)"
    :description="refusalDescription"
    data-testid="settings-refusal"
    data-shape="page"
  >
    <template
      v-if="actions?.length"
      #actions
    >
      <UButton
        v-for="action in actions"
        :key="String(action.label)"
        v-bind="action"
        data-test="refusal-action"
      />
    </template>
  </UEmpty>
  <UAlert
    v-else-if="error"
    data-testid="settings-load-error"
    icon="i-lucide-circle-x"
    color="error"
    :title="error"
    :actions="retryActions"
  />
</template>
