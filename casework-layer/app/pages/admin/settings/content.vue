<script setup lang="ts">
import { EDIT_ICON } from '~/utils/action-icons';
import { useAdminContentSettings } from '~~/casework-layer/app/composables/useAdminContentSettings';
import SettingsLoadNotice from '~~/casework-layer/app/components/admin/SettingsLoadNotice.vue';
import AppCard from '~/components/app/Card.vue';
import { TEXT_LINK_CLASS } from '~/utils/text-link';
import type { ContentKind } from '~~/casework-layer/app/composables/useAdminContentSettings';

definePageMeta({
    layout: 'dashboard',
    middleware: 'admin'
});

const { t } = useI18n();
/** The edit form sits in the dialog body, its "Speichern" in the footer. */
const contentFormId = 'admin-content-edit-form';

useHead({
    title: computed(() => `${t('admin.settings.content.label')} - ${t('common.settings')} - beantragt.ai`)
});

const {
    workspaceRoute,
    loading,
    formsLoading,
    error,
    selectedKind,
    isModalOpen,
    editingItem,
    saving,
    formKind,
    formTitle,
    formStatus,
    formScope,
    formBody,
    formPageKey,
    formPublicSlug,
    formFooterVisible,
    formOrder,
    formBoilerplateType,
    formDocumentPlacement,
    formDocumentFormId,
    selectedDocumentFile,
    documentFileInputKey,
    documentFileInputId,
    documentFileHelpId,
    tabs,
    pageKeyOptions,
    boilerplateTypeOptions,
    documentPlacementOptions,
    sectionPlacementOptions,
    documentFormOptions,
    scopeOptions,
    filteredItems,
    canEdit,
    loadRefusal,
    allSectionsRefused,
    loadRetryable,
    isNewItem,
    currentSavedPreview,
    retryActiveSection,
    openCreateModal,
    openEditModal,
    closeModal,
    itemScopeLabel,
    itemSubtitle,
    publicPagePath,
    changedLabel,
    insertSnippet,
    formatDocumentFileSize,
    adminDocumentFileUrl,
    saveContent
} = useAdminContentSettings();

// One create button in the header: the one of the active tab.
const CREATE_LABELS: Record<ContentKind, string> = {
    page: 'admin.settings.content.newPage',
    section: 'admin.settings.content.newSection',
    boilerplate: 'admin.settings.content.newBoilerplate',
    document: 'admin.settings.content.newDocument'
};
const createLabel = computed(() => t(CREATE_LABELS[selectedKind.value]));
// Tabs switch views; they carry no icons.
const tabItems = computed(() => tabs.value.map(({ icon: _icon, ...item }) => item));

function onDocumentFileChosen(file: unknown) {
    selectedDocumentFile.value = file instanceof File ? file : null;
}
</script>

