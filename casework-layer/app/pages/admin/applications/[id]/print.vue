<script setup lang="ts">
// Relative, not `~/assets`: the same file, and the unit tests (which map `~` to the repository root) can load the page.
import '../../../../../../app/assets/css/print.css';
import { getPublicWorkspaceBrand } from '~/utils/public-brand';
import {
    publicJurisdictionLogoAlt,
    publicJurisdictionLogoSrc,
    publicJurisdictionName
} from '~/utils/public-jurisdiction-config';
import type { FormSchema } from '~/types/form';
import type { AdminApplicationDetailResponse } from '~/types';
import { safeJsonParse, getStatusLabel } from '~/composables/useFormatters';
import {
    buildPrintArchiveRows,
    buildPrintAttachmentGroups,
    buildPrintCrmRows,
    buildPrintFieldGroups,
    buildPrintFieldLabels,
    buildPrintFieldMap,
    attachmentTypeLabel,
    extractPrintAttachmentsFromApplicationData,
    formatPrintAttachmentSize,
    withoutManifestFileFields
} from '~~/casework-layer/app/utils/application-print';
import { repeatedFieldIds } from '~~/casework-layer/app/utils/application-data-sections';
import { parseStoredFormSchema } from '~/utils/form-schema';
import { buildStatusMap } from '~/utils/workflow-status';

const { t, locale } = useI18n();
/** Localized yes/no labels for boolean field values in the print view. */
const booleanLabels = computed(() => ({ yes: t('common.yes'), no: t('common.no') }));

definePageMeta({
    layout: false,
    middleware: 'admin'
});

const route = useRoute();
const router = useRouter();
const applicationId = route.params.id as string;
const { currentWorkspace, selectedWorkspaceKey, workspaceRoute, withWorkspaceQuery } = useWorkspaceContext();
const applicationQuery = computed(() => withWorkspaceQuery());
const archiveMode = computed(() => route.query.mode === 'archive' || route.query.archive === '1');
const archiveRoute = computed(() => ({
    ...workspaceRoute(`/admin/applications/${applicationId}/print`),
    query: withWorkspaceQuery({ mode: 'archive' })
}));
const jurisdictionSlug = computed(() =>
    currentWorkspace.value?.jurisdictionSlug ?? selectedWorkspaceKey.value?.split('/')[0] ?? null
);
const {
    config: publicConfig,
    pending: publicConfigPending
} = usePublicJurisdictionConfig(jurisdictionSlug);
const publicBrand = computed(() => getPublicWorkspaceBrand({ jurisdictionSlug: jurisdictionSlug.value }));
const printLogoSrc = computed(() => publicJurisdictionLogoSrc(publicConfig.value) || publicBrand.value?.logoSrc || null);
const printLogoAlt = computed(() =>
    publicJurisdictionLogoAlt(publicConfig.value)
    || publicBrand.value?.logoAlt
    || publicJurisdictionName(publicConfig.value)
    || currentWorkspace.value?.jurisdictionLabel
    || publicBrand.value?.name
    || t('admin.settings.branding.logoAlt')
);
const printLogoElement = ref<HTMLImageElement | null>(null);
const logoLoadFailed = ref(false);
const printBrandText = computed(() =>
    publicJurisdictionName(publicConfig.value)
    || currentWorkspace.value?.jurisdictionLabel
    || publicBrand.value?.name
    || ''
);
const effectivePrintLogoSrc = computed(() => logoLoadFailed.value ? null : printLogoSrc.value);

watch(printLogoSrc, () => {
    logoLoadFailed.value = false;
});

// ── Load application with included schema (via server proxy) ──────

const { data: response, status, error } = await useFetch<AdminApplicationDetailResponse>(
    `/api/admin/applications/${applicationId}`,
    {
        key: `print-application-${applicationId}`,
        query: applicationQuery,
        watch: [selectedWorkspaceKey]
    }
);

const workflowStatuses = computed(() =>
    buildStatusMap(response.value?.included as Parameters<typeof buildStatusMap>[0])
);

type IncludedFormSchemaResource = {
    id: string
    type: string
    attributes?: {
        label?: string
        field_schema?: { value?: string } | string | null
        field_version?: number | string | null
        changed?: string | null
    }
};

function isIncludedFormSchema(resource: unknown): resource is IncludedFormSchemaResource {
    return Boolean(resource && typeof resource === 'object' && (resource as { type?: unknown }).type === 'form_schema--form_schema');
}

const schemaEntity = computed(() => {
    if (!response.value?.included?.length) return null;
    return (response.value.included as unknown[]).find(isIncludedFormSchema) ?? null;
});

