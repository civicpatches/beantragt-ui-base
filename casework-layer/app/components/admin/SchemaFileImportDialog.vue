<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, useId, useTemplateRef, watch } from 'vue';
import { MAX_SCHEMA_IMPORT_BYTES } from '#shared/schema-file-import';
import type { AdminWorkspace } from '../../composables/useWorkspaceContext';

const props = defineProps<{
    workspace: Pick<AdminWorkspace, 'id' | 'key' | 'label' | 'jurisdictionSlug' | 'organisationSlug' | 'canCreateFormSchema'>
}>();
const emit = defineEmits<{
    imported: [result: { workspaceId: string, workspaceKey: string, entityId: string }]
}>();

const { t } = useI18n();
const { resolveApiErrorMessage } = useApiErrorMessage();
const open = ref(false);
const file = shallowRef<File | null>(null);
const busy = ref(false);
const error = ref('');
const fileInput = useTemplateRef<HTMLInputElement>('fileInput');
const fileId = useId();
const errorMessage = computed(() => fileError.value || error.value);
const fileDescription = computed(() => errorMessage.value ? `${fileId}-hint ${fileId}-error` : `${fileId}-hint`);
let workspaceVersion = 0;

function setOpen(value: boolean) {
    if (busy.value) return;
    open.value = value;
    file.value = null;
    error.value = '';
}

watch(() => [props.workspace.id, props.workspace.key, props.workspace.canCreateFormSchema], () => {
    workspaceVersion++;
    open.value = false;
    file.value = null;
    error.value = '';
});

const fileError = computed(() => {
    if (!file.value) return '';
    if (file.value.size > MAX_SCHEMA_IMPORT_BYTES) return t('errors.schema.importTooLarge');
    if (!file.value.size) return t('errors.schema.importMalformed');
    return '';
});

function selectFile(event: Event) {
    file.value = (event.target as HTMLInputElement).files?.[0] ?? null;
    error.value = '';
}

async function submit() {
    if (!open.value || !file.value || fileError.value || busy.value || props.workspace.canCreateFormSchema !== true) return;

    const { id: workspaceId, key: workspaceKey, jurisdictionSlug, organisationSlug } = props.workspace;
    const version = workspaceVersion;
    busy.value = true;
    error.value = '';
    try {
        const response = await $fetch.raw<{ entityId: string }>('/api/admin/schemas/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            query: { jurisdiction: jurisdictionSlug, ...(organisationSlug ? { organisation: organisationSlug } : {}) },
            body: file.value,
            retry: 0
        });
        if (version !== workspaceVersion) return;
        if (response.status !== 201 || !response._data?.entityId) {
            error.value = t('errors.schema.importFailed');
            return;
        }
        open.value = false;
        file.value = null;
        emit('imported', { workspaceId, workspaceKey, entityId: response._data.entityId });
    } catch (failure: unknown) {
        if (version === workspaceVersion) {
            const code = (failure as { data?: { data?: { code?: string } } } | null)?.data?.data?.code;
            error.value = code === 'errors.schema.invalid'
                ? t('errors.schema.importSemantic')
                : resolveApiErrorMessage(failure, 'errors.schema.importFailed');
        }
    } finally {
        busy.value = false;
        if (error.value && open.value && version === workspaceVersion) {
            await nextTick();
            fileInput.value?.focus();
        }
    }
}
</script>

<template>
  <UModal
    :open="open"
    :title="t('admin.forms.schemaFileImport.action')"
    :description="t('admin.forms.schemaFileImport.target', { workspace: workspace.label })"
    :dismissible="!busy"
    :close="!busy"
    @update:open="setOpen"
  >
    <UButton
      color="neutral"
      variant="outline"
      icon="i-lucide-upload"
      :label="t('admin.forms.schemaFileImport.action')"
      :disabled="busy"
    />

    <template #body>
      <div class="space-y-4">
        <div class="space-y-1">
          <label
            :for="fileId"
            class="block text-sm font-medium text-default"
          >{{ t('admin.forms.schemaFileImport.file') }}</label>
          <p
            :id="`${fileId}-hint`"
            class="text-sm text-muted"
          >
            {{ t('admin.forms.schemaFileImport.fileHint') }}
          </p>
          <input
            :id="fileId"
            ref="fileInput"
            type="file"
            accept=".json,application/json"
            :disabled="busy"
            :aria-invalid="errorMessage ? true : undefined"
            :aria-describedby="fileDescription"
            class="block w-full"
            @change="selectFile"
          >
          <p
            v-if="errorMessage"
            :id="`${fileId}-error`"
            role="alert"
            class="text-sm text-error"
          >
            {{ errorMessage }}
          </p>
        </div>
        <p
          v-if="busy"
          role="status"
        >
          {{ t('admin.forms.schemaFileImport.saving') }}
        </p>
      </div>
    </template>

    <template #footer>
      <UButton
        color="neutral"
        variant="outline"
        :label="t('admin.forms.schemaFileImport.cancel')"
        :disabled="busy"
        @click="setOpen(false)"
      />
      <UButton
        :label="t('admin.forms.schemaFileImport.submit')"
        :loading="busy"
        :disabled="!file || !!fileError || busy"
        @click="submit"
      />
    </template>
  </UModal>
</template>
