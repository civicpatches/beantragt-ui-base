<script setup lang="ts">
/**
 * Embed Settings Page
 *
 * Generate iframe embed code for published form schemas.
 * Configurable width, height, and theme (light/dark).
 * Live preview of the embedded form.
 */

import type { FormSchemaCollectionResponse } from '~/types';
import { staffFetch } from '~~/casework-layer/app/composables/api/useStaffSessionFetch';
import { publicFormPath } from '~/utils/public-form-path';
import { SETTINGS_SECTION_REFUSAL_CODES, useSettingsLoadState } from '~~/casework-layer/app/composables/useSettingsLoadState';
import SettingsLoadNotice from '~~/casework-layer/app/components/admin/SettingsLoadNotice.vue';
import AppCard from '~/components/app/Card.vue';

definePageMeta({
    layout: 'dashboard',
    middleware: 'admin'
});

const { t } = useI18n();
const {
    selectedWorkspaceKey,
    selectedWorkspaceSlug,
    currentWorkspace,
    withWorkspaceQuery,
    workspaceRoute,
    loadWorkspaces
} = useWorkspaceContext();

useHead({
    title: computed(() => `${t('admin.settings.embed.label')} - ${t('common.settings')} - beantragt.ai`)
});

const toast = useToast();

// ── Load published form schemas (via proxy) ─────────────────────

interface SchemaItem {
    id: string
    label: string
}

interface EmbedSectionData {
    defaultTheme?: 'auto' | 'light' | 'dark'
    defaultWidth?: string
    defaultHeight?: string
    showBorder?: boolean
}

const schemas = ref<SchemaItem[]>([]);
const schemasLoading = ref(true);

async function fetchSchemas() {
    schemasLoading.value = true;
    try {
        const res = await staffFetch<FormSchemaCollectionResponse>('/api/admin/schemas', {
            query: withWorkspaceQuery({
                fields: 'label,field_workflow_status',
                filter: 'published',
                publicationScope: 'internet'
            })
        });

        schemas.value = (res.data || []).map((item: FormSchemaCollectionResponse['data'][number]) => ({
            id: item.id,
            label: item.attributes.label ?? ''
        }));
    } catch (e: unknown) {
        if (parseSettingsError(e).status === 401) return;
        console.error('[embed] Failed to load schemas:', e);
        schemas.value = [];
    } finally {
        schemasLoading.value = false;
    }
}

onMounted(() => {
    reloadPageData();
});

watch(selectedWorkspaceKey, () => {
    reloadPageData();
});

// ── Embed Configuration ─────────────────────────────────────────

const selectedSchemaId = ref('');
const embedWidth = ref('100%');
const embedHeight = ref('800px');
const embedTheme = ref<'auto' | 'light' | 'dark'>('light');
const showBorder = ref(true);
const isSettingsLoading = ref(true);
const isSaving = ref(false);
const loadError = ref<string | null>(null);
const savedSnapshot = ref('');
// The page is only partly available when the defaults are refused: the code
// generator below works without them, saving the defaults does not.
const {
    refusal: loadRefusal,
    retryable: loadRetryable,
    begin: beginLoad,
    succeed: loadSucceeded,
    fail: loadFailed,
    failLocally: loadFailedLocally
} = useSettingsLoadState({ refusalCodes: SETTINGS_SECTION_REFUSAL_CODES });

function settingsSnapshot() {
    return JSON.stringify({
        defaultTheme: embedTheme.value,
        defaultWidth: embedWidth.value,
        defaultHeight: embedHeight.value,
        showBorder: showBorder.value
    });
}

function takeSnapshot() {
    savedSnapshot.value = settingsSnapshot();
}

const isDirty = computed(() => {
    if (!savedSnapshot.value) return false;
    return settingsSnapshot() !== savedSnapshot.value;
});

useUnsavedChangesGuard(isDirty);

const themeOptions = computed(() => [
    { label: t('admin.settings.embed.themeAuto'), value: 'auto' },
    { label: t('admin.settings.embed.themeLight'), value: 'light' },
    { label: t('admin.settings.embed.themeDark'), value: 'dark' }
]);

const selectedSchemaLabel = computed(() => {
    return schemas.value.find(s => s.id === selectedSchemaId.value)?.label ?? '';
});

// ── Build Embed URL ─────────────────────────────────────────────

const requestUrl = useRequestURL();

const embedUrl = computed(() => {
    if (!selectedSchemaId.value) return '';

    const base = `${requestUrl.origin}${publicFormPath({
        id: selectedSchemaId.value,
        jurisdictionSlug: currentWorkspace.value?.jurisdictionSlug,
        organisationSlug: currentWorkspace.value?.organisationSlug
    })}`;
    const params = new URLSearchParams();

    params.set('embed', 'true');
    if (embedTheme.value !== 'auto') {
        params.set('theme', embedTheme.value);
    }

    const queryString = params.toString();
    return queryString ? `${base}?${queryString}` : base;
});

