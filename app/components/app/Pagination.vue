<script setup lang="ts">
/**
 * `UPagination` with accessible names in the interface language.
 *
 * reka-ui hard-codes English names on the controls ("First Page", "Previous Page", "Page 3", "Next Page",
 * "Last Page"), and Nuxt UI 4.11 has no locale keys for them. This wrapper fills Nuxt UI's own slots
 * (`first`, `prev`, `item`, `next`, `last`) with the button its template renders by default (same props,
 * icons, label class, all resolved the way `Pagination.vue` resolves them) and adds the translated
 * `aria-label`; reka's slot merge lets the child's own name win. The current page keeps reka's
 * `aria-current="page"`, the `nav` landmark gets a name. Everything else (`v-model:page`, `total`,
 * `items-per-page`, `ui`, `class`, ...) passes through unchanged.
 *
 * Link mode (`to`) is not supported: Nuxt UI hands the control slots no page number. Use `v-model:page`.
 * `tests/unit/components/AppPagination.test.ts` fails when Nuxt UI changes what its default buttons bind.
 */
import type { PaginationProps, PaginationSlots } from '@nuxt/ui';
import UPagination from '@nuxt/ui/components/Pagination.vue';
import { useComponentProps } from '@nuxt/ui/composables/useComponentProps';
import { useLocale } from '@nuxt/ui/composables/useLocale';
import { tv } from '@nuxt/ui/utils/tv';
import theme from '#build/ui/pagination';

type LookProps = Pick<PaginationProps, 'color' | 'variant' | 'activeColor' | 'activeVariant' | 'size'
  | 'firstIcon' | 'prevIcon' | 'nextIcon' | 'lastIcon' | 'showControls'>;

// `showControls: undefined` stops Vue from casting an absent boolean to `false`, so UPagination's default applies.
const _props = withDefaults(defineProps<LookProps>(), { showControls: undefined });
// The same resolution as `Pagination.vue` (theme context, `app.config` defaults), then UPagination's own defaults.
const props = useComponentProps('pagination', _props);
const paginationDefaults = (UPagination as unknown as { props: Record<string, { default?: unknown }> }).props;
function look<K extends keyof LookProps>(key: K): LookProps[K] {
    return (props[key] ?? paginationDefaults[key]?.default) as LookProps[K];
}

const { t } = useI18n();
const { dir } = useLocale();
const appConfig = useAppConfig();
// The next five lines repeat `Pagination.vue` word for word (quotes aside); the unit test compares them.
const firstIcon = computed(() => props.firstIcon || (dir.value === 'rtl' ? appConfig.ui.icons.chevronDoubleRight : appConfig.ui.icons.chevronDoubleLeft));
const prevIcon = computed(() => props.prevIcon || (dir.value === 'rtl' ? appConfig.ui.icons.chevronRight : appConfig.ui.icons.chevronLeft));
const nextIcon = computed(() => props.nextIcon || (dir.value === 'rtl' ? appConfig.ui.icons.chevronLeft : appConfig.ui.icons.chevronRight));
const lastIcon = computed(() => props.lastIcon || (dir.value === 'rtl' ? appConfig.ui.icons.chevronDoubleLeft : appConfig.ui.icons.chevronDoubleRight));
const ui = computed(() => tv({ extend: theme, ...appConfig.ui?.pagination || {} })());

type PaginationItem = Parameters<NonNullable<PaginationSlots['item']>>[0]['item'];
/** Nuxt UI renders the `item` slot for page items only (ellipses have their own slot); narrows the slot's type. */
function pageNumber(item: PaginationItem): number {
    return item.type === 'page' ? item.value : 0;
}
</script>

<template>
  <UPagination
    :color="_props.color"
    :variant="_props.variant"
    :active-color="_props.activeColor"
    :active-variant="_props.activeVariant"
    :size="_props.size"
    :first-icon="_props.firstIcon"
    :prev-icon="_props.prevIcon"
    :next-icon="_props.nextIcon"
    :last-icon="_props.lastIcon"
    :show-controls="look('showControls')"
    :aria-label="t('common.pagination.label')"
  >
    <template
      v-if="look('showControls')"
      #first
    >
      <UButton
        :color="look('color')"
        :variant="look('variant')"
        :size="look('size')"
        :icon="firstIcon"
        :aria-label="t('common.pagination.first')"
      />
    </template>
    <template
      v-if="look('showControls')"
      #prev
    >
      <UButton
        :color="look('color')"
        :variant="look('variant')"
        :size="look('size')"
        :icon="prevIcon"
        :aria-label="t('common.pagination.previous')"
      />
    </template>
    <template #item="{ item, page }">
      <UButton
        :color="page === pageNumber(item) ? look('activeColor') : look('color')"
        :variant="page === pageNumber(item) ? look('activeVariant') : look('variant')"
        :size="look('size')"
        :label="String(pageNumber(item))"
        :ui="{ label: ui.label() }"
        :aria-label="t('common.pagination.page', { page: pageNumber(item) })"
        square
      />
    </template>
    <template
      v-if="look('showControls')"
      #next
    >
      <UButton
        :color="look('color')"
        :variant="look('variant')"
        :size="look('size')"
        :icon="nextIcon"
        :aria-label="t('common.pagination.next')"
      />
    </template>
    <template
      v-if="look('showControls')"
      #last
    >
      <UButton
        :color="look('color')"
        :variant="look('variant')"
        :size="look('size')"
        :icon="lastIcon"
        :aria-label="t('common.pagination.last')"
      />
    </template>
  </UPagination>
</template>
