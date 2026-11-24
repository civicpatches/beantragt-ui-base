<script setup lang="ts">
import { schemaRefusalOf } from '~/utils/schema-refusal';
import type { DropdownMenuItem } from '@nuxt/ui';

interface FimCatalogItem {
    file: string
    url: string
    schemaId: string
    version?: string
    title: string
    description: string
    sections: number
    fields: number
    importedId?: string
    importedStatus?: string
    importedOrganisation?: string
}

interface FimCatalogResponse {
    query: string
    totalFiles: number
    results: FimCatalogItem[]
}

interface FimImportResponse {
    id: string
    operation: 'create'
    status: 'draft' | 'published'
    item: FimCatalogItem
}

definePageMeta({
    layout: 'dashboard',
    middleware: 'admin'
});

const { t } = useI18n();
const toast = useToast();
const router = useRouter();
const route = useRoute();
const { resolveApiErrorMessage } = useApiErrorMessage();
const { currentWorkspace, withWorkspaceQuery, workspaceRoute } = useWorkspaceContext();
const canCreateForm = computed(() => currentWorkspace.value?.canCreateFormSchema === true);

useHead({
    title: computed(() => `${t('admin.fim.title')} - beantragt.ai`)
});

const query = ref('');
const results = ref<FimCatalogItem[]>([]);
const totalFiles = ref(0);
const loading = ref(false);
const searched = ref(false);
const errorMessage = ref<string | null>(null);
const importing = ref<Record<string, boolean>>({});

const canSearch = computed(() => query.value.trim().length >= 2);
// The term the results belong to, for the no-hit line.
const searchedTerm = ref('');

const quickSearches = computed<Array<{ label: string, term: string }>>(() => [
    { label: t('admin.fim.quickSearches.dogTax'), term: 'Hundesteuer' },
    { label: t('admin.fim.quickSearches.parkingPermit'), term: 'Bewohnerparkausweis' },
    { label: t('admin.fim.quickSearches.business'), term: 'Gewerbe' },
    { label: t('admin.fim.quickSearches.housingBenefit'), term: 'Wohngeld' },
    { label: t('admin.fim.quickSearches.idCard'), term: 'Personalausweis' }
]);

async function searchCatalog() {
    if (!canSearch.value || loading.value) return;

    const workspaceKey = currentWorkspace.value?.key;
    loading.value = true;
    searched.value = true;
    errorMessage.value = null;
    const term = query.value.trim();
    // The last search stays in the address, so coming back to the page shows
    // it again instead of an empty page.
    if (route.query?.q !== term) void router.replace({ query: { ...route.query, q: term } });

    try {
        const response = await $fetch<FimCatalogResponse>('/api/admin/fim/catalog', {
            query: withWorkspaceQuery({
                q: term,
                limit: 20
            })
        });
        if (currentWorkspace.value?.key !== workspaceKey) return;
        searchedTerm.value = term;

        results.value = response.results;
        totalFiles.value = response.totalFiles;
    } catch (e) {
        if (currentWorkspace.value?.key !== workspaceKey) return;
        console.error('[fim] Catalog search failed:', e);
        errorMessage.value = resolveApiErrorMessage(e, 'admin.fim.searchErrorDescription');
        results.value = [];
    } finally {
        loading.value = false;
    }
}

async function runQuickSearch(term: string) {
    query.value = term;
    await searchCatalog();
}

onMounted(() => {
    const term = typeof route.query?.q === 'string' ? route.query.q.trim() : '';
    if (term.length >= 2) {
        query.value = term;
        void searchCatalog();
    }
});

function itemTitle(item: FimCatalogItem): string {
    return item.title || item.file;
}

// In the municipality workspace the marker names the organisation that
// imported the entry (when the person may see it); in an organisation's own
// workspace that would only repeat the workspace.
function importedLabel(item: FimCatalogItem): string {
    return item.importedOrganisation && currentWorkspace.value?.type === 'jurisdiction'
        ? t('admin.fim.alreadyImportedBy', { organisation: item.importedOrganisation })
        : t('admin.fim.alreadyImported');
}

// A second import of an entry the person already imported asks first:
// it creates a second draft next to the existing form. "Abbrechen" has the focus.
const importAgainItem = ref<FimCatalogItem | null>(null);
const importAgainOpen = computed({
    get: () => importAgainItem.value !== null,
    set: (open: boolean) => {
        if (!open) importAgainItem.value = null;
    }
});
const IMPORT_AGAIN_CANCEL_ID = 'fim-import-again-cancel';
let importAgainOpener: HTMLElement | null = null;

function formListLocation(id: string, workspace = currentWorkspace.value) {
    return { ...workspaceRoute('/admin/forms', workspace), query: { form: id } };
}

