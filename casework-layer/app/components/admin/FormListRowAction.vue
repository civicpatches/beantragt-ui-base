<script setup lang="ts">
import { EDIT_ICON } from '~/utils/action-icons';
import type { FormListRowContext } from '~~/casework-layer/app/utils/staff-extensions';

const props = defineProps<{ context: FormListRowContext }>();
const { t } = useI18n();
const { workspaceRoute } = useWorkspaceContext();
const isDraft = computed(() => props.context.status === 'draft');
</script>

<template>
  <UTooltip :text="isDraft ? t('admin.forms.editSchemaShort') : t('admin.forms.viewSchemaShort')">
    <UButton
      :to="workspaceRoute(`/admin/forms/${context.id}/edit`)"
      color="neutral"
      variant="ghost"
      :icon="isDraft ? EDIT_ICON : 'i-lucide-eye'"
      :aria-label="isDraft ? t('admin.forms.editSchemaNamed', { label: context.label }) : t('admin.forms.viewSchemaNamed', { label: context.label })"
      data-test="form-open-editor"
    />
  </UTooltip>
</template>
