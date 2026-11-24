import type { FormField, FormSchema } from '~/types/form';

export const FIELD_CHANGE_KEYS = [
    'label',
    'placeholder',
    'required',
    'type',
    'format',
    'options',
    'validation',
    'conditionalOn',
    'crm_key',
    'privacy',
    'sensitive',
    'defaultValue',
    // Edited in the field inspector, which registers undo steps too.
    'analysis',
    'maxFiles',
    'maxSizeBytes',
    'maxFileSizeBytes'
] as const;

export type FieldChangeKey = typeof FIELD_CHANGE_KEYS[number] | 'location';

export interface FieldLocation {
    sectionId: string
    fieldId: string
}

export type SchemaChangeSummary
    = | { kind: 'field_updated', fieldLabel: string, sectionId: string, fieldId: string, changes: FieldChangeKey[] }
      | { kind: 'field_deleted', fieldLabel: string, sectionId: string, fieldId: string }
      | { kind: 'field_added', fieldLabel: string, sectionId: string, fieldId: string }
      | { kind: 'schema_updated', sections: number, fields: number }
      // Structure edits from the editor name their change
      // explicitly; the diff below cannot tell a reorder from other edits.
      // A move names where it went (section and position), for the answer beside "Rückgängig".
      | { kind: 'field_moved', fieldLabel: string, sectionId: string, fieldId: string, toSectionTitle?: string, toPosition?: number }
      | { kind: 'section_moved', sectionTitle: string, sectionId: string, toPosition?: number }
      | { kind: 'section_deleted', sectionTitle: string, sectionId: string }
      // Title or description edited at the section header.
      | { kind: 'section_updated', sectionTitle: string, sectionId: string }
      | { kind: 'group_moved', groupLabel: string, sectionId: string, groupId: string, toSectionTitle?: string }
      | { kind: 'group_deleted', groupLabel: string, sectionId: string, groupId: string }
      | { kind: 'no_change' };

export function cloneFormSchema(schema: FormSchema): FormSchema {
    return JSON.parse(JSON.stringify(schema)) as FormSchema;
}

export function findField(
    schema: FormSchema,
    location: FieldLocation
): { sectionIndex: number, fieldIndex: number, field: FormField } | null {
    const sectionIndex = schema.sections.findIndex(section => section.id === location.sectionId);
    if (sectionIndex === -1) return null;
    const section = schema.sections[sectionIndex];
    if (!section) return null;

    const fieldIndex = section.fields.findIndex(field => field.id === location.fieldId);
    if (fieldIndex === -1) return null;
    const field = section.fields[fieldIndex];
    if (!field) return null;

    return {
        sectionIndex,
        fieldIndex,
        field
    };
}

function countFields(schema: FormSchema): number {
    return schema.sections.reduce((total, section) => total + section.fields.length, 0);
}

function fieldsById(schema: FormSchema): Map<string, { sectionId: string, field: FormField }> {
    const fields = new Map<string, { sectionId: string, field: FormField }>();

    for (const section of schema.sections) {
        for (const field of section.fields) {
            fields.set(field.id, {
                sectionId: section.id,
                field
            });
        }
    }

    return fields;
}

function valuesEqual(left: unknown, right: unknown): boolean {
    return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function changedFieldKeys(before: FormField, after: FormField): FieldChangeKey[] {
    return FIELD_CHANGE_KEYS.filter(key => !valuesEqual(before[key], after[key]));
}

export function summarizeSchemaChange(
    before: FormSchema,
    after: FormSchema,
    selectedField?: FieldLocation | null
): SchemaChangeSummary {
    if (valuesEqual(before, after)) {
        return { kind: 'no_change' };
    }

    if (selectedField) {
        const beforeField = findField(before, selectedField)?.field ?? null;
        const afterField = findField(after, selectedField)?.field ?? null;

        if (beforeField && !afterField) {
            const relocatedField = fieldsById(after).get(selectedField.fieldId);
            if (relocatedField) {
                return {
                    kind: 'field_updated',
                    fieldLabel: relocatedField.field.label || beforeField.label,
                    sectionId: relocatedField.sectionId,
                    fieldId: selectedField.fieldId,
                    changes: ['location']
                };
            }
        }

        if (beforeField && !afterField) {
            return {
                kind: 'field_deleted',
                fieldLabel: beforeField.label,
                sectionId: selectedField.sectionId,
                fieldId: selectedField.fieldId
            };
        }

        if (beforeField && afterField) {
            const changes = changedFieldKeys(beforeField, afterField);
            if (changes.length > 0) {
                return {
                    kind: 'field_updated',
                    sectionId: selectedField.sectionId,
                    fieldId: selectedField.fieldId,
                    fieldLabel: afterField.label || beforeField.label,
                    changes
                };
            }
        }
    }

    const beforeFields = fieldsById(before);
    const afterFields = fieldsById(after);

    for (const [id, item] of beforeFields) {
        if (!afterFields.has(id)) {
            return {
                kind: 'field_deleted',
                fieldLabel: item.field.label,
                sectionId: item.sectionId,
                fieldId: id
            };
        }
    }

    for (const [id, item] of afterFields) {
        if (!beforeFields.has(id)) {
            return {
                kind: 'field_added',
                fieldLabel: item.field.label,
                sectionId: item.sectionId,
                fieldId: id
            };
        }
    }

    for (const [id, item] of afterFields) {
        const beforeItem = beforeFields.get(id);
        if (!beforeItem) continue;

        if (beforeItem.sectionId !== item.sectionId) {
            return {
                kind: 'field_updated',
                fieldLabel: item.field.label || beforeItem.field.label,
                sectionId: item.sectionId,
                fieldId: id,
                changes: ['location']
            };
        }

        const changes = changedFieldKeys(beforeItem.field, item.field);
        if (changes.length > 0) {
            return {
                kind: 'field_updated',
                fieldLabel: item.field.label || beforeItem.field.label,
                sectionId: item.sectionId,
                fieldId: id,
                changes
            };
        }
    }

    return {
        kind: 'schema_updated',
        sections: after.sections.length,
        fields: countFields(after)
    };
}
