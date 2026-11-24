import type { FormField, FormSchema } from '~/types/form';
import type { BooleanLabels } from '~/composables/useFormatters';
import { formatFieldLabel, formatFieldValue, formatValue } from '~/composables/useFormatters';
import {
    PROTECTED_VALUE_LABEL,
    isProtectedApplicationDataValue,
    isRedactedApplicationDataValue
} from '~~/casework-layer/app/utils/application-data-redaction';

function isProtectedPrintValue(value: unknown): boolean {
    return isRedactedApplicationDataValue(value) || isProtectedApplicationDataValue(value);
}

/**
 * Prints a placeholder for values the staff member may not read, otherwise
 * the value in the locale with the schema field's type and format.
 */
function formatPrintValue(value: unknown, booleanLabels?: BooleanLabels, field?: FormField, locale?: string, perEntry = false): string {
    if (isProtectedPrintValue(value)) return PROTECTED_VALUE_LABEL;
    return formatFieldValue(value, {
        type: field?.type,
        format: field?.format,
        step: field?.validation?.step,
        locale,
        booleanLabels,
        perEntry
    });
}

export interface PrintFieldRow {
    id: string
    label: string
    value: string
    fullWidth: boolean
}

export interface PrintFieldGroup {
    title: string
    fields: PrintFieldRow[]
}

export interface PrintCrmRow {
    key: string
    label: string
    value: string
}

export interface PrintAttachmentGroup {
    fieldId: string
    label: string
    attachments: PrintAttachment[]
}

export interface PrintAttachment {
    id: string
    fieldId: string
    filename: string
    url?: string
    mimeType?: string
    size?: number
    analysisStatus?: string
}

export interface PrintArchiveRow {
    key: string
    label: string
    value: string
}

export function buildPrintFieldLabels(schema: FormSchema | null | undefined): Record<string, string> {
    const labels: Record<string, string> = {};
    if (!schema) return labels;
    for (const section of schema.sections) {
        for (const field of section.fields) {
            labels[field.id] = field.label;
            if (field.crm_key) {
                labels[field.crm_key] = field.label;
            }
        }
    }
    return labels;
}

/** Schema fields by id and by CRM key, same precedence as the labels. */
export function buildPrintFieldMap(schema: FormSchema | null | undefined): Record<string, FormField> {
    const fields: Record<string, FormField> = {};
    if (!schema) return fields;
    for (const section of schema.sections) {
        for (const field of section.fields) {
            fields[field.id] = field;
            if (field.crm_key) {
                fields[field.crm_key] = field;
            }
        }
    }
    return fields;
}

export function buildPrintFieldGroups(
    data: Record<string, unknown>,
    schema: FormSchema | null | undefined,
    fallbackTitle: string,
    booleanLabels?: BooleanLabels,
    locale?: string,
    perEntryIds: ReadonlySet<string> = new Set()
): PrintFieldGroup[] {
    if (!schema) {
        return [{
            title: fallbackTitle,
            fields: Object.entries(data).map(([key, value]) => {
                const formatted = formatPrintFieldValue(value, undefined, booleanLabels, locale);
                return {
                    id: key,
                    label: formatFieldLabel(key.replace(/\./g, '_')),
                    value: formatted,
                    fullWidth: formatted.length > 80
                };
            })
        }];
    }

    return schema.sections.map(section => ({
        title: section.title,
        fields: section.fields.map(field => ({
            id: field.id,
            label: field.label,
            value: formatPrintFieldValue(data[field.id], field, booleanLabels, locale, perEntryIds.has(field.id)),
            fullWidth: field.type === 'textarea'
        }))
    }));
}

export function buildPrintCrmRows(
    crmData: Record<string, unknown>,
    fieldLabels: Record<string, string>,
    booleanLabels?: BooleanLabels,
    locale?: string,
    fieldsByKey: Record<string, FormField> = {}
): PrintCrmRow[] {
    return Object.entries(crmData).map(([key, value]) => ({
        key,
        label: fieldLabels[key] ?? formatFieldLabel(key.replace(/\./g, '_')),
        value: formatPrintValue(value, booleanLabels, fieldsByKey[key], locale)
    }));
}

export function buildPrintAttachmentGroups(
    attachments: PrintAttachment[],
    schema: FormSchema | null | undefined,
    fieldLabels: Record<string, string>
): PrintAttachmentGroup[] {
    const groups = new Map<string, PrintAttachment[]>();
    for (const attachment of attachments) {
        const entries = groups.get(attachment.fieldId) || [];
        entries.push(attachment);
        groups.set(attachment.fieldId, entries);
    }

    const fileFieldOrder = new Map<string, number>();
    if (schema) {
        let index = 0;
        for (const section of schema.sections) {
            for (const field of section.fields) {
                if (field.type === 'file') {
                    fileFieldOrder.set(field.id, index);
                    index += 1;
                }
            }
        }
    }

    return Array.from(groups.entries())
        .map(([fieldId, groupAttachments]) => ({
            fieldId,
            label: fieldLabels[fieldId] ?? formatFieldLabel(fieldId.replace(/\./g, '_')),
            attachments: groupAttachments
        }))
        .sort((a, b) => {
            const orderDelta = (fileFieldOrder.get(a.fieldId) ?? Number.MAX_SAFE_INTEGER)
              - (fileFieldOrder.get(b.fieldId) ?? Number.MAX_SAFE_INTEGER);
            return orderDelta || a.label.localeCompare(b.label);
        });
}

