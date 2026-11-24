<script setup lang="ts">
import { shallowRef } from 'vue';
import { DRAFT_ICON } from '~/utils/action-icons';
import { formatDateTime } from '~/composables/useFormatters';
import type { FormSchemaCollectionResponse, ApplicationCountsResponse } from '~/types';
import type { FormSchemaLifecycleStatus, FormSchemaStatusResponse } from '~/types/api';
import type { DraftClassificationChoice, DraftClassificationField, DraftClassificationReview } from '../../../../shared/schema-classification';
import { needsClassification } from '../../../../shared/schema-classification';
import SchemaClassificationForm from '../../../components/admin/SchemaClassificationForm.vue';
import SchemaFileImportDialog from '../../../components/admin/SchemaFileImportDialog.vue';
import type { StatTile } from '../../../components/admin/StatTiles.vue';
import { formListDetailPath, staffOutlet } from '../../../utils/staff-extensions';
import { formStatusErrorData } from '../../../utils/publish-blockers';

interface SchemaListItem {
    id: string
    label: string
    status: string
    aiReviewPending: boolean
    publicationScope: 'internet' | 'intranet'
    created: string
    changed: string
    revisionId: number | null
}

const lifecycleTargets = new Map<string, FormSchemaLifecycleStatus>([
    ['draft', 'published'],
    ['published', 'archived'],
    ['archived', 'draft']
]);

definePageMeta({
    layout: 'dashboard',
    middleware: 'admin'
});

const { t } = useI18n();
const toast = useToast();
const { resolveApiErrorMessage } = useApiErrorMessage();
const { currentWorkspace, selectedWorkspaceKey, withWorkspaceQuery, workspaceRoute } = useWorkspaceContext();
const hasToolbarActions = computed(() => staffOutlet('form-list-toolbar').length > 0);
const hasEmptyActions = computed(() => staffOutlet('form-list-empty-actions').length > 0);
const hasRowActions = computed(() => staffOutlet('form-list-row-actions').length > 0);
const canCreateForm = computed(() => currentWorkspace.value?.canCreateFormSchema === true);

useHead({
    title: computed(() => `${t('nav.forms')} - beantragt.ai`)
});

// Fetch every form for client-side sorting and paging. The ID breaks ties between
// forms created in the same second so they stay in order across requests.
const schemasQuery = computed(() => withWorkspaceQuery({
    all: 'true',
    sort: '-created,-drupal_internal__id',
    fields: 'label,field_workflow_status,field_ai_review_pending,field_publication_scope,created,changed,drupal_internal__revision_id'
}));
const { data: schemasResponse, status, error, refresh } = await useFetch<FormSchemaCollectionResponse>(
    '/api/admin/schemas',
    {
        key: computed(() => `admin-schemas-${selectedWorkspaceKey.value ?? 'none'}`),
        query: schemasQuery
    }
);

const schemas = computed<SchemaListItem[]>(() => {
    if (!schemasResponse.value?.data) return [];
    return schemasResponse.value.data.map((item: FormSchemaCollectionResponse['data'][number]) => {
        const publicationScope: SchemaListItem['publicationScope']
            = item.attributes.field_publication_scope === 'internet' ? 'internet' : 'intranet';
        const revisionId = Number(item.attributes.drupal_internal__revision_id);

        return {
            id: item.id,
            label: item.attributes.label ?? '',
            status: item.attributes.field_workflow_status || 'unknown',
            aiReviewPending: item.attributes.field_ai_review_pending === true,
            publicationScope,
            created: item.attributes.created ?? '',
            changed: item.attributes.changed ?? '',
            revisionId: Number.isSafeInteger(revisionId) && revisionId > 0 ? revisionId : null
        };
    });
});

// Fetch application counts in a single request (fixes N+1 query)
const applicationCounts = ref<Record<string, number>>({});
const applicationCountsLoaded = ref(false);
const applicationCountsFailed = ref(false);
const schemaGroupCounts = ref<Record<string, number>>({});
const schemaGroupCountsLoaded = ref(false);
const schemaGroupCountsFailed = ref(false);
const schemaToDelete = ref<SchemaListItem | null>(null);
const isDeleteDialogOpen = ref(false);
const deletingSchemaId = ref<string | null>(null);
const lifecycleSelection = shallowRef<{ schema: SchemaListItem, target: FormSchemaLifecycleStatus, revision: number } | null>(null);
const lifecyclePending = ref(false);
const lifecycleError = ref('');
const classificationReview = shallowRef<DraftClassificationReview | null>(null);
const classificationRejected = shallowRef<DraftClassificationField[]>([]);
const classificationError = ref('');
const classificationResult = ref<'publishable' | 'blocked' | 'unverified' | null>(null);
const canClassify = computed(() => !classificationResult.value && !!classificationReview.value?.fields.some(needsClassification));
const classificationFormId = 'forms-classification';
let lifecycleFocusId: string | null = null;

