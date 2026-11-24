<script setup lang="ts">
import type { AdminApplicationsResponse, ApplicationRow, FormSchemaCollectionResponse } from '~/types';
import type { AdminUnconfirmedApplicationsResponse, UnconfirmedApplicationRow } from '~/types/admin';
import { classifySettingsLoadFailure } from '~~/casework-layer/app/composables/useSettingsLoadState';
import { hasApplicationAssignmentRelationship } from '~~/casework-layer/app/utils/application-assignment-filter';
import { applicationListRows, applicationListFormLabels } from '~~/casework-layer/app/utils/application-list-rows';
import type { FormSchema } from '~/types/form';
import { parseStoredFormSchema } from '~/utils/form-schema';
import { buildStatusMap } from '~/utils/workflow-status';

definePageMeta({
    layout: 'dashboard',
    middleware: 'admin'
});

const { t } = useI18n();
const { resolveApiErrorMessage } = useApiErrorMessage();
const route = useRoute();
const { selectedWorkspaceKey, currentWorkspace, withWorkspaceQuery, workspaceRoute } = useWorkspaceContext();
const { user, isAdmin } = useAuth();
const requestedFormId = computed(() => typeof route.query?.form === 'string' ? route.query.form : undefined);
const formId = computed(() => isAdmin.value ? requestedFormId.value : undefined);
const formSchema = ref<FormSchema | null>(null);
const formLabel = ref<string | null>(null);
const currentUserId = computed(() => user.value?.uuid ?? null);
const currentTeamIds = computed(() =>
    currentWorkspace.value?.type === 'organisation' ? [currentWorkspace.value.id] : []
);

useHead({
    title: computed(() => `${t('nav.applications')} - beantragt.ai`)
});

const schemaLabels = ref<Record<string, string>>({});

const rows = ref<ApplicationRow[]>([]);
const showUnconfirmed = ref(false);
const unreadFilterActive = ref(false);
const unconfirmedRows = ref<UnconfirmedApplicationRow[] | null>(null);
const statusMap = ref(new Map());
const loading = ref(true);
const error = ref<string | null>(null);
const retryable = ref(false);
const truncated = ref(false);
const assignmentFilterAvailable = ref(false);
let applicationRequestId = 0;

async function loadApplications() {
    const requestId = ++applicationRequestId;
    loading.value = true;
    error.value = null;
    truncated.value = false;
    unconfirmedRows.value = null;
    rows.value = [];
    formSchema.value = null;
    formLabel.value = null;
    const schemaId = formId.value;

    try {
        if (!schemaId && showUnconfirmed.value) {
            const res = await $fetch<AdminUnconfirmedApplicationsResponse>('/api/admin/applications', {
                query: withWorkspaceQuery({ confirmation: 'unconfirmed' })
            });
            if (requestId !== applicationRequestId) return;
            unconfirmedRows.value = res.data.filter(item => item.emailConfirmed === false);
            truncated.value = res.meta.truncated;
            return;
        }

        if (schemaId) {
            const { data } = await $fetch<FormSchemaCollectionResponse>('/api/admin/schemas', {
                query: withWorkspaceQuery({ schemaId })
            });
            if (requestId !== applicationRequestId) return;
            const form = data.find(item => item.id === schemaId);
            const stored = form?.attributes.field_schema;
            const value = typeof stored === 'string' ? stored : stored?.value;
            if (!value) throw createError({ statusCode: 404, message: 'errors.schema.notFound' });
            formSchema.value = parseStoredFormSchema(value, schemaId);
            formLabel.value = form?.attributes.label ?? null;
        }

        const res = await $fetch<AdminApplicationsResponse>('/api/admin/applications', {
            query: withWorkspaceQuery(schemaId ? { schemaId } : {})
        });

        if (requestId !== applicationRequestId) return;
        const applications = res.data || [];
        truncated.value = Boolean(res.meta?.truncated);
        schemaLabels.value = applicationListFormLabels(res.included);
        assignmentFilterAvailable.value = applications.some(hasApplicationAssignmentRelationship);
        statusMap.value = buildStatusMap(res.included as Parameters<typeof buildStatusMap>[0]);
        rows.value = applicationListRows(res, schemaId);
    } catch (e) {
        if (requestId !== applicationRequestId) return;
        console.error('[admin] Failed to load applications:', e);
        const failure = classifySettingsLoadFailure(e);
        retryable.value = failure.kind === 'technical' && failure.retryable;
        error.value = resolveApiErrorMessage(e, 'admin.applications.loadError');
        truncated.value = false;
        assignmentFilterAvailable.value = false;
    } finally {
        if (requestId === applicationRequestId) {
            loading.value = false;
        }
    }
}

onMounted(loadApplications);
watch(formId, () => {
    showUnconfirmed.value = false;
});
watch([selectedWorkspaceKey, currentUserId, formId, showUnconfirmed], loadApplications, { flush: 'post' });
</script>

<template>
  <AppPageLayout
    :title="formLabel || t('admin.applications.title')"
    :description="formId ? t('admin.forms.applicationsHeading') : t('admin.applications.subtitle')"
    :breadcrumbs="formId ? [{ label: t('nav.forms'), to: workspaceRoute('/admin/forms') }] : undefined"
  >
    <!-- The access notice after a redirect comes first, from AppPageLayout. -->
    <UAlert
      v-if="requestedFormId && !isAdmin"
      role="status"
      color="info"
      icon="i-lucide-info"
      :title="t('admin.applications.formViewAdminOnly')"
      class="mb-4"
    />

    <UAlert
      v-if="error"
      color="error"
      icon="i-lucide-circle-x"
      :title="error"
      :actions="retryable ? [{ label: t('common.retry'), color: 'neutral', variant: 'outline', onClick: loadApplications }] : []"
      class="mb-4"
    />

    <UAlert
      v-if="truncated && !unreadFilterActive"
      role="status"
      aria-live="polite"
      color="warning"
      icon="i-lucide-triangle-alert"
      :title="t('admin.applications.limitedTitle')"
      :description="showUnconfirmed
        ? t('admin.applications.unconfirmed.limitedDescription', { count: unconfirmedRows?.length ?? 0 })
        : t('admin.applications.limitedDescription', { count: rows.length })"
      class="mb-4"
    />

    <!-- The page's one table: a card without a title, the page title names it. -->
    <AppCard>
      <AdminApplicationsDataTable
        :key="formId || 'all'"
        v-model:show-unconfirmed="showUnconfirmed"
        :caption="t('admin.applications.title')"
        :rows="rows"
        :unconfirmed-rows="formId ? undefined : unconfirmedRows"
        :schema="formSchema"
        :application-form-id="formId"
        :status-map="statusMap"
        :schema-labels="schemaLabels"
        :show-form-column="!formId"
        enable-unread-messages
        :current-user-id="currentUserId"
        :current-team-ids="currentTeamIds"
        :assignment-filter-available="assignmentFilterAvailable"
        :loading="loading"
        @unread-filter-change="unreadFilterActive = $event"
        @refresh="loadApplications"
      />
    </AppCard>
  </AppPageLayout>
</template>
