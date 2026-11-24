<script setup lang="ts">
import { inject } from 'vue';
import { PUBLIC_CONTENT_RETRY_STATUS_CODES } from '~/utils/public-content-fetch';
import { startSearchExtensionKey } from '~/utils/start-search-extension';
import CitizenPage from '~/components/citizen/Page.vue';
import { getPublicWorkspaceBrand, localizedBrandText } from '~/utils/public-brand';
import PublicContentPlacement from '~/components/content/PublicContentPlacement.vue';
import { publicJurisdictionName } from '~/utils/public-jurisdiction-config';
import { publicFormPath, publicStatusLookupPath } from '~/utils/public-form-path';
import { filterFormCatalog } from '~/utils/form-catalog-search';
import { localeOrDefault } from '~/utils/locale-routing';
import {
    publicContentFooterLinks,
    type PublicContentPageListResponse
} from '~/utils/public-content-pages';
import { usePublicFooterLinks } from '~/composables/usePublicFooterLinks';

definePageMeta({
    layout: false
});

const { t, locale } = useI18n();
const route = useRoute();

interface DiscoverableForm {
    id: string
    title: string
    description: string
    status: string
    jurisdictionSlug?: string | null
    organisationSlug?: string | null
    organisationLabel?: string | null
    path?: string
}

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

interface PublicContentSectionResponse {
    data?: PublicContentSectionItem[]
}

interface PublicDocumentResponse {
    data?: PublicDocumentItem[]
}

function routeParam(value: string | string[] | undefined): string | undefined {
    return Array.isArray(value) ? value[0] : value;
}

const routeJurisdictionSlug = computed(() => routeParam(route.params.workspace as string | string[] | undefined));
const routeOrganisationSlug = computed(() => routeParam(route.params.organisation as string | string[] | undefined));
const inOrgContext = computed(() => Boolean(routeOrganisationSlug.value));
const publicWorkspace = computed(() => ({
    jurisdictionSlug: routeJurisdictionSlug.value || null,
    organisationSlug: routeOrganisationSlug.value || null
}));
const { config: publicConfig, pending: publicConfigPending } = usePublicJurisdictionConfig(
    routeJurisdictionSlug,
    routeOrganisationSlug
);
const runtimeJurisdictionName = computed(() => publicJurisdictionName(publicConfig.value));
const publicBrand = computed(() => getPublicWorkspaceBrand({ jurisdictionSlug: routeJurisdictionSlug.value }));
const startTitle = computed(() =>
    localizedBrandText(publicBrand.value?.startTitle, locale.value)
    || (runtimeJurisdictionName.value
        ? t('start.titleWithJurisdiction', { jurisdiction: runtimeJurisdictionName.value })
        : t('start.title'))
);
const scopeQuery = computed(() => {
    const query: Record<string, string> = {};
    if (routeJurisdictionSlug.value) query.jurisdiction = routeJurisdictionSlug.value;
    if (routeOrganisationSlug.value) query.organisation = routeOrganisationSlug.value;
    return query;
});

useHead({
    title: computed(() => startTitle.value)
});

// Session state from the header's shared probe; no request of this page.
const { authenticated } = useAuth();
const statusLookupPath = computed(() => publicStatusLookupPath(publicWorkspace.value));

const allForms = ref<DiscoverableForm[]>([]);
const isLoadingForms = ref(true);
const formsLoadError = ref(false);
const catalogSearchQuery = ref('');
const catalogSearchContainer = ref<HTMLElement | null>(null);
const searchExtension = inject(startSearchExtensionKey, null)?.({
    jurisdiction: routeJurisdictionSlug,
    organisation: routeOrganisationSlug,
    config: publicConfig,
    configPending: publicConfigPending,
    totalForms: computed(() => allForms.value.length)
});
const startSubtitle = computed(() =>
    localizedBrandText(publicBrand.value?.startSubtitle, locale.value)
    || searchExtension?.subtitle.value
    || t('start.catalogSubtitle')
);
const visibleForms = computed(() => filterFormCatalog(allForms.value, catalogSearchQuery.value));