const lifecycleTitle = computed(() => {
    const selection = lifecycleSelection.value;
    if (!selection) return undefined;
    const params = { title: selection.schema.label };
    if (canClassify.value) return t('admin.forms.classification.title', params);
    if (classificationReview.value || classificationResult.value) return t('admin.forms.classification.reviewTitle', params);
    return t(`admin.forms.lifecycle.${selection.target}.title`, params);
});

const lifecycleDescription = computed(() => {
    const selection = lifecycleSelection.value;
    if (!selection) return '';
    if (canClassify.value) return t('admin.forms.classification.description');
    if (classificationReview.value || classificationResult.value) return t('admin.forms.classification.draft');
    const suffix = selection.target === 'published' ? selection.schema.publicationScope : 'description';
    return t(`admin.forms.lifecycle.${selection.target}.${suffix}`);
});

function openLifecycleDialog(schema: SchemaListItem) {
    const target = lifecycleTargets.get(schema.status);
    if (!target || schema.revisionId === null || lifecyclePending.value || status.value !== 'success' || !currentWorkspace.value) return;
    lifecycleError.value = '';
    classificationReview.value = null;
    classificationRejected.value = [];
    classificationError.value = '';
    classificationResult.value = null;
    lifecycleFocusId = `form-lifecycle-${schema.id}`;
    lifecycleSelection.value = { schema, target, revision: schema.revisionId };
}

function closeLifecycleDialog() {
    if (!lifecyclePending.value) lifecycleSelection.value = null;
}

function restoreLifecycleFocus() {
    if (!lifecycleFocusId) return;
    (document.getElementById(lifecycleFocusId) ?? document.getElementById('forms-heading'))?.focus();
    lifecycleFocusId = null;
}

function lifecycleFailureMessage(code: string | null, fields: string | null) {
    if (fields && code) return t(code, { fields });
    switch (code) {
        case 'errors.schema.modifiedInOtherTab': return t('admin.forms.lifecycle.revisionChanged');
        case 'errors.schemaSetup.loadFailed': return t('admin.forms.lifecycle.capabilityUnavailable');
        case 'errors.schema.publishForbidden': return t('admin.forms.lifecycle.publishForbidden');
        case 'errors.schema.formInvalid':
        case 'errors.schema.notFound':
        case 'errors.auth.notAuthenticated':
        case 'errors.auth.accessDenied':
        case 'errors.admin.accessDenied': return t(code);
        default: return t('errors.schema.statusUpdateFailed');
    }
}

async function changeSelectedStatus() {
    const selection = lifecycleSelection.value;
    if (!selection || lifecyclePending.value || lifecycleError.value) return;
    const { schema, target, revision } = selection;
    lifecyclePending.value = true;

    try {
        try {
            await $fetch<FormSchemaStatusResponse>(`/api/admin/schemas/${schema.id}/status`, {
                method: 'PATCH',
                query: withWorkspaceQuery(),
                body: { status: target, expectedRevision: revision }
            });
        } catch (error: unknown) {
            if (lifecycleSelection.value !== selection) return;
            const { code, fields, classification } = formStatusErrorData(error);
            if (target === 'published' && classification?.fields.length) {
                classificationReview.value = classification;
                return;
            }
            lifecycleError.value = lifecycleFailureMessage(code, fields);
            if (code === 'errors.schema.modifiedInOtherTab') await refresh();
            return;
        }

        if (lifecycleSelection.value !== selection) return;
        await refresh();
        if (lifecycleSelection.value !== selection) return;
        toast.add({ title: t(`admin.forms.lifecycle.${target}.success`, { title: schema.label }), color: 'success' });
        lifecycleSelection.value = null;
    } finally {
        lifecyclePending.value = false;
        if (lifecycleSelection.value === selection && (lifecycleError.value || classificationReview.value)) {
            await nextTick();
            if (lifecycleSelection.value === selection) focusLifecycleFeedback();
        }
    }
}

function focusLifecycleFeedback() {
    (document.getElementById('forms-classification-feedback') ?? document.getElementById('forms-lifecycle-cancel'))?.focus();
}

