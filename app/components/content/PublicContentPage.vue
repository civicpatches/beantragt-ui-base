<script setup lang="ts">
import CitizenPage from '~/components/citizen/Page.vue';
import {
    publicMyDataPath,
    publicWorkspacePath,
    publicWorkspaceFromRoute
} from '~/utils/public-form-path';
import {
    localizedContentPagePath,
    normalizeSupportedLocale,
    publicContentPageKeyFromIdentifier,
    type PublicContentPageKey,
    type SupportedLocale,
    withLocaleQuery
} from '~/utils/locale-routing';
import { PUBLIC_CONTENT_FALLBACKS } from '~/utils/public-content-fallbacks';

interface ContentPageResponse {
    data?: {
        id: string
        attributes?: {
            key?: string
            title?: string
            body?: {
                value?: string
                processed?: string
                format?: string | null
            }
            path?: string | null
            langcode?: string
            changed?: number
        }
    }
}

const props = defineProps<{
    pageKey?: PublicContentPageKey
    pageIdentifier?: string
    defaultLocale: SupportedLocale
    fallbackTitleDe?: string
    fallbackTitleEn?: string
    fallbackHtmlDe?: string
    fallbackHtmlEn?: string
}>();

const { t } = useI18n();
const { authenticated } = useAuth();
const route = useRoute();
const router = useRouter();
const publicWorkspace = computed(() => publicWorkspaceFromRoute(route));
// Language of this page's text. The app language follows the same rule in
// the locale plugin, which also never stores it: only the header's
// language switch changes the language of later pages.
const effectiveLocale = computed<SupportedLocale>(() =>
    normalizeSupportedLocale(route.query.lang) ?? props.defaultLocale
);
const contentIdentifier = computed(() =>
    (props.pageIdentifier || props.pageKey || '').trim().toLowerCase()
);
/** The standard page this is (privacy, legal notice, ...), also when opened by slug. */
const standardKey = computed(() => props.pageKey ?? publicContentPageKeyFromIdentifier(contentIdentifier.value));
const standardFallback = computed(() => standardKey.value ? PUBLIC_CONTENT_FALLBACKS[standardKey.value] : null);

const fallbackTitle = computed(() => effectiveLocale.value === 'en'
    ? (props.fallbackTitleEn || standardFallback.value?.titleEn || '')
    : (props.fallbackTitleDe || standardFallback.value?.titleDe || '')
);

const fallbackHtml = computed(() => effectiveLocale.value === 'en'
    ? (props.fallbackHtmlEn || standardFallback.value?.htmlEn || '')
    : (props.fallbackHtmlDe || standardFallback.value?.htmlDe || '')
);

// The skip link itself lives in AppHeader (`skip-to`), one per page.
const mainContentId = 'public-content-main';
const mainTitleId = 'public-content-title';

const myDataPath = computed(() => publicMyDataPath(publicWorkspace.value));

const page = ref<ContentPageResponse['data'] | null>(null);

// The privacy policy text is editable per tenant; this fixed link reaches
// signed-in citizens on every tenant, also those with their own text.
// Workspace tenants open it as /{workspace}/pages/privacy (identifier only).
const isPrivacyPage = computed(() =>
    standardKey.value === 'privacy'
    || page.value?.attributes?.key === 'privacy'
);

const pagePath = computed(() => {
    if (!props.pageKey) {
        return route.path;
    }

    const localized = localizedContentPagePath(
        props.pageKey,
        effectiveLocale.value,
        publicWorkspace.value
    );
    return localized.split('?', 1)[0] || '/';
});

const isLoading = ref(false);
const loadError = ref(false);
const isNotFound = ref(false);
let loadSequence = 0;

