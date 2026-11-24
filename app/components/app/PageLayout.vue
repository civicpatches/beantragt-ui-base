<script setup lang="ts">
/**
 * Shared layout wrapper for every admin page.
 *
 * Guarantees that headline, description and primary actions sit at the
 * exact same x/y position on each route. The outer container is the only
 * element allowed to centre itself (max-width + mx-auto); all inner content
 * stays left-aligned.
 *
 * `fullBleed` hands the whole panel body to the content (no width limit, no
 * padding, content fills the height): breadcrumb and header are hidden but stay
 * mounted, so overlays opened from the header keep their state. The page title
 * stays as a visually hidden `h1`, so the outline still starts at the top level.
 *
 * Layout rules:
 * - Single-column forms use a left-aligned `max-w-3xl` content column.
 *   Lists, tables and work surfaces with an editor or preview alongside
 *   them use the full page width. Limit only the form column when needed.
 * - Gutter: the dashboard panel gives 16 px (`p-4`), from `sm` up the wrapper
 *   adds 32 px to the panel's 24 px, so the content starts 56 px in.
 * - The title wraps and is never truncated. `#title` replaces the visible
 *   content of the `h1` for a composite title (for example a reference number
 *   above the form name); use phrasing content (`span`) inside it. The `title`
 *   prop stays the plain text of the page, it feeds the hidden `h1` of
 *   `fullBleed`. With `#title`, `#titleMeta` aligns with the LAST line of the
 *   `h1` (the state badge aligns with the form name).
 * - Actions stand right of the title from `lg` in one row that never wraps;
 *   below `lg` they stand under the description and may wrap.
 * - `#description` replaces the description by a meta line of facts (who,
 *   when) at the same place, `text-sm text-muted`.
 * - A breadcrumb that would show only the current page (one item without a
 *   link) is not rendered: a lone crumb is no way back.
 * - `headingId` puts the id and `tabindex="-1"` on the rendered `h1` (the
 *   hidden one in `fullBleed`), and the component exposes that element as
 *   `heading`, so a page can move focus to its title. A focused title shows
 *   a 2 px bar in the primary colour at its left instead of the browser ring. The negative margin keeps
 *   the text on the left edge of the content.
 */
import type { BreadcrumbItem } from '@nuxt/ui';
import { inject } from 'vue';
import { PAGE_LAYOUT_NOTICE } from '~/utils/page-layout-notice';

export type PageBreadcrumb = Pick<BreadcrumbItem, 'label' | 'to'>;

const props = defineProps<{
    title: string
    description?: string
    breadcrumbs?: PageBreadcrumb[]
    fullBleed?: boolean
    /** Id of the page's `h1`; the `h1` then takes focus by script (`tabindex="-1"`). */
    headingId?: string
    /** `data-testid` of the breadcrumb `nav`. */
    breadcrumbTestId?: string
}>();

const slots = defineSlots<{
    default(): unknown
    actions?(): unknown
    title?(): unknown
    titleMeta?(): unknown
    description?(): unknown
    toolbar?(): unknown
}>();

const { t } = useI18n();

/** The layout's notice (admin: the access notice after a redirect), first in the content; told the frame mode. */
const notice = inject(PAGE_LAYOUT_NOTICE, null);

// Depth 2 or more, or at least a link back: never a lone current-page crumb.
// Below `sm`: the current page is not repeated as the last crumb (the title right
// under it names it), so the crumbs that lead somewhere keep their width; the first one never shrinks.
const visibleBreadcrumbs = computed<BreadcrumbItem[]>(() => {
    const items = props.breadcrumbs ?? [];
    if (items.length === 1 && !items[0]?.to) return [];
    const current = items.length > 1 && !items.at(-1)?.to;
    return items.map((item, index) => {
        const ui: { item?: string, separator?: string } = {};
        if (index === 0) ui.item = 'shrink-0';
        if (current && index === items.length - 1) ui.item = 'hidden sm:flex';
        if (current && index === items.length - 2) ui.separator = 'hidden sm:flex';
        return Object.keys(ui).length ? { ...item, ui } : item;
    });
});

