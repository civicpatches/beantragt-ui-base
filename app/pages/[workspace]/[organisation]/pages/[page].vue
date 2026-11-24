<script setup lang="ts">
import PublicContentPage from '~/components/content/PublicContentPage.vue';
import { readChosenLocale, resolveRouteLocale } from '~/utils/locale-routing';

definePageMeta({
    layout: false
});

const route = useRoute();

function routeParam(value: string | string[] | undefined): string {
    return (Array.isArray(value) ? value[0] : value) || '';
}

const pageIdentifier = computed(() => routeParam(route.params.page as string | string[] | undefined));
// The page language follows the same rule as the app language: the
// language the person chose stays, a workspace page path carries none.
const defaultLocale = computed(() => resolveRouteLocale({
    path: route.path,
    queryLang: route.query.lang,
    chosenLocale: readChosenLocale()
}).locale);
</script>

<template>
  <PublicContentPage
    :page-identifier="pageIdentifier"
    :default-locale="defaultLocale"
  />
</template>