// Names for the organisation sidebar from the catalogue answer the page
// already has. A label that is only the address slug is no name.
const organisationLabel = computed(() => {
    const label = allForms.value.find(form => form.organisationSlug === routeOrganisationSlug.value)?.organisationLabel;
    return label && label !== routeOrganisationSlug.value ? label : null;
});
let formsLoadSequence = 0;
const catalogRetryActions = computed(() => [{
    label: t('common.retry'),
    color: 'neutral' as const,
    variant: 'outline' as const,
    onClick: () => {
        void loadAllForms();
    }
}]);
// The page list feeds the shared footer; this page is the only one that
// asks for it, the footer of later pages reuses the answer.
const { remember: rememberFooterLinks } = usePublicFooterLinks(publicWorkspace);
let contentPagesLoadSequence = 0;
const orgStartSections = ref<PublicContentSectionItem[]>([]);
const orgStartDocuments = ref<PublicDocumentItem[]>([]);
const orgStartLoading = ref(false);
const orgStartError = ref(false);
let orgStartLoadSequence = 0;

function isNotFoundError(error: unknown): boolean {
    const candidate = error as { status?: number, statusCode?: number, response?: { status?: number } };
    return candidate.status === 404 || candidate.statusCode === 404 || candidate.response?.status === 404;
}

function hasWorkspaceScope(): boolean {
    return Boolean(routeJurisdictionSlug.value || routeOrganisationSlug.value);
}

async function loadAllForms() {
    const loadSequence = ++formsLoadSequence;
    const query = { ...scopeQuery.value, lang: localeOrDefault(locale.value) };

    isLoadingForms.value = true;
    formsLoadError.value = false;
    allForms.value = [];

    try {
    // Use the public schema proxy (no auth needed for published forms)
        const response = await $fetch<{ data: DiscoverableForm[] }>('/api/schemas/published', {
            query
        });

        if (loadSequence !== formsLoadSequence) return;

        allForms.value = response.data || [];
    } catch (e) {
        if (loadSequence !== formsLoadSequence) return;

        if (hasWorkspaceScope() && isNotFoundError(e)) {
            // The error page shows this inside the frame, with links to the
            // platform pages instead of the unknown municipality.
            // An unknown organisation under a real municipality leads back to
            // that municipality, not to the list of all municipalities.
            showError({
                statusCode: 404,
                statusMessage: 'Workspace not found',
                data: { code: routeOrganisationSlug.value ? 'organisation_not_found' : 'workspace_not_found' }
            });
            return;
        }

        console.error('[start] Failed to load forms:', e);
        allForms.value = [];
        formsLoadError.value = true;
    } finally {
        if (loadSequence === formsLoadSequence) {
            isLoadingForms.value = false;
        }
    }
}

async function degradeToCatalogSearch(query: string) {
    catalogSearchQuery.value = query;
    searchExtension?.fallBackToCatalog();
    await nextTick();
    catalogSearchContainer.value?.querySelector<HTMLInputElement>('input')?.focus();
}

async function loadContentPages() {
    const loadSequence = ++contentPagesLoadSequence;

    if (!routeJurisdictionSlug.value) {
        return;
    }

    try {
        const response = await $fetch<PublicContentPageListResponse>(
            `/api/jurisdictions/${routeJurisdictionSlug.value}/pages`,
            {
                query: {
                    lang: locale.value,
                    ...(routeOrganisationSlug.value ? { organisation: routeOrganisationSlug.value } : {})
                }
            }
        );

        if (loadSequence !== contentPagesLoadSequence) return;

        rememberFooterLinks(publicContentFooterLinks(
            response,
            localeOrDefault(locale.value),
            publicWorkspace.value
        ));
    } catch (e) {
        if (loadSequence !== contentPagesLoadSequence) return;
        rememberFooterLinks([]);
        console.error('[start] Failed to load content pages:', e);
    }
}

async function loadOrgStartContent() {
    const loadSequence = ++orgStartLoadSequence;
    orgStartSections.value = [];
    orgStartDocuments.value = [];
    orgStartError.value = false;

    if (!routeJurisdictionSlug.value) {
        orgStartLoading.value = false;
        return;
    }

    orgStartLoading.value = true;
    const query = {
        lang: locale.value,
        placement: 'org_start',
        ...(routeOrganisationSlug.value ? { organisation: routeOrganisationSlug.value } : {})
    };

    // Show any content that loads. The section reports an error only if both requests fail.
    // Retrying a rate-limited request would add load, so 429 is excluded from retries.
    const [sectionsResult, documentsResult] = await Promise.allSettled([
        $fetch<PublicContentSectionResponse>(
            `/api/jurisdictions/${routeJurisdictionSlug.value}/sections`,
            { query, retryStatusCodes: PUBLIC_CONTENT_RETRY_STATUS_CODES }
        ),
        $fetch<PublicDocumentResponse>(
            `/api/jurisdictions/${routeJurisdictionSlug.value}/documents`,
            { query, retryStatusCodes: PUBLIC_CONTENT_RETRY_STATUS_CODES }
        )
    ]);
    if (loadSequence !== orgStartLoadSequence) return;
    orgStartSections.value = sectionsResult.status === 'fulfilled' ? sectionsResult.value.data || [] : [];
    orgStartDocuments.value = documentsResult.status === 'fulfilled'
        ? (documentsResult.value.data || []).filter(item => Boolean(item.attributes.file?.url))
        : [];
    const failures = [sectionsResult, documentsResult].filter(result => result.status === 'rejected');
    orgStartError.value = failures.length === 2;
    orgStartLoading.value = false;
}

