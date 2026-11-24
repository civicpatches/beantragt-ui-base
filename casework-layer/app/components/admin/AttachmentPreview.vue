<script setup lang="ts">
import { onUnmounted, ref, shallowRef, watch } from 'vue';
import AppDocumentPreview from '~/components/app/DocumentPreview.vue';
import type { DocumentPreviewSource } from '~/utils/document-preview-extension';
import { classifySettingsLoadFailure } from '../../composables/useSettingsLoadState';
import { fetchStaffFile } from '../../utils/staff-file';
import type { ViewerDocument } from '../../utils/viewer-document';

const props = defineProps<{ document: ViewerDocument }>();
const { t } = useI18n();
const { withWorkspaceQuery, selectedWorkspaceKey } = useWorkspaceContext();
const { resolveApiErrorMessage } = useApiErrorMessage();
const preview = shallowRef<DocumentPreviewSource | null>(null);
const loading = ref(false);
const error = ref('');
const retryable = ref(false);
let request = 0;

function clear() {
    if (preview.value) URL.revokeObjectURL(preview.value.url);
    preview.value = null;
}

async function load() {
    const { fileUrl, originalName, label, mime } = props.document;
    const current = ++request;
    clear();
    error.value = '';
    loading.value = false;
    if (!fileUrl || !mime || mime === 'image/tiff') return;
    loading.value = true;
    try {
        const { blob, filename } = await fetchStaffFile(fileUrl, withWorkspaceQuery(), originalName || '');
        if (current !== request) return;
        preview.value = {
            url: URL.createObjectURL(new Blob([blob], { type: mime })),
            blob,
            mime,
            filename,
            title: label || filename
        };
    } catch (failure) {
        if (current !== request) return;
        const state = classifySettingsLoadFailure(failure);
        retryable.value = state.kind === 'technical' && state.retryable;
        error.value = resolveApiErrorMessage(failure, 'admin.documentViewer.failed');
    } finally {
        if (current === request) loading.value = false;
    }
}

watch(() => [props.document.fileUrl, props.document.mime, selectedWorkspaceKey?.value].join('|'), load, { immediate: true });
onUnmounted(() => {
    request++;
    clear();
});
</script>

<template>
  <p
    v-if="loading"
    role="status"
  >
    {{ t('admin.common.loading') }}
  </p>
  <UAlert
    v-else-if="error"
    color="error"
    icon="i-lucide-circle-x"
    role="alert"
    :title="error"
    :actions="retryable ? [{ label: t('common.retry'), color: 'neutral', variant: 'outline', onClick: load }] : []"
  />
  <AppDocumentPreview
    v-else-if="preview"
    :preview="preview"
  />
</template>
