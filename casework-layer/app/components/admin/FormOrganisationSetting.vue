<script setup lang="ts">
/**
 * Shows which organisation a form belongs to in the form settings.
 *
 * A form of the municipality itself can be assigned here once; the same
 * assignment is offered next to the workflow on the form overview.
 */
import OrganisationAssign from './OrganisationAssign.vue';

defineProps<{ formId: string, organisationId?: string | null, expectedChanged?: string | null, disabled?: boolean }>();
const emit = defineEmits<{ (event: 'assigned', result: { changed: string | null }): void, (event: 'busy', busy: boolean): void }>();

const { t } = useI18n();
const { workspaces, currentWorkspace } = useWorkspaceContext();

function organisationLabel(id: string): string {
    return workspaces.value.find(workspace => workspace.type === 'organisation' && workspace.id === id)?.label
      ?? t('admin.forms.organisationSetting.hidden');
}
</script>

<template>
  <section
    data-test="form-organisation-setting"
    class="space-y-2"
  >
    <h3 class="text-sm font-medium text-highlighted">
      {{ t('admin.forms.organisationSetting.label') }}
    </h3>
    <template v-if="organisationId">
      <p
        data-test="form-organisation-current"
        class="flex items-center gap-2 text-sm"
      >
        <UIcon
          name="i-lucide-building-2"
          class="size-4 shrink-0 text-muted"
          aria-hidden="true"
        />
        {{ organisationLabel(organisationId) }}
      </p>
      <p class="text-sm text-muted">
        {{ t('admin.forms.organisationSetting.assignedHelp') }}
      </p>
    </template>
    <template v-else>
      <p
        data-test="form-organisation-current"
        class="text-sm"
      >
        {{ t('admin.forms.organisationSetting.none', { name: currentWorkspace?.label ?? '' }) }}
      </p>
      <p class="text-sm text-muted">
        {{ t('admin.forms.organisationSetting.noneHelp') }}
      </p>
      <OrganisationAssign
        :form-id="formId"
        :expected-changed="expectedChanged"
        :disabled="disabled"
        @assigned="emit('assigned', $event)"
        @busy="emit('busy', $event)"
      />
    </template>
  </section>
</template>