const application = computed(() => {
    if (!response.value?.data) return null;
    const attrs = response.value.data.attributes;
    const statusRel = response.value.data.relationships?.field_workflow_status?.data;
    const statusInfo = statusRel && !Array.isArray(statusRel)
        ? workflowStatuses.value.get(statusRel.id)
        : null;
    return {
        id: response.value.data.id,
        referenceNumber: attrs.field_reference_number ?? '',
        status: statusInfo?.machineName ?? 'new',
        statusLabel: statusInfo?.label,
        email: attrs.field_applicant_email ?? null,
        schemaVersion: attrs.field_schema_version ?? null,
        origin: attrs.field_origin ?? null,
        data: safeJsonParse(attrs.field_data),
        crmData: safeJsonParse(attrs.field_crm_data),
        created: attrs.created,
        changed: attrs.changed
    };
});

const schema = computed<FormSchema | null>(() => {
    if (!schemaEntity.value) return null;
    try {
        const fieldSchema = schemaEntity.value.attributes?.field_schema;
        const fieldValue = typeof fieldSchema === 'string'
            ? fieldSchema
            : fieldSchema?.value;
        if (!fieldValue) return null;
        return parseStoredFormSchema(fieldValue, schemaEntity.value.id);
    } catch (e) {
        console.error('[print] Failed to parse schema:', e);
        return null;
    }
});

const schemaLabel = computed(() => {
    return schemaEntity.value?.attributes?.label ?? t('common.forms');
});

const dateTimeLocale = computed(() => locale.value === 'en' ? 'en-GB' : 'de-DE');