function importedMenuItems(item: FimCatalogItem): DropdownMenuItem[][] {
    return [[{
        label: t('admin.fim.importAgain'),
        slot: 'import-again',
        disabled: Boolean(importing.value[item.file]),
        onSelect: () => askImportAgain(item)
    }]];
}
function askImportAgain(item: FimCatalogItem) {
    if (!canCreateForm.value) return;
    importAgainOpener = document.getElementById(`fim-entry-${item.file}`)?.querySelector<HTMLElement>('[aria-haspopup="menu"]') ?? null;
    importAgainItem.value = item;
}
function focusImportAgainCancel(event: Event) {
    event.preventDefault();
    void nextTick(() => document.getElementById(IMPORT_AGAIN_CANCEL_ID)?.focus());
}
function restoreImportAgainFocus(event: Event) {
    const opener = importAgainOpener;
    importAgainOpener = null;
    if (!opener?.isConnected) return;
    event.preventDefault();
    opener.focus();
}
async function confirmImportAgain() {
    const item = importAgainItem.value;
    if (!item) return;
    importAgainItem.value = null;
    await importItem(item);
}

async function importItem(item: FimCatalogItem) {
    const workspace = currentWorkspace.value;
    if (!workspace?.canCreateFormSchema || importing.value[item.file]) return;

    importing.value = {
        ...importing.value,
        [item.file]: true
    };

    try {
        const response = await $fetch<FimImportResponse>('/api/admin/fim/import', {
            method: 'POST',
            query: withWorkspaceQuery(),
            body: {
                file: item.file
            }
        });

        if (currentWorkspace.value?.key === workspace.key) {
            results.value = results.value.map(result => result.file === item.file
                ? { ...result, importedId: response.id, importedStatus: response.status }
                : result);
        }

        toast.add({
            title: t('admin.fim.importCreated'),
            description: response.item.title,
            color: 'success'
        });

        clearNuxtData(`admin-schemas-${workspace.key}`);
        await router.push(formListLocation(response.id, workspace));
    } catch (e) {
        console.error('[fim] Import failed:', e);
        toast.add({
            title: t('admin.fim.importError'),
            // A draft refused for a field's condition names the field.
            description: schemaRefusalOf(e)
                ? t('admin.forms.conditionValueEmptyField', { field: schemaRefusalOf(e)!.fieldId })
                : resolveApiErrorMessage(e, 'admin.fim.importErrorDescription'),
            color: 'error'
        });
    } finally {
        importing.value = {
            ...importing.value,
            [item.file]: false
        };
    }
}
</script>