export function buildPrintArchiveRows(
    rows: Array<{ key: string, label: string, value: unknown }>,
    booleanLabels?: BooleanLabels
): PrintArchiveRow[] {
    return rows
        .map(row => ({
            key: row.key,
            label: row.label,
            // Archive metadata (ids, versions, timestamps) is printed as is.
            value: isProtectedPrintValue(row.value) ? PROTECTED_VALUE_LABEL : formatValue(row.value, booleanLabels)
        }))
        .filter(row => row.value !== '-');
}

export function extractPrintAttachmentsFromApplicationData(
    data: Record<string, unknown>,
    schema: FormSchema | null | undefined
): PrintAttachment[] {
    const fileFieldIds = new Set<string>();
    if (schema) {
        for (const section of schema.sections) {
            for (const field of section.fields) {
                if (field.type === 'file') {
                    fileFieldIds.add(field.id);
                }
            }
        }
    }

    const entries = schema
        ? Array.from(fileFieldIds).map(fieldId => [fieldId, data[fieldId]] as const)
        : Object.entries(data);

    return entries.flatMap(([fieldId, value]) =>
        attachmentEntries(value).map((attachment, index) => ({
            id: attachment.id || `${fieldId}-${index}`,
            fieldId,
            filename: attachment.filename,
            url: attachment.url,
            mimeType: attachment.mimeType,
            size: attachment.size,
            analysisStatus: attachment.analysisStatus
        }))
    );
}

/**
 * The attachment manifest names every file once, with field, name, size and
 * type: a file field leaves the form sections only when the manifest
 * lists every file name its stored value carries (`stored`, from the
 * application data). A name the manifest misses (a file entity gone, a row
 * without URL) keeps the field printed in its section, so the record still
 * shows that the file was submitted. Sections left without fields go.
 */
export function withoutManifestFileFields(groups: PrintFieldGroup[], manifest: PrintAttachmentGroup[], stored: PrintAttachment[] = []): PrintFieldGroup[] {
    const listedNames = new Map<string, Set<string>>();
    for (const group of manifest) {
        if (group.attachments.length === 0) continue;
        listedNames.set(group.fieldId, new Set(group.attachments.map(attachment => attachment.filename)));
    }
    if (listedNames.size === 0) return groups;
    const storedNames = new Map<string, string[]>();
    for (const attachment of stored) {
        storedNames.set(attachment.fieldId, [...(storedNames.get(attachment.fieldId) ?? []), attachment.filename]);
    }
    const covered = (fieldId: string) => {
        const listed = listedNames.get(fieldId);
        if (!listed) return false;
        return (storedNames.get(fieldId) ?? []).every(name => listed.has(name));
    };
    return groups
        .map(group => ({ ...group, fields: group.fields.filter(field => !covered(field.id)) }))
        .filter(group => group.fields.length > 0);
}

/** Short type of an attachment for print: "PDF" instead of `application/pdf`. */
const KNOWN_TYPES: Record<string, string> = {
    'application/pdf': 'PDF',
    'image/jpeg': 'JPEG',
    'image/jpg': 'JPEG',
    'image/png': 'PNG',
    'image/gif': 'GIF',
    'image/webp': 'WebP',
    'image/tiff': 'TIFF',
    'image/heic': 'HEIC',
    'text/plain': 'TXT',
    'text/csv': 'CSV',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
    'application/msword': 'DOC',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
    'application/vnd.ms-excel': 'XLS',
    'application/vnd.oasis.opendocument.text': 'ODT',
    'application/zip': 'ZIP',
    'application/xml': 'XML',
    'text/xml': 'XML'
};

export function attachmentTypeLabel(mimeType: string | null | undefined): string {
    const type = (typeof mimeType === 'string' ? mimeType.trim() : '').toLowerCase().split(';')[0]!.trim();
    if (!type) return '';
    if (KNOWN_TYPES[type]) return KNOWN_TYPES[type];
    // Unknown types: the short subtype when it reads as a file type, else nothing technical.
    const subtype = type.split('/')[1] ?? '';
    return /^[a-z0-9]{2,5}$/u.test(subtype) ? subtype.toUpperCase() : '';
}

export function formatPrintAttachmentSize(size: number | undefined): string {
    if (!Number.isFinite(size) || !size || size <= 0) return '0 KB';
    if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    return `${Math.ceil(size / 1024)} KB`;
}

function formatPrintFieldValue(value: unknown, field?: FormField, booleanLabels?: BooleanLabels, locale?: string, perEntry = false): string {
    const attachments = attachmentEntries(value);
    if (field?.type === 'file' || attachments.length > 0) {
        const filenames = attachments.map(attachment => attachment.filename);
        if (filenames.length > 0) return filenames.join(', ');
    }
    return formatPrintValue(value, booleanLabels, field, locale, perEntry);
}

function attachmentEntries(value: unknown): Array<{
    id?: string
    filename: string
    url?: string
    mimeType?: string
    size?: number
    analysisStatus?: string
}> {
    const values = Array.isArray(value) ? value : [value];
    return values.flatMap((entry) => {
        if (!entry || typeof entry !== 'object') return [];
        const raw = entry as Record<string, unknown>;
        const filename = typeof raw.filename === 'string' ? raw.filename : null;
        if (!filename) return [];
        return [{
            id: stringValue(raw.id) || stringValue(raw.attachmentId) || stringValue(raw.fileUuid),
            filename,
            url: stringValue(raw.url),
            mimeType: stringValue(raw.mimeType),
            size: numberValue(raw.size),
            analysisStatus: stringValue(raw.analysisStatus)
        }];
    });
}

function stringValue(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
    return value;
}
