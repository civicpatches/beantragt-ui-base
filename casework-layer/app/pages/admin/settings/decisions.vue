<script setup lang="ts">
/**
 * Decision template catalog of the selected workspace: templates with
 * their versions, upload with the placeholders docgen found, version
 * release, sender address and the document service health.
 */
import type { DocgenCatalog, DocgenHealth, DocgenPurpose, DocgenResponse, DocgenScopeSettings, DocgenTemplate } from '~/types/docgen';
import { formatDateTime } from '~/composables/useFormatters';
import { staffFetch } from '~~/casework-layer/app/composables/api/useStaffSessionFetch';
import { useDocgenMessages } from '~~/casework-layer/app/composables/useDocgenMessages';
import { DOCGEN_MAX_UPLOAD_BYTES, docgenRetryAfter, fetchDocgenFile, fileToBase64, saveBlob } from '~~/casework-layer/app/utils/docgen';
import AccessReason from '~~/casework-layer/app/components/AccessReason.vue';
import AppCard from '~/components/app/Card.vue';

definePageMeta({
    layout: 'dashboard',
    middleware: 'admin'
});

const { t } = useI18n();
const toast = useToast();
const { workspaceRoute, withWorkspaceQuery, selectedWorkspaceKey } = useWorkspaceContext();
const { docgenMessage } = useDocgenMessages();

useHead({
    title: computed(() => `${t('docgenUi.catalog.title')} - ${t('common.settings')} - beantragt.ai`)
});

const PURPOSES: DocgenPurpose[] = ['approval', 'rejection', 'request_info', 'acknowledgement', 'other'];
const catalog = shallowRef<DocgenCatalog | null>(null);
const health = shallowRef<DocgenHealth | null>(null);
const scopeSettings = shallowRef<DocgenScopeSettings | null>(null);
const senderDraft = ref('');
const loading = ref(true);
const loadError = ref('');
const actionError = ref('');
const pending = ref<string | null>(null);
const uploadName = ref('');
const uploadPurpose = ref<DocgenPurpose>('approval');
const uploadFile = ref<File | null>(null);
const versionInput = ref<HTMLInputElement | null>(null);
const versionTarget = ref<DocgenTemplate | null>(null);
const lastUploadId = ref<string | null>(null);
const confirm = ref<{ kind: 'release' | 'delete', template: DocgenTemplate } | null>(null);
let sequence = 0;

// "Neue Vorlage hochladen" is the header action and opens the upload form in a dialog.
const uploadOpen = ref(false);
// Disclosures per template: placeholders (open after an upload of that template) and older versions.
const placeholdersOpen = ref<Record<string, boolean>>({});
const olderOpen = ref<Record<string, boolean>>({});
watch(lastUploadId, (id) => {
    if (!id) return;
    uploadOpen.value = false;
    placeholdersOpen.value = { ...placeholdersOpen.value, [id]: true };
});

/** The document service as one line when ready, as an alert naming the part when not. */
const healthReady = computed(() => health.value?.configured === true && health.value.status === 'ok');
const healthAlertColor = computed(() => health.value?.configured && health.value.status === 'degraded' ? 'warning' as const : 'error' as const);
const healthAlertDescription = computed(() => {
    const current = health.value;
    if (!current) return '';
    if (!current.configured) return healthLabel('not_configured');
    const parts = [
        current.gotenberg && current.gotenberg !== 'ok' ? t('docgenUi.catalog.healthPartConversion') : null,
        current.verapdf && current.verapdf !== 'ok' ? t('docgenUi.catalog.healthPartPdfa') : null
    ].filter((part): part is string => part !== null);
    return parts.length ? t('docgenUi.catalog.healthAffected', { parts: parts.join(', ') }) : healthLabel(current.status);
});