async function saveClassification(choices: DraftClassificationChoice[]) {
    const selection = lifecycleSelection.value;
    if (!selection || !canClassify.value || lifecyclePending.value || lifecycleError.value) return;
    lifecyclePending.value = true;
    classificationError.value = '';
    classificationRejected.value = [];
    try {
        const { classification } = await $fetch<{ classification: DraftClassificationReview | null }>(
            `/api/admin/schemas/${selection.schema.id}/classification`,
            { method: 'PATCH', query: withWorkspaceQuery(), body: { expectedRevision: selection.revision, choices }, retry: 0 }
        );
        if (lifecycleSelection.value !== selection) return;
        classificationReview.value = classification;
        classificationResult.value = classification ? (classification.publishable ? 'publishable' : 'blocked') : 'unverified';
        await refresh();
    } catch (error: unknown) {
        if (lifecycleSelection.value !== selection) return;
        const { code, classification } = formStatusErrorData(error);
        if (classification?.fields.length) {
            classificationRejected.value = classification.fields;
        } else if (code === 'errors.schema.modifiedInOtherTab' || code === 'errors.schema.classificationDraftRequired') {
            classificationReview.value = null;
            lifecycleError.value = t('admin.forms.lifecycle.revisionChanged');
            await refresh();
        } else {
            classificationError.value = resolveApiErrorMessage(error, 'errors.schema.classificationFailed');
        }
    } finally {
        lifecyclePending.value = false;
        if (lifecycleSelection.value === selection && !classificationRejected.value.length) {
            await nextTick();
            if (lifecycleSelection.value === selection) focusLifecycleFeedback();
        }
    }
}

watch([schemas, status, selectedWorkspaceKey], ([items, listStatus], _previous, onCleanup) => {
    applicationCountsLoaded.value = false;
    applicationCountsFailed.value = false;
    schemaGroupCountsLoaded.value = false;
    schemaGroupCountsFailed.value = false;
    if (!items.length || listStatus !== 'success') return;

    const controller = new AbortController();
    onCleanup(() => controller.abort());
    const options = { query: withWorkspaceQuery(), signal: controller.signal };

    void $fetch<ApplicationCountsResponse>('/api/admin/application-counts', options).then((response) => {
        if (controller.signal.aborted) return;
        applicationCounts.value = response.counts;
        applicationCountsLoaded.value = true;
    }).catch(() => {
        if (!controller.signal.aborted) applicationCountsFailed.value = true;
    });

    void $fetch<{ counts: Record<string, number> }>('/api/admin/schema-group-counts', options).then((response) => {
        if (controller.signal.aborted) return;
        schemaGroupCounts.value = response.counts;
        schemaGroupCountsLoaded.value = true;
    }).catch(() => {
        if (!controller.signal.aborted) schemaGroupCountsFailed.value = true;
    });
}, { immediate: true });

function getSchemaGroupCount(schemaId: string): number {
    return schemaGroupCounts.value[schemaId] ?? 0;
}

function openDeleteDialog(schema: SchemaListItem) {
    // A blocked bin stays focusable for its reason (aria-disabled); it opens nothing.
    if (schema.status !== 'draft' || !canDeleteSchema(schema)) return;

    schemaToDelete.value = schema;
    isDeleteDialogOpen.value = true;
}

// `all` is the working view, drafts and published forms; archived forms
// have their own filter, so a withdrawn form does not stand between drafts.
type StatusFilter = 'all' | 'published' | 'draft' | 'archived';
type ScopeFilter = 'all' | SchemaListItem['publicationScope'];

type SortKey = 'created' | 'changed' | 'label';

const route = useRoute();
const statusFromQuery = (): StatusFilter => route.query?.status === 'archived' ? 'archived' : 'all';
const statusFilter = ref<StatusFilter>(statusFromQuery());
// The function search opens "Archivierte Formulare" with `?status=archived`.
watch(() => route.query?.status, () => {
    statusFilter.value = statusFromQuery();
});
const scopeFilter = ref<ScopeFilter>('all');
const search = ref('');
// Default is the order the list always had: newest first.
const sortKey = ref<SortKey>('created');
const page = ref(1);
const PAGE_SIZE = 20;

const sortOptions = computed(() => [
    { label: t('admin.forms.sortCreated'), value: 'created' },
    { label: t('admin.forms.sortChanged'), value: 'changed' },
    { label: t('admin.forms.sortLabel'), value: 'label' }
]);

const scopeOptions = computed(() => [
    { label: t('admin.forms.scopeAll'), value: 'all' },
    { label: t('admin.forms.publicationScopes.internet'), value: 'internet' },
    { label: t('admin.forms.publicationScopes.intranet'), value: 'intranet' }
]);

const totalApplications = computed(() =>
    schemas.value.reduce((sum, schema) => sum + getApplicationCount(schema.id), 0)
);

// Four tiles, all four filter. "Archiviert" replaces the
// figure "Anträge gesamt" and the line with the archived forms; the total of
// applications moves into the foot line of the list.
const statTiles = computed<StatTile[]>(() => [
    { key: 'all', label: t('admin.forms.statsAll'), value: workingCount.value, icon: 'i-lucide-files', tone: 'neutral', filterable: true },
    { key: 'published', label: t('admin.forms.statsPublished'), value: schemas.value.filter(schema => schema.status === 'published').length, icon: 'i-lucide-globe', tone: 'success', filterable: true },
    { key: 'draft', label: t('admin.forms.statsDraft'), value: schemas.value.filter(schema => schema.status === 'draft').length, icon: DRAFT_ICON, tone: 'warning', filterable: true },
    { key: 'archived', label: t('admin.forms.statsArchived'), value: archivedCount.value, icon: 'i-lucide-archive', tone: 'neutral', filterable: true }
]);

