<!--
  The personal theme preview is a menu beside the colour-mode control that switches the
  administration between "Standard" (the installation's theme) and the offered presets. Development server only (the
  dashboard layout loads it under `import.meta.dev`, the build's theme list is empty), this browser only
  (localStorage), the dashboard only (undone when the layout unmounts).
-->
<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui';
import themes from '#build/beantragt-staff-themes';
import { createStaffThemeSwitch, readStoredTheme, storeTheme, type StaffThemeSwitch } from '../../utils/staff-theme-preview-runtime';

const { t } = useI18n();
const appConfig = useAppConfig();
const current = ref<string | null>(null);
let themeSwitch: StaffThemeSwitch | null = null;
const storage = () => window.localStorage;

onMounted(() => {
    themeSwitch = createStaffThemeSwitch({ doc: document, ui: appConfig.ui as unknown as Record<string, unknown>, themes });
    current.value = readStoredTheme(storage, themes.map(theme => theme.id));
    if (current.value) themeSwitch.apply(current.value);
});

onBeforeUnmount(() => {
    // Citizens' pages and every other layout get the installation's theme back.
    themeSwitch?.apply(null);
    themeSwitch = null;
});

function choose(id: string | null) {
    current.value = id;
    storeTheme(storage, id);
    themeSwitch?.apply(id);
}

const currentLabel = computed(() =>
    themes.find(theme => theme.id === current.value)?.name ?? t('nav.themePreview.standard'));

const items = computed<DropdownMenuItem[][]>(() => [
    [{ label: t('nav.themePreview.title'), type: 'label' as const }],
    [
        {
            label: t('nav.themePreview.standard'),
            description: t('nav.themePreview.standardDescription'),
            type: 'checkbox' as const,
            checked: current.value === null,
            onSelect: () => choose(null)
        },
        ...themes.map(theme => ({
            label: theme.name,
            description: theme.fontFamilies[0],
            type: 'checkbox' as const,
            checked: current.value === theme.id,
            onSelect: () => choose(theme.id)
        }))
    ],
    [{ label: t('nav.themePreview.hint'), type: 'label' as const }]
]);
</script>

<template>
  <UDropdownMenu
    :items="items"
    :content="{ side: 'bottom', align: 'end' }"
  >
    <UButton
      color="neutral"
      variant="ghost"
      icon="i-lucide-palette"
      square
      data-testid="staff-theme-preview"
      :aria-label="`${t('nav.themePreview.title')}: ${currentLabel}`"
      :title="`${t('nav.themePreview.title')}: ${currentLabel}`"
    />
  </UDropdownMenu>
</template>
