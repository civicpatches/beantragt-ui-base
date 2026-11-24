<script setup lang="ts">
import type { CommandPaletteGroup, CommandPaletteItem } from '@nuxt/ui';
import type { PublicOrgNode, PublicOrgCatalogResponse } from '~/types/org-catalog';
import {
    publicMyDataPath,
    publicStartPath,
    publicWorkspaceFromKey
} from '~/utils/public-form-path';
import {
    buildWorkspacePaletteGroups,
    WORKSPACE_PALETTE_CITIZEN_VIEW_ID
} from '~~/casework-layer/app/utils/workspace-palette';
import {
    filterOrgs,
    hasCatalog,
    orgCatalogItemId,
    ORG_CATALOG_RESET_ID,
    resolveOrgWorkspaceTarget
} from '~~/casework-layer/app/utils/org-catalog-palette';
import { buildOrgBreadcrumbItems } from '~~/casework-layer/app/utils/org-breadcrumb';
import {
    buildFunctionPaletteGroups,
    focusPageSection,
    isApplicationDetailPath,
    presentApplicationSections,
    applicationSectionNotes,
    type FunctionPaletteItem
} from '~~/casework-layer/app/utils/function-search';

const props = withDefaults(defineProps<{
    collapsed?: boolean
    placement?: 'sidebar' | 'header'
}>(), {
    collapsed: false,
    placement: 'sidebar'
});

const { t } = useI18n();
const router = useRouter();
const route = useRoute();
const { isStaff, isAdmin, user } = useAuth();
const {
    workspaces,
    isLoading,
    currentWorkspace,
    selectedWorkspaceKey,
    switchWorkspace,
    loadWorkspaces,
    workspaceRoute
} = useWorkspaceContext();

const isOpen = ref(false);
const searchTerm = ref('');
let returnFocusTo: HTMLElement | undefined;

// --- Org catalog (rich org navigation for jurisdictions that have one) -------
// The Drupal-backed catalog for ALL jurisdictions still needs to be provided; the bundle
// ships none, so jurisdictions without a catalog fall back to the flat
// workspace org list below.
const catalogOrgs = ref<PublicOrgNode[]>([]);
const catalogLoadedJurisdiction = ref<string | null>(null);

const activeJurisdictionSlug = computed(() => currentWorkspace.value?.jurisdictionSlug ?? null);

const activeJurisdictionLabel = computed(() =>
    currentWorkspace.value?.jurisdictionLabel || currentWorkspace.value?.label || null
);

const knownWorkspaceKeys = computed(() => new Set(workspaces.value.map(workspace => workspace.key)));

const activeOrganisationWorkspaces = computed(() =>
    workspaces.value.filter(workspace =>
        workspace.type === 'organisation'
        && workspace.jurisdictionSlug === activeJurisdictionSlug.value
    )
);

const catalogOrgBySlug = computed(() => new Map(catalogOrgs.value.map(org => [org.slug, org])));

const adminCatalogOrgs = computed(() => {
    const jurisdictionSlug = activeJurisdictionSlug.value;
    if (!jurisdictionSlug) return [];
    return catalogOrgs.value.filter(org =>
        knownWorkspaceKeys.value.has(`${jurisdictionSlug}/${org.slug}`)
    );
});

const catalogCoversAdminWorkspaces = computed(() =>
    activeOrganisationWorkspaces.value.every(workspace =>
        Boolean(workspace.organisationSlug && catalogOrgBySlug.value.has(workspace.organisationSlug))
    )
);

const catalogAvailable = computed(() =>
    catalogLoadedJurisdiction.value === activeJurisdictionSlug.value
    && hasCatalog(adminCatalogOrgs.value)
    && catalogCoversAdminWorkspaces.value
);

/**
 * Code breadcrumb for the trigger pill. When a catalog org is selected, derive
 * the ancestor path (`VIII / 23 / 232`) from its catalog node; otherwise show a
 * single non-navigable segment (the jurisdiction label, or its short code at
 * jur-level / for jurisdictions without a catalog) so the pill never breaks.
 */