function formatPrintDateTime(dateStr: string | null | undefined): string {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleString(dateTimeLocale.value, {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

const formattedDate = computed(() => formatPrintDateTime(application.value?.created));
const changedDate = computed(() => formatPrintDateTime(application.value?.changed));
const schemaChangedDate = computed(() => formatPrintDateTime(schemaEntity.value?.attributes?.changed));

const statusLabel = computed(() => {
    return application.value?.statusLabel || getStatusLabel(application.value?.status ?? '');
});

useHead({
    title: computed(() => {
        const prefix = archiveMode.value ? t('print.archiveMode') : t('print.print');
        return `${prefix} - ${application.value?.referenceNumber ?? applicationId} - beantragt.ai`;
    })
});

/**
 * Groups fields by section when schema is available.
 */
const formFieldGroups = computed(() => {
    if (!application.value) return [];
    return buildPrintFieldGroups(application.value.data, schema.value, t('print.formData'), booleanLabels.value, dateTimeLocale.value, repeatedFieldIds(schema.value, application.value.origin));
});

const fieldLabels = computed(() => buildPrintFieldLabels(schema.value));

const printFieldMap = computed(() => buildPrintFieldMap(schema.value));

const crmRows = computed(() => buildPrintCrmRows(
    application.value?.crmData ?? {},
    fieldLabels.value,
    booleanLabels.value,
    dateTimeLocale.value,
    printFieldMap.value
));

const hasCrmData = computed(() => {
    return crmRows.value.length > 0;
});

const applicationAttachments = computed(() => response.value?.meta?.attachments ?? []);

const storedApplicationAttachments = computed(() =>
    extractPrintAttachmentsFromApplicationData(application.value?.data ?? {}, schema.value)
);

const attachmentLoadFailed = computed(() => response.value?.meta?.attachmentLoadFailed === true);

const attachmentGroups = computed(() =>
    buildPrintAttachmentGroups(
        applicationAttachments.value.length > 0
            ? applicationAttachments.value
            : storedApplicationAttachments.value,
        schema.value,
        fieldLabels.value
    )
);

/** Files stand once, in the attachment manifest. */
const groupedFields = computed(() => withoutManifestFileFields(formFieldGroups.value, attachmentGroups.value, storedApplicationAttachments.value));

const printTimestamp = computed(() => formatPrintDateTime(new Date().toISOString()));

const schemaId = computed(() => {
    const schemaRelData = response.value?.data?.relationships?.field_schema?.data;
    return schemaRelData && !Array.isArray(schemaRelData) ? schemaRelData.id : null;
});

const schemaVersion = computed(() =>
    application.value?.schemaVersion ?? schemaEntity.value?.attributes?.field_version ?? null
);

const archiveSourcePath = computed(() => {
    const detailRoute = router.resolve(workspaceRoute(`/admin/applications/${applicationId}`));
    return detailRoute.href;
});

const archiveRows = computed(() => buildPrintArchiveRows([
    { key: 'applicationId', label: t('print.archive.applicationId'), value: application.value?.id },
    { key: 'revision', label: t('print.archive.revision'), value: response.value?.meta?.assignmentRevisionId },
    { key: 'schemaId', label: t('print.archive.schemaId'), value: schemaId.value },
    { key: 'schemaVersion', label: t('print.archive.schemaVersion'), value: schemaVersion.value },
    { key: 'schemaChangedAt', label: t('print.archive.schemaChangedAt'), value: schemaChangedDate.value },
    { key: 'sourcePath', label: t('print.archive.sourcePath'), value: archiveSourcePath.value },
    { key: 'submittedAt', label: t('print.submittedAt'), value: formattedDate.value },
    { key: 'changedAt', label: t('print.archive.changedAt'), value: changedDate.value },
    { key: 'generatedAt', label: t('print.archive.generatedAt'), value: printTimestamp.value }
], booleanLabels.value));

// Auto-trigger print after page load
onMounted(() => {
    if (archiveMode.value) return;
    setTimeout(() => {
        void printPage();
    }, 300);
});

async function waitForLogoBeforePrint(): Promise<void> {
    await nextTick();
    const deadline = Date.now() + 1500;
    while (publicConfigPending.value && Date.now() < deadline) {
        await new Promise(resolve => window.setTimeout(resolve, 50));
    }
    await nextTick();

    const image = printLogoElement.value;
    if (!effectivePrintLogoSrc.value || !image) return;
    if (image.complete) {
        if (image.naturalWidth === 0) {
            logoLoadFailed.value = true;
        }
        return;
    }

    const logoState = await Promise.race([
        typeof image.decode === 'function'
            ? image.decode().then(() => 'loaded' as const).catch(() => 'failed' as const)
            : new Promise((resolve) => {
                const timeout = window.setTimeout(resolve, 1000);
                image.addEventListener('load', () => {
                    window.clearTimeout(timeout);
                    resolve('loaded');
                }, { once: true });
                image.addEventListener('error', () => {
                    window.clearTimeout(timeout);
                    resolve('failed');
                }, { once: true });
            }),
        new Promise(resolve => window.setTimeout(() => resolve('timeout'), 1000))
    ]);

    if (logoState === 'failed' || (image.complete && image.naturalWidth === 0)) {
        logoLoadFailed.value = true;
    }
}

async function printPage() {
    await waitForLogoBeforePrint();
    window.print();
}

function handlePrintLogoError() {
    logoLoadFailed.value = true;
}

/** "PDF" instead of the media type; an unknown type stays readable as such in the archive version only. */
function typeText(mimeType: string | undefined): string {
    return attachmentTypeLabel(mimeType) || (archiveMode.value ? mimeType ?? '' : '');
}

function goBack() {
    navigateTo(workspaceRoute(`/admin/applications/${applicationId}`));
}
</script>

<template>
  <!-- Screen around the sheet (04): page background and toolbar follow the colour mode; the sheet stays paper.
       print.css resets `print-screen` and `print-sheet` for the printer. -->
  <div class="print-screen min-h-screen bg-elevated">
    <!-- Screen-only toolbar, as wide as the sheet: back link left, actions right, the filled button last. -->
    <div
      class="print-hide sticky top-0 z-10 border-b border-default bg-default"
      data-testid="print-toolbar"
    >
      <div class="print-toolbar-row mx-auto flex w-full flex-wrap items-center justify-between gap-2 py-3">
        <UButton
          color="neutral"
          variant="ghost"
          icon="i-lucide-chevron-left"
          @click="goBack"
        >
          {{ t('print.back') }}
        </UButton>
        <div class="flex flex-wrap items-center gap-2">
          <UButton
            v-if="!archiveMode"
            :to="archiveRoute"
            color="neutral"
            variant="outline"
          >
            {{ t('print.archive.open') }}
          </UButton>
          <UBadge
            v-else
            color="neutral"
            icon="i-lucide-archive"
            data-testid="print-archive-badge"
          >
            {{ t('print.archive.badge') }}
          </UBadge>
          <UButton
            icon="i-lucide-printer"
            @click="printPage"
          >
            {{ archiveMode ? t('print.archive.printPdf') : t('print.print') }}
          </UButton>
        </div>
      </div>
    </div>

    <!-- Error state -->
    <div
      v-if="error"
      class="print-hide print-toolbar-row mx-auto mt-6"
    >
      <UAlert
        icon="i-lucide-circle-x"
        color="error"
        :title="t('print.notFound')"
        :description="t('print.notFoundDescription')"
        data-testid="print-error"
      />
    </div>

    <!-- Loading state -->
    <div
      v-else-if="status === 'pending'"
      class="print-hide print-toolbar-row mx-auto mt-6"
    >
      <USkeleton
        class="h-96 w-full"
        data-testid="print-loading"
      />
      <span class="sr-only">{{ t('print.loading') }}</span>
    </div>

    <!-- Print content: on screen a sheet with a fine outline on the darker page (print.css resets it). -->
    <div
      v-else-if="application"
      class="print-sheet my-6 shadow-sm ring ring-default"
      data-testid="print-sheet"
    >
      <div class="print-page">
        <!-- Header -->
        <div class="print-header">
          <div>
            <h1 class="print-title">
              {{ schemaLabel }}
            </h1>
            <p
              v-if="!application.referenceNumber"
              class="print-subtitle"
            >
              {{ t('print.application') }} {{ application.id.slice(0, 8) }}
            </p>
          </div>
          <img
            v-if="effectivePrintLogoSrc"
            ref="printLogoElement"
            class="print-logo"
            :src="effectivePrintLogoSrc"
            :alt="printLogoAlt"
            @error="handlePrintLogoError"
          >
          <div
            v-else-if="printBrandText"
            class="print-brand-text"
          >
            {{ printBrandText }}
          </div>
        </div>

        <div
          v-if="archiveMode"
          class="print-archive-banner"
        >
          <div class="print-archive-kicker">
            {{ t('print.archive.badge') }}
          </div>
          <div class="print-archive-copy">
            {{ t('print.archive.description') }}
          </div>
        </div>

        <!-- Meta block -->
        <div class="print-meta">
          <div class="print-meta-item">
            <span class="print-meta-label">{{ t('print.referenceNumber') }}</span>
            <span class="print-meta-value print-mono">{{ application.referenceNumber || '-' }}</span>
          </div>
          <div class="print-meta-item">
            <span class="print-meta-label">{{ t('print.status') }}</span>
            <span class="print-meta-value">{{ statusLabel }}</span>
          </div>
          <div class="print-meta-item">
            <span class="print-meta-label">{{ t('print.submittedAt') }}</span>
            <span class="print-meta-value">{{ formattedDate }}</span>
          </div>
          <div
            v-if="application.email"
            class="print-meta-item"
          >
            <span class="print-meta-label">{{ t('print.email') }}</span>
            <span class="print-meta-value">{{ application.email }}</span>
          </div>
        </div>

        <!-- Archive provenance -->
        <div
          v-if="archiveMode"
          class="print-section print-archive-section"
        >
          <h2 class="print-section-title">
            {{ t('print.archive.title') }}
          </h2>
          <div class="print-fields">
            <div
              v-for="row in archiveRows"
              :key="row.key"
              class="print-field"
              :class="{ 'print-field-full': row.key === 'sourcePath' || row.key === 'applicationId' || row.key === 'schemaId' }"
            >
              <div class="print-field-label">
                {{ row.label }}
              </div>
              <div class="print-field-value print-mono">
                {{ row.value }}
              </div>
            </div>
          </div>
        </div>

        <!-- Form sections -->
        <div
          v-for="group in groupedFields"
          :key="group.title"
          class="print-section"
        >
          <h2 class="print-section-title">
            {{ group.title }}
          </h2>
          <div class="print-fields">
            <div
              v-for="field in group.fields"
              :key="field.id"
              class="print-field"
              :class="{ 'print-field-full': field.fullWidth }"
            >
              <div class="print-field-label">
                {{ field.label }}
              </div>
              <div class="print-field-value">
                {{ field.value }}
              </div>
            </div>
          </div>
        </div>

        <!-- Attachment manifest -->
        <div
          v-if="attachmentGroups.length > 0 || attachmentLoadFailed"
          class="print-section"
        >
          <h2 class="print-section-title">
            {{ t('admin.detail.attachments') }}
          </h2>

          <p
            v-if="attachmentLoadFailed"
            class="print-field-value"
          >
            {{ t('admin.detail.attachmentLoadFailedDescription') }}
          </p>

          <div class="print-attachments">
            <div
              v-for="group in attachmentGroups"
              :key="group.fieldId"
              class="print-attachment-group"
            >
              <h3 class="print-subsection-title">
                {{ group.label }}
              </h3>

              <div
                v-for="attachment in group.attachments"
                :key="attachment.id"
                class="print-attachment"
              >
                <component
                  :is="!archiveMode && attachment.url ? 'a' : 'span'"
                  :href="!archiveMode && attachment.url ? attachment.url : undefined"
                  class="print-attachment-link"
                >
                  {{ attachment.filename }}
                </component>
                <span class="print-attachment-meta">
                  {{ formatPrintAttachmentSize(attachment.size) }}
                  <span v-if="typeText(attachment.mimeType)">
                    · {{ typeText(attachment.mimeType) }}
                  </span>
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- CRM data -->
        <div
          v-if="hasCrmData"
          class="print-section"
        >
          <h2 class="print-section-title">
            {{ t('print.crmData') }}
          </h2>
          <div class="print-fields">
            <div
              v-for="row in crmRows"
              :key="row.key"
              class="print-field"
            >
              <div class="print-field-label">
                {{ row.label }}
              </div>
              <div class="print-field-value">
                {{ row.value }}
              </div>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="print-footer">
          <span>{{ t('print.createdWith') }}</span>
          <span>{{ t('print.printedAt') }} {{ printTimestamp }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
/* ── Screen styles ──────────────────────────────────────── */

/* The toolbar row and the screen sheet take the sheet's paper width (the same value as .print-page);
   narrower than the sheet, the toolbar row keeps 1rem from the window edge. */
.print-toolbar-row,
.print-sheet {
  max-width: 210mm;
  margin-inline: auto;
}

.print-toolbar-row {
  padding-inline: 1rem;
}

@media (min-width: 52rem) {
  .print-toolbar-row {
    padding-inline: 0;
  }
}

.print-page {
  max-width: 210mm;
  margin: 0 auto;
  padding: 24px 32px;
  background: #fff;
  font-family: system-ui, -apple-system, sans-serif;
  color: #1a1a1a;
  line-height: 1.5;
}

.print-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 24px;
  padding-bottom: 16px;
  border-bottom: 2px solid #1a1a1a;
}

.print-logo {
  display: block;
  max-width: 38mm;
  max-height: 15mm;
  object-fit: contain;
  object-position: right top;
}

.print-brand-text {
  max-width: 44mm;
  text-align: right;
  font-size: 15px;
  font-weight: 700;
  color: #444;
}

.print-title {
  font-size: 22px;
  font-weight: 700;
  margin: 0 0 4px 0;
}

.print-subtitle {
  font-size: 13px;
  color: #666;
  margin: 0;
}

.print-archive-banner {
  margin-bottom: 18px;
  padding: 12px 14px;
  border: 1px solid #1a1a1a;
  background: #f3f4f6;
}

.print-archive-kicker {
  /* The label style of the sheet (as .print-field-label): no capitals, no tracking. */
  font-size: 11px;
  font-weight: 600;
  text-transform: none;
  letter-spacing: 0;
  color: #666;
  margin-bottom: 3px;
}

.print-archive-copy {
  font-size: 12px;
  color: #333;
}

.print-meta {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px 24px;
  padding: 16px;
  background: #f8f8f8;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  margin-bottom: 24px;
}

.print-meta-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/* One label style on the sheet: the meta labels look like the field labels. */
.print-meta-label {
  font-size: 11px;
  font-weight: 600;
  color: #666;
}

.print-meta-value {
  font-size: 14px;
  font-weight: 500;
}

.print-mono {
  font-family: ui-monospace, 'SF Mono', monospace;
}

.print-section {
  margin-bottom: 20px;
}

.print-archive-section {
  break-inside: avoid;
}

.print-section-title {
  font-size: 14px;
  font-weight: 700;
  color: #555;
  padding-bottom: 6px;
  border-bottom: 1px solid #ddd;
  margin: 0 0 12px 0;
}

.print-fields {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px 24px;
}

.print-field {
  padding: 6px 0;
}

.print-field-full {
  grid-column: 1 / -1;
}

.print-field-label {
  font-size: 11px;
  font-weight: 600;
  color: #666;
  margin-bottom: 2px;
}

.print-field-value {
  font-size: 13px;
  color: #1a1a1a;
  white-space: pre-wrap;
  word-break: break-word;
}

.print-attachments {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.print-attachment-group {
  break-inside: avoid;
}

.print-subsection-title {
  font-size: 12px;
  font-weight: 700;
  color: #555;
  margin: 0 0 6px 0;
}

.print-attachment {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 0;
  border-bottom: 1px solid #eee;
}

.print-attachment-link {
  font-size: 13px;
  font-weight: 600;
  color: #1a1a1a;
  text-decoration: none;
  word-break: break-word;
}

.print-attachment-meta {
  font-size: 11px;
  color: #666;
}

.print-footer {
  margin-top: 32px;
  padding-top: 12px;
  border-top: 1px solid #ddd;
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: #555;
}
</style>
