<script setup lang="ts">
import { resolveComponent } from 'vue';

/**
 * Row of key figures above an admin list.
 *
 * Tiles with `filterable` act as filter toggles (aria-pressed) like the
 * Mark-a-Spot status tiles; tiles without it are plain figures.
 *
 * The label comes first and wraps (390 px); the visible label and
 * count name the filter. A filter tile is the framework's button (outline,
 * the chosen one primary subtle), so hover, focus ring and the chosen state
 * come from the theme; the chosen filter also has a bold label, so the
 * selection is not shown by colour alone.
 */

export interface StatTile {
    key: string
    label: string
    value: number | string
    icon: string
    tone?: 'neutral' | 'primary' | 'success' | 'warning' | 'error' | 'info'
    filterable?: boolean
}

const props = defineProps<{
    tiles: StatTile[]
    active?: string | null
    label: string
}>();

const emit = defineEmits<{
    select: [key: string]
}>();

const Button = resolveComponent('UButton');
const PageCard = resolveComponent('UPageCard');

const iconTone: Record<NonNullable<StatTile['tone']>, string> = {
    neutral: 'text-muted',
    primary: 'text-primary',
    success: 'text-success',
    warning: 'text-warning',
    error: 'text-error',
    info: 'text-info'
};
</script>

<template>
  <ul
    :aria-label="label"
    class="grid grid-cols-2 gap-3 lg:grid-cols-4"
  >
    <li
      v-for="tile in tiles"
      :key="tile.key"
    >
      <component
        :is="tile.filterable ? Button : PageCard"
        variant="outline"
        v-bind="tile.filterable ? {
          'color': 'neutral',
          'activeColor': 'primary',
          'activeVariant': 'subtle',
          'active': props.active === tile.key,
          'aria-pressed': props.active === tile.key,
        } : {}"
        data-test="stat-tile"
        class="h-full w-full text-left"
        :class="tile.filterable ? 'rounded-lg p-4 font-normal sm:p-6' : undefined"
        v-on="tile.filterable ? { click: () => emit('select', tile.key) } : {}"
      >
        <span class="my-auto flex min-w-0 items-center gap-3">
          <UIcon
            :name="tile.icon"
            :class="iconTone[tile.tone ?? 'neutral']"
            class="hidden size-5 shrink-0 sm:block"
            aria-hidden="true"
          />
          <span class="min-w-0">
            <span
              class="block wrap-break-word hyphens-auto text-sm"
              :class="{ 'font-semibold': tile.filterable && props.active === tile.key }"
            >{{ tile.label }}</span>
            <span class="block text-2xl leading-tight font-bold tabular-nums">{{ tile.value }}</span>
          </span>
        </span>
      </component>
    </li>
  </ul>
</template>