onMounted(() => {
    loadAllForms();
    loadContentPages();
    loadOrgStartContent();
});

watch([scopeQuery, locale], () => {
    loadAllForms();
});

watch(
    () => [routeJurisdictionSlug.value, routeOrganisationSlug.value, locale.value] as const,
    () => {
        loadContentPages();
        loadOrgStartContent();
    }
);

watch(
    () => [routeJurisdictionSlug.value, routeOrganisationSlug.value] as const,
    () => {
        catalogSearchQuery.value = '';
    }
);

/**
 * One row of the form list as the framework's link card (UPageCard, variant ghost): its own hover, focus ring
 * and corners. Only the layout of a list row is set here: title and chevron in one line, the card's padding
 * matches the list rows. No hover, focus or corner class is set here.
 */
const pageListCardUi = {
    container: 'flex-row items-center gap-3 p-3 sm:p-3 lg:flex',
    wrapper: 'min-w-0 min-h-8 justify-center',
    description: 'mt-0.5'
};
</script>

<template>
  <CitizenPage
    :back-to="false"
    :title="startTitle"
    show-org-switcher
    show-start-actions
  >
    <!--
      One `text` column in every shape of the page (municipality,
      office. The office is a line under the
      title and the way back to the municipality stands in the place of the
      frame's back link.
    -->
    <template
      v-if="inOrgContext"
      #back
    >
      <!-- Owner, 16.11.2026: where am I. "Stadt Musterstadt › Bürgerbüro", names from the workspace data. -->
      <OrgContextSidebar
        :workspace="publicWorkspace"
        :organisation-label="organisationLabel"
        :jurisdiction-label="runtimeJurisdictionName"
        hide-forms
        part="breadcrumb"
      />
    </template>

    <template #description>
      <OrgContextSidebar
        v-if="inOrgContext"
        :workspace="publicWorkspace"
        :organisation-label="organisationLabel"
        hide-forms
        part="name"
      />
      <p class="mt-2 max-w-prose text-base text-muted">
        {{ startSubtitle }}
      </p>
    </template>

    <!--
      For people without a session: whether an account is needed and where
      the status lookup is. Shown until the session is known to
      exist, so it never pushes the page down late.
    -->
    <template
      v-if="!authenticated"
      #meta
    >
      <p data-testid="start-account-hint">
        {{ t('start.accountHint') }}
        {{ t('start.statusLookupPrompt') }}
        <ULink
          :to="statusLookupPath"
          class="font-medium text-default underline underline-offset-2"
          data-testid="start-status-lookup-link"
        >
          {{ t('start.statusLookupLink') }}
        </ULink>
      </p>
    </template>

    <p
      v-if="routeJurisdictionSlug"
      class="sr-only"
      role="status"
      aria-live="polite"
    >
      {{ searchExtension?.announcement.value || t('start.catalogSearchAvailable') }}
    </p>
    <USkeleton
      v-if="searchExtension?.pending.value"
      data-testid="start-search-loading"
      class="h-12 w-full rounded-lg"
      aria-hidden="true"
    />
    <component
      :is="searchExtension.component"
      v-else-if="searchExtension?.available.value"
      :key="`${routeJurisdictionSlug || ''}:${routeOrganisationSlug || ''}`"
      :jurisdiction="routeJurisdictionSlug || null"
      :organisation="routeOrganisationSlug || null"
      :catalog-below="allForms.length > 0"
      @policy-blocked="degradeToCatalogSearch"
    />
    <div
      v-else
      ref="catalogSearchContainer"
      role="search"
      class="max-w-xl"
    >
      <p
        v-if="searchExtension?.fallbackNotice.value"
        class="mb-3 text-base text-muted"
        role="status"
        aria-live="polite"
      >
        {{ searchExtension.fallbackNotice.value }}
      </p>
      <UFormField
        :label="t('start.catalogFilterLabel')"
        size="xl"
      >
        <UInput
          v-model="catalogSearchQuery"
          icon="i-lucide-search"
          size="xl"
          autocomplete="off"
          class="w-full"
          data-testid="catalog-search"
          @focus="searchExtension?.engageCatalogSearch()"
          @update:model-value="searchExtension?.engageCatalogSearch()"
        />
      </UFormField>
    </div>

    <!-- Only once loaded: the heading must not flash and vanish. -->
    <PublicContentPlacement
      v-if="!orgStartLoading"
      class="mt-8"
      :title="t(inOrgContext ? 'start.publicOrgContentTitle' : 'start.publicMunicipalityContentTitle')"
      :sections="orgStartSections"
      :documents="orgStartDocuments"
      :loading="orgStartLoading"
      :error="orgStartError"
    />

    <!-- The list heading is a heading, the forms are one list. -->
    <h2
      class="mt-10 mb-3 text-xl font-semibold text-highlighted"
      data-testid="start-catalog-heading"
    >
      {{ searchExtension?.heading.value || t('start.catalogSearchResults') }}
    </h2>

    <div
      v-if="searchExtension?.showCatalogFilter.value"
      role="search"
      class="mb-4 max-w-xl"
    >
      <UFormField
        :label="t('start.catalogFilterLabel')"
        size="xl"
      >
        <UInput
          v-model="catalogSearchQuery"
          icon="i-lucide-search"
          size="xl"
          autocomplete="off"
          class="w-full"
          data-testid="catalog-filter"
        />
      </UFormField>
    </div>

    <!-- Loading -->
    <div
      v-if="isLoadingForms"
      class="space-y-3"
      aria-live="polite"
      aria-busy="true"
    >
      <span class="sr-only">{{ t('start.catalogLoading') }}</span>
      <USkeleton
        v-for="i in 3"
        :key="i"
        class="h-16 w-full rounded-lg"
      />
    </div>

    <!-- Catalog could not be loaded -->
    <UAlert
      v-else-if="formsLoadError"
      color="error"
      icon="i-lucide-circle-x"
      role="alert"
      :title="t('start.catalogLoadError')"
      :actions="catalogRetryActions"
      data-testid="start-catalog-error"
    />

    <!-- No forms available -->
    <p
      v-else-if="allForms.length === 0"
      class="py-6 text-base text-muted"
    >
      {{ t('start.noFormsAvailable') }}
    </p>

    <!-- Search returned no matching published forms -->
    <p
      v-else-if="visibleForms.length === 0"
      class="py-6 text-base text-muted"
      role="status"
    >
      {{ t('start.catalogSearchEmpty') }}
    </p>

    <!-- Form list: rows between hairlines, one link per row -->
    <template v-else>
      <p
        v-if="catalogSearchQuery.trim()"
        class="sr-only"
        role="status"
        aria-live="polite"
      >
        {{ t('start.catalogSearchCount', { count: visibleForms.length }) }}
      </p>
      <!--
        The framework's list of link cards (Nuxt UI UPageList, UPageCard with `to`): hover, focus ring, inner
        padding and rounded corners come from the theme, not from hand-written classes. The card's link is
        named by its title. The card is at least 48 px high, above the 44 px minimum target of the C-rules.
      -->
      <UPageList
        as="ul"
        divide
        class="border-y border-default"
        data-testid="start-form-list"
      >
        <li
          v-for="form in visibleForms"
          :key="form.id"
          class="py-1"
        >
          <UPageCard
            :to="publicFormPath(form)"
            variant="ghost"
            :ui="pageListCardUi"
            data-testid="start-form-link"
          >
            <!-- Up to two lines each, so long titles stay readable at 375 px. No comment inside the title slot:
                 Nuxt UI names the card's link from the slot's text. -->
            <template #title>
              <span
                class="block text-base font-medium text-highlighted line-clamp-2 break-words"
                data-testid="start-form-title"
              >{{ form.title }}</span>
            </template>
            <template
              v-if="form.description"
              #description
            >
              <span
                class="block text-sm text-muted line-clamp-2 break-words"
                data-testid="start-form-description"
              >{{ form.description }}</span>
            </template>
            <UIcon
              name="i-lucide-chevron-right"
              class="size-5 shrink-0 text-muted"
              aria-hidden="true"
            />
          </UPageCard>
        </li>
      </UPageList>
    </template>
  </CitizenPage>
</template>
