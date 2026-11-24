<script setup lang="ts">
import { staffSettingsRows } from '~~/casework-layer/app/utils/staff-extensions';
import AdminListRow from '~~/casework-layer/app/components/admin/ListRow.vue';

definePageMeta({
    layout: 'dashboard',
    middleware: 'admin'
});

const { t } = useI18n();
const { workspaceRoute, currentWorkspace } = useWorkspaceContext();

useHead({
    title: computed(() => `${t('common.settings')} - beantragt.ai`)
});

interface SettingsRow {
    label: string
    description: string
    to: ReturnType<typeof workspaceRoute>
}

function row(key: string, path: string): SettingsRow {
    return {
        label: t(`admin.settings.${key}.label`),
        description: t(`admin.settings.${key}.description`),
        to: workspaceRoute(path)
    };
}

const groups = ['processing', 'citizen', 'operations'] as const;
const settingsGroups = computed(() => {
    const rows = staffSettingsRows().filter(item =>
        !item.municipalityOnly || currentWorkspace.value?.type !== 'organisation');

    return groups.map(id => ({
        id,
        label: t(`admin.settings.groups.${id}`),
        rows: rows.filter(item => item.group === id)
            .map(item => row(item.key, `/admin/settings/${item.path ?? item.key}`))
    })).filter(group => group.rows.length > 0);
});
</script>

<template>
  <AppPageLayout :title="t('admin.settings.title')">
    <div class="space-y-8">
      <section
        v-for="group in settingsGroups"
        :key="group.id"
        :aria-labelledby="`settings-group-${group.id}`"
        :data-settings-group="group.id"
      >
        <h2
          :id="`settings-group-${group.id}`"
          class="mb-3 text-lg font-semibold text-highlighted"
        >
          {{ group.label }}
        </h2>
        <ul class="space-y-2">
          <li
            v-for="item in group.rows"
            :key="item.label"
          >
            <AdminListRow
              :title="item.label"
              :description="item.description"
              :to="item.to"
              chevron
            />
          </li>
        </ul>
      </section>
    </div>
  </AppPageLayout>
</template>
