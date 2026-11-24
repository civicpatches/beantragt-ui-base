<script setup lang="ts">
import { useOrganisationChoices } from '~~/casework-layer/app/composables/useOrganisationChoices';
import OrganisationAssign from './OrganisationAssign.vue';

defineProps<{ formId: string }>();
const emit = defineEmits<{ assigned: [] }>();

const { t } = useI18n();
const { canAssign } = useOrganisationChoices();

const description = computed(() => {
    const base = t('admin.settings.workflow.organisationFormDescription');
    return canAssign.value ? `${base} ${t('admin.settings.workflow.organisationAssignHint')}` : base;
});
</script>

<template>
  <div>
    <UAlert
      data-test="workflow-organisation-required"
      color="info"
      icon="i-lucide-info"
      :title="t('admin.settings.workflow.organisationRequiredTitle')"
      :description="description"
    />
    <OrganisationAssign
      v-if="canAssign"
      :form-id="formId"
      class="mt-3"
      @assigned="emit('assigned')"
    />
  </div>
</template>