function timestamp(value: string): number {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
}

const filteredSchemas = computed(() => {
    const needle = search.value.trim().toLocaleLowerCase('de');
    const matches = schemas.value.filter(schema =>
        (statusFilter.value === 'all' ? schema.status !== 'archived' : schema.status === statusFilter.value)
        && (scopeFilter.value === 'all' || schema.publicationScope === scopeFilter.value)
        && (!needle || schema.label.toLocaleLowerCase('de').includes(needle))
    );
    const byLabel = (a: SchemaListItem, b: SchemaListItem) => a.label.localeCompare(b.label, 'de');
    return [...matches].sort((a, b) => {
        // The id breaks every remaining tie, so the order is the same on every render.
        const byId = a.id.localeCompare(b.id);
        if (sortKey.value === 'label') return byLabel(a, b) || timestamp(b.created) - timestamp(a.created) || byId;
        if (sortKey.value === 'changed') return timestamp(b.changed || b.created) - timestamp(a.changed || a.created) || byLabel(a, b) || byId;
        return timestamp(b.created) - timestamp(a.created) || byLabel(a, b) || byId;
    });
});

const pageCount = computed(() => Math.max(1, Math.ceil(filteredSchemas.value.length / PAGE_SIZE)));
const pagedSchemas = computed(() => filteredSchemas.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));

// A new filter, search or order starts on the first page; a delete that empties
// the last page steps back.
watch([statusFilter, scopeFilter, search, sortKey], () => {
    page.value = 1;
});
watch(pageCount, (count) => {
    if (page.value > count) page.value = count;
});

const archivedCount = computed(() => schemas.value.filter(schema => schema.status === 'archived').length);
const workingCount = computed(() => schemas.value.length - archivedCount.value);

function selectStatusTile(key: string) {
    statusFilter.value = key === statusFilter.value || key === 'all' ? 'all' : key as StatusFilter;
}

function resetFilters() {
    statusFilter.value = 'all';
    scopeFilter.value = 'all';
    search.value = '';
    page.value = 1;
}

function selectSchemaPage(id: string) {
    const index = filteredSchemas.value.findIndex(schema => schema.id === id);
    if (index >= 0) page.value = Math.floor(index / PAGE_SIZE) + 1;
}

const requestedFormId = computed(() => typeof route.query?.form === 'string' ? route.query.form : undefined);

onMounted(() => {
    let focusedFormId: string | undefined;
    watch([requestedFormId, status], async ([id, listStatus], _previous, onCleanup) => {
        if (focusedFormId !== id) focusedFormId = undefined;
        if (!id || focusedFormId || listStatus !== 'success') return;
        const schema = schemas.value.find(item => item.id === id);
        if (!schema) return;

        let active = true;
        onCleanup(() => {
            active = false;
        });
        resetFilters();
        if (schema.status === 'archived') statusFilter.value = 'archived';
        await nextTick();
        if (!active) return;
        selectSchemaPage(id);
        await nextTick();
        if (!active) return;
        document.getElementById(`form-row-${id}`)?.focus();
        focusedFormId = id;
    }, { immediate: true, flush: 'post' });
});

async function showImportedSchema(result: { workspaceId: string, workspaceKey: string, entityId: string }) {
    const isActiveWorkspace = () => currentWorkspace.value?.id === result.workspaceId
      && currentWorkspace.value?.key === result.workspaceKey;
    if (!isActiveWorkspace()) return;

    resetFilters();
    sortKey.value = 'created';
    await refresh();
    if (!isActiveWorkspace()) return;

    selectSchemaPage(result.entityId);
    toast.add({ title: t('admin.forms.schemaFileImport.success'), color: 'success' });
}

const hasActiveFilters = computed(() =>
    statusFilter.value !== 'all' || scopeFilter.value !== 'all' || search.value.trim() !== ''
);

function getApplicationCount(schemaId: string): number {
    return applicationCounts.value[schemaId] ?? 0;
}

function canDeleteSchema(schema: SchemaListItem): boolean {
    return status.value === 'success'
      && schema.status === 'draft'
      && !!schema.changed
      && applicationCountsLoaded.value
      && !applicationCountsFailed.value
      && schemaGroupCountsLoaded.value
      && !schemaGroupCountsFailed.value
      && getApplicationCount(schema.id) === 0
      && getSchemaGroupCount(schema.id) === 0;
}

function getApplicationsLabel(schemaId: string): string {
    const count = getApplicationCount(schemaId);
    return t(count === 1 ? 'admin.forms.applicationSingular' : 'admin.forms.applications');
}

