<script setup lang="ts">
/**
 * "Bescheide" in the form editor: decision route, the collected
 * variable catalog to copy into Word, sample template, upload with the
 * comparison against the form, and the assigned templates.
 */
import type { DocgenComparison, DocgenFormSettings, DocgenFormUploadResult, DocgenPurpose, DocgenResponse, DocgenRoute, DocgenTemplate, DocgenVariable, DocgenVariables } from '~/types/docgen';
import { DELIVERY_ROUTES, isDeliveryRoute, type DeliveryRoute } from '~/types/delivery';
import { staffFetch } from '~~/casework-layer/app/composables/api/useStaffSessionFetch';
import { useDocgenMessages } from '../../composables/useDocgenMessages';
import { DOCGEN_MAX_UPLOAD_BYTES, docgenCopyText, docgenRetryAfter, docgenSectionCopyText, docgenVariableLabel, fetchDocgenFile, fileToBase64, groupDocgenVariables, saveBlob } from '../../utils/docgen';

const props = defineProps<{ formId: string }>();
const emit = defineEmits<{ busy: [pending: boolean] }>();
const { t, locale } = useI18n();
const toast = useToast();
const { withWorkspaceQuery, selectedWorkspaceKey, workspaceRoute } = useWorkspaceContext();
const { docgenMessage, codeText } = useDocgenMessages();

const PURPOSES: DocgenPurpose[] = ['approval', 'rejection', 'request_info', 'acknowledgement', 'other'];
const settings = shallowRef<DocgenFormSettings | null>(null);
const variables = shallowRef<DocgenVariables | null>(null);
const loading = ref(false);
const loadError = ref('');
const actionError = ref('');
const pending = ref<string | null>(null);
const routeDraft = ref<DocgenRoute>('none');
const search = ref('');
const uploadName = ref('');
const uploadPurpose = ref<DocgenPurpose>('approval');
const uploadReplaces = ref('__new');
const uploadFile = ref<File | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const lastUpload = shallowRef<{ template: DocgenTemplate, comparison: DocgenComparison } | null>(null);
/** Delivery offer being edited; mirrors the stored offer after every load and save. */
const deliveryRoutesDraft = ref<DeliveryRoute[]>([]);
const deliveryDefaultDraft = ref<DeliveryRoute | ''>('');
/** Only routes that are not connected yet are ticked: nothing is saved. */
const deliveryNeedsAvailable = ref(false);
let sequence = 0;

watch(pending, value => emit('busy', value !== null), { flush: 'sync' });

const base = computed(() => `/api/admin/docgen/forms/${props.formId}`);
const groups = computed(() => groupDocgenVariables(variables.value?.variables ?? [], locale.value, search.value, t('docgenUi.form.systemGroup')));
const variableCount = computed(() => variables.value?.variables.length ?? 0);
const routeItems = computed(() => (settings.value?.routes ?? ['none', 'template', 'case_system']).map(value => ({ value, label: t(`docgenUi.form.routes.${value}`) })));
const purposeItems = computed(() => PURPOSES.map(value => ({ value, label: t(`docgenUi.purpose.${value}`) })));
const replaceItems = computed(() => [
    { value: '__new', label: t('docgenUi.form.newTemplate') },
    ...(settings.value?.templates ?? []).map(template => ({ value: template.family, label: t('docgenUi.form.newVersionOf', { name: template.name }) }))
]);
const deliveryAvailable = computed<DeliveryRoute[]>(() => settings.value?.delivery.availableRoutes ?? DELIVERY_ROUTES.filter(route => route !== 'bundid'));
/** All routes can be offered; one that is not connected yet says so and is never the default. */
// Each item named directly (the same text as its label), so Reka's CheckboxRoot reads no label text.
const deliveryRouteItems = computed(() => DELIVERY_ROUTES.map(value => ({
    'value': value,
    'label': t(`delivery.route.${value}`),
    'aria-label': t(`delivery.route.${value}`),
    ...(deliveryAvailable.value.includes(value) ? {} : { description: t('docgenUi.form.delivery.bundidUnavailable') })
})));
const deliveryDefaultItems = computed(() => deliveryRoutesDraft.value
    .filter(value => deliveryAvailable.value.includes(value))
    .map(value => ({ value, label: t(`delivery.route.${value}`) })));