const PUBLIC_CONTENT_PATH_PATTERN = /^\/pages\/[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/u;

function encodeApiPathSegment(segment: string): string {
    return encodeURIComponent(segment);
}

// One URL per page and language: `/impressum` is the German page,
// `/legal-notice` the English one; `/impressum?lang=en` moves to the second.
// No app-wide locale change here.
async function canonicalizeRoute() {
    if (
        route.path !== pagePath.value
        || normalizeSupportedLocale(route.query.lang) !== effectiveLocale.value
    ) {
        await router.replace({
            path: pagePath.value,
            query: withLocaleQuery(route.query, effectiveLocale.value),
            hash: route.hash
        });
    }
}

async function canonicalizeLoadedPage(data: ContentPageResponse['data'] | null) {
    const apiPath = data?.attributes?.path;
    if (
        !publicWorkspace.value.jurisdictionSlug
        || typeof apiPath !== 'string'
        || !PUBLIC_CONTENT_PATH_PATTERN.test(apiPath)
    ) {
        return;
    }

    const targetPath = `${publicWorkspacePath(publicWorkspace.value)}${apiPath}`;
    if (
        route.path !== targetPath
        || normalizeSupportedLocale(route.query.lang) !== effectiveLocale.value
    ) {
        await router.replace({
            path: targetPath,
            query: withLocaleQuery(route.query, effectiveLocale.value),
            hash: route.hash
        });
    }
}

function isNotFoundError(error: unknown): boolean {
    const candidate = error as { status?: number, statusCode?: number, response?: { status?: number } };
    return candidate.status === 404 || candidate.statusCode === 404 || candidate.response?.status === 404;
}

async function loadPage() {
    const jurisdictionSlug = publicWorkspace.value.jurisdictionSlug;
    const sequence = ++loadSequence;
    page.value = null;
    loadError.value = false;
    isNotFound.value = false;

    if (!jurisdictionSlug) {
        return;
    }
    if (!contentIdentifier.value) {
        loadError.value = true;
        isNotFound.value = true;
        return;
    }

    isLoading.value = true;
    try {
        const jurisdictionPathSegment = encodeApiPathSegment(jurisdictionSlug);
        const pagePathSegment = encodeApiPathSegment(contentIdentifier.value);
        const response = await $fetch<ContentPageResponse>(
            `/api/jurisdictions/${jurisdictionPathSegment}/pages/${pagePathSegment}`,
            {
                query: {
                    lang: effectiveLocale.value,
                    ...(publicWorkspace.value.organisationSlug ? { organisation: publicWorkspace.value.organisationSlug } : {})
                }
            }
        );
        if (sequence !== loadSequence) return;
        page.value = response.data ?? null;
        await canonicalizeLoadedPage(page.value);
    } catch (error) {
        if (sequence !== loadSequence) return;
        isNotFound.value = isNotFoundError(error);
        loadError.value = true;
    } finally {
        if (sequence === loadSequence) {
            isLoading.value = false;
        }
    }
}

/**
 * A standard page the municipality has not filled in yet shows the neutral
 * text that names what is missing, instead of "page not found". Only an
 * unknown page identifier is a real not-found.
 */
const showsStandardFallback = computed(() =>
    !publicWorkspace.value.jurisdictionSlug
    || (isNotFound.value && standardFallback.value !== null)
);
const showsNotFound = computed(() =>
    Boolean(publicWorkspace.value.jurisdictionSlug) && isNotFound.value && standardFallback.value === null
);
const showsLoadError = computed(() =>
    Boolean(publicWorkspace.value.jurisdictionSlug) && loadError.value && !isNotFound.value
);

const title = computed(() => {
    if (showsNotFound.value) return t('content.pageNotFoundTitle');
    return page.value?.attributes?.title || fallbackTitle.value || (showsLoadError.value ? t('content.pageLoadFailed') : '');
});

const bodyHtml = computed(() => {
    const body = page.value?.attributes?.body?.processed;
    if (body) return body;
    if (!showsStandardFallback.value) return '';
    // The neutral privacy text links "Meine Daten"; in a workspace that is
    // the workspace's own page.
    return fallbackHtml.value.replaceAll('href="/meine-daten"', `href="${myDataPath.value}"`);
});

const retryActions = computed(() => [{
    label: t('common.retry'),
    icon: 'i-lucide-refresh-cw',
    color: 'neutral' as const,
    variant: 'outline' as const,
    onClick: () => {
        void loadPage();
    }
}]);

watch(
    () => [route.path, route.query.lang, publicWorkspace.value.jurisdictionSlug, publicWorkspace.value.organisationSlug, effectiveLocale.value] as const,
    async () => {
        await canonicalizeRoute();
        await loadPage();
    },
    { immediate: true }
);

useHead({
    title: computed(() => `${title.value} - beantragt.ai`)
});
</script>

<template>
  <CitizenPage
    :width="showsNotFound ? 'narrow' : 'text'"
    :main-id="mainContentId"
    :title="title"
    :title-id="mainTitleId"
    :title-lang="showsNotFound ? undefined : effectiveLocale"
    :busy="isLoading"
    back-test-id="public-content-forms"
  >
    <!--
      Frame width `text` (768 px), the text itself at most 65
      characters per line; a page that does not exist is a narrow page with
      its title and one sentence, the frame's back link is the way out.
    -->
    <template
      v-if="showsNotFound"
      #description
    >
      <p
        class="mt-2 max-w-prose text-base text-muted"
        data-testid="public-content-not-found"
      >
        {{ t('content.pageNotFoundDescription') }}
      </p>
    </template>

    <!-- Privacy page, signed in: the way to the own data is the meta line of the head. -->
    <template
      v-if="authenticated && isPrivacyPage && !showsNotFound"
      #meta
    >
      <ULink
        :to="myDataPath"
        class="inline-flex min-h-6 items-center font-medium text-default underline underline-offset-2"
        data-testid="public-content-my-data"
      >
        {{ t('content.myDataLink') }}
      </ULink>
    </template>

    <div
      v-if="isLoading"
      class="max-w-prose space-y-4"
    >
      <USkeleton class="h-5 w-full" />
      <USkeleton class="h-5 w-11/12" />
      <USkeleton class="h-5 w-4/5" />
    </div>

    <UAlert
      v-else-if="showsLoadError"
      color="error"
      icon="i-lucide-circle-x"
      :title="t('content.pageLoadFailed')"
      :actions="retryActions"
      class="max-w-3xl"
      data-testid="public-content-load-error"
    />

    <!-- Sanitized HTML from beantragt_content, or the fixed texts in public-content-fallbacks.ts. -->
    <div
      v-else-if="!showsNotFound"
      class="legal-content max-w-none break-words text-default"
      :lang="effectiveLocale"
      data-testid="public-content-body"
      v-html="bodyHtml"
    />
  </CitizenPage>
</template>

<style scoped>
/*
 * Typography of the page text. The Tailwind typography plugin is not
 * installed, so `prose` did nothing and section headings looked like body
 * text. Rules taken over from Mark-a-Spot's LegalPageLayout.vue.
 */
.legal-content :deep(h2) {
    font-size: 1.25rem;
    line-height: 1.4;
    font-weight: 600;
    margin: 2rem 0 0.75rem;
}

.legal-content :deep(h3) {
    font-size: 1rem;
    line-height: 1.5;
    font-weight: 600;
    margin: 1.5rem 0 0.5rem;
}

.legal-content :deep(h4) {
    font-size: 1rem;
    font-weight: 500;
    margin: 1.25rem 0 0.5rem;
}

/* Headings in the heading colour, the text in the text colour. */
.legal-content :deep(h2),
.legal-content :deep(h3),
.legal-content :deep(h4) {
    color: var(--ui-text-highlighted);
}

/* About 65 characters per line; tables keep the column. */
.legal-content :deep(p),
.legal-content :deep(ul),
.legal-content :deep(ol),
.legal-content :deep(h2),
.legal-content :deep(h3),
.legal-content :deep(h4) {
    max-width: 65ch;
}

.legal-content :deep(> :first-child),
.legal-content :deep(section:first-child > :first-child) {
    margin-top: 0;
}

.legal-content :deep(p) {
    line-height: 1.7;
    margin: 0 0 1rem;
}

.legal-content :deep(ul),
.legal-content :deep(ol) {
    padding-left: 1.5rem;
    margin: 0 0 1rem;
}

.legal-content :deep(ul) {
    list-style: disc;
}

.legal-content :deep(ol) {
    list-style: decimal;
}

.legal-content :deep(li) {
    line-height: 1.6;
    margin-bottom: 0.375rem;
}

.legal-content :deep(a) {
    color: var(--ui-text-highlighted);
    text-decoration: underline;
    text-underline-offset: 2px;
    overflow-wrap: anywhere;
}

.legal-content :deep(table) {
    width: 100%;
    border-collapse: collapse;
    margin: 0 0 1rem;
    font-size: 0.875rem;
}

/* Scroll wide tables on phones only; on wider screens they span the column. */
@media (max-width: 640px) {
    .legal-content :deep(table) {
        display: block;
        max-width: 100%;
        overflow-x: auto;
    }
}

.legal-content :deep(th),
.legal-content :deep(td) {
    border: 1px solid var(--ui-border);
    padding: 0.5rem;
    text-align: left;
    vertical-align: top;
}

.legal-content :deep(pre),
.legal-content :deep(code) {
    max-width: 100%;
    overflow-wrap: anywhere;
}
</style>