const triggerBreadcrumbItems = computed(() => {
    const workspace = currentWorkspace.value;
    const selectedOrgSlug = currentWorkspace.value?.organisationSlug ?? null;
    const orgNode = catalogAvailable.value && selectedOrgSlug
        ? catalogOrgBySlug.value.get(selectedOrgSlug) ?? null
        : null;

    if (!orgNode && workspace?.type === 'organisation') {
        const organisationName = workspace.organisationLabel || workspace.label || workspace.organisationSlug || workspace.slug;
        return buildOrgBreadcrumbItems(null, {
            code: organisationName,
            label: organisationName,
            slug: selectedOrgSlug
        });
    }

    return buildOrgBreadcrumbItems(orgNode, {
        code: workspace?.label || activeJurisdictionLabel.value || t('orgSwitcher.allShort'),
        label: workspace?.label || activeJurisdictionLabel.value || t('orgSwitcher.allShort'),
        slug: selectedOrgSlug
    });
});

const triggerChangeLabel = computed(() =>
    t('functionSearch.openSearchCurrent', {
        workspace: currentWorkspace.value?.label || activeJurisdictionLabel.value || t('common.appName')
    })
);

// Nuxt UI rewrites `meta_k` to Ctrl+K outside macOS; the announced shortcut follows.
const { macOS } = useKbd();
const shortcutAria = computed(() => (macOS.value ? 'Meta+K' : 'Control+K'));

async function loadCatalog() {
    const jurisdictionSlug = activeJurisdictionSlug.value;
    if (!jurisdictionSlug || catalogLoadedJurisdiction.value === jurisdictionSlug) return;

    try {
        const response = await $fetch<PublicOrgCatalogResponse>(`/api/orgs/${jurisdictionSlug}`);
        catalogOrgs.value = response.data || [];
    } catch (error) {
        // Non-fatal: a missing catalog simply triggers the flat-list fallback.
        console.error('[workspace-switcher] Failed to load org catalog:', error);
        catalogOrgs.value = [];
    } finally {
        catalogLoadedJurisdiction.value = jurisdictionSlug;
    }
}

onMounted(async () => {
    await loadWorkspaces();
    loadCatalog();
});

watch(activeJurisdictionSlug, () => {
    loadCatalog();
});

const currentInitial = computed(() =>
    currentWorkspace.value?.label?.trim().charAt(0).toUpperCase() || 'B'
);

const selectedPublicWorkspace = computed(() => publicWorkspaceFromKey(selectedWorkspaceKey.value));
const citizenViewPath = computed(() => publicStartPath({
    jurisdictionSlug: currentWorkspace.value?.jurisdictionSlug || selectedPublicWorkspace.value.jurisdictionSlug,
    organisationSlug: currentWorkspace.value?.organisationSlug || selectedPublicWorkspace.value.organisationSlug
}));
const profilePath = computed(() => publicMyDataPath({
    jurisdictionSlug: currentWorkspace.value?.jurisdictionSlug || selectedPublicWorkspace.value.jurisdictionSlug,
    organisationSlug: currentWorkspace.value?.organisationSlug || selectedPublicWorkspace.value.organisationSlug
}));

// --- Function search (pages and functions of the admin area) ----------------
// Same conditions as the sidebar (dashboard.vue), the middleware (admin.ts) and
// the settings cards (settings/index.vue); no permission model of its own.
const functionSearchAccess = computed(() => ({
    isStaff: isStaff.value,
    isAdmin: isAdmin.value,
    isPlatformAdmin: user.value?.roles.includes('administrator') ?? false,
    inOrganisationWorkspace: currentWorkspace.value?.type === 'organisation',
    canCreateFormSchema: currentWorkspace.value?.canCreateFormSchema === true
}));