/** Rights in the form's scope (Drupal: administer docgen templates plus an admin role there). */
const canManage = computed(() => settings.value?.canManage === true);
const blocked = computed(() => pending.value !== null);
const canUpload = computed(() => !blocked.value && uploadFile.value !== null && (uploadReplaces.value !== '__new' || uploadName.value.trim() !== ''));

/** Loops show their opening tag; the full block is in the preview below. */
function displaySyntax(variable: DocgenVariable): string {
    return variable.repeatable ? `{#${variable.tag}}` : variable.syntax;
}

function fail(error: unknown): string {
    docgenRetryAfter(error);
    return docgenMessage(error, 'docgenUi.form.loadError');
}

async function load() {
    const current = ++sequence;
    loading.value = true;
    loadError.value = '';
    try {
        const query = withWorkspaceQuery();
        const [settingsResult, variablesResult] = await Promise.all([
            staffFetch<DocgenResponse<DocgenFormSettings>>(base.value, { query }),
            staffFetch<DocgenResponse<DocgenVariables>>(`${base.value}/variables`, { query })
        ]);
        if (current !== sequence) return;
        settings.value = settingsResult.data;
        variables.value = variablesResult.data;
        routeDraft.value = settingsResult.data.route;
    } catch (error) {
        if (current !== sequence) return;
        settings.value = null;
        variables.value = null;
        loadError.value = fail(error);
    } finally {
        if (current === sequence) loading.value = false;
    }
}

async function run(key: string, action: () => Promise<unknown>) {
    if (blocked.value) return;
    pending.value = key;
    actionError.value = '';
    const workspace = selectedWorkspaceKey.value;
    try {
        const success = await action();
        if (workspace !== selectedWorkspaceKey.value) return;
        if (typeof success === 'string') toast.add({ title: success, color: 'success', icon: 'i-lucide-circle-check' });
    } catch (error) {
        if (workspace !== selectedWorkspaceKey.value) return;
        actionError.value = fail(error);
    } finally {
        pending.value = null;
    }
}

async function copy(text: string) {
    try {
        await navigator.clipboard.writeText(text);
        toast.add({ title: t('docgenUi.form.copied'), description: t('docgenUi.form.copiedDescription'), color: 'success', icon: 'i-lucide-clipboard-check' });
    } catch {
        toast.add({ title: t('docgenUi.form.copyFailed'), color: 'error', icon: 'i-lucide-clipboard-x' });
    }
}

function syncDelivery(current: DocgenFormSettings | null) {
    deliveryRoutesDraft.value = [...(current?.delivery.routes ?? [])];
    deliveryDefaultDraft.value = current?.delivery.default ?? '';
    deliveryNeedsAvailable.value = false;
}
watch(settings, syncDelivery);

/**
 * Saves only the delivery offer: the PUT carries `delivery` and nothing
 * else, so it never overwrites the decision route or the templates.
 */
async function saveDelivery(routes: DeliveryRoute[], fallback: DeliveryRoute | '') {
    await run('delivery', async () => {
        const result = await staffFetch<DocgenResponse<DocgenFormSettings>>(base.value, {
            method: 'PUT',
            query: withWorkspaceQuery(),
            body: { delivery: { routes, default: fallback } }
        });
        settings.value = result.data;
        return t('docgenUi.form.delivery.saved');
    });
    // A failed save leaves the stored offer visible.
    syncDelivery(settings.value);
}

/**
 * Autosave on every change (the panel sits in a slideover). Removing the
 * default picks the first ticked route that is connected; ticking only
 * routes that are not connected yet saves nothing and says why.
 */
