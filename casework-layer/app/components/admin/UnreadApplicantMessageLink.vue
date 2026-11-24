<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router';

const props = defineProps<{ count: number, to: RouteLocationRaw, reference?: string }>();
const { t } = useI18n();
const label = computed(() => t('admin.table.events.message', { count: props.count }, props.count));
</script>

<template>
  <NuxtLink
    :to="to"
    :aria-label="reference ? `${label}: ${reference}` : undefined"
    class="inline-flex min-h-6 max-w-full items-center gap-1 text-sm font-normal whitespace-normal text-primary rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    @click.stop
  >
    <UIcon
      name="i-lucide-message-circle"
      class="size-4 shrink-0"
      aria-hidden="true"
    />
    <span>{{ label }}</span>
  </NuxtLink>
</template>