/** Sections present on the open application page; `null` away from it. Read from the DOM. */
const applicationSections = ref<Set<string> | null>(null);
/** What the open application's cards say about themselves (for example why editing is locked). */
const sectionNotes = ref<Map<string, string>>(new Map());
/** Section (and named control) to focus once the dialog has closed; focus would otherwise return to the trigger. */
let pendingSection: { sectionId: string, focusTarget?: string } | null = null;

function refreshApplicationSections() {
    const onPage = typeof document !== 'undefined' && isApplicationDetailPath(route.path);
    applicationSections.value = onPage ? presentApplicationSections(document) : null;
    sectionNotes.value = onPage ? applicationSectionNotes(document) : new Map();
}

const functionGroups = computed(() => buildFunctionPaletteGroups({
    query: searchTerm.value,
    access: functionSearchAccess.value,
    translate: (key, params) => t(key, params ?? {}),
    resolveAdminPath: path => workspaceRoute(path).path,
    citizenViewPath: citizenViewPath.value,
    profilePath: profilePath.value,
    applicationSections: applicationSections.value,
    applicationSectionNotes: sectionNotes.value
}));

/**
 * An entry that cannot be opened is inert but stays reachable: Reka's listbox
 * leaves items with `disabled` (`data-disabled`) out of arrow-key navigation,
 * so a keyboard or screen reader user would never hear the reason line. Such
 * an entry gets `aria-disabled` instead and never a `to` (the link would
 * navigate even after `preventDefault`). Only the label is dimmed, so the
 * reason keeps full contrast.
 */
/**
 * The row Enter opens (`data-highlighted`, moved by the arrow keys and the pointer) gets the full fill and an inset
 * ring in the inverted border colour. The theme default is only `before:bg-elevated/50`, which
 * stood at 1.1:1 against the rows around it; the ring stands at 17.9:1 against the page in light (slate 900 on white)
 * and in dark (white on slate 900), and against the fill. `ring-accented` would stay at 1.5:1 (light) and 1.7:1
 * (dark), below the 3:1 of WCAG 1.4.11. A current workspace row keeps the plain full fill of `active`, without ring.
 */
// Written out in full: Tailwind finds class names only as literal strings in the source.
const paletteUi = {
    viewport: 'px-4',
    content: 'flex-1 min-h-0',
    itemDescription: 'text-clip whitespace-normal',
    item: 'data-highlighted:not-data-disabled:before:bg-elevated data-highlighted:not-data-disabled:before:ring data-highlighted:not-data-disabled:before:ring-inset data-highlighted:not-data-disabled:before:ring-inverted'
};

function toFunctionItem(item: FunctionPaletteItem): CommandPaletteItem {
    const inert = item.disabled;
    return {
        id: item.id,
        label: item.label,
        description: item.description,
        icon: item.icon,
        // Never the link's "current page" state: `ULink` would paint every entry whose target is the
        // open route like the keyboard highlight, so several rows looked selected. Only the highlight marks a row.
        active: false,
        ...(inert
            ? {
                'aria-disabled': 'true',
                'class': 'cursor-not-allowed',
                'ui': { itemLabelBase: 'text-muted', itemLeadingIcon: 'text-dimmed' }
            }
            : {}),
        ...(item.to && !inert ? { to: item.to } : {}),
        onSelect: (event: Event) => onSelectFunction(event, item)
    };
}

function onSelectFunction(event: Event, item: FunctionPaletteItem) {
    // Enter and click on an inert entry do nothing; the palette stays open.
    if (item.disabled) {
        event.preventDefault();
        return;
    }
    if (item.sectionId) {
        event.preventDefault();
        pendingSection = { sectionId: item.sectionId, ...(item.focusTarget ? { focusTarget: item.focusTarget } : {}) };
        closePalette();
        return;
    }
    // Entries with `to` navigate as a link (mouse and Enter); only close here.
    closePalette();
}