/**
 * Below `sm`, when exactly one crumb would remain (the parent of the current page, or a single link): a back link
 * with the back sign and the parent's name instead of a trail of one (lead's decision 13.11.). Two or more stay a
 * trail.
 */
const backCrumb = computed<PageBreadcrumb | null>(() => {
    const items = props.breadcrumbs ?? [];
    const current = items.length > 1 && !items.at(-1)?.to;
    const remaining = current ? items.slice(0, -1) : items;
    return remaining.length === 1 && remaining[0]?.to ? remaining[0] : null;
});

const visibleHeading = ref<HTMLElement | null>(null);
const hiddenHeading = ref<HTMLElement | null>(null);
/** The `h1` that is rendered for the current mode. */
const heading = computed(() => props.fullBleed ? hiddenHeading.value : visibleHeading.value);

defineExpose({ heading });
</script>

<template>
  <div :class="fullBleed ? 'flex min-h-0 w-full min-w-0 flex-1 flex-col' : 'mx-auto w-full min-w-0 max-w-7xl px-0 py-2 sm:px-8 sm:py-5'">
    <h1
      v-if="fullBleed"
      :id="headingId"
      ref="hiddenHeading"
      :tabindex="headingId ? -1 : undefined"
      class="sr-only"
      data-testid="page-title-hidden"
    >
      {{ title }}
    </h1>
    <ULink
      v-if="visibleBreadcrumbs.length && backCrumb"
      v-show="!fullBleed"
      :to="backCrumb.to"
      class="mb-3 inline-flex min-h-6 items-center gap-1 text-sm font-medium text-muted hover:text-default sm:hidden"
      data-testid="page-back-link"
    >
      <UIcon
        name="i-lucide-chevron-left"
        class="size-4 shrink-0"
        aria-hidden="true"
      />{{ backCrumb.label }}
    </ULink>
    <UBreadcrumb
      v-if="visibleBreadcrumbs.length"
      v-show="!fullBleed"
      :items="visibleBreadcrumbs"
      :aria-label="t('common.breadcrumb')"
      :ui="{ link: 'min-h-6' }"
      :data-testid="breadcrumbTestId"
      :class="backCrumb ? 'mb-3 hidden sm:block' : 'mb-3'"
    />

    <!-- Page header: constant position, left-aligned -->
    <header
      v-show="!fullBleed"
      class="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"
      data-testid="page-header"
    >
      <div class="min-w-0 flex-1">
        <div
          class="flex flex-wrap gap-x-3 gap-y-1"
          :class="slots.title ? 'items-baseline-last' : 'items-center'"
          data-testid="page-title-row"
        >
          <h1
            :id="fullBleed ? undefined : headingId"
            ref="visibleHeading"
            :tabindex="headingId && !fullBleed ? -1 : undefined"
            class="min-w-0 break-words text-2xl font-bold tracking-tight text-highlighted"
            :class="headingId ? '-ms-2.5 border-s-2 border-transparent ps-2 outline-none focus-visible:border-primary' : undefined"
            data-testid="page-title"
          >
            <slot name="title">
              {{ title }}
            </slot>
          </h1>
          <slot name="titleMeta" />
        </div>
        <div
          v-if="slots.description"
          class="mt-1 text-sm text-muted"
          data-testid="page-description"
        >
          <slot name="description" />
        </div>
        <p
          v-else-if="description"
          class="mt-1 max-w-2xl text-base text-muted"
          data-testid="page-description"
        >
          {{ description }}
        </p>
      </div>
      <div
        v-if="slots.actions"
        class="flex flex-wrap items-center gap-2 lg:shrink-0 lg:flex-nowrap lg:justify-end"
        data-testid="page-actions"
      >
        <slot name="actions" />
      </div>
    </header>

    <!-- Optional filter / toolbar row -->
    <div
      v-if="slots.toolbar"
      v-show="!fullBleed"
      class="mb-6"
    >
      <slot name="toolbar" />
    </div>

    <!-- Content: left-aligned, never auto-centred -->
    <div :class="fullBleed ? 'flex min-h-0 flex-1 flex-col' : undefined">
      <component
        :is="notice"
        v-if="notice"
        :full-bleed="fullBleed"
      />
      <slot />
    </div>
  </div>
</template>
