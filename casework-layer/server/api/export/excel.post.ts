import ExcelJS from 'exceljs';
import type { H3Event } from 'h3';
import {
    PROTECTED_VALUE_LABEL,
    redactProtectedApplicationDataValue
} from '~~/server/utils/protected-application-data';
import { workflowStatusExportLabel } from '../../utils/application-export';
import { displayFormAddressValue } from '~~/app/utils/form-address';

const MAX_EXPORT_ROWS = 500;
const MAX_EXPORT_BODY_BYTES = 5 * 1024 * 1024;

interface ExcelExportBody {
    schemaId?: string
    applications: Array<{
        field_data: Record<string, unknown>
        field_reference_number: string
        field_workflow_status: string
        field_workflow_status_label?: string
        field_form_title?: string
        field_applicant_email?: string
        created: string
    }>
}

function exportRequestError(statusCode: number, code: string) {
    return createSafeError({ statusCode, message: code, data: { code } });
}

async function readExcelExportBody(event: H3Event): Promise<ExcelExportBody> {
    const request = event.node.req;
    if (Number(request.headers['content-length']) > MAX_EXPORT_BODY_BYTES) {
        throw exportRequestError(413, 'errors.export.bodyTooLarge');
    }

    const chunks: Buffer[] = [];
    let size = 0;
    // Keep the socket writable so a chunked request can receive the 413.
    for await (const chunk of request.iterator({ destroyOnReturn: false })) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bytes.length;
        if (size > MAX_EXPORT_BODY_BYTES) {
            throw exportRequestError(413, 'errors.export.bodyTooLarge');
        }
        chunks.push(bytes);
    }

    try {
        return JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
    } catch {
        throw exportRequestError(400, 'errors.validation.invalidPayload');
    }
}

/**
 * Sanitize a cell value to prevent CSV injection.
 * Cells starting with =, +, -, or @ are prefixed with a single quote
 * so spreadsheet apps treat them as plain text.
 */
function sanitizeCell(value: string): string {
    if (value.length > 0 && '=+-@'.includes(value[0]!)) {
        return `'${value}`;
    }
    return value;
}

function isSensitiveSchemaValue(value: unknown): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1;
    if (typeof value === 'string') {
        return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
    }
    return false;
}

/**
 * POST /api/export/excel
 *
 * Receives application data and a schema ID, returns an .xlsx file.
 * The schema is used to determine column headers and sensitive-field redaction.
 */
