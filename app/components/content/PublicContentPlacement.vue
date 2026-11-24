<script setup lang="ts">
interface PublicContentSectionItem {
    id: string
    attributes: {
        title: string
        body?: {
            processed?: string
        }
    }
}

interface PublicDocumentItem {
    id: string
    attributes: {
        title: string
        description?: {
            processed?: string
        }
        file?: {
            filename?: string
            mimeType?: string
            size?: number
            url?: string
        }
    }
}

const props = withDefaults(defineProps<{
    title?: string
    description?: string
    icon?: string
    sections?: PublicContentSectionItem[]
    documents?: PublicDocumentItem[]
    loading?: boolean
    error?: boolean
    compact?: boolean
    inlineDocuments?: boolean
    iconClass?: string
}>(), {
    title: '',
    description: '',
    icon: 'i-lucide-info',
    sections: () => [],
    documents: () => [],
    loading: false,
    error: false,
    compact: false,
    inlineDocuments: false,
    iconClass: 'text-(--ui-primary)'
});

const { t } = useI18n();

const visibleDocuments = computed(() =>
    props.documents.filter(document => Boolean(documentFileUrl(document)))
);
const visibleSections = computed(() =>
    props.sections.filter(section => Boolean(section.attributes.body?.processed))
);
const hasContent = computed(() =>
    props.loading || props.error || visibleSections.value.length > 0 || visibleDocuments.value.length > 0
);

function documentFileUrl(document: PublicDocumentItem): string {
    const url = document.attributes.file?.url || '';
    if (!/^\/api\/v1\/jurisdictions\/[a-z0-9-]{2,80}\/documents\/[0-9a-f-]{36}\/file(?:\?|$)/u.test(url)) {
        return '';
    }
    return url;
}

function publicDocumentFileSize(document: PublicDocumentItem): string {
    const size = document.attributes.file?.size;
    if (!Number.isFinite(size) || !size || size <= 0) return '';
    if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    return `${Math.ceil(size / 1024)} KB`;
}
</script>

<template>
  <component
    :is="inlineDocuments ? 'div' : 'section'"
    v-if="hasContent"
    :data-public-content-placement="inlineDocuments ? 'inline-documents' : 'section'"
    :class="inlineDocuments
      ? 'space-y-2'
      : ['rounded-lg border border-(--ui-border) bg-(--ui-bg-elevated)/60 p-4 sm:p-5', { 'p-4 sm:p-4': compact }]"
  >
    <div
      v-if="(title || description) && !inlineDocuments"
      class="mb-4 flex items-start gap-3"
    >
      <UIcon
        :name="icon"
        class="mt-0.5 size-5 shrink-0"
        :class="iconClass"
      />
      <div class="min-w-0">
        <h2
          v-if="title"
          class="font-semibold text-(--ui-text-highlighted)"
          :class="compact ? 'text-sm' : 'text-base'"
        >
          {{ title }}
        </h2>
        <p
          v-if="description"
          class="mt-1 max-w-prose text-sm text-(--ui-text-muted)"
        >
          {{ description }}
        </p>
      </div>
    </div>

    <UAlert
      v-if="error"
      role="status"
      color="warning"
      icon="i-lucide-triangle-alert"
      :title="t('content.sectionLoadFailed')"
    />

    <div
      v-else-if="loading"
      class="space-y-3"
    >
      <USkeleton class="h-16 w-full" />
    </div>

    <div
      v-else
      class="space-y-4"
    >
      <article
        v-for="section in visibleSections"
        :key="section.id"
        class="space-y-1"
      >
        <h3 class="text-sm font-semibold text-(--ui-text-highlighted)">
          {{ section.attributes.title }}
        </h3>
        <div
          class="prose prose-neutral dark:prose-invert max-w-prose text-sm text-(--ui-text-muted)"
          v-html="section.attributes.body?.processed"
        />
      </article>

      <div
        v-if="visibleDocuments.length"
        class="space-y-3"
      >
        <div
          v-for="document in visibleDocuments"
          :key="document.id"
          :class="inlineDocuments
            ? 'flex items-center justify-between gap-3 border-y border-(--ui-border) py-2'
            : [
              'flex flex-col gap-3 rounded-md border border-(--ui-border) bg-(--ui-bg) p-3',
              compact ? '' : 'sm:flex-row sm:items-center sm:justify-between',
            ]"
        >
          <div class="min-w-0">
            <p class="font-medium text-(--ui-text-highlighted)">
              {{ document.attributes.title }}
            </p>
            <div
              v-if="document.attributes.description?.processed && !inlineDocuments"
              class="prose prose-neutral dark:prose-invert mt-1 max-w-prose text-sm text-(--ui-text-muted)"
              v-html="document.attributes.description.processed"
            />
            <p
              v-if="publicDocumentFileSize(document) && !inlineDocuments"
              class="mt-1 text-xs text-(--ui-text-muted)"
            >
              {{ document.attributes.file?.filename }} · {{ publicDocumentFileSize(document) }}
            </p>
          </div>
          <UButton
            :to="documentFileUrl(document)"
            target="_blank"
            rel="noopener noreferrer"
            icon="i-lucide-download"
            color="neutral"
            variant="soft"
            class="shrink-0"
            :aria-label="t('form.publicDocumentDownloadAria', {
              title: document.attributes.title,
              filename: document.attributes.file?.filename || '',
            })"
          >
            {{ t('form.publicDocumentDownload') }}
          </UButton>
        </div>
      </div>
    </div>
  </component>
</template>