// ── Snippet ─────────────────────────────────────────────────────

const embedSnippet = computed(() => {
    if (!embedUrl.value) return '';
    const border = showBorder.value ? '1px solid #d1d5db' : '0';
    return `<iframe
  src="${embedUrl.value}"
  width="${embedWidth.value}"
  height="${embedHeight.value}"
  frameborder="0"
  loading="lazy"
  style="border: ${border}; border-radius: 8px;"
  title="${selectedSchemaLabel.value}"
></iframe>`;
});

function applySection(data: EmbedSectionData) {
    if (data.defaultTheme === 'auto' || data.defaultTheme === 'light' || data.defaultTheme === 'dark') {
        embedTheme.value = data.defaultTheme;
    }
    embedWidth.value = typeof data.defaultWidth === 'string' ? data.defaultWidth : '100%';
    embedHeight.value = typeof data.defaultHeight === 'string' ? data.defaultHeight : '800px';
    showBorder.value = typeof data.showBorder === 'boolean' ? data.showBorder : true;
}

async function loadSettings() {
    isSettingsLoading.value = true;
    loadError.value = null;
    beginLoad();

    if (!selectedWorkspaceSlug.value) {
        await loadWorkspaces();
    }
    const slug = selectedWorkspaceSlug.value;
    if (!slug) {
        loadError.value = t('admin.settings.selectWorkspace');
        loadFailedLocally();
        isSettingsLoading.value = false;
        return;
    }

    try {
        const response = await staffFetch<{ section: string, data: EmbedSectionData }>(
            `/api/admin/jurisdictions/${slug}/settings/embed`
        );
        applySection(response.data || {});
        takeSnapshot();
        loadSucceeded();
    } catch (e: unknown) {
        if (loadFailed(e) === 'technical') {
            loadError.value = t('admin.settings.embed.loadError');
        }
    } finally {
        isSettingsLoading.value = false;
    }
}

async function saveSettings() {
    const slug = selectedWorkspaceSlug.value;
    if (!slug) {
        toast.add({
            title: t('admin.settings.selectWorkspace'),
            icon: 'i-lucide-circle-x',
            color: 'error'
        });
        return;
    }

    isSaving.value = true;
    try {
        const response = await staffFetch<{ section: string, data: EmbedSectionData }>(
            `/api/admin/jurisdictions/${slug}/settings/embed`,
            {
                method: 'PATCH',
                body: {
                    data: {
                        defaultTheme: embedTheme.value,
                        defaultWidth: embedWidth.value.trim(),
                        defaultHeight: embedHeight.value.trim(),
                        showBorder: showBorder.value
                    }
                }
            }
        );
        applySection(response.data || {});
        takeSnapshot();
        toast.add({
            title: t('common.success'),
            description: t('admin.settings.embed.saved'),
            color: 'success'
        });
    } catch (e: unknown) {
        const { status, detail } = parseSettingsError(e);
        if (status === 401) return;
        toast.add({
            title: t('admin.settings.embed.saveError'),
            description: detail || undefined,
            icon: 'i-lucide-circle-x',
            color: 'error'
        });
    } finally {
        isSaving.value = false;
    }
}

async function reloadPageData() {
    await loadSettings();
    await fetchSchemas();
}

// ── Copy to Clipboard ───────────────────────────────────────────

const copied = ref(false);

async function copySnippet() {
    if (!embedSnippet.value) return;

    try {
        await navigator.clipboard.writeText(embedSnippet.value);
        copied.value = true;
        setTimeout(() => {
            copied.value = false;
        }, 2000);
    } catch {
    // Fallback
        const textarea = document.createElement('textarea');
        textarea.value = embedSnippet.value;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        copied.value = true;
        setTimeout(() => {
            copied.value = false;
        }, 2000);
    }
}

// ── Preview ─────────────────────────────────────────────────────

const previewKey = ref(0);
let previewTimeout: ReturnType<typeof setTimeout> | undefined;

watch(embedUrl, () => {
    clearTimeout(previewTimeout);
    previewTimeout = setTimeout(() => {
        previewKey.value++;
    }, 500);
});

function refreshPreview() {
    clearTimeout(previewTimeout);
    previewKey.value++;
}

onBeforeUnmount(() => clearTimeout(previewTimeout));
</script>