export default defineEventHandler(async (event) => {
    await requireStaff(event);
    requireSameOriginRequest(event);
    setPrivateNoStore(event);

    // Rate limiting
    const ip = getClientIp(event);
    checkRateLimit(ip, 'excel_export', event);

    const rawBody = await readExcelExportBody(event);
    if (!Array.isArray(rawBody?.applications) || !rawBody.applications.length) {
        throw exportRequestError(400, 'errors.export.noApplications');
    }
    if (rawBody.applications.length > MAX_EXPORT_ROWS) {
        throw exportRequestError(422, 'errors.export.tooManyRows');
    }
    const schemaId = rawBody.schemaId ? validateUuid(rawBody.schemaId, 'schemaId') : undefined;
    const body = { ...rawBody, schemaId };

    const containsSubmittedFieldData = body.applications.some(app =>
        app.field_data
        && typeof app.field_data === 'object'
        && Object.keys(app.field_data).length > 0
    );

    // ── Load schema for column headers ──────────────────────────────
    interface SchemaSection {
        title: string
        fields: Array<{ id: string, label: string, sensitive?: boolean | string | number }>
    }

    interface ParsedSchema {
        sections: SchemaSection[]
    }

    let parsedSchema: ParsedSchema | null = null;

    if (body.schemaId) {
        const schemaQuery = new URLSearchParams({
            'filter[id]': body.schemaId,
            'fields[form_schema--form_schema]': 'label,field_schema',
            'page[limit]': '1'
        });
        await applyAdminJurisdictionFilter(event, schemaQuery);

        const schemaRes = await drupalSessionFetch<{
            data?: Array<{
                attributes: {
                    label: string
                    field_schema: { value: string } | string
                }
            }>
        }>(
            event,
            `/jsonapi/form_schema/form_schema?${schemaQuery.toString()}`
        );

        const schema = schemaRes.data?.[0];
        if (!schema) {
            throw createSafeError({
                statusCode: 404,
                message: 'errors.schema.notFound',
                data: { code: 'errors.schema.notFound' }
            });
        }

        const fieldValue = typeof schema.attributes.field_schema === 'string'
            ? schema.attributes.field_schema
            : schema.attributes.field_schema?.value;

        try {
            if (fieldValue) {
                parsedSchema = JSON.parse(fieldValue) as ParsedSchema;
            }
        } catch (e) {
            console.warn('[excel] Could not parse schema, using raw field keys:', e);
        }
    }

    if (containsSubmittedFieldData && !parsedSchema) {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.export.schemaRequired',
            data: { code: 'errors.export.schemaRequired' }
        });
    }

    // ── Build column definitions ────────────────────────────────────
    const hasFormColumn = body.applications.some(app => app.field_form_title);
    const staticHeaders = hasFormColumn
        ? ['Aktenzeichen', 'Status', 'Formular', 'E-Mail', 'Eingereicht']
        : ['Aktenzeichen', 'Status', 'E-Mail', 'Eingereicht'];
    const fieldColumns: Array<{ id: string, label: string, sensitive: boolean }> = [];

    if (parsedSchema) {
        for (const section of parsedSchema.sections) {
            for (const field of section.fields) {
                fieldColumns.push({
                    id: field.id,
                    label: field.label,
                    sensitive: isSensitiveSchemaValue(field.sensitive)
                });
            }
        }
    } else {
    // Fallback: use keys from first application
        const keys = Object.keys(body.applications[0]?.field_data ?? {});
        for (const key of keys) {
            fieldColumns.push({ id: key, label: key, sensitive: false });
        }
    }

    const headers = [...staticHeaders, ...fieldColumns.map(c => c.label)].map(sanitizeCell);

    // ── Build data rows ─────────────────────────────────────────────
    const rows = body.applications.map((app) => {
        const staticCells = [
            app.field_reference_number || '',
            workflowStatusExportLabel(app.field_workflow_status, app.field_workflow_status_label),
            ...(hasFormColumn ? [app.field_form_title || ''] : []),
            app.field_applicant_email || '',
            app.created ? new Date(app.created).toLocaleDateString('de-DE') : ''
        ];

        const dataCells = fieldColumns.map((col) => {
            if (col.sensitive) return PROTECTED_VALUE_LABEL;
            const val = redactProtectedApplicationDataValue(app.field_data[col.id]);
            if (val === null || val === undefined) return '';
            if (Array.isArray(val)) return val.join('; ');
            if (typeof val === 'boolean') return val ? 'Ja' : 'Nein';
            const address = displayFormAddressValue(val);
            if (address) return address;
            return String(val);
        });

        return [...staticCells, ...dataCells].map(sanitizeCell);
    });

    // ── Generate workbook ───────────────────────────────────────────
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Antraege');

    worksheet.addRow(headers);

    // Style header row bold
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };

    for (const row of rows) {
        worksheet.addRow(row);
    }

    // Auto-width columns (based on content length, capped at 50)
    worksheet.columns.forEach((column, i) => {
        let maxLen = headers[i]?.length ?? 10;
        for (const row of rows) {
            const cellLen = (row[i] ?? '').length;
            if (cellLen > maxLen) maxLen = cellLen;
        }
        column.width = Math.min(maxLen + 2, 50);
    });

    const buffer = await workbook.xlsx.writeBuffer();

    // ── Return as file download ─────────────────────────────────────
    const filename = `antraege-${new Date().toISOString().slice(0, 10)}.xlsx`;

    setResponseHeaders(event, {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`
    });

    return buffer;
});
