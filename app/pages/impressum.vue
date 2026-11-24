<script setup lang="ts">
import PublicContentPage from '~/components/content/PublicContentPage.vue';
import { PUBLIC_CONTENT_FALLBACKS } from '~/utils/public-content-fallbacks';

definePageMeta({
    layout: false
});

const fallback = PUBLIC_CONTENT_FALLBACKS.legal_notice;
</script>

<template>
  <PublicContentPage
    page-key="legal_notice"
    default-locale="de"
    :fallback-title-de="fallback.titleDe"
    :fallback-title-en="fallback.titleEn"
    :fallback-html-de="fallback.htmlDe"
    :fallback-html-en="fallback.htmlEn"
  />
</template>