async function changeDeliveryRoutes(value: unknown) {
    if (!settings.value || !canManage.value || blocked.value || !Array.isArray(value)) return;
    const routes = DELIVERY_ROUTES.filter(route => value.includes(route));
    deliveryRoutesDraft.value = routes;
    const usable = routes.filter(route => deliveryAvailable.value.includes(route));
    if (routes.length && !usable.length) {
        deliveryNeedsAvailable.value = true;
        return;
    }
    deliveryNeedsAvailable.value = false;
    const current = deliveryDefaultDraft.value;
    const fallback = current && usable.includes(current) ? current : usable[0] ?? '';
    deliveryDefaultDraft.value = fallback;
    await saveDelivery(routes, fallback);
}

async function changeDeliveryDefault(value: unknown) {
    if (!settings.value || !canManage.value || blocked.value || !isDeliveryRoute(value) || value === deliveryDefaultDraft.value) return;
    if (!deliveryRoutesDraft.value.includes(value) || !deliveryAvailable.value.includes(value)) return;
    deliveryDefaultDraft.value = value;
    await saveDelivery(deliveryRoutesDraft.value, value);
}

async function saveSettings(route: DocgenRoute, families: string[], message: string) {
    await run('settings', async () => {
        const result = await staffFetch<DocgenResponse<DocgenFormSettings>>(base.value, {
            method: 'PUT',
            query: withWorkspaceQuery(),
            body: { route, templates: families }
        });
        settings.value = result.data;
        routeDraft.value = result.data.route;
        return message;
    });
}

/**
 * The decision route is saved on change: the panel sits in a slideover that
 * can be closed at any time, so an unsaved choice would get lost silently.
 */
async function changeRoute(value: unknown) {
    const current = settings.value;
    if (!current || !canManage.value || blocked.value || typeof value !== 'string' || !current.routes.includes(value as DocgenRoute) || value === current.route) return;
    routeDraft.value = value as DocgenRoute;
    await saveSettings(value as DocgenRoute, current.templates.map(template => template.family), t('docgenUi.form.routeSaved'));
    // A failed save leaves the stored route visible.
    if (settings.value) routeDraft.value = settings.value.route;
}

/**
 * Removing an assignment keeps the template in the catalogue, so the toast
 * offers to put it back at once (audit: "Zuordnung entfernen" acted without
 * a word). Undo restores the previous order of the templates still assigned.
 */
function removeAssignment(family: string) {
    const current = settings.value;
    if (!current) return;
    const before = current.templates.map(template => template.family);
    void run('settings', async () => {
        const result = await staffFetch<DocgenResponse<DocgenFormSettings>>(base.value, {
            method: 'PUT',
            query: withWorkspaceQuery(),
            body: { route: current.route, templates: before.filter(item => item !== family) }
        });
        settings.value = result.data;
        routeDraft.value = result.data.route;
        toast.add({
            title: t('docgenUi.form.assignmentRemoved'),
            color: 'success',
            icon: 'i-lucide-circle-check',
            actions: [{
                label: t('docgenUi.form.undoRemove'),
                icon: 'i-lucide-undo-2',
                color: 'neutral',
                variant: 'outline',
                onClick: () => restoreAssignment(family, before)
            }]
        });
    });
}

function restoreAssignment(family: string, before: string[]) {
    const current = settings.value;
    if (!current) return;
    const assigned = new Set(current.templates.map(template => template.family));
    if (assigned.has(family)) return;
    void saveSettings(current.route, before.filter(item => item === family || assigned.has(item)), t('docgenUi.form.assignmentRestored'));
}

function downloadSample(lang: 'de' | 'en') {
    void run(`sample:${lang}`, async () => {
        const { blob, filename } = await fetchDocgenFile(`${base.value}/sample`, withWorkspaceQuery({ lang }), 'muster.docx');
        saveBlob(blob, filename);
    });
}

function onFileChosen(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    actionError.value = '';
    if (file && !file.name.toLowerCase().endsWith('.docx')) {
        actionError.value = t('docgenUi.form.fileType');
        input.value = '';
        uploadFile.value = null;
        return;
    }
    if (file && file.size > DOCGEN_MAX_UPLOAD_BYTES) {
        actionError.value = t('docgenUi.form.fileTooLarge');
        input.value = '';
        uploadFile.value = null;
        return;
    }
    uploadFile.value = file;
    if (file && !uploadName.value.trim() && uploadReplaces.value === '__new') uploadName.value = file.name.replace(/\.docx$/iu, '');
}

