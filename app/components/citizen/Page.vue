<script setup lang="ts">
import { CITIZEN_CONTAINER_CLASS } from '~/utils/citizen-layout';
import AppSourceLink from '~/components/AppSourceLink.vue';
import { sourceCodeHref } from '~/utils/source-link';
import {
    publicHomePath,
    publicWorkspaceFromRoute,
    type PublicFormPathInput
} from '~/utils/public-form-path';

/**
 * This frame gives citizen pages a common layout:
 * one background, the shared header, `main` in the header's container with
 * one of three column widths, the page head (back link, `h1`, lead, meta,
 * at most one action) and the shared footer. Pages put their content into
 * the default slot and write no wrapper, `main` or `h1` classes of their own.
 */
type CitizenPageWidth = 'wide' | 'text' | 'narrow';

const props = withDefaults(defineProps<{
    /** `wide`: the whole container (page with a side column); `text`: 768 px; `narrow`: 448 px. */
    width?: CitizenPageWidth
    title?: string
    lead?: string
    /** "Zurück zur Startseite" above the title; off on the start pages themselves. */
    backTo?: boolean
    mainId?: string
    /** Name of `main` when it has no `h1` of its own to point at. */
    mainLabel?: string
    /** Id of the `h1`; `main` is then labelled by it. */
    titleId?: string
    /** Language of the title when it differs from the page (legal pages). */
    titleLang?: string
    busy?: boolean
    /** Form in an iframe: no header, no footer. */
    embed?: boolean
    /**
     * False only for pages that still bring their own containers and head
     * (the start and form pages): header and footer
     * of the frame, `main` without container, column and head.
     */
    container?: boolean
    /** Header brand, as `AppHeader`. */
    brand?: 'municipality' | 'app'
    /** Workspace of header, footer and back link; defaults to the route. */
    workspace?: PublicFormPathInput
    showOrgSwitcher?: boolean
    /** Include registered start-page actions in the footer. */
    showStartActions?: boolean
    /** Staff login already shows the product links below the form. */
    hideFooterProductLinks?: boolean
    /** The page body already links to the status lookup. */
    hideFooterStatusLookup?: boolean
    /** Test id of the back link, for pages whose tests and tours know it by an older id. */
    backTestId?: string
    /** Test id of `main`, for pages whose tests know it by an older id. */
    mainTestId?: string
}>(), {
    width: 'text',
    title: undefined,
    lead: undefined,
    backTo: true,
    mainId: 'main-content',
    mainLabel: undefined,
    titleId: undefined,
    titleLang: undefined,
    busy: false,
    embed: false,
    container: true,
    brand: 'municipality',
    workspace: undefined,
    showOrgSwitcher: false,
    backTestId: 'citizen-page-back',
    mainTestId: 'citizen-page-main'
});

const slots = defineSlots<{
    default?: () => unknown
    /** Replaces the back link above the title (start page of an office: the way to the municipality). */
    back?: () => unknown
    title?: () => unknown
    description?: () => unknown
    meta?: () => unknown
    actions?: () => unknown
    aside?: () => unknown
}>();

const { t } = useI18n();
const route = useRoute();
const frameWorkspace = computed(() => props.workspace ?? publicWorkspaceFromRoute(route));
const homePath = computed(() => publicHomePath(frameWorkspace.value));

const COLUMN_CLASS: Record<CitizenPageWidth, string> = {
    wide: 'w-full',
    text: 'mx-auto w-full max-w-3xl',
    narrow: 'mx-auto w-full max-w-md'
};

const mainClass = computed(() => {
    if (!props.container) return 'w-full flex-1 focus:outline-none';
    return [
        CITIZEN_CONTAINER_CLASS,
        'flex-1 focus:outline-none',
        props.embed ? 'py-4' : 'py-8 sm:py-10'
    ].join(' ');
});

const hasHead = computed(() => Boolean(
    props.title || props.lead || slots.title || slots.description || slots.meta || slots.actions
));
const showBackLink = computed(() => props.container && props.backTo && !props.embed);
const { public: runtimePublic } = useRuntimeConfig();
const sourceHref = computed(() => sourceCodeHref(runtimePublic.sourceUrl, runtimePublic.appVersion));
</script>

<template>
  <div class="flex min-h-dvh flex-col bg-default">
    <AppHeader
      v-if="!embed"
      :skip-to="mainId"
      :brand="brand"
      :workspace="workspace"
      :show-org-switcher="showOrgSwitcher"
      class="print:hidden"
    />

    <main
      :id="mainId"
      tabindex="-1"
      :class="mainClass"
      :aria-label="mainLabel"
      :aria-labelledby="mainLabel ? undefined : titleId"
      :aria-busy="busy ? 'true' : undefined"
      :data-testid="mainTestId"
    >
      <slot v-if="!container" />

      <div
        v-else
        :class="COLUMN_CLASS[width]"
        :data-width="width"
        data-testid="citizen-page-column"
      >
        <!-- One way back, one name, above the title. -->
        <slot
          v-if="slots.back"
          name="back"
        />
        <ULink
          v-else-if="showBackLink"
          :to="homePath"
          class="mb-4 -ms-1 inline-flex min-h-6 items-center gap-1.5 text-sm text-muted hover:text-default print:hidden"
          :data-testid="backTestId"
        >
          <UIcon
            name="i-lucide-chevron-left"
            class="size-4 shrink-0"
            aria-hidden="true"
          />
          {{ t('common.backToHome') }}
        </ULink>

        <div
          v-if="hasHead"
          class="mb-8 sm:flex sm:items-start sm:justify-between sm:gap-4"
          data-testid="citizen-page-head"
        >
          <div class="min-w-0">
            <slot name="title">
              <h1
                :id="titleId"
                :lang="titleLang"
                class="text-2xl font-bold tracking-tight break-words hyphens-auto text-highlighted sm:text-3xl"
              >
                {{ title }}
              </h1>
            </slot>
            <slot name="description">
              <p
                v-if="lead"
                class="mt-2 max-w-prose text-base text-muted"
              >
                {{ lead }}
              </p>
            </slot>
            <div
              v-if="slots.meta"
              class="mt-2 text-sm text-muted"
              data-testid="citizen-page-meta"
            >
              <slot name="meta" />
            </div>
          </div>
          <div
            v-if="slots.actions"
            class="mt-4 shrink-0 sm:mt-0"
          >
            <slot name="actions" />
          </div>
        </div>

        <div
          v-if="width === 'wide' && slots.aside"
          class="grid gap-6 lg:grid-cols-3"
        >
          <div class="min-w-0 lg:col-span-2">
            <slot />
          </div>
          <div class="min-w-0 lg:col-span-1">
            <slot name="aside" />
          </div>
        </div>
        <slot v-else />
      </div>
    </main>

    <AppFooter
      v-if="!embed"
      :workspace="workspace"
      :show-start-actions="showStartActions"
      :hide-product-links="hideFooterProductLinks"
      :hide-status-lookup="hideFooterStatusLookup"
    />
    <AppSourceLink
      v-else-if="sourceHref"
      :href="sourceHref"
      class="mx-4 mb-4 inline-flex min-h-6 items-center self-start text-sm text-muted underline underline-offset-2 hover:text-default print:hidden"
    />
  </div>
</template>
