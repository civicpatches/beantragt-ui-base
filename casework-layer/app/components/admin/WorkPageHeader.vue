<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router';

defineProps<{
    back?: { to: RouteLocationRaw, label: string, attrs?: Record<string, string> }
}>();
</script>

<template>
  <UDashboardNavbar :toggle="false">
    <template #left>
      <UTooltip
        v-if="back"
        :text="back.label"
      >
        <UButton
          :to="back.to"
          variant="ghost"
          color="neutral"
          icon="i-lucide-arrow-left"
          :aria-label="back.label"
          v-bind="back.attrs"
        />
      </UTooltip>
      <slot name="left" />
    </template>
    <template #right>
      <slot name="right" />
    </template>
  </UDashboardNavbar>
</template>
