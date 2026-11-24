<script setup lang="ts">
import type { CaseDetailPanelContext } from '../../utils/case-detail-context';
import { useCasePanelState } from '../../composables/useCasePanelState';

const { context } = defineProps<{ context: CaseDetailPanelContext }>();
const { isStaff, application } = context;
const { nachreichungVersion, requestWay } = useCasePanelState(context);

const setupTo = computed(() => context.isAdmin.value && application.value?.schemaId
    ? { ...context.workspaceRoute(`/admin/forms/${application.value.schemaId}/edit`), query: { panel: 'decisions' } }
    : null);
</script>

<template>
  <AdminApplicationNachreichung
    v-if="isStaff && application"
    id="application-nachreichung"
    :key="`nachreichung-${nachreichungVersion}`"
    :application-id="application.id"
    :request-way="requestWay"
    :setup-to="setupTo"
  />
</template>
