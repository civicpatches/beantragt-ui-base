<script setup lang="ts">
defineProps<{ context: { id: string } }>();

const { t } = useI18n();
const { workspaceRoute } = useWorkspaceContext();
</script>

<template>
  <UButton
    :to="workspaceRoute(`/admin/forms/${context.id}/edit`)"
    :label="t('admin.fim.editInEditor')"
    color="neutral"
    variant="link"
    data-test="fim-editor-action"
  />
</template>
