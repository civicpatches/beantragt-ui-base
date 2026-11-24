import type { FormSchema, FormSection } from '~/types/form';
import { isProtectedApplicationDataValue, isRedactedApplicationDataValue } from '~~/casework-layer/app/utils/application-data-redaction';

export interface ApplicationDataRow {
    key: string
    value: unknown
}

export interface ApplicationDataEntryView {
    key: string
    label: string
    rows: ApplicationDataRow[]
}

export interface ApplicationDataSectionView {
    key: string
    title: string
    entries: ApplicationDataEntryView[]
    rows: ApplicationDataRow[]
}

interface RepeatedSection {
    key: string
    section: FormSection
    entries: Omit<ApplicationDataEntryView, 'label'>[]
    rows: ApplicationDataRow[]
}

/** Mirrors the batch writer: every non-file field of a repeatable section. */
export function repeatedFieldIds(schema: FormSchema | null | undefined, origin?: string | null): Set<string> {
    if (origin !== 'bulk' || !schema) return new Set();
    return new Set(schema.sections
        .filter(section => section.repeatable === true)
        .flatMap(section => section.fields.filter(field => field.type !== 'file').map(field => field.id)));
}

/** Split stored columns without inferring the application's origin from values. */
export function splitRepeatedSections(
    rows: ApplicationDataRow[],
    schema: FormSchema | null | undefined,
    origin?: string | null
): { rows: ApplicationDataRow[], sections: RepeatedSection[] } {
    const ids = repeatedFieldIds(schema, origin);
    if (!schema || ids.size === 0) return { rows, sections: [] };
    const byId = new Map(rows.map(row => [row.key, row]));
    const groupedIds = new Set<string>();
    const sections: RepeatedSection[] = [];
    for (const section of schema.sections) {
        if (section.repeatable !== true) continue;
        const repeatedRows = section.fields
            .filter(field => ids.has(field.id))
            .flatMap((field) => {
                const row = byId.get(field.id);
                return row ? [row] : [];
            });
        const columns = repeatedRows.filter(row => Array.isArray(row.value));
        if (columns.length === 0) continue;
        const count = Math.max(...columns.map(row => (row.value as unknown[]).length));
        const entryRows = repeatedRows.filter(row => Array.isArray(row.value)
          || isProtectedApplicationDataValue(row.value) || isRedactedApplicationDataValue(row.value));
        const entryIds = new Set(entryRows.map(row => row.key));
        const sectionIds = new Set(section.fields.map(field => field.id));
        for (const id of sectionIds) groupedIds.add(id);
        sections.push({
            key: section.id,
            section,
            entries: Array.from({ length: count }, (_, index) => ({
                key: `${section.id}#${index}`,
                rows: entryRows.map(row => ({
                    key: row.key,
                    value: Array.isArray(row.value) ? row.value[index] ?? null : row.value
                }))
            })),
            rows: rows.filter(row => sectionIds.has(row.key) && !entryIds.has(row.key))
        });
    }
    return { rows: rows.filter(row => !groupedIds.has(row.key)), sections };
}
