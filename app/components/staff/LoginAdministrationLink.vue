<script setup lang="ts">
// Citizen-only build: there is no administration to link to. The pro layer
// overrides this component with the way into the admin area.
defineProps<{
    to?: string
}>();
</script>

<template>
  <span v-if="false" />
</template>
