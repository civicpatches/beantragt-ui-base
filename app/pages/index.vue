<script setup lang="ts">
import CitizenPage from '~/components/citizen/Page.vue';
import { getPublicWorkspaceBrandBySlug } from '~/utils/public-brand';
import { publicStartPath } from '~/utils/public-form-path';
import {
    publicJurisdictionConfigEndpoint,
    publicJurisdictionLogoDarkSrc,
    publicJurisdictionLogoSrc,
    type PublicJurisdictionConfig
} from '~/utils/public-jurisdiction-config';
import { svgLogoColorModes } from '~/utils/svg-logo-color-modes';

definePageMeta({
    layout: false
});

const { t, locale } = useI18n();

useHead({
    title: computed(() => `${t('home.title')} - beantragt.ai`)
});

interface DiscoverableForm {
    id: string
    jurisdictionSlug?: string | null
    jurisdictionLabel?: string | null
}

interface PublicJurisdiction {
    slug: string
    label: string
    formsCount: number
}

const forms = ref<DiscoverableForm[]>([]);
const jurisdictionConfigs = ref<Record<string, PublicJurisdictionConfig | null>>({});
const failedJurisdictionLogoSources = ref<Record<string, string[]>>({});
/** Logos whose derived light or dark form did not load: shown as the original on the plate. */
const failedDerivedLogoSources = ref<ReadonlySet<string>>(new Set());
const isLoading = ref(true);
const loadError = ref(false);
let loadGeneration = 0;

const jurisdictions = computed<PublicJurisdiction[]>(() => {
    const grouped = new Map<string, PublicJurisdiction>();
    for (const form of forms.value) {
        if (!form.jurisdictionSlug) continue;
        const item = grouped.get(form.jurisdictionSlug) || {
            slug: form.jurisdictionSlug,
            label: form.jurisdictionLabel || form.jurisdictionSlug,
            formsCount: 0
        };
        item.formsCount += 1;
        grouped.set(item.slug, item);
    }
    // Only what the backend returns: the bundle adds no municipality of its own.
    return [...grouped.values()].sort((a, b) => a.label.localeCompare(b.label, 'de'));
});

function jurisdictionBrand(slug: string) {
    return getPublicWorkspaceBrandBySlug(slug);
}

interface JurisdictionLogo {
    /** The logo as configured: the key for a failed load, whichever form was shown. */
    source: string
    light: string
    /** A custom dark logo uses two images without a plate. Other logos use the same plate as MunicipalityBrand. */
    dark: string | null
}

function jurisdictionLogoSrc(slug: string): string | null {
    const failedSources = new Set(failedJurisdictionLogoSources.value[slug] || []);
    const runtimeLogo = publicJurisdictionLogoSrc(jurisdictionConfigs.value[slug]);
    if (runtimeLogo && !failedSources.has(runtimeLogo)) return runtimeLogo;
    const staticLogo = jurisdictionBrand(slug)?.logoSrc || null;
    return staticLogo && !failedSources.has(staticLogo) ? staticLogo : null;
}

/**
 * The derived forms of every jurisdiction's uploaded logo, computed once per config load (not per
 * render: the helper's own cache holds only 8 logos).
 */
const derivedLogoModes = computed(() => new Map(Object.entries(jurisdictionConfigs.value).map(
    ([slug, config]) => [slug, svgLogoColorModes(publicJurisdictionLogoSrc(config))] as const
)));

/**
 * Same rule as `MunicipalityBrand`. Dark, in this order: the uploaded dark logo, the derived dark
 * form of an SVG that styles itself, none (the plate); a static brand takes its drawn dark variant.
 * Both pictures only ever as `<img src>`. A dark logo without a logo shows nothing of its own.
 */
function jurisdictionLogo(slug: string): JurisdictionLogo | null {
    const source = jurisdictionLogoSrc(slug);
    if (!source) return null;
    const runtimeLogo = publicJurisdictionLogoSrc(jurisdictionConfigs.value[slug]);
    if (source === runtimeLogo) {
        if (failedDerivedLogoSources.value.has(source)) return { source, light: source, dark: null };
        const modes = derivedLogoModes.value.get(slug) ?? null;
        const uploadedDark = publicJurisdictionLogoDarkSrc(jurisdictionConfigs.value[slug]);
        return { source, light: modes?.light || source, dark: uploadedDark || modes?.dark || null };
    }
    const staticDark = failedDerivedLogoSources.value.has(source) ? null : jurisdictionBrand(slug)?.logoDarkSrc;
    return { source, light: source, dark: staticDark || null };
}

/**
 * A derived form that does not load gives way to the original on its plate;
 * only when the original itself fails does the list fall back to the next logo or the icon.
 */
function handleJurisdictionLogoError(slug: string, logo: JurisdictionLogo | null, event: Event): void {
    if (!logo) return;
    const shown = (event.currentTarget as HTMLImageElement | null)?.getAttribute('src') || '';
    // Any picture that is not the original (uploaded dark logo, light or dark derived form, static
    // dark variant) only drops the alternatives; a second such failure must not count against the original.
    if (shown && shown !== logo.source) {
        if (!failedDerivedLogoSources.value.has(logo.source)) {
            failedDerivedLogoSources.value = new Set([...failedDerivedLogoSources.value, logo.source]);
        }
        return;
    }
    const failedSource = logo.source;
    failedJurisdictionLogoSources.value = {
        ...failedJurisdictionLogoSources.value,
        [slug]: [...new Set([...(failedJurisdictionLogoSources.value[slug] || []), failedSource])]
    };
}

