<script setup lang="ts">
import { inject, ref } from 'vue';
import { documentPreviewExtensionKey, type DocumentPreviewSource } from '~/utils/document-preview-extension';

const props = defineProps<{
    preview: DocumentPreviewSource
    hideActions?: boolean
}>();
const emit = defineEmits<{ rendered: [url: string], fallback: [url: string] }>();
const { t } = useI18n();
const viewer = inject(documentPreviewExtensionKey, null);
const failedUrl = ref('');

function fallBack(url: string) {
    if (url !== props.preview.url || failedUrl.value === url) return;
    failedUrl.value = url;
    emit('fallback', url);
}
</script>

<template>
  <div class="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
    <div
      v-if="!hideActions"
      class="flex flex-wrap gap-2"
    >
      <UButton
        :href="preview.url"
        target="_blank"
        rel="noopener"
        color="neutral"
        variant="outline"
        icon="i-lucide-external-link"
        :label="t('common.openNewTab')"
      />
    </div>
    <ClientOnly v-if="viewer && failedUrl !== preview.url">
      <component
        :is="viewer"
        :key="preview.url"
        :preview="preview"
        fill
        @loaded="emit('rendered', $event)"
        @failed="fallBack"
      />
    </ClientOnly>
    <img
      v-else-if="preview.mime === 'image/jpeg' || preview.mime === 'image/png'"
      :src="preview.url"
      :alt="preview.title"
      class="min-h-0 flex-1 object-contain"
    >
    <object
      v-else
      :data="preview.url"
      type="application/pdf"
      :title="preview.title"
      class="block min-h-0 w-full flex-1 overflow-hidden rounded-lg border border-default bg-default"
    >
      <p class="p-4 text-sm text-muted">
        {{ t('common.pdfPreviewUnavailable') }}
      </p>
    </object>
  </div>
</template>
