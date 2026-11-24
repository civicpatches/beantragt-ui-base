<script setup lang="ts">
import { useId, useTemplateRef, watch } from 'vue';
import { DATA_EDIT_REASON_MAX_LENGTH } from '~~/casework-layer/app/utils/application-data-corrections';

const props = defineProps<{
    saving: boolean
    error: string
}>();

const open = defineModel<boolean>('open', { required: true });
const reason = defineModel<string>('reason', { required: true });
const emit = defineEmits<{ save: [reason: string], restoreFocus: [], input: [] }>();
const { t } = useI18n();
const formId = useId();
const textarea = useTemplateRef('textarea');

watch(() => props.error, (error) => {
    if (error) textarea.value?.textareaRef?.focus();
}, { flush: 'post' });

function cancel() {
    if (props.saving) return;
    open.value = false;
}

function submit() {
    if (props.error) textarea.value?.textareaRef?.focus();
    emit('save', reason.value);
}
</script>

<template>
  <UModal
    :open="open"
    :title="t('admin.detail.dataEditReasonTitle')"
    :close="!saving"
    :dismissible="!saving"
    :content="{ onCloseAutoFocus: event => { event.preventDefault(); emit('restoreFocus'); } }"
    @update:open="!$event && cancel()"
  >
    <template #body>
      <form
        :id="formId"
        novalidate
        @submit.prevent="submit"
      >
        <UFormField
          name="reason"
          :label="t('admin.detail.dataEditReasonLabel')"
          :description="t('admin.detail.dataEditReasonDescription')"
          :hint="`${reason.length}/${DATA_EDIT_REASON_MAX_LENGTH}`"
          :error="error || undefined"
          required
        >
          <UTextarea
            ref="textarea"
            v-model="reason"
            class="w-full"
            autocomplete="off"
            :maxlength="DATA_EDIT_REASON_MAX_LENGTH"
            :disabled="saving"
            autofocus
            required
            @update:model-value="emit('input')"
          />
        </UFormField>
      </form>
    </template>
    <template #footer>
      <div class="flex w-full flex-wrap justify-end gap-2">
        <UButton
          type="button"
          color="neutral"
          variant="ghost"
          :label="t('common.cancel')"
          :disabled="saving"
          @click="cancel"
        />
        <UButton
          type="submit"
          :form="formId"
          :label="t('admin.detail.saveDataCorrection')"
          :loading="saving"
          :disabled="saving"
        />
      </div>
    </template>
  </UModal>
</template>