function upload() {
    const file = uploadFile.value;
    if (!file || !canUpload.value) return;
    const family = uploadReplaces.value;
    // A new version always continues the newest version of the family, draft or released.
    const replaces = family === '__new' ? undefined : settings.value?.templates.find(template => template.family === family)?.latestId || undefined;
    if (family !== '__new' && !replaces) return;
    void run('upload', async () => {
        const content = await fileToBase64(file);
        const body: Record<string, string> = { filename: file.name, content };
        if (replaces) {
            body.replaces = replaces;
        } else {
            body.name = uploadName.value.trim();
            body.purpose = uploadPurpose.value;
        }
        const result = await staffFetch<DocgenResponse<DocgenFormUploadResult>>(`${base.value}/templates`, { method: 'POST', query: withWorkspaceQuery(), body });
        settings.value = result.data.settings;
        routeDraft.value = result.data.settings.route;
        lastUpload.value = { template: result.data.template, comparison: result.data.comparison };
        uploadFile.value = null;
        uploadName.value = '';
        uploadReplaces.value = '__new';
        if (fileInput.value) fileInput.value.value = '';
        return t('docgenUi.form.uploaded');
    });
}

function releaseTemplate(id: string) {
    void run(`release:${id}`, async () => {
        const result = await staffFetch<DocgenResponse<DocgenTemplate>>(`/api/admin/docgen/templates/${id}/release`, { method: 'POST', query: withWorkspaceQuery() });
        if (lastUpload.value?.template.id === id) lastUpload.value = { ...lastUpload.value, template: result.data };
        settings.value = (await staffFetch<DocgenResponse<DocgenFormSettings>>(base.value, { query: withWorkspaceQuery() })).data;
        return t('docgenUi.form.templateReleased');
    });
}

watch([() => props.formId, selectedWorkspaceKey], () => {
    lastUpload.value = null;
    void load();
}, { immediate: true });

onUnmounted(() => emit('busy', false));

const comparisonRows = computed(() => {
    const comparison = lastUpload.value?.comparison;
    if (!comparison) return [];
    // What needs action first; the long list of known placeholders last, collapsed.
    return [
        { key: 'unknown', label: t('docgenUi.form.unknown'), color: 'warning' as const, collapsed: false, items: comparison.unknown.map(entry => ({ tag: entry.tag, hint: entry.suggestion ? t('docgenUi.form.suggestion', { tag: entry.suggestion }) : '' })) },
        { key: 'protected', label: t('docgenUi.form.protectedUsed'), color: 'info' as const, collapsed: false, items: comparison.protected.map(tag => ({ tag, hint: '' })) },
        { key: 'unused', label: t('docgenUi.form.unused'), color: 'neutral' as const, collapsed: false, items: comparison.unused.map(tag => ({ tag, hint: '' })) },
        { key: 'known', label: t('docgenUi.form.known'), color: 'success' as const, collapsed: true, items: comparison.known.map(tag => ({ tag, hint: '' })) }
    ];
});

defineExpose({ reload: load });
</script>

