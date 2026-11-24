<script setup lang="ts">
import type { CommandPaletteGroup, CommandPaletteItem } from '@nuxt/ui';
import type {
    AdminApplicationDelegationTarget
} from '~/types';
import type { PublicOrgNode } from '~/types/org-catalog';
import {
    buildDelegationOrgPath,
    filterDelegationTargets,
    joinTargetsWithCatalog,
    type DelegationTargetWithCatalog
} from '~~/casework-layer/app/utils/delegation-palette';

type DelegationPaletteItem = CommandPaletteItem & {
    id: string
    delegationTarget: AdminApplicationDelegationTarget
    node: PublicOrgNode | null
    path: string[]
    slot: 'org' | 'target'
};

const props = withDefaults(defineProps<{
    open: boolean
    delegationTargets: AdminApplicationDelegationTarget[]
    currentResponsibilityLabel?: string | null
    jurisdictionSlug?: string | null
    noteRequired?: boolean
    busy?: boolean
}>(), {
    currentResponsibilityLabel: null,
    jurisdictionSlug: null,
    noteRequired: false,
    busy: false
});

const emit = defineEmits<{
    (event: 'update:open', value: boolean): void
    (event: 'delegate', targetUuid: string, note: string): void
}>();

const { t } = useI18n();

const searchTerm = ref('');
const note = ref('');
const pendingSelection = ref<DelegationPaletteItem | null>(null);
const { catalogOrgs, isCatalogLoading, loadCatalog } = useOrgCatalog('application-delegation');

const currentResponsibility = computed(() =>
    props.currentResponsibilityLabel || t('admin.detail.delegation.currentResponsibilityUnknown')
);

const targetsByUuid = computed(() =>
    new Map(props.delegationTargets.map(target => [target.uuid, target]))
);

const joinedTargets = computed(() =>
    joinTargetsWithCatalog(props.delegationTargets, catalogOrgs.value)
);

const filteredTargets = computed(() =>
    filterDelegationTargets(joinedTargets.value, searchTerm.value, 50)
);

const paletteItems = computed<DelegationPaletteItem[]>(() =>
    filteredTargets.value.map(item => buildPaletteItem(item))
);

const groups = computed<CommandPaletteGroup[]>(() => [
    {
        id: 'delegation-targets',
        label: t('workspaceSwitcher.organisations'),
        ignoreFilter: true,
        items: paletteItems.value
    }
]);

const selectedPath = computed(() =>
    pendingSelection.value?.path ?? []
);

const selectedPathLabel = computed(() =>
    selectedPath.value.join(' / ')
);

const noteHelp = computed(() =>
    t(props.noteRequired ? 'admin.detail.delegation.noteRequiredHint' : 'admin.detail.delegation.noteOptionalHint')
);

const notePlaceholder = computed(() =>
    t(props.noteRequired ? 'admin.detail.delegation.noteRequiredPlaceholder' : 'admin.detail.delegation.notePlaceholder')
);

const confirmDisabled = computed(() =>
    props.busy || (props.noteRequired && note.value.trim().length === 0)
);

watch(
    () => [props.open, props.jurisdictionSlug] as const,
    ([open, jurisdictionSlug]) => {
        if (open) loadCatalog(jurisdictionSlug);
    },
    { immediate: true }
);

watch(
    () => props.open,
    (open) => {
        if (!open) resetModalState();
    }
);

function buildPaletteItem(item: DelegationTargetWithCatalog): DelegationPaletteItem {
    const path = item.node?.pathLabels.slice(0, -1) ?? buildDelegationOrgPath(item.target, targetsByUuid.value);
    return {
        id: `delegation:${item.target.uuid}`,
        slot: item.node ? 'org' : 'target',
        label: item.node ? `${item.node.code} ${item.node.label}` : item.target.label,
        delegationTarget: item.target,
        node: item.node,
        path,
        onSelect: (event: Event) => selectTarget(event, item.target.uuid)
    };
}

function selectTarget(event: Event, targetUuid: string) {
    event.preventDefault();
    const item = paletteItems.value.find(candidate => candidate.delegationTarget.uuid === targetUuid) ?? null;
    if (!item) return;
    pendingSelection.value = item;
    note.value = '';
}

function typeLabel(type: string): string {
    const key = `orgSwitcher.types.${type}`;
    const translated = t(key);
    return translated === key ? type : translated;
}

function childCountLabel(count: number): string {
    return t('orgSwitcher.children', { count });
}

function resetModalState() {
    searchTerm.value = '';
    note.value = '';
    pendingSelection.value = null;
}

function updateOpen(value: boolean) {
    if (!value) resetModalState();
    emit('update:open', value);
}

function updateNote(value: unknown) {
    note.value = typeof value === 'string' ? value.slice(0, 2000) : '';
}

function backToPalette() {
    pendingSelection.value = null;
}

