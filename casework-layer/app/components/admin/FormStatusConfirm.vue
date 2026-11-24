<script setup lang="ts">
/**
 * The question before a status change of a form that is not publishing:
 * archiving, reopening as a draft and "Als Entwurf setzen", as a
 * `UModal`.
 *
 * The focus starts on "Abbrechen", so Enter twice changes nothing. The
 * confirming button is primary, not red: nothing is deleted. The caller opens
 * and closes it with `v-model:open` and returns the focus on `closed`, once
 * the dialog is gone.
 */
import type { ModalProps } from '@nuxt/ui';
import { nextTick, useId } from 'vue';

defineOptions({ inheritAttrs: false });

defineProps<{
    title: string
    description: string
    confirmLabel: string
    busy?: boolean
}>();

/** Whether the dialog is open. */
const open = defineModel<boolean>('open', { default: false });
const emit = defineEmits<{ confirm: [], cancel: [], closed: [] }>();
const { t } = useI18n();
const id = useId();
const descriptionId = `${id}-description`;

function focusCancel() {
    document.querySelector<HTMLElement>(`[data-form-status-cancel="${id}"]`)?.focus();
}

function onOpenAutoFocus(event: Event) {
    event.preventDefault();
    void nextTick(focusCancel);
}

function onCloseAutoFocus(event: Event) {
    event.preventDefault();
}

// The test id rides on the dialog element itself; `DialogContentProps` has
// no key for plain attributes, so the object is widened for it.
const dialogContent: NonNullable<ModalProps['content']> & Record<string, unknown> = {
    'data-test': 'form-status-confirm',
    onOpenAutoFocus,
    onCloseAutoFocus
};
</script>

<template>
  <UModal
    v-model:open="open"
    :title="title"
    :dismissible="!busy"
    :close="!busy"
    :ui="{ description: 'mt-2 max-w-prose text-sm text-default' }"
    :content="dialogContent"
    @after:leave="emit('closed')"
  >
    <template #description>
      <span :id="descriptionId">{{ description }}</span>
    </template>
    <template #footer>
      <div class="flex w-full flex-wrap justify-end gap-2">
        <UButton
          :data-form-status-cancel="id"
          color="neutral"
          variant="ghost"
          :disabled="busy"
          @click="emit('cancel')"
        >
          {{ t('common.cancel') }}
        </UButton>
        <UButton
          data-form-status-submit
          :aria-describedby="descriptionId"
          :loading="busy"
          @click="emit('confirm')"
        >
          {{ confirmLabel }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