function onCloseAutoFocus(event: Event) {
    const pending = pendingSection;
    pendingSection = null;
    const opener = returnFocusTo;
    returnFocusTo = undefined;
    if (pending && typeof document !== 'undefined' && document.getElementById(pending.sectionId)) {
        event.preventDefault();
        const reducedMotion = typeof window !== 'undefined'
          && typeof window.matchMedia === 'function'
          && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        focusPageSection(document, pending.sectionId, { reducedMotion, focusTarget: pending.focusTarget });
    } else if (opener?.isConnected) {
        event.preventDefault();
        opener.focus();
    }
}

function typeLabel(type: string): string {
    const key = `orgSwitcher.types.${type}`;
    const translated = t(key);
    return translated === key ? type : translated;
}

function childCountLabel(count: number): string {
    return t('orgSwitcher.children', { count });
}

const orgGroupLabel = computed(() =>
    activeJurisdictionLabel.value
        ? `${t('workspaceSwitcher.organisations')} · ${activeJurisdictionLabel.value}`
        : t('workspaceSwitcher.organisations')
);

/**
 * Actions + Jurisdictions groups (always from the flat workspace set), plus the
 * Organisations group rendered EITHER richly from the catalog OR, as a fallback,
 * from the flat jur-scoped workspace list.
 *
 * Jurisdiction scoping is enforced two ways: the catalog is fetched per active
 * jurisdiction, and the flat builder filters orgs by `jurisdictionSlug`.
 */
const groups = computed<CommandPaletteGroup<CommandPaletteItem>[]>(() => {
    const hasQuery = searchTerm.value.trim().length > 0;
    const flatGroups = buildWorkspacePaletteGroups(
        workspaces.value,
        activeJurisdictionSlug.value,
        selectedWorkspaceKey.value,
        {
            citizenView: t('nav.citizenView'),
            jurisdictions: t('workspaceSwitcher.jurisdictions'),
            organisations: orgGroupLabel.value,
            current: `(${t('common.current')})`
        }
    );

    // Keep Actions + Jurisdictions as-is; replace the flat Organisations group
    // with the rich catalog group when a catalog is available.
    // With a query the citizen view comes from the function index (with its
    // keywords), so the action entry would only repeat it.
    const result: CommandPaletteGroup<CommandPaletteItem>[] = flatGroups
        .filter(group => !(catalogAvailable.value && group.id === 'organisations'))
        .filter(group => !(hasQuery && group.id === 'actions'))
        .map(group => ({
            id: group.id,
            label: group.label,
            items: group.items.map<CommandPaletteItem>(item => ({
                label: item.label,
                suffix: item.suffix,
                icon: item.icon,
                active: item.active,
                disabled: item.disabled,
                onSelect: (event: Event) => onSelectFlatItem(event, item.id)
            }))
        }));

    if (catalogAvailable.value && activeJurisdictionSlug.value) {
        result.push(buildCatalogGroup(activeJurisdictionSlug.value));
    }

    // Function groups use their own matcher (label, second line, keywords), so
    // the palette must not re-filter them (`ignoreFilter`, like the catalog).
    // An ignored group keeps its array position: first and last here.
    const [allowedGroup, deniedGroup] = [
        functionGroups.value.find(group => group.id === 'functions'),
        functionGroups.value.find(group => group.id === 'functions-unavailable')
    ];
    if (allowedGroup) {
        result.unshift({
            id: allowedGroup.id,
            label: allowedGroup.label,
            ignoreFilter: true,
            items: allowedGroup.items.map(toFunctionItem)
        });
    }
    if (deniedGroup) {
        result.push({
            id: deniedGroup.id,
            label: deniedGroup.label,
            ignoreFilter: true,
            items: deniedGroup.items.map(toFunctionItem)
        });
    }

    return result;
});

/**
 * Whether the dialog shows organisation entries right now. The catalog group
 * is filtered here (`ignoreFilter`) and always keeps its reset row, which is
 * the whole jurisdiction, not an organisation. The flat group is filtered
 * inside the palette by Fuse (threshold 0.1 over label and suffix),
 * approximated by a substring test.
 */
