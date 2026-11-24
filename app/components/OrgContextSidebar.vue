<script setup lang="ts">
import type { PublicFormPathInput } from '~/utils/public-form-path';
import { publicFormPath, publicStartPath } from '~/utils/public-form-path';
import type { PublicOrgNode, PublicOrgCatalogResponse } from '~/types/org-catalog';
import type { DiscoverableForm } from '~/utils/org-forms';
import { filterFormsByOrg } from '~/utils/org-forms';

/**
 * Citizen org-context sidebar: the current org's name as the leading
 * heading, the active org's forms and the way back to all forms of the
 * municipality. Renders when an organisation is active.
 * Citizen-only — no ancestry breadcrumb, no codes, no ⌘K, no command palette.
 */
const props = defineProps<{
    workspace: PublicFormPathInput
    hideForms?: boolean
    /** Name of the organisation from an answer the page already holds. */
    organisationLabel?: string | null
    /** Name of the municipality from the workspace data, for the breadcrumb. */
    jurisdictionLabel?: string | null
    /**
     * Start page of an office: `back` renders
     * only the way back to the municipality in the place of the frame's back
     * link, `name` only the office name as a line under the page title.
     * `breadcrumb` (owner, 16.11.2026): "Stadt Musterstadt › Bürgerbüro" in that place, the first entry leading to the
     * municipality's start page; while a name is unknown it stays the way back.
     * `card` (default) is the side column of before.
     */
    part?: 'card' | 'back' | 'name' | 'breadcrumb'
}>();

const { t, locale } = useI18n();

const jurisdictionSlug = computed(() => props.workspace.jurisdictionSlug || null);
const organisationSlug = computed(() => props.workspace.organisationSlug || null);

// --- Catalog (gate + current org's readable name) ----------------------------
const catalogOrgs = ref<PublicOrgNode[]>([]);
const catalogLoadedJurisdiction = ref<string | null>(null);

// No name made up from the address slug: "citizen-services" became an
// English "Citizen Services" on a German page. Without a real label
// the sidebar shows no name.
const fallbackOrgLabel = computed(() => {
    const label = props.organisationLabel
      || orgForms.value.find(form => form.organisationSlug === organisationSlug.value)?.organisationLabel;
    return label && label !== organisationSlug.value ? label : null;
});
const currentOrgLabel = computed(() => {
    if (!organisationSlug.value) return null;
    return catalogOrgs.value.find(org => org.slug === organisationSlug.value)?.label
      ?? fallbackOrgLabel.value;
});
const jurisdictionStartPath = computed(() => publicStartPath({ jurisdictionSlug: jurisdictionSlug.value }));
const breadcrumbItems = computed(() => props.jurisdictionLabel && currentOrgLabel.value
    ? [{ label: props.jurisdictionLabel, to: jurisdictionStartPath.value }, { label: currentOrgLabel.value }]
    : null);

async function loadCatalog() {
    // The back link needs no data: no request for it.
    if (props.part === 'back') return;
    if (!jurisdictionSlug.value || !organisationSlug.value) {
        catalogOrgs.value = [];
        return;
    }
    if (catalogLoadedJurisdiction.value === jurisdictionSlug.value) return;

    try {
        const response = await $fetch<PublicOrgCatalogResponse>(`/api/orgs/${jurisdictionSlug.value}`);
        catalogOrgs.value = response.data || [];
    } catch (error) {
        // Non-fatal: a missing catalog simply keeps the sidebar hidden.
        console.error('[org-sidebar] Failed to load org catalog:', error);
        catalogOrgs.value = [];
    } finally {
        catalogLoadedJurisdiction.value = jurisdictionSlug.value;
    }
}

// --- Org-scoped forms --------------------------------------------------------
const orgForms = ref<DiscoverableForm[]>([]);
const isLoadingForms = ref(false);
let formsLoadSequence = 0;

async function loadOrgForms() {
    if (props.hideForms) {
        orgForms.value = [];
        isLoadingForms.value = false;
        return;
    }

    if (!jurisdictionSlug.value || !organisationSlug.value) {
        orgForms.value = [];
        return;
    }

    const loadSequence = ++formsLoadSequence;
    isLoadingForms.value = true;

    try {
        const response = await $fetch<{ data: DiscoverableForm[] }>('/api/schemas/published', {
            query: {
                jurisdiction: jurisdictionSlug.value,
                organisation: organisationSlug.value,
                lang: locale.value
            }
        });
        if (loadSequence !== formsLoadSequence) return;
        // Defensive client-side scoping on top of the server filter.
        orgForms.value = filterFormsByOrg(response.data || [], jurisdictionSlug.value, organisationSlug.value);
    } catch (error) {
        if (loadSequence !== formsLoadSequence) return;
        console.error('[org-sidebar] Failed to load org forms:', error);
        orgForms.value = [];
    } finally {
        if (loadSequence === formsLoadSequence) {
            isLoadingForms.value = false;
        }
    }
}