<template>
  <AppPageLayout
    :title="t('admin.settings.embed.title')"
    :description="t('admin.settings.embed.subtitle')"
    :breadcrumbs="[{ label: t('common.settings'), to: workspaceRoute('/admin/settings') }, { label: t('admin.settings.embed.label') }]"
  >
    <div class="space-y-6">
      <!-- Defaults refused: one reason line, the generator still works (Part A) -->
      <SettingsLoadNotice
        v-if="loadRefusal || loadError"
        class="max-w-3xl"
        :refusal="loadRefusal"
        partial
        :description="loadRefusal ? t('admin.settings.embed.defaultsRefused') : undefined"
        :error="loadError"
        :retryable="loadRetryable"
        @retry="loadSettings"
      />

      <!-- Configuration: one card; before a form is chosen it is the page -->
      <AppCard
        class="max-w-3xl"
        data-testid="embed-config-card"
      >
        <UFormField
          :label="t('admin.settings.embed.selectForm')"
          :description="selectedSchemaId ? undefined : t('admin.settings.embed.selectFormDescription')"
          name="schema"
          required
        >
          <USkeleton
            v-if="schemasLoading"
            class="h-9 w-full max-w-xl"
          />
          <p
            v-else-if="schemas.length === 0"
            class="text-sm text-muted"
          >
            {{ t('admin.settings.embed.noPublishedForms') }}
          </p>
          <USelectMenu
            v-else
            v-model="selectedSchemaId"
            :items="schemas.map(s => ({ label: s.label, value: s.id }))"
            value-key="value"
            :placeholder="t('admin.settings.embed.selectFormPlaceholder')"
            class="w-full max-w-xl"
            data-testid="embed-form-select"
          />
        </UFormField>

        <UFormField
          :label="t('admin.settings.embed.colorScheme')"
          name="theme"
        >
          <!-- 24 px between options, so the three do not read as one line of words -->
          <URadioGroup
            v-model="embedTheme"
            :items="themeOptions"
            value-key="value"
            orientation="horizontal"
            :ui="{ fieldset: 'gap-x-6 gap-y-2 flex-wrap' }"
            data-testid="embed-theme"
          />
        </UFormField>

        <!-- Two short fields without a sentence: next to each other, not a grid -->
        <div class="flex flex-wrap gap-4">
          <UFormField :label="t('admin.settings.embed.width')">
            <UInput
              v-model="embedWidth"
              placeholder="100%"
              class="w-32"
            />
          </UFormField>
          <UFormField :label="t('admin.settings.embed.height')">
            <UInput
              v-model="embedHeight"
              placeholder="800px"
              class="w-32"
            />
          </UFormField>
        </div>

        <USwitch
          v-model="showBorder"
          :label="t('admin.settings.embed.showBorder')"
          :description="t('admin.settings.embed.showBorderHint')"
          data-testid="embed-border"
        />

        <template
          v-if="!loadRefusal"
          #footer
        >
          <div class="w-full space-y-2">
            <p class="max-w-prose text-sm text-muted">
              {{ t('admin.settings.embed.saveDefaultsHint') }}
            </p>
            <UButton
              color="neutral"
              variant="outline"
              :loading="isSaving"
              :disabled="isSettingsLoading || !isDirty"
              data-testid="embed-save-defaults"
              @click="saveSettings"
            >
              {{ t('admin.settings.embed.save') }}
            </UButton>
          </div>
        </template>
      </AppCard>

      <!-- After the choice: the code, then the preview -->
      <AppCard
        v-if="embedSnippet"
        :title="t('admin.settings.embed.snippetTitle')"
        class="max-w-3xl"
        data-testid="embed-snippet-card"
      >
        <template #actions>
          <UButton
            :color="copied ? 'success' : 'primary'"
            data-testid="embed-copy"
            @click="copySnippet"
          >
            {{ copied ? t('common.copied') : t('admin.settings.embed.copyCode') }}
          </UButton>
        </template>
        <pre class="select-all overflow-x-auto rounded-md bg-elevated/50 p-3 font-mono text-sm text-default"><code>{{ embedSnippet }}</code></pre>
      </AppCard>

      <AppCard
        v-if="embedUrl"
        :title="t('admin.settings.embed.previewTitle')"
        class="max-w-3xl"
        data-testid="embed-preview-card"
      >
        <template #actions>
          <UTooltip :text="t('common.refresh')">
            <UButton
              color="neutral"
              variant="ghost"
              icon="i-lucide-refresh-cw"
              :aria-label="t('common.refresh')"
              @click="refreshPreview"
            />
          </UTooltip>
        </template>
        <div
          class="overflow-hidden rounded-lg"
          :class="showBorder ? 'border border-default' : ''"
          :style="{ maxWidth: embedWidth }"
        >
          <iframe
            :key="previewKey"
            :src="embedUrl"
            :width="embedWidth"
            :height="embedHeight"
            frameborder="0"
            loading="lazy"
            style="border: 0; display: block;"
            :title="selectedSchemaLabel"
          />
        </div>
      </AppCard>
    </div>
  </AppPageLayout>
</template>
