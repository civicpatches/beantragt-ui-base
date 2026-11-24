<script setup lang="ts">
import type { AttachmentRowState } from '~~/casework-layer/app/composables/useAdminApplicationAttachments';

/**
 * The state cell of one attachment, shared by the list, the slide-over's list and its right column. The
 * normal case is quiet: a green check with its text for screen readers and as title, a muted word, or nothing.
 * Colour only marks an exception, and every badge carries its word. `verbose` (the slide-over's right column)
 * writes the check's text next to it, so its meaning never depends on hover.
 */
withDefaults(defineProps<{ state: AttachmentRowState, verbose?: boolean }>(), { verbose: false });
</script>

<template>
  <span
    class="inline-flex min-w-0 flex-wrap items-center gap-1"
    :data-state="state.kind"
    data-testid="attachment-state"
  >
    <template v-if="state.badges.length">
      <UBadge
        v-for="(badge, position) in state.badges"
        :key="`${position}-${badge.text}`"
        :color="badge.color"
        size="sm"
        class="whitespace-normal"
      >
        {{ badge.text }}
      </UBadge>
    </template>
    <span
      v-else-if="state.kind === 'quiet'"
      class="text-sm text-toned"
    >{{ state.word }}</span>
    <span
      v-else-if="state.kind === 'clean' && verbose"
      class="inline-flex items-center gap-1.5 text-sm text-toned"
    >
      <UIcon
        name="i-lucide-check"
        class="size-4 shrink-0 text-success"
        aria-hidden="true"
      />{{ state.checkLabel }}
    </span>
    <span
      v-else-if="state.kind === 'clean'"
      class="inline-flex size-6 items-center justify-center text-success"
      :title="state.checkLabel"
    >
      <UIcon
        name="i-lucide-check"
        class="size-4"
        aria-hidden="true"
      />
      <span class="sr-only">{{ state.checkLabel }}</span>
    </span>
  </span>
</template>