async function loadJurisdictionConfigs(slugs: string[]): Promise<Record<string, PublicJurisdictionConfig | null>> {
    const entries = await Promise.all(slugs.map(async (slug) => {
        const endpoint = publicJurisdictionConfigEndpoint(slug);
        if (!endpoint) return [slug, null] as const;
        try {
            return [slug, await $fetch<PublicJurisdictionConfig>(endpoint)] as const;
        } catch (e) {
            console.error(`[home] Failed to load public jurisdiction config for ${slug}:`, e);
            return [slug, null] as const;
        }
    }));
    return Object.fromEntries(entries);
}

async function loadJurisdictions() {
    const generation = ++loadGeneration;
    isLoading.value = true;
    loadError.value = false;
    try {
        const response = await $fetch<{ data: DiscoverableForm[] }>('/api/schemas/published', {
            query: { lang: locale.value }
        });
        if (generation !== loadGeneration) return;
        forms.value = response.data || [];
        isLoading.value = false;
        const configs = await loadJurisdictionConfigs(jurisdictions.value.map(jurisdiction => jurisdiction.slug));
        if (generation !== loadGeneration) return;
        failedJurisdictionLogoSources.value = {};
        failedDerivedLogoSources.value = new Set();
        jurisdictionConfigs.value = configs;
    } catch (e) {
        if (generation !== loadGeneration) return;
        console.error('[home] Failed to load public jurisdictions:', e);
        forms.value = [];
        jurisdictionConfigs.value = {};
        loadError.value = true;
    } finally {
        if (generation === loadGeneration) isLoading.value = false;
    }
}

onMounted(() => {
    loadJurisdictions();
});

watch(locale, loadJurisdictions);
</script>

<template>
  <CitizenPage
    brand="app"
    :back-to="false"
    :title="t('home.title')"
    :lead="t('home.subtitle')"
  >
    <!-- The root page in the citizen frame: text width, no way back (it is the start). -->
    <template #meta>
      <AppExtensionOutlet name="home-actions" />
    </template>

    <div
      v-if="isLoading"
      class="space-y-3"
    >
      <USkeleton
        v-for="i in 3"
        :key="i"
        class="h-20 w-full rounded-lg"
      />
    </div>

    <UAlert
      v-else-if="loadError"
      color="error"
      icon="i-lucide-circle-x"
      :title="t('home.loadError')"
    />

    <div
      v-else-if="jurisdictions.length > 0"
      class="space-y-3"
    >
      <!-- The framework's link card (UPageCard, outline): outline, corners, hover and focus ring are the theme's. -->
      <UPageCard
        v-for="jurisdiction in jurisdictions"
        :key="jurisdiction.slug"
        :to="publicStartPath({ jurisdictionSlug: jurisdiction.slug })"
        :aria-label="jurisdiction.label"
        :ui="{ container: 'flex-row items-center gap-3 p-4 sm:gap-4 sm:p-4 lg:flex' }"
      >
        <div
          class="flex h-12 w-24 shrink-0 items-center justify-center rounded-md bg-(--ui-bg-elevated) p-2 ring-1 ring-(--ui-border) sm:w-32"
          :class="{ 'dark:bg-white': jurisdictionLogo(jurisdiction.slug) && !jurisdictionLogo(jurisdiction.slug)?.dark }"
          data-testid="jurisdiction-logo-box"
        >
          <!-- Light and dark from the framework pair (`UColorModeImage`); one picture on the plate otherwise. -->
          <UColorModeImage
            v-if="jurisdictionLogo(jurisdiction.slug)?.dark"
            :light="jurisdictionLogo(jurisdiction.slug)!.light"
            :dark="jurisdictionLogo(jurisdiction.slug)!.dark!"
            alt=""
            aria-hidden="true"
            class="max-h-full max-w-full object-contain"
            @error="handleJurisdictionLogoError(jurisdiction.slug, jurisdictionLogo(jurisdiction.slug), $event)"
          />
          <img
            v-else-if="jurisdictionLogo(jurisdiction.slug)"
            :src="jurisdictionLogo(jurisdiction.slug)!.light"
            alt=""
            aria-hidden="true"
            class="max-h-full max-w-full object-contain"
            @error="handleJurisdictionLogoError(jurisdiction.slug, jurisdictionLogo(jurisdiction.slug), $event)"
          >
          <UIcon
            v-else
            name="i-lucide-landmark"
            class="jurisdiction-logo-fallback size-5 text-(--ui-primary)"
          />
        </div>
        <!-- The name only: the address slug is no information for citizens. -->
        <div class="min-w-0 flex-1">
          <p class="font-semibold break-words text-(--ui-text)">
            {{ jurisdiction.label }}
          </p>
        </div>
        <UBadge
          color="neutral"
          class="hidden sm:inline-flex"
        >
          {{ t('home.formCount', { count: jurisdiction.formsCount }) }}
        </UBadge>
        <UIcon
          name="i-lucide-chevron-right"
          class="size-5 shrink-0 text-(--ui-text-muted)"
        />
      </UPageCard>
    </div>

    <p
      v-else
      class="rounded-lg border border-(--ui-border) p-4 text-(--ui-text-muted)"
    >
      {{ t('home.noJurisdictions') }}
    </p>

    <div class="mt-8">
      <UButton
        to="/start"
        variant="ghost"
        color="neutral"
        icon="i-lucide-list"
      >
        {{ t('home.allForms') }}
      </UButton>
    </div>
  </CitizenPage>
</template>