function confirmDelegation() {
    const selection = pendingSelection.value;
    if (!selection || confirmDisabled.value) return;
    emit('delegate', selection.delegationTarget.uuid, note.value);
}
</script>

<template>
  <UModal
    :open="open"
    :title="t('admin.detail.delegation.modalTitle')"
    :description="t('admin.detail.delegation.modalDescription', { name: currentResponsibility })"
    :ui="{ content: 'sm:max-w-3xl' }"
    :close="!busy"
    @update:open="updateOpen"
  >
    <!-- Step 1, the search list: the palette fills the dialog, the title and description stay the hidden dialog name. -->
    <template
      v-if="!pendingSelection"
      #content
    >
      <UCommandPalette
        v-model:search-term="searchTerm"
        :groups="groups"
        :placeholder="t('admin.detail.delegation.searchPlaceholder')"
        :loading="busy || isCatalogLoading"
        :close="true"
        :fuse="{ resultLimit: 50 }"
        :ui="{
          viewport: 'px-4',
          item: 'data-highlighted:not-data-disabled:text-highlighted data-highlighted:not-data-disabled:before:bg-elevated/50',
        }"
        class="h-[min(70vh,42rem)]"
        @update:open="updateOpen"
      >
        <template #org="{ item }">
          <AdminOrgCatalogItem
            v-if="item.node"
            :org="item.node"
            :type-label="typeLabel"
            :child-count-label="childCountLabel"
            show-enter-hint
          />
        </template>

        <template #target="{ item }">
          <span class="flex w-full min-w-0 items-start gap-3 text-left">
            <span class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-(--ui-bg-elevated) text-(--ui-text-muted)">
              <UIcon
                name="i-lucide-building-2"
                class="size-4"
              />
            </span>
            <span class="min-w-0 flex-1">
              <span class="block text-sm font-medium text-(--ui-text-highlighted)">
                {{ item.delegationTarget.label }}
              </span>
              <span
                v-if="item.path.length"
                class="mt-1 block truncate text-sm text-(--ui-text-muted)"
                aria-hidden="true"
              >
                {{ item.path.join(' / ') }}
              </span>
            </span>
            <UIcon
              name="i-lucide-corner-down-left"
              class="mt-1 size-4 shrink-0 text-(--ui-text-muted)"
            />
          </span>
        </template>

        <template #empty>
          {{ t('admin.detail.delegation.empty') }}
        </template>

        <template #footer>
          <p class="px-4 py-1 text-sm text-(--ui-text-muted)">
            <UIcon
              name="i-lucide-info"
              class="inline size-3.5 align-text-bottom"
            />
            {{ t('admin.detail.delegation.footerHint') }}
          </p>
        </template>
      </UCommandPalette>
    </template>

    <!-- Step 2, the confirmation: title and description come once from the dialog header. -->
    <template
      v-if="pendingSelection"
      #body
    >
      <div>
        <h3 class="mb-3 text-sm font-semibold text-(--ui-text-highlighted)">
          {{ t('admin.detail.delegation.confirmHeading') }}
        </h3>
        <div class="space-y-5">
          <div class="rounded-lg border border-(--ui-border) bg-(--ui-bg-muted) p-4">
            <p class="text-sm font-medium text-(--ui-text-highlighted)">
              {{ pendingSelection.delegationTarget.label }}
            </p>
            <p
              v-if="selectedPathLabel"
              class="mt-1 text-sm text-(--ui-text-muted)"
            >
              {{ selectedPathLabel }}
            </p>
          </div>

          <UAlert
            role="status"
            color="warning"
            icon="i-lucide-triangle-alert"
            :title="t('admin.detail.delegation.consequence')"
          />

          <UFormField
            :label="t('admin.detail.delegation.noteLabel')"
            :help="noteHelp"
            :required="noteRequired"
          >
            <UTextarea
              :model-value="note"
              :placeholder="notePlaceholder"
              :maxlength="2000"
              :rows="2"
              :maxrows="6"
              autoresize
              class="w-full"
              :disabled="busy"
              :aria-required="noteRequired"
              @update:model-value="updateNote"
            />
          </UFormField>
        </div>
      </div>
    </template>

    <template
      v-if="pendingSelection"
      #footer
    >
      <div class="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <UButton
          color="neutral"
          variant="ghost"
          icon="i-lucide-arrow-left"
          :disabled="busy"
          @click="backToPalette"
        >
          {{ t('admin.detail.delegation.back') }}
        </UButton>
        <UButton
          color="neutral"
          variant="ghost"
          icon="i-lucide-x"
          :disabled="busy"
          @click="updateOpen(false)"
        >
          {{ t('common.cancel') }}
        </UButton>
        <UButton
          icon="i-lucide-arrow-right-left"
          :loading="busy"
          :disabled="confirmDisabled"
          @click="confirmDelegation"
        >
          {{ t('admin.detail.delegation.confirmCta', { name: pendingSelection.delegationTarget.label }) }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