// The foot line under the list, "7 Formulare · 30 Anträge"
// (the second part only once the counts loaded); with several pages the range.
const footLine = computed(() => {
    const total = filteredSchemas.value.length;
    const first = pageCount.value > 1
        ? t('admin.forms.showing', { from: (page.value - 1) * PAGE_SIZE + 1, to: Math.min(page.value * PAGE_SIZE, total), total })
        : t('admin.forms.formCount', { count: total }, total);
    if (!applicationCountsLoaded.value || applicationCountsFailed.value) return first;
    const applications = totalApplications.value;
    return `${first} · ${t('admin.forms.applicationTotal', { count: applications }, applications)}`;
});

function detailLink(schemaId: string) {
    const path = formListDetailPath(schemaId);
    return path ? workspaceRoute(path) : { ...workspaceRoute('/admin/applications'), query: { form: schemaId } };
}

function getDeleteAriaLabel(schema: SchemaListItem): string {
    return t('admin.forms.deleteSchemaNamed', { label: schema.label });
}

/**
 * Why a draft cannot be deleted, said at the bin. Null while the counts
 * still load (the bin is plainly disabled for that moment) or when it can be
 * deleted. The same reasons as in the dialog.
 */
function deleteBlockedReason(schema: SchemaListItem): string | null {
    // An archived form keeps its bin locked, with the delete route's reason.
    if (schema.status === 'archived') return t('errors.schema.draftDeleteOnly');
    if (schema.status !== 'draft' || canDeleteSchema(schema)) return null;
    if (applicationCountsFailed.value || !schema.changed) return t('admin.forms.deleteSchemaCountUnavailable');
    if (schemaGroupCountsFailed.value) return t('admin.forms.schemaGroupCountsErrorDescription');
    if (!applicationCountsLoaded.value || !schemaGroupCountsLoaded.value) return null;
    if (getSchemaGroupCount(schema.id) > 0) return t('admin.forms.deleteSchemaGroupBlocked');
    if (getApplicationCount(schema.id) > 0) return t('admin.forms.deleteSchemaBlocked');
    return null;
}

// Keyboard users get the disabled reason on focus. Pointer users get it on click.
const reasonOpenId = ref<string | null>(null);
function setReasonOpen(schemaId: string, open: boolean) {
    if (open) reasonOpenId.value = schemaId;
    else if (reasonOpenId.value === schemaId) reasonOpenId.value = null;
}
watch(selectedWorkspaceKey, () => {
    resetFilters();
    statusFilter.value = statusFromQuery();
    reasonOpenId.value = null;
    isDeleteDialogOpen.value = false;
    schemaToDelete.value = null;
    lifecycleSelection.value = null;
    lifecycleFocusId = null;
});

function openReasonOnKeyboardFocus(event: FocusEvent, schemaId: string) {
    const target = event.target;
    let keyboard = false;
    try {
        keyboard = target instanceof HTMLElement && target.matches(':focus-visible');
    } catch {
        keyboard = false;
    }
    if (keyboard) reasonOpenId.value = schemaId;
}

/** "In 2 Verfahren" only where the form belongs to one; nothing while loading or failed. */
function showSchemaGroupCount(schemaId: string): boolean {
    return schemaGroupCountsLoaded.value && !schemaGroupCountsFailed.value && getSchemaGroupCount(schemaId) > 0;
}

function closeDeleteDialog() {
    if (deletingSchemaId.value) return;
    isDeleteDialogOpen.value = false;
    schemaToDelete.value = null;
}

async function deleteSelectedSchema() {
    if (!schemaToDelete.value) return;

    const schema = schemaToDelete.value;
    if (!canDeleteSchema(schema)) return;

    deletingSchemaId.value = schema.id;

    try {
        await $fetch(`/api/admin/schemas/${schema.id}`, {
            method: 'DELETE',
            query: withWorkspaceQuery({ expectedChanged: schema.changed })
        });
        toast.add({
            title: t('admin.forms.deleteSuccess'),
            color: 'success'
        });
        isDeleteDialogOpen.value = false;
        schemaToDelete.value = null;
        await refresh();
    } catch (e: unknown) {
        toast.add({
            title: t('admin.forms.deleteError'),
            description: resolveApiErrorMessage(e),
            color: 'error'
        });
    } finally {
        deletingSchemaId.value = null;
    }
}
</script>

