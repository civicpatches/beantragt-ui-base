<script setup lang="ts">
import PublicContentPage from '~/components/content/PublicContentPage.vue';
import { PUBLIC_CONTENT_FALLBACKS } from '~/utils/public-content-fallbacks';

definePageMeta({
    layout: false
});

const fallback = PUBLIC_CONTENT_FALLBACKS.easy_language;
</script>

<template>
  <PublicContentPage
    page-key="easy_language"
    default-locale="en"
    :fallback-title-de="fallback.titleDe"
    :fallback-title-en="fallback.titleEn"
    :fallback-html-de="fallback.htmlDe"
    :fallback-html-en="fallback.htmlEn"
  />
</template>