const organisationEntriesShown = computed(() => {
    const group = groups.value.find(entry => entry.id === 'organisations');
    const organisations = (group?.items ?? []).filter(item => item.id !== ORG_CATALOG_RESET_ID);
    if (organisations.length === 0) return false;
    const term = searchTerm.value.trim().toLocaleLowerCase('de');
    if (!term || group?.ignoreFilter) return true;
    return organisations.some(item => [item.label, item.suffix].some(text =>
        typeof text === 'string' && text.toLocaleLowerCase('de').includes(term)
    ));
});

/** "Organisationen werden auf … eingegrenzt" only while organisations are listed. */
const showScopeHint = computed(() => Boolean(activeJurisdictionLabel.value) && organisationEntriesShown.value);

function buildCatalogGroup(jurisdictionSlug: string): CommandPaletteGroup<CommandPaletteItem> {
    // We do our own code/label/path search, so the palette must not re-filter.
    const matches = filterOrgs(adminCatalogOrgs.value, searchTerm.value);
    const selectedOrgSlug = currentWorkspace.value?.organisationSlug ?? null;

    const items: CommandPaletteItem[] = [
        {
            id: ORG_CATALOG_RESET_ID,
            slot: 'org-reset',
            label: t('orgSwitcher.allLabel'),
            active: !selectedOrgSlug,
            disabled: !selectedOrgSlug,
            onSelect: (event: Event) => onSelectCatalog(event, jurisdictionSlug, null)
        },
        ...matches.map<CommandPaletteItem>((org) => {
            const isCurrent = org.slug === selectedOrgSlug;
            return {
                id: orgCatalogItemId(jurisdictionSlug, org.slug),
                slot: 'org',
                // label is required by the palette type and is the screen-reader
                // text; the rich visual is rendered via the #org slot.
                label: `${org.code} ${org.label}`,
                org,
                active: isCurrent,
                disabled: isCurrent,
                onSelect: (event: Event) => onSelectCatalog(event, jurisdictionSlug, org.slug)
            };
        })
    ];

    return {
        id: 'organisations',
        label: orgGroupLabel.value,
        slot: 'org',
        ignoreFilter: true,
        items
    };
}

function onSelectFlatItem(event: Event, id: string) {
    if (id === WORKSPACE_PALETTE_CITIZEN_VIEW_ID) {
        closePalette();
        router.push(citizenViewPath.value);
        return;
    }

    // Selecting the active workspace is a no-op (items are disabled too).
    if (id === selectedWorkspaceKey.value) {
        event.preventDefault();
        return;
    }

    closePalette();
    switchWorkspace(id);
}

function onSelectCatalog(event: Event, jurisdictionSlug: string, orgSlug: string | null) {
    // No-op when re-selecting the current scope.
    const currentOrgSlug = currentWorkspace.value?.organisationSlug ?? null;
    if (orgSlug === currentOrgSlug) {
        event.preventDefault();
        return;
    }

    const target = resolveOrgWorkspaceTarget(
        jurisdictionSlug,
        orgSlug,
        knownWorkspaceKeys.value
    );

    closePalette();
    if (target.workspaceKey) {
        switchWorkspace(target.workspaceKey);
    } else if (target.routePath) {
        // Safe fallback: workspace not found in the (paginated) admin set.
        router.push(target.routePath);
    }
}

/**
 * Re-scopes the admin to an ancestor org via a trigger-pill breadcrumb segment.
 * Same scoping logic as the palette, but driven by the ancestor slug directly.
 */
function selectBreadcrumbSlug(slug: string) {
    const jurisdictionSlug = activeJurisdictionSlug.value;
    if (!jurisdictionSlug || !slug || slug === currentWorkspace.value?.organisationSlug) return;

    const target = resolveOrgWorkspaceTarget(jurisdictionSlug, slug, knownWorkspaceKeys.value);
    if (target.workspaceKey) {
        switchWorkspace(target.workspaceKey);
    } else if (target.routePath) {
        router.push(target.routePath);
    }
}