<template>
  <AppPageLayout
    :title="t('admin.settings.content.title')"
    :description="t('admin.settings.content.subtitle')"
    :breadcrumbs="[{ label: t('common.settings'), to: workspaceRoute('/admin/settings') }, { label: t('admin.settings.content.label') }]"
  >
    <template
      v-if="!loadRefusal"
      #actions
    >
      <UButton
        icon="i-lucide-plus"
        :disabled="!canEdit"
        data-testid="content-create"
        @click="openCreateModal(selectedKind)"
      >
        {{ createLabel }}
      </UButton>
    </template>

    <!-- Refused load (reason, no retry) or technical error (retry) -->
    <SettingsLoadNotice
      v-if="loadRefusal || error"
      class="mb-6"
      :refusal="loadRefusal"
      :error="error"
      :retryable="loadRetryable"
      @retry="retryActiveSection"
    />

    <UTabs
      v-if="!allSectionsRefused"
      v-model="selectedKind"
      :items="tabItems"
      color="neutral"
      variant="link"
      :content="false"
      :ui="{ list: 'gap-6 overflow-x-auto', trigger: 'px-0 shrink-0 grow-0', label: 'whitespace-nowrap' }"
      class="mb-6"
      data-testid="content-tabs"
    />

    <div
      v-if="!error && loading"
      class="space-y-2"
    >
      <USkeleton
        v-for="i in 5"
        :key="i"
        class="h-10 w-full"
      />
    </div>

    <AppCard
      v-else-if="!loadRefusal && !error && filteredItems.length"
      data-testid="content-list"
    >
      <ul class="divide-y divide-default">
        <!-- The row itself is not clickable (its title button and the pencil are), so it paints no hover. -->
        <li
          v-for="item in filteredItems"
          :key="item.id"
          class="flex items-start gap-3 py-3 first:pt-0 last:pb-0"
          data-testid="content-row"
        >
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
              <!-- The title opens the editor (dialog). -->
              <!-- The framework button lets the title wrap and gives it a visible focus ring. Vertical padding provides a 24 px
                   target without shifting the text line. The shared text-link class keeps the title underlined. -->
              <UButton
                color="neutral"
                variant="link"
                class="inline min-w-0 break-words px-0 py-0.5 text-left text-sm"
                :class="TEXT_LINK_CLASS"
                :aria-label="t('admin.settings.content.editAria', { title: item.title })"
                data-testid="content-row-edit"
                @click="openEditModal(item)"
              >
                {{ item.title }}
              </UButton>
              <UBadge
                :color="item.status ? 'success' : 'neutral'"
                data-testid="content-row-state"
              >
                {{ item.status ? t('admin.settings.content.published') : t('admin.settings.content.draft') }}
              </UBadge>
            </div>
            <p
              class="mt-0.5 text-sm text-muted"
              data-testid="content-row-meta"
            >
              <span :class="item.kind === 'page' && item.page?.path ? 'font-mono' : undefined">{{ itemSubtitle(item) }}</span>
              <span aria-hidden="true"> · </span>
              <span>{{ itemScopeLabel(item) }}</span>
              <template v-if="changedLabel(item)">
                <span aria-hidden="true"> · </span>
                <span>{{ t('admin.settings.content.changedAt', { date: changedLabel(item) }) }}</span>
              </template>
            </p>
          </div>

          <UTooltip
            v-if="item.kind === 'page' && item.page?.path"
            :text="t('admin.settings.content.openPublic')"
          >
            <UButton
              :to="publicPagePath(item)"
              icon="i-lucide-external-link"
              color="neutral"
              variant="ghost"
              :aria-label="t('admin.settings.content.openPageAria', { title: item.title })"
            />
          </UTooltip>
          <UTooltip
            v-else-if="item.kind === 'public_document' && adminDocumentFileUrl(item)"
            :text="t('admin.settings.content.openPublic')"
          >
            <UButton
              :to="adminDocumentFileUrl(item)"
              target="_blank"
              rel="noopener noreferrer"
              icon="i-lucide-download"
              color="neutral"
              variant="ghost"
              :aria-label="t('admin.settings.content.openDocumentAria', { title: item.title, filename: item.document.file?.filename })"
            />
          </UTooltip>
          <!-- Every row ends with the pencil: editing is the row's frequent action -->
          <UTooltip :text="t('common.edit')">
            <UButton
              :icon="EDIT_ICON"
              color="neutral"
              variant="ghost"
              :aria-label="t('admin.settings.content.editAria', { title: item.title })"
              data-testid="content-row-pencil"
              @click="openEditModal(item)"
            />
          </UTooltip>
        </li>
      </ul>
    </AppCard>

    <UEmpty
      v-else-if="!error && !loadRefusal"
      icon="i-lucide-file-question"
      :title="t('admin.settings.content.emptyTitle')"
      :description="t('admin.settings.content.emptyDescription')"
    />

    <UModal
      :open="isModalOpen"
      :title="isNewItem ? t('admin.settings.content.createTitle') : t('admin.settings.content.editTitle')"
      :description="t('admin.settings.content.modalDescription')"
      :ui="{ content: 'sm:max-w-4xl' }"
      @update:open="(val: boolean) => !val && closeModal()"
    >
      <template #body>
        <div>
          <form
            :id="contentFormId"
            class="space-y-5"
            @submit.prevent="saveContent"
          >
            <div class="grid gap-4 md:grid-cols-2">
              <UFormField
                :label="t('admin.settings.content.kindLabel')"
                name="kind"
              >
                <USelect
                  v-model="formKind"
                  :items="tabs"
                  value-key="value"
                  class="w-full"
                  :disabled="!isNewItem"
                />
              </UFormField>

              <UFormField
                :label="t('admin.settings.content.scopeLabel')"
                name="scope"
              >
                <USelect
                  v-model="formScope"
                  :items="scopeOptions"
                  value-key="value"
                  class="w-full"
                />
              </UFormField>
            </div>

            <UFormField
              :label="t('admin.settings.content.titleLabel')"
              name="title"
              required
            >
              <UInput
                v-model="formTitle"
                class="w-full"
                :placeholder="t('admin.settings.content.titlePlaceholder')"
                autofocus
              />
            </UFormField>

            <template v-if="formKind === 'page'">
              <div class="grid gap-4 md:grid-cols-3">
                <UFormField
                  :label="t('admin.settings.content.pageKeyLabel')"
                  name="pageKey"
                >
                  <USelect
                    v-model="formPageKey"
                    :items="pageKeyOptions"
                    value-key="value"
                    class="w-full"
                  />
                </UFormField>

                <UFormField
                  :label="t('admin.settings.content.publicSlugLabel')"
                  name="publicSlug"
                >
                  <UInput
                    v-model="formPublicSlug"
                    class="w-full font-mono"
                    placeholder="kontakt"
                  />
                </UFormField>

                <UFormField
                  :label="t('admin.settings.content.orderLabel')"
                  name="order"
                >
                  <UInput
                    v-model.number="formOrder"
                    class="w-full"
                    type="number"
                  />
                </UFormField>
              </div>

              <UCheckbox
                v-model="formFooterVisible"
                :label="t('admin.settings.content.footerVisibleLabel')"
              />
            </template>

            <UFormField
              v-else-if="formKind === 'boilerplate'"
              :label="t('admin.settings.content.boilerplateTypeLabel')"
              name="boilerplateType"
            >
              <USelect
                v-model="formBoilerplateType"
                :items="boilerplateTypeOptions"
                value-key="value"
                class="w-full"
              />
            </UFormField>

            <template v-else-if="formKind === 'section'">
              <div class="grid gap-4 md:grid-cols-3">
                <UFormField
                  :label="t('admin.settings.content.sectionPlacementLabel')"
                  name="placement"
                >
                  <USelect
                    v-model="formDocumentPlacement"
                    :items="sectionPlacementOptions"
                    value-key="value"
                    class="w-full"
                  />
                </UFormField>

                <UFormField
                  :label="t('admin.settings.content.sectionFormLabel')"
                  name="formId"
                >
                  <USelect
                    v-model="formDocumentFormId"
                    :items="documentFormOptions"
                    value-key="value"
                    class="w-full"
                    :loading="formsLoading"
                  />
                </UFormField>

                <UFormField
                  :label="t('admin.settings.content.orderLabel')"
                  name="order"
                >
                  <UInput
                    v-model.number="formOrder"
                    class="w-full"
                    type="number"
                  />
                </UFormField>
              </div>
            </template>

            <template v-else>
              <div class="grid gap-4 md:grid-cols-3">
                <UFormField
                  :label="t('admin.settings.content.documentPlacementLabel')"
                  name="placement"
                >
                  <USelect
                    v-model="formDocumentPlacement"
                    :items="documentPlacementOptions"
                    value-key="value"
                    class="w-full"
                  />
                </UFormField>

                <UFormField
                  :label="t('admin.settings.content.documentFormLabel')"
                  name="formId"
                >
                  <USelect
                    v-model="formDocumentFormId"
                    :items="documentFormOptions"
                    value-key="value"
                    class="w-full"
                    :loading="formsLoading"
                  />
                </UFormField>

                <UFormField
                  :label="t('admin.settings.content.orderLabel')"
                  name="order"
                >
                  <UInput
                    v-model.number="formOrder"
                    class="w-full"
                    type="number"
                  />
                </UFormField>
              </div>

              <UFormField
                :label="t('admin.settings.content.documentFileLabel')"
                :help="t('admin.settings.content.documentFileHelp')"
                name="file"
                :required="isNewItem"
              >
                <UFileUpload
                  :id="documentFileInputId"
                  :key="documentFileInputKey"
                  :model-value="selectedDocumentFile"
                  accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                  :label="t('admin.settings.content.documentFileChoose')"
                  icon="i-lucide-file-up"
                  layout="list"
                  :required="isNewItem"
                  :aria-describedby="documentFileHelpId"
                  class="w-full"
                  data-testid="content-document-file"
                  @update:model-value="onDocumentFileChosen"
                />
                <p
                  v-if="selectedDocumentFile"
                  :id="documentFileHelpId"
                  class="mt-2 text-sm text-(--ui-text-muted)"
                >
                  {{ selectedDocumentFile.name }} {{ formatDocumentFileSize(selectedDocumentFile.size) }}
                </p>
                <p
                  v-else-if="editingItem?.kind === 'public_document' && editingItem.document.file"
                  :id="documentFileHelpId"
                  class="mt-2 text-sm text-(--ui-text-muted)"
                >
                  {{ editingItem.document.file.filename }} {{ formatDocumentFileSize(editingItem.document.file.size) }}
                </p>
              </UFormField>
            </template>

            <UCheckbox
              v-model="formStatus"
              :label="t('admin.settings.content.publishedLabel')"
            />

            <UFormField
              :label="t('admin.settings.content.bodyLabel')"
              :help="t('admin.settings.content.bodyHelp')"
              name="body"
            >
              <div class="mb-2 flex flex-wrap gap-2">
                <UButton
                  type="button"
                  icon="i-lucide-heading-2"
                  variant="outline"
                  color="neutral"
                  :title="t('admin.settings.content.insertHeading')"
                  :aria-label="t('admin.settings.content.insertHeading')"
                  @click="insertSnippet(`<h2>${t('admin.settings.content.headingSnippet')}</h2>`)"
                />
                <UButton
                  type="button"
                  icon="i-lucide-bold"
                  variant="outline"
                  color="neutral"
                  :title="t('admin.settings.content.insertStrong')"
                  :aria-label="t('admin.settings.content.insertStrong')"
                  @click="insertSnippet(`<p><strong>${t('admin.settings.content.strongSnippet')}</strong></p>`)"
                />
                <UButton
                  type="button"
                  icon="i-lucide-list"
                  variant="outline"
                  color="neutral"
                  :title="t('admin.settings.content.insertList')"
                  :aria-label="t('admin.settings.content.insertList')"
                  @click="insertSnippet(`<ul><li>${t('admin.settings.content.listSnippet')}</li></ul>`)"
                />
                <UButton
                  type="button"
                  icon="i-lucide-link"
                  variant="outline"
                  color="neutral"
                  :title="t('admin.settings.content.insertLink')"
                  :aria-label="t('admin.settings.content.insertLink')"
                  @click="insertSnippet(`<p><a href=&quot;https://example.org&quot; rel=&quot;noopener noreferrer&quot;>${t('admin.settings.content.linkSnippet')}</a></p>`)"
                />
              </div>
              <UTextarea
                v-model="formBody"
                class="w-full font-mono text-sm"
                :rows="12"
                autoresize
              />
            </UFormField>

            <div
              v-if="currentSavedPreview"
              class="rounded-lg border border-(--ui-border) p-4"
            >
              <div class="mb-3 flex items-center gap-2 text-sm font-medium">
                <UIcon
                  name="i-lucide-eye"
                  class="size-4"
                />
                {{ t('admin.settings.content.savedPreview') }}
              </div>
              <div
                class="prose prose-neutral dark:prose-invert max-w-none text-sm"
                v-html="currentSavedPreview"
              />
            </div>
          </form>
        </div>
      </template>

      <template #footer>
        <div class="flex w-full justify-end gap-3">
          <UButton
            type="button"
            color="neutral"
            variant="ghost"
            :disabled="saving"
            @click="closeModal"
          >
            {{ t('common.cancel') }}
          </UButton>
          <!-- Outside the form element, tied to it by `form`, so Enter in a field still saves. -->
          <UButton
            type="submit"
            :form="contentFormId"
            :loading="saving"
            :disabled="saving"
          >
            {{ t('common.save') }}
          </UButton>
        </div>
      </template>
    </UModal>
  </AppPageLayout>
</template>
