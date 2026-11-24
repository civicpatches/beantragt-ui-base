<script setup lang="ts">
/**
 * One record in an admin list: title with badges, an optional one-line
 * description and meta line, a right-aligned key figure and an action
 * column. The action column keeps a fixed width so badges and figures line
 * up whether or not a row has actions; `wideActions` fits a button group.
 *
 * Built on the framework's card (Nuxt UI `UPageCard`, variant outline): its
 * outline, corners, hover and focus ring come from the theme, no own hover
 * or outline class. With `to`, the card's one link lies over the row, named
 * by the title: the whole row is clickable and the actions sit above it.
 * Without `to` the row is a plain card. Anything interactive must go into the
 * actions slot: badges, meta and figure sit below the link and cannot be
 * clicked on linked rows.
 *
 * Long titles wrap instead of being cut (390 px). `chevron` ends a
 * linked row with an arrow like the batch list, so opening reads as the row's
 * action; it is decoration, the link name stays the title.
 *
 * The form list put two 32 px buttons (open and delete) into the
 * 48 px column: they reached 8 px into the text column and over the chevron, and a row with one action
 * stood centred, 16 px off. `pairedActions` gives the column the width of two icon buttons and the gap
 * between them (32 + 4 + 32), starting at its left, so a row's first action stands in the same place in
 * every row, whether the second one is there or not.
 */
import type { RouteLocationRaw } from 'vue-router';

const props = defineProps<{
    title: string
    to?: RouteLocationRaw
    description?: string
    wideActions?: boolean
    pairedActions?: boolean
    chevron?: boolean
}>();

/** Layout of a list row inside the card; no hover, focus or corner class (those are the card's). */
const cardUi = computed(() => ({
    container: [
        'p-0 sm:p-0 gap-0 lg:flex flex-1',
        props.wideActions ? 'flex-col lg:flex-row items-stretch' : 'flex-row items-stretch'
    ].join(' ')
}));

const slots = defineSlots<{
    badges(): unknown
    meta(): unknown
    figure(): unknown
    actions(): unknown
}>();
</script>

<template>
  <div data-test="admin-list-row">
    <UPageCard
      :to="props.to"
      :ui="cardUi"
      :aria-label="props.to ? title : undefined"
      data-test="admin-list-row-card"
    >
      <!-- Below sm the figure stands under the meta line instead of
           squeezing the title column. -->
      <div class="flex min-w-0 flex-1 flex-col items-start gap-1 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
        <div class="w-full min-w-0 sm:w-auto sm:flex-1">
          <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <h3 class="min-w-0 hyphens-auto break-words text-base font-semibold text-highlighted">
              {{ title }}
            </h3>
            <slot name="badges" />
          </div>
          <p
            v-if="description"
            class="mt-0.5 line-clamp-2 text-sm text-muted sm:line-clamp-1"
            :title="props.to ? undefined : description"
          >
            {{ description }}
          </p>
          <div
            v-if="slots.meta"
            class="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted"
          >
            <slot name="meta" />
          </div>
        </div>
        <div
          v-if="slots.figure"
          class="shrink-0 sm:text-right"
        >
          <slot name="figure" />
        </div>
      </div>
      <div
        class="relative z-10 flex shrink-0 items-center"
        :class="props.wideActions ? 'flex-wrap gap-2 px-4 pb-3 lg:justify-end lg:py-3' : props.pairedActions ? 'w-17 justify-start gap-1' : 'w-12 justify-center'"
        data-test="admin-list-row-actions"
      >
        <slot name="actions" />
      </div>
      <!-- With paired actions the bin ended where the chevron began; the
           pattern names no space there, so it is the 4 px between the two actions (`ps-1`). A single,
           centred action keeps its 8 px on either side, so other lists are unchanged. -->
      <div
        v-if="props.chevron && props.to"
        class="pointer-events-none flex shrink-0 items-center pe-3 text-muted"
        :class="props.pairedActions ? 'ps-1' : undefined"
        data-test="admin-list-row-chevron"
        aria-hidden="true"
      >
        <UIcon
          name="i-lucide-chevron-right"
          class="size-4"
        />
      </div>
    </UPageCard>
  </div>
</template>