<template>
  <AppPageLayout
    :title="t('admin.forms.title')"
    :description="t('admin.forms.subtitle')"
    heading-id="forms-heading"
  >
    <template
      v-if="currentWorkspace && canCreateForm"
      #actions
    >
      <SchemaFileImportDialog
        :workspace="currentWorkspace"
        @imported="showImportedSchema"
      />
      <StaffExtensionOutlet
        v-if="hasToolbarActions"
        name="form-list-toolbar"
      />
    </template>

    <AccessReason
      v-if="currentWorkspace && !canCreateForm"
      id="forms-create-access"
      :text="t('errors.schema.writeForbidden')"
    />

    <!-- Loading: the new row height -->
    <div
      v-if="status === 'pending' && !(lifecyclePending && lifecycleSelection)"
      class="space-y-2"
      data-test="forms-loading"
    >
      <USkeleton
        v-for="i in 5"
        :key="i"
        class="h-16 w-full rounded-lg"
      />
    </div>

    <!-- Error -->
    <UAlert
      v-else-if="error"
      color="error"
      icon="i-lucide-circle-x"
      :title="t('admin.forms.loadError')"
      :description="resolveApiErrorMessage(error, 'admin.forms.loadErrorDescription')"
      class="max-w-3xl"
    />

    <UEmpty
      v-else-if="!schemas.length"
      :icon="hasEmptyActions ? 'i-lucide-file-plus' : 'i-lucide-files'"
      :title="t('admin.forms.empty')"
      :description="hasEmptyActions ? (canCreateForm ? t('admin.forms.emptyDescription') : undefined) : t('admin.forms.emptyImportDescription')"
    >
      <template
        v-if="canCreateForm"
        #actions
      >
        <div class="flex flex-col items-center gap-3">
          <StaffExtensionOutlet
            v-if="hasEmptyActions"
            name="form-list-empty-actions"
          />
          <p
            class="text-sm text-muted"
            data-test="forms-empty-catalog"
          >
            {{ t('admin.forms.emptyCatalogBefore') }}
            <ULink
              :to="workspaceRoute('/admin/fim')"
              class="font-medium text-default underline underline-offset-2"
            >{{ t('admin.forms.emptyCatalogLink') }}</ULink>{{ t('admin.forms.emptyCatalogAfter') }}
          </p>
        </div>
      </template>
    </UEmpty>

    <!-- Schema list -->
    <div
      v-else
      class="space-y-4"
    >
      <AdminStatTiles
        :tiles="statTiles"
        :active="statusFilter"
        :label="t('admin.forms.statsLabel')"
        @select="selectStatusTile"
      />

      <!-- Search and filter left, sorting right. -->
      <div
        class="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center"
        data-test="forms-toolbar"
      >
        <UInput
          v-model="search"
          icon="i-lucide-search"
          :placeholder="t('admin.forms.searchPlaceholder')"
          :aria-label="t('admin.forms.searchLabel')"
          class="w-full sm:w-80"
        />
        <USelect
          v-model="scopeFilter"
          :items="scopeOptions"
          value-key="value"
          :aria-label="t('admin.forms.scopeLabel')"
          class="w-full sm:w-44"
        />
        <UButton
          v-if="hasActiveFilters"
          color="neutral"
          variant="ghost"
          class="self-start sm:self-auto"
          data-test="forms-reset-filters"
          @click="resetFilters"
        >
          {{ t('admin.forms.resetFilters') }}
        </UButton>
        <USelect
          v-model="sortKey"
          :items="sortOptions"
          value-key="value"
          icon="i-lucide-arrow-down-up"
          :aria-label="t('admin.forms.sortAria')"
          data-test="forms-sort"
          class="w-full sm:ms-auto sm:w-52"
        />
      </div>

      <UAlert
        v-if="applicationCountsFailed"
        role="status"
        color="warning"
        icon="i-lucide-triangle-alert"
        :title="t('admin.forms.applicationCountsErrorTitle')"
        :description="t('admin.forms.applicationCountsErrorDescription')"
        class="max-w-3xl"
      />
      <UAlert
        v-if="schemaGroupCountsFailed"
        role="status"
        color="warning"
        icon="i-lucide-triangle-alert"
        :title="t('admin.forms.schemaGroupCountsErrorTitle')"
        :description="t('admin.forms.schemaGroupCountsErrorDescription')"
        class="max-w-3xl"
      />

      <div
        v-if="!filteredSchemas.length"
        class="flex flex-wrap items-center gap-x-3 gap-y-1 py-8 text-sm text-muted"
        data-test="forms-no-match"
      >
        <span>{{ t('admin.forms.noMatchesDescription') }}</span>
        <UButton
          color="neutral"
          variant="ghost"
          @click="resetFilters"
        >
          {{ t('admin.forms.resetFilters') }}
        </UButton>
      </div>

      <template v-else>
        <ul
          class="space-y-2"
        >
          <li
            v-for="schema in pagedSchemas"
            :id="`form-row-${schema.id}`"
            :key="schema.id"
            :tabindex="requestedFormId === schema.id ? -1 : undefined"
          >
            <AdminListRow
              :title="schema.label"
              :to="detailLink(schema.id)"
              :paired-actions="hasRowActions"
              :wide-actions="schema.revisionId !== null && lifecycleTargets.has(schema.status)"
              chevron
            >
              <template #badges>
                <StatusBadge
                  :status="schema.status"
                  type="schema"
                />
                <UBadge
                  v-if="schema.status === 'draft' && schema.aiReviewPending"
                  color="neutral"
                  :label="t('admin.forms.aiReviewMarker')"
                  data-test="ai-review-marker"
                />
              </template>
              <template #meta>
                <span data-test="form-meta">
                  <span data-test="form-scope">{{ t(`admin.forms.publicationScopes.${schema.publicationScope}`) }}</span>
                  <span aria-hidden="true"> · </span>
                  <span data-test="form-changed">{{ t('admin.forms.changedOn', { date: formatDateTime(schema.changed || schema.created) }) }}</span>
                  <template v-if="showSchemaGroupCount(schema.id)">
                    <span aria-hidden="true"> · </span>
                    <span data-test="form-schema-groups">{{ t('admin.forms.inSchemaGroups', { count: getSchemaGroupCount(schema.id) }, getSchemaGroupCount(schema.id)) }}</span>
                  </template>
                </span>
              </template>
              <!-- The number of applications is a quiet
                   fact; zero is a word. -->
              <template #figure>
                <span
                  class="whitespace-nowrap text-sm"
                  data-test="form-figure"
                >
                  <span
                    v-if="applicationCountsFailed"
                    class="text-muted"
                  >-</span>
                  <span
                    v-else-if="!applicationCountsLoaded"
                    class="text-muted"
                  >...</span>
                  <span
                    v-else-if="getApplicationCount(schema.id) === 0"
                    class="text-muted"
                  >{{ t('admin.forms.noApplications') }}</span>
                  <template v-else>
                    <span
                      class="font-semibold text-highlighted tabular-nums"
                      data-test="application-count"
                    >{{ getApplicationCount(schema.id) }}</span>
                    <!-- The template drops a leading space, so the gap is a margin. -->
                    <span
                      class="ms-1 text-muted"
                      data-test="application-unit"
                    >{{ getApplicationsLabel(schema.id) }}</span>
                  </template>
                </span>
              </template>
              <template #actions>
                <StaffExtensionOutlet
                  name="form-list-row-actions"
                  :context="schema"
                />
                <!-- A blocked bin keeps its focus and says why: aria-disabled
                     instead of disabled, and always in the DOM as its description.
                     Click, tap, Enter or Space open the reason; the focus stays on the bin. It looks locked. -->
                <UPopover
                  v-if="(schema.status === 'draft' || schema.status === 'archived') && deleteBlockedReason(schema)"
                  :open="reasonOpenId === schema.id"
                  :content="{ side: 'left', onOpenAutoFocus: (event: Event) => event.preventDefault() }"
                  @update:open="(open: boolean) => setReasonOpen(schema.id, open)"
                >
                  <UButton
                    color="neutral"
                    variant="ghost"
                    icon="i-lucide-trash-2"
                    class="text-dimmed"
                    aria-disabled="true"
                    :aria-label="getDeleteAriaLabel(schema)"
                    :aria-describedby="`delete-reason-${schema.id}`"
                    data-test="form-delete"
                    @focus="openReasonOnKeyboardFocus($event, schema.id)"
                    @click="openDeleteDialog(schema)"
                  />
                  <template #content>
                    <div
                      class="max-w-64 p-3"
                      data-test="form-delete-reason-popover"
                    >
                      <AccessReason
                        :id="`delete-reason-popover-${schema.id}`"
                        :text="deleteBlockedReason(schema) ?? ''"
                      />
                    </div>
                  </template>
                </UPopover>
                <UButton
                  v-else-if="schema.status === 'draft'"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-trash-2"
                  class="hover:text-error focus-visible:text-error"
                  :loading="deletingSchemaId === schema.id"
                  :disabled="!!deletingSchemaId || !canDeleteSchema(schema)"
                  :aria-label="getDeleteAriaLabel(schema)"
                  data-test="form-delete"
                  @click="openDeleteDialog(schema)"
                />
                <span
                  v-if="(schema.status === 'draft' || schema.status === 'archived') && deleteBlockedReason(schema)"
                  :id="`delete-reason-${schema.id}`"
                  class="sr-only"
                  data-test="form-delete-reason"
                >{{ deleteBlockedReason(schema) }}</span>
                <UButton
                  v-if="schema.revisionId !== null && lifecycleTargets.has(schema.status)"
                  :id="`form-lifecycle-${schema.id}`"
                  color="neutral"
                  variant="outline"
                  :disabled="lifecyclePending || status !== 'success'"
                  :aria-label="t(`admin.forms.lifecycle.${lifecycleTargets.get(schema.status)}.namedAction`, { title: schema.label })"
                  data-test="form-lifecycle-action"
                  @click="openLifecycleDialog(schema)"
                >
                  {{ t(`admin.forms.lifecycle.${lifecycleTargets.get(schema.status)}.action`) }}
                </UButton>
              </template>
            </AdminListRow>
          </li>
        </ul>
      </template>

      <!-- Foot line, always under the list. -->
      <div
        v-if="filteredSchemas.length"
        class="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
        data-test="forms-foot"
      >
        <p
          class="text-sm text-muted"
          data-test="forms-foot-line"
        >
          {{ footLine }}
        </p>
        <AppPagination
          v-if="pageCount > 1"
          v-model:page="page"
          :total="filteredSchemas.length"
          :items-per-page="PAGE_SIZE"
        />
      </div>
    </div>

    <UModal
      :open="!!lifecycleSelection"
      :title="lifecycleTitle"
      :description="lifecycleDescription"
      :close="false"
      :dismissible="!lifecyclePending"
      :ui="{ title: 'wrap-anywhere' }"
      :content="{ onCloseAutoFocus: (event: Event) => event.preventDefault() }"
      @update:open="(value: boolean) => !value && closeLifecycleDialog()"
      @after:leave="restoreLifecycleFocus"
    >
      <template
        v-if="lifecycleError || classificationError || classificationReview || classificationResult"
        #body
      >
        <UAlert
          v-if="lifecycleError || classificationError"
          :id="classificationError ? 'forms-classification-feedback' : undefined"
          :tabindex="classificationError ? -1 : undefined"
          role="alert"
          color="error"
          icon="i-lucide-circle-x"
          :title="lifecycleError || classificationError"
          data-test="form-lifecycle-error"
        />
        <div
          v-if="classificationReview || classificationResult"
          class="space-y-4"
        >
          <p
            :id="classificationError ? undefined : 'forms-classification-feedback'"
            tabindex="-1"
            role="status"
            class="text-sm"
          >
            {{ t(classificationResult ? `admin.forms.classification.${classificationResult}` : 'admin.forms.classification.blockedBeforeSave') }}
          </p>
          <SchemaClassificationForm
            v-if="classificationReview?.fields.length"
            :form-id="classificationFormId"
            :fields="classificationReview.fields"
            :rejected="classificationRejected"
            :editable="canClassify"
            :pending="lifecyclePending"
            @save="saveClassification"
          />
        </div>
      </template>
      <template #footer>
        <UButton
          id="forms-lifecycle-cancel"
          color="neutral"
          variant="ghost"
          :disabled="lifecyclePending"
          :label="t(lifecycleError || classificationResult || (classificationReview && !canClassify) ? 'common.close' : 'common.cancel')"
          data-test="form-lifecycle-cancel"
          @click="closeLifecycleDialog"
        />
        <UButton
          v-if="canClassify"
          type="submit"
          :form="classificationFormId"
          :loading="lifecyclePending"
          :label="t('admin.forms.classification.save')"
          data-test="form-classification-save"
        />
        <UButton
          v-else-if="lifecycleSelection && !lifecycleError && !classificationReview && !classificationResult"
          :color="lifecycleSelection.target === 'archived' ? 'warning' : 'primary'"
          :loading="lifecyclePending"
          :label="t(`admin.forms.lifecycle.${lifecycleSelection.target}.action`)"
          data-test="form-lifecycle-confirm"
          @click="changeSelectedStatus"
        />
      </template>
    </UModal>

    <UModal
      :open="isDeleteDialogOpen"
      :title="schemaToDelete ? t('admin.forms.deleteSchemaNamedTitle', { title: schemaToDelete.label }) : t('admin.forms.deleteSchemaTitle')"
      :description="t('admin.forms.deleteDraftDescription')"
      :close="!deletingSchemaId"
      @update:open="(value: boolean) => !value && closeDeleteDialog()"
    >
      <!-- Only when the counts changed while the dialog was open: one reason,
           and the red button stays disabled. -->
      <template
        v-if="schemaToDelete && !canDeleteSchema(schemaToDelete)"
        #body
      >
        <UAlert
          role="status"
          icon="i-lucide-triangle-alert"
          color="warning"
          :title="deleteBlockedReason(schemaToDelete) ?? t('admin.forms.deleteSchemaCountUnavailable')"
          data-test="form-delete-blocked"
        />
      </template>

      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            :disabled="!!deletingSchemaId"
            @click="closeDeleteDialog"
          >
            {{ t('common.cancel') }}
          </UButton>
          <UButton
            color="error"
            icon="i-lucide-trash-2"
            :loading="!!deletingSchemaId"
            :disabled="!!deletingSchemaId || (schemaToDelete ? !canDeleteSchema(schemaToDelete) : true)"
            data-test="form-delete-confirm"
            @click="deleteSelectedSchema"
          >
            {{ t('admin.forms.deleteSchemaConfirm') }}
          </UButton>
        </div>
      </template>
    </UModal>
  </AppPageLayout>
</template>
