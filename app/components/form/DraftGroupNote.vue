<script setup lang="ts">
/**
 * Over a row of an address group (its search block or a card) the form editor
 * says why nothing is dropped into it. One note per row that reads only its own entry of
 * `notes`, so a note that moves to another row renders these two rows and nothing else of the
 * form. Only rendered in structure mode; the citizen form never has it.
 */
defineProps<{
    /** The row's key (`data-draft-row`). */
    row: string
    /** The rows where the note stands; one shared reactive set, read and changed per key. */
    notes: ReadonlySet<string>
    text: string
}>();
</script>

<template>
  <span
    v-if="notes.has(row)"
    class="pointer-events-none absolute start-2 top-1/2 z-10 max-w-[calc(100%-1rem)] -translate-y-1/2 rounded-sm bg-default px-2.5 py-1 text-xs text-highlighted shadow-sm ring ring-default"
    data-test="draft-group-note"
  >{{ text }}</span>
</template>
