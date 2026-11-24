<script setup lang="ts">
import { de, en } from '@nuxt/ui/locale';

const { locale, t } = useI18n();

// Nuxt UI labels its own controls (dialog close button, pagination, toasts)
// from this locale; without it screen readers hear English "Close".
const uiLocale = computed(() => locale.value === 'en' ? en : de);
// Screen readers announce every toast as "<label> <title> <description>"; reka's
// default label is the English "Notification", and the Nuxt UI locale has none.
const toaster = computed(() => ({ label: t('common.toastAnnouncement') }));

useHead({
    htmlAttrs: {
        lang: computed(() => locale.value === 'en' ? 'en' : 'de')
    }
});
</script>

<template>
  <!-- UApp renders the one toaster; a second UToaster showed every toast twice. -->
  <UApp
    :locale="uiLocale"
    :toaster="toaster"
  >
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
    <!-- Layers render overlays here (the commercial layer: demo tour); empty in the citizen build. -->
    <AppExtensionOutlet name="app-overlay" />
  </UApp>
</template>
