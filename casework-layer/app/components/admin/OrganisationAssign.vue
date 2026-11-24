<script setup lang="ts">
/**
 * Assigns a form of the municipality to one of its organisations.
 *
 * The assignment is offered once and only after an explicit confirmation,
 * because a later move to another organisation is not possible yet.
 */
import { useOrganisationChoices } from '~~/casework-layer/app/composables/useOrganisationChoices';

// The form editor passes the `changed` value it knows; the route then refuses
// to assign over an edit from another tab and returns the new value.
// `disabled` lets the editor hold the assignment while it saves, so the two
// writes never race on the form's `changed` value.
const props = defineProps<{ formId: string, expectedChanged?: string | null, disabled?: boolean }>();
// `busy` lets the editor hold its autosave while the assignment is in flight.
const emit = defineEmits<{ (event: 'assigned', result: { changed: string | null }): void, (event: 'busy', busy: boolean): void }>();

const { t } = useI18n();
const toast = useToast();
const { resolveApiErrorMessage } = useApiErrorMessage();
const { withWorkspaceQuery } = useWorkspaceContext();
const { organisations, canAssign } = useOrganisationChoices();

const organisationItems = computed(() => organisations.value.map(organisation => ({ label: organisation.label, value: organisation.id })));
const selectedOrganisationId = ref<string | undefined>(undefined);
const selectedOrganisation = computed(() => organisations.value.find(organisation => organisation.id === selectedOrganisationId.value));
const confirming = ref(false);
const assigning = ref(false);
const assignError = ref('');

watch(selectedOrganisationId, () => {
    confirming.value = false;
    assignError.value = '';
});

async function assign() {
    if (!selectedOrganisation.value || assigning.value || props.disabled) return;
    assigning.value = true;
    emit('busy', true);
    assignError.value = '';
    try {
        const result = await $fetch<{ changed?: string | null }>(`/api/admin/schemas/${props.formId}/organisation`, {
            method: 'PATCH',
            query: withWorkspaceQuery(),
            body: props.expectedChanged === undefined
                ? { organisationId: selectedOrganisation.value.id }
                : { organisationId: selectedOrganisation.value.id, expectedChanged: props.expectedChanged }
        });
        toast.add({ title: t('admin.settings.workflow.organisationAssigned', { name: selectedOrganisation.value.label }), color: 'success' });
        confirming.value = false;
        emit('assigned', { changed: result?.changed ?? null });
    } catch (error: unknown) {
        assignError.value = resolveApiErrorMessage(error, 'errors.schema.organisationAssignFailed');
    } finally {
        assigning.value = false;
        emit('busy', false);
    }
}
</script>

<template>
  <div
    v-if="canAssign"
    data-test="organisation-assign"
    class="space-y-3"
  >
    <div class="flex flex-wrap items-end gap-3">
      <UFormField
        :label="t('admin.settings.workflow.organisationAssignLabel')"
        class="min-w-64"
      >
        <USelect
          v-model="selectedOrganisationId"
          data-test="organisation-assign-select"
          :items="organisationItems"
          :placeholder="t('admin.settings.workflow.organisationAssignPlaceholder')"
          :disabled="assigning || disabled"
          class="w-full"
        />
      </UFormField>
      <UButton
        v-if="!confirming"
        data-test="organisation-assign-start"
        color="neutral"
        variant="outline"
        icon="i-lucide-building-2"
        :disabled="!selectedOrganisation || disabled"
        @click="confirming = true"
      >
        {{ t('admin.settings.workflow.organisationAssign') }}
      </UButton>
    </div>
    <div
      v-if="confirming && selectedOrganisation"
      data-test="organisation-assign-confirm"
      role="group"
      :aria-label="t('admin.settings.workflow.organisationAssign')"
      class="space-y-3 rounded-md border border-default p-4 text-sm"
    >
      <p>{{ t('admin.settings.workflow.organisationAssignConfirm', { name: selectedOrganisation.label }) }}</p>
      <div class="flex flex-wrap gap-2">
        <UButton
          data-test="organisation-assign-submit"
          :loading="assigning"
          :disabled="disabled"
          @click="assign"
        >
          {{ t('admin.settings.workflow.organisationAssignSubmit', { name: selectedOrganisation.label }) }}
        </UButton>
        <UButton
          color="neutral"
          variant="ghost"
          :disabled="assigning"
          @click="confirming = false"
        >
          {{ t('common.cancel') }}
        </UButton>
      </div>
    </div>
    <p
      v-if="assignError"
      role="alert"
      data-test="organisation-assign-error"
      class="text-sm text-error"
    >
      {{ assignError }}
    </p>
  </div>
</template>
