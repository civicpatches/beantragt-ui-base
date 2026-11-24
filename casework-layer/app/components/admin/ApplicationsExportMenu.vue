<script setup lang="ts">
import type { FormField } from '~/types/form';
import type { DropdownMenuItem } from '@nuxt/ui';
import { redactApplicationExportValue } from '~~/casework-layer/app/utils/application-data-redaction';
import { isMetadataOnlyApplicationExport } from '~~/casework-layer/app/utils/application-export-coverage';
import type { CaseListActionsContext } from '~~/casework-layer/app/utils/staff-extensions';

/*
 * "Exportieren" of the application list (CSV and Excel), on the global list and on the form page. Sachbearbeitung registers it
 * in the outlet `case-list-actions` of ApplicationsDataTable; it reads the list's current rows from the context at
 * the moment of the click.
 */
const props = defineProps<{ context: CaseListActionsContext }>();

const { t } = useI18n();
const toast = useToast();
const { withWorkspaceQuery } = useWorkspaceContext();
const { resolveApiErrorMessage } = useApiErrorMessage();
/** Overrides the theme's `truncate` (tailwind-merge drops it for `text-clip`), as in the workspace switcher. */
const WRAP_MENU_TEXT = 'text-clip whitespace-normal';

const metadataOnlyExport = computed(() => isMetadataOnlyApplicationExport({
    showFormColumn: props.context.showFormColumn,
    hasSchema: Boolean(props.context.schema)
}));
const exportCoverageNoticeVisible = computed(() => metadataOnlyExport.value && props.context.rows.length > 0);
const exportCoverageNoticeId = 'applications-export-coverage-notice';

function sanitizeSpreadsheetCell(value: string): string {
    if (value.startsWith('\t') || value.startsWith('\r')) return `'${value}`;
    return value.length > 0 && '=+-@'.includes(value[0]!) ? `\t${value}` : value;
}

function exportCsv() {
    if (!props.context.rows.length) return;
    const headers = ['Aktenzeichen', 'Status', 'E-Mail', 'Eingereicht'];
    const fields: FormField[] = [];

    if (props.context.showFormColumn) {
        headers.splice(2, 0, t('admin.table.colForm'));
    }

    if (props.context.schema) {
        for (const section of props.context.schema.sections) {
            for (const field of section.fields) {
                headers.push(field.label);
                fields.push(field);
            }
        }
    }

    const rows = props.context.rows.map((row) => {
        const cells = [
            row.referenceNumber || '',
            props.context.statusOf(row)?.label || '',
            row.email || '',
            row.created ? new Date(row.created).toISOString() : ''
        ];
        if (props.context.showFormColumn) {
            cells.splice(2, 0, row.schemaId ? (props.context.schemaLabels[row.schemaId] || '') : '');
        }
        for (const field of fields) {
            const val = redactApplicationExportValue(row.data?.[field.id], field);
            if (val === null || val === undefined) cells.push('');
            else if (Array.isArray(val)) cells.push(val.join('; '));
            else cells.push(String(val));
        }
        return cells;
    });

    const csv = [
        headers.map(h => `"${sanitizeSpreadsheetCell(h).replace(/"/g, '""')}"`).join(','),
        ...rows.map(r => r.map(c => `"${sanitizeSpreadsheetCell(String(c)).replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    downloadBlob(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }), `antraege-${new Date().toISOString().slice(0, 10)}.csv`);
}

async function exportExcel() {
    if (!props.context.rows.length) return;
    try {
        const blob = await $fetch<Blob>('/api/export/excel', {
            method: 'POST',
            query: withWorkspaceQuery(),
            responseType: 'blob',
            body: {
                schemaId: props.context.schema?.id,
                applications: props.context.rows.map(row => ({
                    field_data: row.data ?? {},
                    field_reference_number: row.referenceNumber,
                    field_workflow_status: props.context.statusOf(row)?.machineName ?? '',
                    field_workflow_status_label: props.context.statusOf(row)?.label ?? '',
                    field_form_title: props.context.schema ? undefined : (row.schemaId ? props.context.schemaLabels[row.schemaId] : undefined),
                    field_applicant_email: row.email ?? undefined,
                    created: row.created
                }))
            }
        });
        downloadBlob(blob, `antraege-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (e) {
        toast.add({ title: t('admin.table.exportError'), description: resolveApiErrorMessage(e), color: 'error' });
    }
}

const exportMenuItems = computed<DropdownMenuItem[][]>(() => {
    const formats: DropdownMenuItem[] = [
        { label: 'CSV', icon: 'i-lucide-file-text', onSelect: exportCsv },
        { label: 'Excel', icon: 'i-lucide-file-spreadsheet', onSelect: () => void exportExcel() }
    ];
    // The coverage note is one line in the menu, not a paragraph.
    return metadataOnlyExport.value
        ? [[{ type: 'label', label: t('admin.table.exportFormFieldsHint'), class: 'font-normal text-xs text-muted', ui: { itemLabel: WRAP_MENU_TEXT } }], formats]
        : [formats];
});

function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
}
</script>

<template>
  <UDropdownMenu
    :items="exportMenuItems"
    :content="{ align: 'end' }"
    :ui="{ content: 'max-w-72' }"
  >
    <UButton
      data-test="export-menu"
      icon="i-lucide-download"
      color="neutral"
      variant="outline"
      :disabled="!context.rows.length"
      :aria-describedby="exportCoverageNoticeVisible ? exportCoverageNoticeId : undefined"
      :label="t('admin.table.export')"
      trailing-icon="i-lucide-chevron-down"
    />
  </UDropdownMenu>
  <span
    v-if="exportCoverageNoticeVisible"
    :id="exportCoverageNoticeId"
    class="sr-only"
  >{{ t('admin.table.exportFormFieldsHint') }}</span>
</template>