const isVisible = computed(() => Boolean(organisationSlug.value));

function reload() {
    loadCatalog();
    loadOrgForms();
}

onMounted(reload);
watch([jurisdictionSlug, organisationSlug, locale], () => {
    catalogLoadedJurisdiction.value = null;
    reload();
});

/** The organisation's forms as items of the vertical navigation (label, target, chevron). */
const formLinks = computed(() => orgForms.value.map(form => ({
    label: form.title,
    to: publicFormPath(form),
    trailingIcon: 'i-lucide-chevron-right'
})));
</script>

<template>
  <UBreadcrumb
    v-if="isVisible && part === 'breadcrumb' && jurisdictionSlug && breadcrumbItems"
    :items="breadcrumbItems"
    class="mb-4"
    data-testid="org-breadcrumb"
  />
  <ULink
    v-else-if="isVisible && (part === 'back' || part === 'breadcrumb') && jurisdictionSlug"
    :to="jurisdictionStartPath"
    class="mb-4 -ms-1 inline-flex min-h-6 items-center gap-1.5 text-sm text-muted hover:text-default"
    data-testid="org-sidebar-all-forms"
  >
    <UIcon
      name="i-lucide-chevron-left"
      class="size-4 shrink-0"
      aria-hidden="true"
    />
    {{ t('orgSidebar.allForms') }}
  </ULink>
  <p
    v-else-if="isVisible && part === 'name' && currentOrgLabel"
    class="mt-1 text-base font-medium text-default"
    data-testid="org-sidebar-name"
  >
    {{ currentOrgLabel }}
  </p>
  <aside
    v-else-if="isVisible && (part ?? 'card') === 'card'"
    :aria-label="currentOrgLabel || t('orgSidebar.ariaLabel')"
    class="flex flex-col gap-6 rounded-xl border border-(--ui-border) bg-(--ui-bg-elevated)/40 p-4 sm:p-5"
  >
    <!-- Current organisation name as the leading heading -->
    <div v-if="currentOrgLabel">
      <p class="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
        {{ t('orgSidebar.eyebrow') }}
      </p>
      <h2 class="mt-0.5 text-lg font-semibold text-(--ui-text-highlighted)">
        {{ currentOrgLabel }}
      </h2>
    </div>

    <!-- a. Forms of this organisation -->
    <section v-if="!props.hideForms">
      <h2 class="mb-2 flex items-center gap-2 text-sm font-semibold text-(--ui-text-highlighted)">
        <UIcon
          name="i-lucide-file-text"
          class="size-4 text-(--ui-text-muted)"
        />
        {{ t('orgSidebar.formsTitle') }}
      </h2>

      <div
        v-if="isLoadingForms"
        class="space-y-2"
      >
        <USkeleton
          v-for="i in 3"
          :key="i"
          class="h-10 w-full rounded-lg"
        />
      </div>

      <p
        v-else-if="orgForms.length === 0"
        class="text-sm text-(--ui-text-muted)"
      >
        {{ t('orgSidebar.formsEmpty') }}
      </p>

      <!-- The framework's vertical navigation: hover, focus ring, padding and corners of each link come from the
           theme (rows to the framework). One link per form, the chevron as its trailing icon. -->
      <UNavigationMenu
        v-else
        orientation="vertical"
        :items="formLinks"
        :aria-label="t('orgSidebar.formsTitle')"
        data-testid="org-sidebar-forms"
      />
    </section>

    <!--
      The way back to the whole offer of the municipality. The former
      "Über diese Organisation" card only said that information would follow;
      it returns when the organisation has real information to show.
    -->
    <ULink
      v-if="jurisdictionSlug"
      :to="jurisdictionStartPath"
      class="inline-flex items-center gap-1.5 self-start py-1 text-sm font-medium text-(--ui-text) underline underline-offset-2"
      data-testid="org-sidebar-all-forms"
    >
      <UIcon
        name="i-lucide-arrow-left"
        class="size-4 shrink-0"
        aria-hidden="true"
      />
      {{ t('orgSidebar.allForms') }}
    </ULink>
  </aside>
</template>
