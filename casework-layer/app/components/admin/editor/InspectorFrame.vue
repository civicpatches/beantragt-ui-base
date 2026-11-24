<script setup lang="ts">
defineProps<{
    /** A field is selected and the inspector shows it. */
    open: boolean
}>();
</script>

<template>
  <div
    class="flex min-h-0 min-w-0 flex-1 flex-col border-s border-default"
    data-test="editor-inspector-frame"
    :data-open="open ? 'true' : 'false'"
  >
    <slot v-if="open" />
    <div
      v-show="!open"
      class="flex min-h-0 flex-1 flex-col"
      data-test="editor-inspector-empty"
    >
      <slot name="empty" />
    </div>
  </div>
</template>
