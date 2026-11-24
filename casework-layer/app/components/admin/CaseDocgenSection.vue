<script setup lang="ts">
import type { CaseDetailPanelContext } from '../../utils/case-detail-context';
import { useCasePanelState } from '../../composables/useCasePanelState';

const { context } = defineProps<{ context: CaseDetailPanelContext }>();
const { isStaff, application } = context;
const { nachreichungVersion, deliveryVersion, docgenPanel, requestWay } = useCasePanelState(context);

const setupTo = computed(() => context.isAdmin.value && application.value?.schemaId
    ? { ...context.workspaceRoute(`/admin/forms/${application.value.schemaId}/edit`), query: { panel: 'decisions' } }
    : null);

async function onReleased() {
    context.bumpResponses();
    nachreichungVersion.value += 1;
    deliveryVersion.value += 1;
    await context.refreshApplication();
}
</script>

<template>
  <AdminApplicationDocgen
    v-if="isStaff && application"
    ref="docgenPanel"
    :application-id="application.id"
    :form-id="application.schemaId"
    :setup-to="setupTo"
    @busy="context.setBusy('docgen', $event)"
    @released="onReleased"
    @request-way="requestWay = $event"
  />
</template>