<template>
  <div
    class="space-y-6"
    data-testid="docgen-form-panel"
  >
    <UAlert
      v-if="settings && !canManage"
      icon="i-lucide-lock"
      :title="t('docgenUi.form.readOnly')"
    />

    <div
      v-if="loading && !settings"
      class="space-y-3"
    >
      <USkeleton class="h-10 w-full" />
      <USkeleton class="h-40 w-full" />
    </div>

    <div
      v-if="loadError"
      role="alert"
    >
      <p class="mb-3 text-sm text-error">
        {{ loadError }}
      </p>
      <UButton
        color="neutral"
        variant="soft"
        class="min-h-11"
        :disabled="loading"
        @click="load"
      >
        {{ t('common.retry') }}
      </UButton>
    </div>

    <p
      v-if="actionError"
      role="alert"
      class="text-sm text-error"
    >
      {{ actionError }}
    </p>

    <template v-if="settings && variables">
      <!-- Warnings -->
      <UAlert
        v-if="settings.warnings.length"
        role="status"
        color="warning"
        icon="i-lucide-triangle-alert"
        :title="t('docgenUi.form.warningsTitle')"
        data-testid="docgen-form-warnings"
      >
        <template #description>
          <ul class="list-disc space-y-1 ps-5">
            <li
              v-for="(warning, index) in settings.warnings"
              :key="index"
            >
              {{ codeText(warning.code) }}
              <span
                v-if="warning.placeholders?.length"
                class="break-words"
              >
                <code
                  v-for="entry in warning.placeholders"
                  :key="entry.tag"
                  class="me-1 rounded bg-elevated px-1 text-xs"
                >{{ entry.tag }}</code>
              </span>
            </li>
          </ul>
        </template>
      </UAlert>

      <!-- Decision route -->
      <section
        class="space-y-3"
        aria-labelledby="docgen-route-title"
      >
        <h3
          id="docgen-route-title"
          class="font-semibold"
        >
          {{ t('docgenUi.form.routeLabel') }}
        </h3>
        <URadioGroup
          :model-value="routeDraft"
          :items="routeItems"
          value-key="value"
          :disabled="!canManage || blocked"
          data-testid="docgen-route"
          @update:model-value="changeRoute"
        />
        <p class="text-sm text-muted">
          {{ t(`docgenUi.form.routeHelp.${routeDraft}`) }}
        </p>
        <p
          v-if="canManage"
          class="text-sm text-muted"
          role="status"
        >
          {{ pending === 'settings' ? t('docgenUi.form.routeSaving') : t('docgenUi.form.routeAutosave') }}
        </p>
      </section>

      <!-- Delivery route offer -->
      <section
        class="space-y-3"
        aria-labelledby="docgen-delivery-title"
        data-testid="docgen-delivery"
      >
        <h3
          id="docgen-delivery-title"
          class="font-semibold"
        >
          {{ t('docgenUi.form.delivery.title') }}
        </h3>
        <UCheckboxGroup
          :model-value="deliveryRoutesDraft"
          :items="deliveryRouteItems"
          value-key="value"
          :legend="t('docgenUi.form.delivery.routesLabel')"
          :disabled="!canManage || blocked"
          data-testid="docgen-delivery-routes"
          @update:model-value="changeDeliveryRoutes"
        />
        <p
          v-if="deliveryNeedsAvailable"
          role="alert"
          class="text-sm text-warning"
          data-testid="docgen-delivery-needs-available"
        >
          {{ t('docgenUi.form.delivery.needsAvailable') }}
        </p>
        <p
          v-if="!deliveryRoutesDraft.length"
          class="text-sm text-muted"
          data-testid="docgen-delivery-not-configured"
        >
          {{ t('docgenUi.form.delivery.notConfigured') }}
        </p>
        <URadioGroup
          v-else-if="deliveryDefaultItems.length"
          :model-value="deliveryDefaultDraft || undefined"
          :items="deliveryDefaultItems"
          value-key="value"
          :legend="t('docgenUi.form.delivery.defaultLabel')"
          :disabled="!canManage || blocked"
          data-testid="docgen-delivery-default"
          @update:model-value="changeDeliveryDefault"
        />
        <p class="text-sm text-muted">
          {{ t('docgenUi.form.delivery.decisionsByPost') }}
        </p>
      </section>

      <!-- Assigned templates -->
      <section
        class="space-y-3"
        aria-labelledby="docgen-assigned-title"
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h3
            id="docgen-assigned-title"
            class="font-semibold"
          >
            {{ t('docgenUi.form.assignedTitle') }}
          </h3>
          <UButton
            v-if="settings.catalogInWorkspace"
            :to="workspaceRoute('/admin/settings/decisions')"
            color="neutral"
            variant="link"
            icon="i-lucide-library"
            class="min-h-11"
          >
            {{ t('docgenUi.form.catalogLink') }}
          </UButton>
        </div>
        <p
          v-if="!settings.templates.length"
          class="text-sm text-muted"
        >
          {{ t('docgenUi.form.assignedEmpty') }}
        </p>
        <ul class="space-y-2">
          <li
            v-for="template in settings.templates"
            :key="template.family"
            class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-default p-3 text-sm"
            data-testid="docgen-form-template"
          >
            <div class="min-w-0">
              <p class="break-words font-medium">
                {{ template.name }}
              </p>
              <p class="text-xs text-muted">
                {{ t(`docgenUi.purpose.${template.purpose}`) }} ·
                {{ t('docgenUi.form.latestVersion', { version: template.latestVersion }) }} ·
                {{ template.releasedVersion ? t('docgenUi.form.releasedVersion', { version: template.releasedVersion }) : t('docgenUi.form.notReleased') }}
              </p>
            </div>
            <div class="flex flex-wrap gap-1">
              <UBadge
                :color="template.releasedVersion ? 'success' : 'neutral'"
              >
                {{ t(`docgenUi.state.${template.releasedVersion ? 'released' : 'draft'}`) }}
              </UBadge>
              <UBadge
                v-if="template.comparison.unknown.length"
                color="warning"
              >
                {{ t('docgenUi.form.unknown') }}: {{ template.comparison.unknown.length }}
              </UBadge>
              <UButton
                v-if="canManage && template.latestId && template.latestStatus === 'draft' && !template.latestHasErrors"
                icon="i-lucide-stamp"
                class="min-h-11"
                :loading="pending === `release:${template.latestId}`"
                :disabled="blocked"
                @click="releaseTemplate(template.latestId)"
              >
                {{ t('docgenUi.form.releaseVersion', { version: template.latestVersion }) }}
              </UButton>
              <UButton
                v-if="canManage"
                color="neutral"
                variant="ghost"
                icon="i-lucide-unlink"
                class="min-h-11"
                :aria-label="t('docgenUi.form.removeAria', { name: template.name })"
                :disabled="blocked"
                @click="removeAssignment(template.family)"
              >
                {{ t('docgenUi.form.remove') }}
              </UButton>
            </div>
          </li>
        </ul>
      </section>

      <!-- Upload -->
      <section
        v-if="canManage"
        class="space-y-3 rounded-lg border border-default p-3 sm:p-4"
        aria-labelledby="docgen-upload-title"
      >
        <h3
          id="docgen-upload-title"
          class="font-semibold"
        >
          {{ t('docgenUi.form.uploadTitle') }}
        </h3>
        <UFormField :label="t('docgenUi.form.replaces')">
          <USelect
            v-model="uploadReplaces"
            :items="replaceItems"
            value-key="value"
            class="w-full"
            :disabled="blocked"
          />
        </UFormField>
        <div
          v-if="uploadReplaces === '__new'"
          class="grid gap-3 sm:grid-cols-2"
        >
          <UFormField
            :label="t('docgenUi.form.name')"
            required
          >
            <UInput
              v-model="uploadName"
              :maxlength="255"
              class="w-full"
              :disabled="blocked"
              data-testid="docgen-upload-name"
            />
          </UFormField>
          <UFormField :label="t('docgenUi.form.purpose')">
            <USelect
              v-model="uploadPurpose"
              :items="purposeItems"
              value-key="value"
              class="w-full"
              :disabled="blocked"
            />
          </UFormField>
        </div>
        <UFormField :label="t('docgenUi.form.file')">
          <input
            ref="fileInput"
            type="file"
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            class="block w-full text-sm file:me-3 file:min-h-11 file:rounded-md file:border-0 file:bg-elevated file:px-3 file:py-2"
            :disabled="blocked"
            data-testid="docgen-upload-file"
            @change="onFileChosen"
          >
        </UFormField>
        <UButton
          icon="i-lucide-upload"
          class="min-h-11"
          :loading="pending === 'upload'"
          :disabled="!canUpload"
          data-testid="docgen-upload-submit"
          @click="upload"
        >
          {{ t('docgenUi.form.upload') }}
        </UButton>

        <div
          v-if="lastUpload"
          class="space-y-3 rounded-lg bg-elevated/50 p-3"
          data-testid="docgen-upload-result"
        >
          <p class="font-medium">
            {{ t('docgenUi.form.comparisonTitle') }}: {{ lastUpload.template.name }}, {{ t('docgenUi.form.latestVersion', { version: lastUpload.template.version }) }}
          </p>
          <div
            v-if="lastUpload.template.errors.length"
            role="alert"
            class="text-sm text-error"
          >
            <p class="font-medium">
              {{ t('docgenUi.form.templateErrors') }}
            </p>
            <ul class="list-disc ps-5">
              <li
                v-for="(error, index) in lastUpload.template.errors"
                :key="index"
                class="break-words"
              >
                {{ error.message }}<code
                  v-if="error.tag"
                  class="ms-1 text-sm"
                >{{ error.tag }}</code>
              </li>
            </ul>
          </div>
          <div class="grid gap-3 text-sm sm:grid-cols-2">
            <component
              :is="row.collapsed ? 'details' : 'div'"
              v-for="row in comparisonRows"
              :key="row.key"
              :class="row.collapsed ? 'sm:col-span-2' : undefined"
              :data-testid="`docgen-comparison-${row.key}`"
            >
              <component
                :is="row.collapsed ? 'summary' : 'p'"
                class="flex min-h-11 items-center gap-2 font-medium"
                :class="row.collapsed ? 'cursor-pointer' : undefined"
              >
                <UBadge
                  :color="row.color"
                >
                  {{ row.items.length }}
                </UBadge>
                {{ row.label }}
              </component>
              <div class="mt-1">
                <span
                  v-if="!row.items.length"
                  class="text-muted"
                >{{ t('docgenUi.form.none') }}</span>
                <ul
                  v-else
                  class="space-y-0.5"
                >
                  <li
                    v-for="item in row.items"
                    :key="item.tag"
                    class="break-all"
                  >
                    <code class="text-sm">{{ item.tag }}</code>
                    <span
                      v-if="item.hint"
                      class="ms-1 text-sm text-muted"
                    >{{ item.hint }}</span>
                  </li>
                </ul>
              </div>
            </component>
          </div>
          <UButton
            v-if="lastUpload.template.status === 'draft' && !lastUpload.template.errors.length"
            icon="i-lucide-stamp"
            class="min-h-11"
            :loading="pending === `release:${lastUpload.template.id}`"
            :disabled="blocked"
            data-testid="docgen-upload-release"
            @click="releaseTemplate(lastUpload.template.id)"
          >
            {{ t('docgenUi.form.releaseVersion', { version: lastUpload.template.version }) }}
          </UButton>
        </div>
      </section>

      <!-- Sample -->
      <section
        class="space-y-2"
        aria-labelledby="docgen-sample-title"
      >
        <h3
          id="docgen-sample-title"
          class="font-semibold"
        >
          {{ t('docgenUi.form.sample') }}
        </h3>
        <p class="text-sm text-muted">
          {{ t('docgenUi.form.sampleHelp') }}
        </p>
        <div
          class="flex flex-wrap gap-2"
          role="group"
          :aria-label="t('docgenUi.form.sampleLanguage')"
        >
          <UButton
            color="neutral"
            variant="outline"
            icon="i-lucide-file-down"
            class="min-h-11"
            :loading="pending === 'sample:de'"
            :disabled="blocked"
            data-testid="docgen-sample-de"
            @click="downloadSample('de')"
          >
            {{ t('language.de') }}
          </UButton>
          <UButton
            color="neutral"
            variant="outline"
            icon="i-lucide-file-down"
            class="min-h-11"
            :loading="pending === 'sample:en'"
            :disabled="blocked"
            @click="downloadSample('en')"
          >
            {{ t('language.en') }}
          </UButton>
        </div>
      </section>

      <!-- Variables -->
      <section
        class="space-y-3"
        aria-labelledby="docgen-variables-title"
      >
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <h3
            id="docgen-variables-title"
            class="font-semibold"
          >
            {{ t('docgenUi.form.variablesTitle') }}
          </h3>
          <span class="text-sm text-muted">{{ t('docgenUi.form.variableCount', { count: variableCount }) }}</span>
        </div>
        <p class="text-sm text-muted">
          {{ t('docgenUi.form.variablesHelp') }}
        </p>
        <UInput
          v-model="search"
          icon="i-lucide-search"
          type="search"
          class="w-full"
          :placeholder="t('docgenUi.form.searchPlaceholder')"
          :aria-label="t('docgenUi.form.search')"
          data-testid="docgen-variable-search"
        />
        <p
          v-if="!groups.length"
          class="text-sm text-muted"
        >
          {{ t('docgenUi.form.noMatches') }}
        </p>
        <div
          v-for="group in groups"
          :key="group.id"
          class="rounded-lg border border-default"
          data-testid="docgen-variable-group"
        >
          <div class="flex flex-wrap items-center justify-between gap-2 border-b border-default bg-elevated/50 px-3 py-2">
            <h4 class="min-w-0 break-words text-sm font-semibold">
              {{ group.title }}
            </h4>
            <UButton
              color="neutral"
              variant="ghost"
              icon="i-lucide-copy-plus"
              class="min-h-11"
              :aria-label="t('docgenUi.form.copySectionAria', { section: group.title })"
              @click="copy(docgenSectionCopyText(group))"
            >
              {{ t('docgenUi.form.copySection') }}
            </UButton>
          </div>
          <ul class="divide-y divide-(--ui-border)">
            <li
              v-for="variable in group.variables"
              :key="variable.tag"
              class="px-3 py-2 text-sm"
              data-testid="docgen-variable"
            >
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="min-w-0 flex-1">
                  <p class="break-words">
                    {{ docgenVariableLabel(variable, locale) }}
                  </p>
                  <div class="mt-0.5 flex flex-wrap items-center gap-1">
                    <code class="break-all rounded bg-elevated px-1.5 py-0.5 text-xs">{{ displaySyntax(variable) }}</code>
                    <UBadge
                      v-if="variable.protected"
                      color="warning"
                      icon="i-lucide-shield"
                      :title="t('docgenUi.form.protectedHelp')"
                    >
                      {{ t('docgenUi.form.protected') }}
                    </UBadge>
                    <UBadge
                      v-if="variable.repeatable"
                      color="info"
                      icon="i-lucide-repeat"
                    >
                      {{ t('docgenUi.form.repeatable') }}
                    </UBadge>
                  </div>
                </div>
                <UButton
                  color="neutral"
                  variant="outline"
                  icon="i-lucide-copy"
                  class="min-h-11 min-w-11"
                  :aria-label="t('docgenUi.form.copyAria', { tag: variable.tag })"
                  data-testid="docgen-variable-copy"
                  @click="copy(docgenCopyText(variable))"
                >
                  <span class="hidden sm:inline">{{ t('docgenUi.form.copy') }}</span>
                </UButton>
              </div>
              <pre
                v-if="variable.repeatable"
                class="mt-2 overflow-x-auto rounded bg-elevated p-2 text-sm"
              >{{ docgenCopyText(variable) }}</pre>
              <ul
                v-if="variable.repeatable && variable.children?.length"
                class="mt-2 space-y-1 ps-3"
              >
                <li
                  v-for="child in variable.children"
                  :key="child.tag"
                  class="flex flex-wrap items-center justify-between gap-2"
                >
                  <span class="min-w-0 break-words text-sm">
                    {{ docgenVariableLabel(child, locale) }}
                    <code class="ms-1 rounded bg-elevated px-1">{{ child.syntax }}</code>
                    <UBadge
                      v-if="child.protected"
                      color="warning"
                      class="ms-1"
                    >{{ t('docgenUi.form.protected') }}</UBadge>
                  </span>
                  <UButton
                    color="neutral"
                    variant="ghost"
                    icon="i-lucide-copy"
                    class="min-h-11 min-w-11"
                    :aria-label="t('docgenUi.form.copyAria', { tag: child.tag })"
                    @click="copy(child.syntax)"
                  />
                </li>
              </ul>
            </li>
          </ul>
        </div>
        <p
          v-if="variables.loopExample"
          class="text-sm text-muted"
        >
          {{ t('docgenUi.form.loopExample') }}: <code>{{ variables.loopExample }}</code>
        </p>
      </section>
    </template>
  </div>
</template>