const purposeItems = computed(() => PURPOSES.map(value => ({ value, label: t(`docgenUi.purpose.${value}`) })));
const canManage = computed(() => catalog.value?.canManage === true);
const blocked = computed(() => pending.value !== null);
// The inherited address as one line: "Marktplatz 1, 12345 Musterstadt".
const effectiveSenderOneLine = computed(() => (scopeSettings.value?.effectiveSenderAddress ?? '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .join(', '));
const senderChanged = computed(() => scopeSettings.value !== null && senderDraft.value !== scopeSettings.value.senderAddress);

/** Families with their newest version first, then the older versions. */
const families = computed(() => {
    const byFamily = new Map<string, DocgenTemplate[]>();
    for (const template of catalog.value?.templates ?? []) {
        byFamily.set(template.family, [...(byFamily.get(template.family) ?? []), template]);
    }
    return [...byFamily.values()]
        .map(versions => versions.sort((a, b) => b.version - a.version))
        .map(versions => ({ latest: versions[0]!, older: versions.slice(1) }))
        .sort((a, b) => a.latest.name.localeCompare(b.latest.name, 'de'));
});

function timestamp(seconds: number | null): string {
    return seconds ? formatDateTime(new Date(seconds * 1000).toISOString()) : '';
}

function healthLabel(value: string | undefined): string {
    const key = value && ['ok', 'degraded', 'down', 'not_configured'].includes(value) ? value : 'unknown';
    return t(`docgenUi.catalog.health.${key}`);
}

async function load() {
    const current = ++sequence;
    loading.value = true;
    loadError.value = '';
    const query = withWorkspaceQuery();
    try {
        const [catalogResult, settingsResult] = await Promise.all([
            staffFetch<DocgenResponse<DocgenCatalog>>('/api/admin/docgen/templates', { query }),
            staffFetch<DocgenResponse<DocgenScopeSettings>>('/api/admin/docgen/settings', { query })
        ]);
        if (current !== sequence) return;
        catalog.value = catalogResult.data;
        scopeSettings.value = settingsResult.data;
        senderDraft.value = settingsResult.data.senderAddress;
    } catch (error) {
        if (current !== sequence) return;
        catalog.value = null;
        loadError.value = docgenMessage(error, 'docgenUi.catalog.loadError');
    } finally {
        if (current === sequence) loading.value = false;
    }
    try {
        const healthResult = await staffFetch<DocgenResponse<DocgenHealth>>('/api/admin/docgen/health', { query });
        if (current === sequence) health.value = healthResult.data;
    } catch {
        // Health is for template administrators only; others never see it.
        if (current === sequence) health.value = null;
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
        docgenRetryAfter(error);
        actionError.value = docgenMessage(error);
        await load();
    } finally {
        pending.value = null;
    }
}

function checkFile(file: File | undefined | null): File | null {
    if (!file) return null;
    if (!file.name.toLowerCase().endsWith('.docx')) {
        actionError.value = t('docgenUi.form.fileType');
        return null;
    }
    if (file.size > DOCGEN_MAX_UPLOAD_BYTES) {
        actionError.value = t('docgenUi.form.fileTooLarge');
        return null;
    }
    return file;
}

function onUploadChosen(file: File | null | undefined) {
    actionError.value = '';
    uploadFile.value = checkFile(file);
    if (uploadFile.value && !uploadName.value.trim()) uploadName.value = uploadFile.value.name.replace(/\.docx$/iu, '');
}

function upload() {
    const file = uploadFile.value;
    if (!file || !uploadName.value.trim()) return;
    void run('upload', async () => {
        const result = await staffFetch<DocgenResponse<DocgenTemplate>>('/api/admin/docgen/templates', {
            method: 'POST',
            query: withWorkspaceQuery(),
            body: { name: uploadName.value.trim(), purpose: uploadPurpose.value, filename: file.name, content: await fileToBase64(file) }
        });
        lastUploadId.value = result.data.id;
        uploadFile.value = null;
        uploadName.value = '';
        await load();
        return t('docgenUi.catalog.uploaded');
    });
}

function chooseVersion(template: DocgenTemplate) {
    if (blocked.value) return;
    versionTarget.value = template;
    versionInput.value?.click();
}

function onVersionChosen(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = checkFile(input.files?.[0]);
    const target = versionTarget.value;
    input.value = '';
    versionTarget.value = null;
    if (!file || !target) return;
    void run(`version:${target.family}`, async () => {
        const result = await staffFetch<DocgenResponse<DocgenTemplate>>(`/api/admin/docgen/templates/${target.id}/versions`, {
            method: 'POST',
            query: withWorkspaceQuery(),
            body: { filename: file.name, content: await fileToBase64(file) }
        });
        lastUploadId.value = result.data.id;
        await load();
        return t('docgenUi.catalog.newVersionUploaded');
    });
}

function confirmAction() {
    const target = confirm.value;
    if (!target) return;
    void run(`${target.kind}:${target.template.id}`, async () => {
        if (target.kind === 'release') {
            await staffFetch(`/api/admin/docgen/templates/${target.template.id}/release`, { method: 'POST', query: withWorkspaceQuery() });
        } else {
            await staffFetch(`/api/admin/docgen/templates/${target.template.id}`, { method: 'DELETE', query: withWorkspaceQuery() });
        }
        confirm.value = null;
        await load();
        return t(target.kind === 'release' ? 'docgenUi.catalog.released' : 'docgenUi.catalog.deleted');
    });
}

function download(template: DocgenTemplate) {
    void run(`download:${template.id}`, async () => {
        const { blob, filename } = await fetchDocgenFile(`/api/admin/docgen/templates/${template.id}/file`, withWorkspaceQuery(), template.filename || 'vorlage.docx');
        saveBlob(blob, filename);
    });
}

function saveSender() {
    void run('sender', async () => {
        const result = await staffFetch<DocgenResponse<DocgenScopeSettings>>('/api/admin/docgen/settings', {
            method: 'PUT',
            query: withWorkspaceQuery(),
            body: { senderAddress: senderDraft.value }
        });
        scopeSettings.value = result.data;
        senderDraft.value = result.data.senderAddress;
        return t('docgenUi.catalog.senderSaved');
    });
}

watch(selectedWorkspaceKey, () => {
    lastUploadId.value = null;
    void load();
}, { immediate: true });
</script>

<template>
  <AppPageLayout
    :title="t('docgenUi.catalog.title')"
    :description="t('docgenUi.catalog.subtitle')"
    :breadcrumbs="[{ label: t('common.settings'), to: workspaceRoute('/admin/settings') }, { label: t('admin.settings.decisions.label') }]"
  >
    <div
      class="space-y-6"
      data-testid="docgen-catalog"
    >
      <div
        v-if="loading && !catalog"
        class="space-y-2"
      >
        <USkeleton
          v-for="index in 3"
          :key="index"
          class="h-10 w-full"
        />
      </div>

      <div
        v-if="loadError"
        role="alert"
        class="space-y-3"
      >
        <p class="text-sm text-error">
          {{ loadError }}
        </p>
        <UButton
          color="neutral"
          variant="outline"
          :disabled="loading"
          @click="load"
        >
          {{ t('common.retry') }}
        </UButton>
      </div>

      <p
        v-if="actionError && !uploadOpen"
        role="alert"
        class="text-sm text-error"
      >
        {{ actionError }}
      </p>

      <template v-if="catalog">
        <!-- Read only for this role: one reason line under the description -->
        <AccessReason
          v-if="!canManage"
          id="docgen-catalog-read-only"
          :text="t('docgenUi.catalog.readOnly')"
        />

        <!-- The document service, when it is not ready: at the top of the column -->
        <UAlert
          v-if="health && !healthReady"
          :color="healthAlertColor"
          :icon="healthAlertColor === 'warning' ? 'i-lucide-triangle-alert' : 'i-lucide-circle-x'"
          :role="healthAlertColor === 'warning' ? 'status' : undefined"
          :title="t('docgenUi.catalog.healthNotReadyTitle')"
          :description="healthAlertDescription"
          data-testid="docgen-health"
        />

        <section
          class="space-y-4"
          aria-labelledby="docgen-catalog-templates"
        >
          <!-- The upload stands at the end of the section heading row and ends on the
               cards' right edge; the page header carries no action -->
          <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2
              id="docgen-catalog-templates"
              class="text-lg font-semibold text-highlighted"
            >
              {{ t('docgenUi.catalog.templatesTitle') }}
            </h2>
            <UButton
              v-if="canManage"
              icon="i-lucide-plus"
              :disabled="blocked"
              data-testid="docgen-catalog-upload-open"
              @click="uploadOpen = true"
            >
              {{ t('docgenUi.catalog.uploadTitle') }}
            </UButton>
          </div>
          <p
            v-if="!families.length"
            class="text-sm text-muted"
          >
            {{ t('docgenUi.catalog.empty') }}
          </p>
          <ul class="space-y-4">
            <li
              v-for="family in families"
              :key="family.latest.family"
              data-testid="docgen-catalog-template"
            >
              <AppCard
                :title="family.latest.name"
                as="h3"
                :class="lastUploadId === family.latest.id ? 'ring-2 ring-primary/40' : undefined"
              >
                <template #badge>
                  <UBadge
                    :color="family.latest.status === 'released' ? 'success' : 'neutral'"
                    data-testid="docgen-catalog-state"
                  >
                    {{ t(`docgenUi.state.${family.latest.status}`) }}
                  </UBadge>
                </template>

                <div class="space-y-1 text-sm text-muted">
                  <p data-testid="docgen-catalog-meta">
                    {{ t(`docgenUi.purpose.${family.latest.purpose}`) }} ·
                    {{ t('docgenUi.catalog.versionLabel', { version: family.latest.version }) }} ·
                    {{ t('docgenUi.catalog.placeholderCount', family.latest.placeholders.length) }}<template v-if="family.latest.closesProcedure">
                      · {{ t('docgenUi.closes') }}
                    </template>
                  </p>
                  <p>
                    {{ family.latest.releasedAt && family.latest.releasedBy
                      ? t('docgenUi.catalog.releasedBy', { name: family.latest.releasedBy, date: timestamp(family.latest.releasedAt) })
                      : t('docgenUi.catalog.createdBy', { name: family.latest.createdBy || '', date: timestamp(family.latest.createdAt) }) }}
                  </p>
                </div>

                <div
                  v-if="family.latest.errors.length"
                  role="alert"
                  class="text-sm text-error"
                >
                  <p class="font-medium">
                    {{ t('docgenUi.form.templateErrors') }}
                  </p>
                  <ul class="list-disc ps-5">
                    <li
                      v-for="(error, index) in family.latest.errors"
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

                <!-- Actions of the template: the next step filled, the rest outline, delete at the end -->
                <div
                  class="flex flex-wrap items-center gap-2"
                  data-testid="docgen-catalog-actions"
                >
                  <UButton
                    v-if="canManage && family.latest.status === 'draft' && !family.latest.errors.length"
                    :disabled="blocked"
                    data-testid="docgen-catalog-release"
                    @click="confirm = { kind: 'release', template: family.latest }"
                  >
                    {{ t('docgenUi.catalog.release') }}
                  </UButton>
                  <UButton
                    color="neutral"
                    variant="outline"
                    icon="i-lucide-download"
                    :aria-label="t('docgenUi.catalog.downloadAria', { name: family.latest.name, version: family.latest.version })"
                    :loading="pending === `download:${family.latest.id}`"
                    :disabled="blocked"
                    @click="download(family.latest)"
                  >
                    {{ t('docgenUi.catalog.download') }}
                  </UButton>
                  <template v-if="canManage">
                    <UButton
                      color="neutral"
                      variant="outline"
                      icon="i-lucide-upload"
                      :loading="pending === `version:${family.latest.family}`"
                      :disabled="blocked"
                      @click="chooseVersion(family.latest)"
                    >
                      {{ t('docgenUi.catalog.newVersion') }}
                    </UButton>
                    <UButton
                      v-if="family.latest.status === 'draft'"
                      color="error"
                      variant="ghost"
                      icon="i-lucide-trash-2"
                      class="ms-auto"
                      :disabled="blocked"
                      @click="confirm = { kind: 'delete', template: family.latest }"
                    >
                      {{ t('docgenUi.catalog.delete') }}
                    </UButton>
                  </template>
                </div>

                <!-- Disclosure: placeholders found in the template -->
                <UCollapsible
                  :open="placeholdersOpen[family.latest.id] === true"
                  :unmount-on-hide="false"
                  @update:open="(value: boolean) => { placeholdersOpen = { ...placeholdersOpen, [family.latest.id]: value } }"
                >
                  <UButton
                    color="neutral"
                    variant="ghost"
                    icon="i-lucide-chevron-right"
                    class="group -ms-2.5"
                    :ui="{ leadingIcon: 'transition-transform group-data-[state=open]:rotate-90' }"
                    data-testid="docgen-catalog-placeholders"
                  >
                    {{ t('docgenUi.catalog.placeholdersTitle') }}
                    <span class="text-muted tabular-nums">{{ family.latest.placeholders.length }}</span>
                  </UButton>
                  <template #content>
                    <div class="space-y-2 pt-3 text-sm">
                      <ul class="flex flex-wrap gap-1">
                        <li
                          v-for="tag in family.latest.placeholders"
                          :key="tag"
                        >
                          <UBadge
                            color="neutral"
                            class="font-mono"
                          >
                            {{ tag }}
                          </UBadge>
                        </li>
                      </ul>
                      <template v-if="family.latest.loops.length">
                        <p class="font-medium text-default">
                          {{ t('docgenUi.catalog.loopsTitle') }}
                        </p>
                        <ul class="flex flex-wrap gap-1">
                          <li
                            v-for="loop in family.latest.loops"
                            :key="loop"
                          >
                            <UBadge
                              color="neutral"
                              class="font-mono"
                            >
                              {{ loop }}
                            </UBadge>
                          </li>
                        </ul>
                      </template>
                    </div>
                  </template>
                </UCollapsible>

                <!-- Disclosure: older versions -->
                <UCollapsible
                  v-if="family.older.length"
                  :open="olderOpen[family.latest.family] === true"
                  :unmount-on-hide="false"
                  @update:open="(value: boolean) => { olderOpen = { ...olderOpen, [family.latest.family]: value } }"
                >
                  <UButton
                    color="neutral"
                    variant="ghost"
                    icon="i-lucide-chevron-right"
                    class="group -ms-2.5"
                    :ui="{ leadingIcon: 'transition-transform group-data-[state=open]:rotate-90' }"
                    data-testid="docgen-catalog-older"
                  >
                    {{ t('docgenUi.catalog.olderVersions') }}
                    <span class="text-muted tabular-nums">{{ family.older.length }}</span>
                  </UButton>
                  <template #content>
                    <ul class="space-y-1 pt-3 text-sm">
                      <li
                        v-for="version in family.older"
                        :key="version.id"
                        class="flex flex-wrap items-center justify-between gap-2"
                      >
                        <span>
                          {{ t('docgenUi.catalog.versionLabel', { version: version.version }) }} · {{ t(`docgenUi.state.${version.status}`) }}
                        </span>
                        <UTooltip :text="t('docgenUi.catalog.download')">
                          <UButton
                            color="neutral"
                            variant="ghost"
                            icon="i-lucide-download"
                            :aria-label="t('docgenUi.catalog.downloadAria', { name: version.name, version: version.version })"
                            :disabled="blocked"
                            @click="download(version)"
                          />
                        </UTooltip>
                      </li>
                    </ul>
                  </template>
                </UCollapsible>
              </AppCard>
            </li>
          </ul>
        </section>

        <input
          ref="versionInput"
          type="file"
          accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          class="hidden"
          tabindex="-1"
          aria-hidden="true"
          @change="onVersionChosen"
        >

        <!-- 32 px from the section "Vorlagen" (24 of the column plus 8), so this card
             does not read as one more template -->
        <div
          v-if="scopeSettings"
          class="max-w-3xl pt-2"
        >
          <!-- Sender address -->
          <AppCard
            :title="t('docgenUi.catalog.senderTitle')"
            data-testid="docgen-sender-card"
          >
            <!-- The card title says "Absenderanschrift"; the field label stays for screen readers only -->
            <UFormField
              :label="t('docgenUi.catalog.senderTitle')"
              :description="t('docgenUi.catalog.senderHelp')"
              name="senderAddress"
              :ui="{ label: 'sr-only' }"
            >
              <UTextarea
                v-model="senderDraft"
                :rows="4"
                :maxlength="1000"
                class="w-full max-w-xl"
                autoresize
                :disabled="!canManage || blocked"
                data-testid="docgen-sender"
              />
            </UFormField>
            <!-- The stored value is shown once: the jurisdiction's address while the field is empty. -->
            <p
              v-if="effectiveSenderOneLine && !senderDraft.trim()"
              class="text-sm text-muted"
              data-testid="docgen-sender-effective"
            >
              {{ t('docgenUi.catalog.senderEffective', { address: effectiveSenderOneLine }) }}
            </p>
            <template
              v-if="canManage"
              #footer
            >
              <UButton
                :loading="pending === 'sender'"
                :disabled="blocked || !senderChanged"
                @click="saveSender"
              >
                {{ t('docgenUi.catalog.senderSave') }}
              </UButton>
            </template>
          </AppCard>
        </div>

        <!-- The document service, when everything is ready: one line at the end -->
        <p
          v-if="health && healthReady"
          class="text-sm text-muted"
          data-testid="docgen-health-ready"
        >
          {{ t('docgenUi.catalog.healthReady') }}
        </p>
      </template>
    </div>

    <!-- New template: the upload form in a dialog -->
    <UModal
      :open="uploadOpen"
      :title="t('docgenUi.catalog.uploadTitle')"
      @update:open="(value: boolean) => { if (!value && pending !== 'upload') uploadOpen = false }"
    >
      <template #body>
        <div class="space-y-4">
          <p
            v-if="actionError"
            role="alert"
            class="text-sm text-error"
          >
            {{ actionError }}
          </p>
          <UFormField
            :label="t('docgenUi.form.name')"
            required
          >
            <UInput
              v-model="uploadName"
              :maxlength="255"
              class="w-full max-w-xl"
              :disabled="blocked"
            />
          </UFormField>
          <UFormField :label="t('docgenUi.form.purpose')">
            <USelect
              v-model="uploadPurpose"
              :items="purposeItems"
              value-key="value"
              class="w-full sm:w-72"
              :disabled="blocked"
            />
          </UFormField>
          <UFormField :label="t('docgenUi.form.file')">
            <UFileUpload
              :model-value="uploadFile"
              accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              :label="t('docgenUi.form.chooseFile')"
              icon="i-lucide-file-text"
              layout="list"
              class="w-full"
              :disabled="blocked"
              data-testid="docgen-catalog-file"
              @update:model-value="onUploadChosen"
            />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full flex-wrap justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            :disabled="pending === 'upload'"
            @click="uploadOpen = false"
          >
            {{ t('common.cancel') }}
          </UButton>
          <UButton
            :loading="pending === 'upload'"
            :disabled="blocked || !uploadFile || !uploadName.trim()"
            data-testid="docgen-catalog-upload"
            @click="upload"
          >
            {{ t('docgenUi.form.upload') }}
          </UButton>
        </div>
      </template>
    </UModal>

    <UModal
      :open="confirm !== null"
      :title="confirm ? t(confirm.kind === 'release' ? 'docgenUi.catalog.releaseTitle' : 'docgenUi.catalog.deleteTitle', { name: confirm.template.name, version: confirm.template.version }) : ''"
      :description="confirm?.kind === 'release' ? t('docgenUi.catalog.releaseDescription') : t('docgenUi.catalog.deleteDescription')"
      @update:open="(value: boolean) => { if (!value && !pending) confirm = null }"
    >
      <template #footer>
        <div class="flex w-full flex-wrap justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            :disabled="blocked"
            @click="confirm = null"
          >
            {{ t('common.cancel') }}
          </UButton>
          <UButton
            :color="confirm?.kind === 'delete' ? 'error' : 'primary'"
            :icon="confirm?.kind === 'delete' ? 'i-lucide-trash-2' : undefined"
            :loading="blocked"
            data-testid="docgen-catalog-confirm"
            @click="confirmAction"
          >
            {{ confirm?.kind === 'delete' ? t('docgenUi.catalog.delete') : t('docgenUi.catalog.release') }}
          </UButton>
        </div>
      </template>
    </UModal>
  </AppPageLayout>
</template>
