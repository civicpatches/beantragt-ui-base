<script setup lang="ts">
/**
 * Frame of one field in the form editor's canvas: it holds the
 * field card and, beside it, the selected field's action bar. The bar cannot sit
 * inside the card, because the card is one `role="button"` and its controls are
 * not clickable in draft mode.
 *
 * Inactive (citizen form, preview) the frame renders nothing of its own: only its
 * content, so the citizen form's markup does not change.
 */
defineOptions({ inheritAttrs: false });

defineProps<{
    active: boolean
}>();
</script>

<template>
  <div
    v-if="active"
    class="relative"
    v-bind="$attrs"
    data-test="draft-field-frame"
  >
    <slot />
    <slot name="overlay" />
  </div>
  <slot v-else />
</template>
