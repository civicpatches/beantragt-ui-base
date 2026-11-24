<script setup lang="ts">
import { appExtensions, type AppExtensionOutletName } from '~/utils/app-extensions';

const props = defineProps<{
    name: AppExtensionOutletName
    componentProps?: Record<string, unknown>
}>();

const components = computed(() => appExtensions(props.name));
</script>

<template>
  <ClientOnly v-if="components.length > 0">
    <component
      :is="component"
      v-for="(component, index) in components"
      :key="index"
      v-bind="props.componentProps"
    />
  </ClientOnly>
</template>