function openPalette() {
    refreshApplicationSections();
    isOpen.value = true;
    loadCatalog();
}

defineExpose({ openFrom(opener: HTMLElement) {
    returnFocusTo = opener;
    openPalette();
} });

function closePalette() {
    isOpen.value = false;
}

// Reset the search term whenever the palette closes (ESC, backdrop, selection).
watch(isOpen, (open) => {
    if (!open) searchTerm.value = '';
});

// Cards that load late may appear while the palette is open.
watch(searchTerm, () => {
    if (isOpen.value) refreshApplicationSections();
});

// `meta_k` is auto-rewritten to Ctrl on non-mac platforms by Nuxt UI, so a
// separate `ctrl_k` would make Ctrl+K fire on macOS too.
defineShortcuts({
    meta_k: openPalette
});
</script>

<template>
  <div>
    <!-- Collapsed sidebar: compact avatar button opens the palette. The framework's button (neutral ghost, full
         width) brings hover and focus ring; only the height is ours. -->
    <UButton
      v-if="props.collapsed"
      color="neutral"
      variant="ghost"
      block
      class="py-3"
      :aria-label="triggerChangeLabel"
      :aria-keyshortcuts="shortcutAria"
      @click="openPalette"
    >
      <UAvatar
        :text="currentInitial"
        class="bg-primary text-inverted"
      />
    </UButton>

    <!-- Expanded trigger. In the dashboard header this gets room for long org paths. -->
    <div
      v-else
      :class="props.placement === 'header'
        ? 'flex min-w-0 flex-1 items-center'
        : 'flex flex-col gap-1 px-3 py-2'"
    >
      <span
        v-if="props.placement !== 'header'"
        class="shrink-0 text-sm text-(--ui-text-muted)"
      >
        {{ t('nav.workspace') }}
      </span>
      <AdminOrgBreadcrumbPill
        :items="triggerBreadcrumbItems"
        :change-label="triggerChangeLabel"
        :wide="props.placement === 'header'"
        @open="openPalette"
        @select="selectBreadcrumbSlug"
      />
    </div>

    <UModal
      v-model:open="isOpen"
      :title="t('workspaceSwitcher.title')"
      :description="t('workspaceSwitcher.subtitle')"
      :ui="{ content: 'sm:max-w-3xl' }"
      :content="{ onCloseAutoFocus }"
    >
      <template #content>
        <UCommandPalette
          v-model:search-term="searchTerm"
          :groups="groups"
          :placeholder="t('workspaceSwitcher.searchPlaceholder')"
          :loading="isLoading"
          :close="true"
          :fuse="{ resultLimit: 50 }"
          :ui="paletteUi"
          class="h-[min(70vh,42rem)]"
        >
          <template #org="{ item }">
            <AdminOrgCatalogItem
              v-if="item.org"
              :org="item.org"
              :active="item.active"
              :type-label="typeLabel"
              :child-count-label="childCountLabel"
            />
          </template>
          <template #org-reset="{ item }">
            <AdminOrgCatalogItem
              reset
              :active="item.active"
              :reset-label="t('orgSwitcher.allLabel')"
              :reset-description="t('orgSwitcher.allDescription')"
            />
          </template>

          <template #empty>
            {{ t('workspaceSwitcher.noResults') }}
          </template>
          <!-- The foot speaks only when it has something to say: the sentence about narrowed
               organisations. What the dialog does stays its description for screen readers (UModal). -->
          <template
            v-if="showScopeHint"
            #footer
          >
            <p
              class="px-4 py-2 text-sm text-muted"
              data-testid="workspace-switcher-scope"
            >
              {{ t('workspaceSwitcher.scopedTo', { jurisdiction: activeJurisdictionLabel }) }}
            </p>
          </template>
        </UCommandPalette>
      </template>
    </UModal>
  </div>
</template>
