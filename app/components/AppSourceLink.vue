<script setup lang="ts">
defineProps<{ href: string }>();
const { t } = useI18n();
</script>

<template>
  <ULink
    :to="href"
    target="_blank"
    rel="noopener"
    data-testid="app-source-link"
  >
    <slot>{{ t('nav.sourceCode') }}</slot>
  </ULink>
</template>
