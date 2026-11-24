<script setup lang="ts">
import type { PublicOrgNode } from '~/types/org-catalog';

/**
 * Presentation-only rich org row rendered in the admin command palette
 * (`DashboardWorkspaceSwitcher`).
 *
 * Two modes:
 * - `org` set → renders code badge + label + type badge + breadcrumb path +
 *   "N Untereinheiten".
 * - `reset` true → renders the "Gesamte Stadtverwaltung" reset row (building
 *   icon + reset label/description).
 *
 * Pure display: emits no events and performs no navigation; the parent wires
 * selection.
 */
withDefaults(defineProps<{
    org?: PublicOrgNode | null
    reset?: boolean
    resetLabel?: string
    resetDescription?: string
    /** Resolves a type machine name to a localized label. */
    typeLabel?: (type: string) => string
    /** Localized "{count} subunit(s)" formatter. */
    childCountLabel?: (count: number) => string
    /** Render trailing affordance (e.g. enter hint). */
    showEnterHint?: boolean
    /** Marks the row as the currently selected scope (trailing check icon). */
    active?: boolean
    /** Marks the row as the current assignment target. */
    current?: boolean
    /** Localized current marker rendered beside the label. */
    currentLabel?: string
}>(), {
    org: null,
    reset: false,
    resetLabel: '',
    resetDescription: '',
    typeLabel: (type: string) => type,
    childCountLabel: (count: number) => String(count),
    showEnterHint: false,
    active: false,
    current: false,
    currentLabel: ''
});
</script>

<template>
  <span class="flex w-full min-w-0 items-start gap-3 text-left">
    <template v-if="reset">
      <span class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-(--ui-primary)/10 text-(--ui-primary)">
        <UIcon
          name="i-lucide-building-2"
          class="size-4"
        />
      </span>
      <span class="min-w-0 flex-1">
        <span class="block text-sm font-medium text-(--ui-text-highlighted)">
          {{ resetLabel }}
        </span>
        <span class="block truncate text-sm text-(--ui-text-muted)">
          {{ resetDescription }}
        </span>
      </span>
    </template>

    <template v-else-if="org">
      <span class="mt-0.5 flex min-w-14 shrink-0 items-center justify-center rounded-md border border-(--ui-border) px-2 py-1 font-mono text-xs text-(--ui-text-highlighted)">
        {{ org.code }}
      </span>
      <span class="min-w-0 flex-1">
        <span class="flex flex-wrap items-center gap-2">
          <span class="font-medium text-(--ui-text-highlighted)">
            {{ org.label }}
          </span>
          <UBadge
            color="neutral"
          >
            {{ typeLabel(org.type) }}
          </UBadge>
          <span
            v-if="current && currentLabel"
            class="text-sm text-(--ui-text-muted)"
          >
            {{ currentLabel }}
          </span>
        </span>
        <span
          class="mt-1 block truncate text-sm text-(--ui-text-muted)"
          aria-hidden="true"
        >
          {{ org.pathCodes.join(' / ') }}
          <template v-if="org.childCount > 0">
            · {{ childCountLabel(org.childCount) }}
          </template>
        </span>
      </span>
    </template>

    <UIcon
      v-if="active || current"
      name="i-lucide-check"
      :class="[
        'mt-1 size-4 shrink-0',
        current && !active ? 'text-(--ui-text-muted)' : 'text-(--ui-primary)',
      ]"
    />
    <UIcon
      v-else-if="showEnterHint"
      name="i-lucide-corner-down-left"
      class="mt-1 size-4 shrink-0 text-(--ui-text-muted)"
    />
  </span>
</template>
