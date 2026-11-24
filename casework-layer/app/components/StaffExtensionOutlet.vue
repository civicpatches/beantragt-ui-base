<script setup lang="ts">
import { staffOutlet, type StaffOutletName } from '../utils/staff-extensions';

/*
 * Renders what a layer registered for a staff outlet and hands each component the outlet's context. Like
 * `AppExtensionOutlet.vue`: nothing registered renders nothing, and there is no wrapper element.
 */
const props = defineProps<{
    name: StaffOutletName
    context?: object
}>();

const components = computed(() => staffOutlet(props.name));
</script>

<template>
  <ClientOnly v-if="components.length > 0">
    <component
      :is="component"
      v-for="(component, index) in components"
      :key="index"
      :context="context"
    />
  </ClientOnly>
</template>