<template>
  <AppPageLayout
    :title="t('admin.fim.title')"
    :description="t('admin.fim.subtitle')"
  >
    <template #toolbar>
      <!-- One narrow form; field and button share one height. -->
      <form
        class="max-w-xl"
        data-test="fim-search-form"
        @submit.prevent="searchCatalog"
      >
        <UFormField
          :label="t('admin.fim.searchLabel')"
          :description="t('admin.fim.searchHint')"
          name="fim-query"
        >
          <UFieldGroup class="flex w-full">
            <UInput
              v-model="query"
              icon="i-lucide-search"
              class="flex-1"
            />
            <UButton
              type="submit"
              :loading="loading"
              :disabled="!canSearch"
              class="min-w-24 justify-center"
            >
              {{ t('common.search') }}
            </UButton>
          </UFieldGroup>
        </UFormField>
      </form>

      <div
        class="mt-3 flex flex-wrap items-center gap-2"
        data-test="fim-quick-searches"
      >
        <span class="text-sm text-muted">{{ t('admin.fim.quickSearchLead') }}</span>
        <UButton
          v-for="quickSearch in quickSearches"
          :key="quickSearch.term"
          type="button"
          size="sm"
          color="neutral"
          variant="outline"
          :disabled="loading"
          @click="runQuickSearch(quickSearch.term)"
        >
          {{ quickSearch.label }}
        </UButton>
      </div>
    </template>

    <AccessReason
      v-if="currentWorkspace && !canCreateForm"
      id="fim-create-access"
      :text="t('errors.schema.writeForbidden')"
    />

    <UAlert
      v-if="errorMessage"
      role="alert"
      color="error"
      icon="i-lucide-circle-x"
      :title="t('admin.fim.searchError')"
      :description="errorMessage"
      class="mb-6 max-w-3xl"
    />

    <div
      v-if="loading"
      class="space-y-2"
    >
      <USkeleton
        v-for="i in 5"
        :key="i"
        class="h-16 w-full rounded-lg"
      />
    </div>

    <div
      v-else
      aria-live="polite"
      class="space-y-3"
    >
      <!-- Before the first search, after a search without hit and above the
           hits: one muted line in the same place. -->
      <p
        class="text-sm text-muted"
        data-test="fim-result-line"
      >
        <template v-if="!searched">
          {{ t('admin.fim.beforeSearch') }}
        </template>
        <template v-else-if="!results.length">
          {{ t('admin.fim.noHits', { term: searchedTerm, total: totalFiles }) }}
        </template>
        <template v-else>
          {{ t('admin.fim.resultCount', { count: results.length, total: totalFiles }) }}
        </template>
      </p>

      <ul
        v-if="results.length"
        class="space-y-2"
      >
        <li
          v-for="item in results"
          :id="`fim-entry-${item.file}`"
          :key="item.file"
        >
          <AdminListRow
            :title="itemTitle(item)"
            :description="item.description || undefined"
            wide-actions
          >
            <template
              v-if="item.importedStatus"
              #badges
            >
              <StatusBadge
                :status="item.importedStatus"
                type="schema"
              />
            </template>
            <template #meta>
              <!-- One line without icons, parts joined with " · " (patterns 3 and 6). -->
              <span
                class="min-w-0"
                data-test="fim-row-meta"
              >
                <template v-if="item.importedId">
                  <span data-test="fim-imported">{{ importedLabel(item) }}</span>{{ ' · ' }}
                </template>{{ t('admin.fim.sectionCount', { count: item.sections }) }} · {{ t('admin.fim.fieldCount', { count: item.fields }) }} · <span
                  class="whitespace-nowrap"
                  data-test="fim-row-schema"
                >{{ t('admin.fim.schemaWord') }} <span class="font-mono">{{ item.schemaId }}</span><template v-if="item.version">, {{ t('admin.fim.versionPart', { version: item.version }) }}</template></span>
              </span>
            </template>
            <template #actions>
              <template v-if="item.importedId">
                <ULink
                  :to="formListLocation(item.importedId)"
                  class="inline-flex min-h-6 items-center text-sm font-medium text-default underline underline-offset-2"
                  :aria-label="t('admin.fim.openImportedAria', { title: itemTitle(item) })"
                  data-test="fim-open-imported"
                >
                  {{ t('admin.fim.openImported') }}
                </ULink>
                <StaffExtensionOutlet
                  name="fim-imported-actions"
                  :context="{ id: item.importedId }"
                />
                <UDropdownMenu
                  v-if="canCreateForm"
                  :items="importedMenuItems(item)"
                  :content="{ align: 'end' }"
                >
                  <UTooltip :text="t('admin.fim.moreActionsAria', { title: itemTitle(item) })">
                    <UButton
                      color="neutral"
                      variant="ghost"
                      icon="i-lucide-ellipsis"
                      :loading="importing[item.file]"
                      :aria-label="t('admin.fim.moreActionsAria', { title: itemTitle(item) })"
                      data-test="fim-row-menu"
                    />
                  </UTooltip>
                  <template #import-again-label>
                    <span data-test="fim-import-again">{{ t('admin.fim.importAgain') }}</span>
                  </template>
                </UDropdownMenu>
              </template>
              <UButton
                v-else-if="canCreateForm"
                type="button"
                color="neutral"
                variant="outline"
                icon="i-lucide-download"
                :loading="importing[item.file]"
                :aria-label="t('admin.fim.importDraftAria', { title: itemTitle(item) })"
                @click="importItem(item)"
              >
                {{ t('admin.fim.importDraft') }}
              </UButton>
            </template>
          </AdminListRow>
        </li>
      </ul>
    </div>

    <UModal
      v-if="canCreateForm"
      v-model:open="importAgainOpen"
      :title="importAgainItem ? t('admin.fim.importAgainTitle', { title: itemTitle(importAgainItem) }) : ''"
      :description="t('admin.fim.importAgainDescription')"
      :content="{ onOpenAutoFocus: focusImportAgainCancel, onCloseAutoFocus: restoreImportAgainFocus }"
    >
      <template #footer>
        <div class="flex w-full flex-wrap justify-end gap-3">
          <UButton
            :id="IMPORT_AGAIN_CANCEL_ID"
            color="neutral"
            variant="ghost"
            data-test="fim-import-again-cancel"
            @click="importAgainOpen = false"
          >
            {{ t('common.cancel') }}
          </UButton>
          <UButton
            icon="i-lucide-download"
            data-test="fim-import-again-confirm"
            @click="confirmImportAgain"
          >
            {{ t('admin.fim.importAgainConfirm') }}
          </UButton>
        </div>
      </template>
    </UModal>
  </AppPageLayout>
</template>
