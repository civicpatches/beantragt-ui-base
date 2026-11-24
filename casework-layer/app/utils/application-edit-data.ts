import type { FormField, FormSchema, FormSection } from '~/types/form';
import { isStoredConditionMet } from '~/utils/form-condition-value';
import { isFieldValueEmpty, validateFormFieldValue } from '~/utils/form-schema';

type VisibilityPredicate = (fieldId: string) => boolean;
const UNSAFE_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** One entry of a repeatable section, as the staff edit names it ("<Abschnitt>, Eintrag 2"). */
export interface ApplicationEditEntryRef {
    sectionId: string
    sectionTitle: string
    /** Zero-based position of the entry in its columns. */
    index: number
}

/**
 * The edited columns of a section no longer match the stored entries: `entryCount` for a list of another
 * length (an entry added or removed), `entryColumn` for a scalar or a missing value where a column is stored.
 * Drupal refuses the same two cases ("must keep <n> entries", "must keep one value per entry").
 */
export interface ApplicationEditShapeIssue {
    code: 'entryCount' | 'entryColumn'
    /** Stored number of entries of the section. */
    expected: number
}

/** A hidden element of an entry was changed, or a stored hidden element was emptied (Drupal: "cannot be changed/removed"). */
export interface ApplicationEditHiddenElementViolation {
    field: FormField
    entry: ApplicationEditEntryRef
    kind: 'changed' | 'removed'
}

export interface ApplicationEditValidationIssue {
    field: FormField
    issue: ReturnType<typeof validateFormFieldValue>[number] | ApplicationEditShapeIssue
    /** Set when the issue belongs to one entry of a repeatable section. */
    entry?: ApplicationEditEntryRef
}

/** A repeatable section whose stored data hold entry columns, with the column field ids and their stored length. */
export interface ApplicationEditEntrySection {
    section: FormSection
    fieldIds: string[]
    length: number
}

function isSafeApplicationDataKey(key: string): boolean {
    return !UNSAFE_OBJECT_KEYS.has(key);
}

function setSafeValue(target: Record<string, unknown>, key: string, value: unknown): void {
    if (!isSafeApplicationDataKey(key)) return;
    target[key] = value;
}

function stableJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value as Record<string, unknown>).sort()
            .map(key => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
    }
    return JSON.stringify(value) ?? 'null';
}

/**
 * Rule U, the same in the page, the proxy and Drupal: a field is an entry column if and only if the
 * application's origin is `bulk`, the field belongs to a section with `repeatable: true`, it is not a file
 * field, and its STORED value is a list (batch intake writes one element per entry, `beantragt_bulk`
 * BulkIntakeService; for a checkbox with options an element is an option string, a list of them, or empty).
 * For any other origin nothing is a column; a bulk field whose stored value is not a list is flat.
 */
export function isEntryColumn(origin: string | null | undefined, section: FormSection, field: FormField, storedValue: unknown): boolean {
    return origin === 'bulk' && section.repeatable === true && field.type !== 'file' && Array.isArray(storedValue);
}

/** Repeatable sections whose STORED data hold entry columns (Rule U); origin and stored data decide, never the edit. */
export function applicationEditEntrySections(
    schema: FormSchema,
    storedData: Record<string, unknown>,
    origin: string | null | undefined
): ApplicationEditEntrySection[] {
    const sections: ApplicationEditEntrySection[] = [];
    for (const section of schema.sections) {
        if (section.repeatable !== true) continue;
        const fields = section.fields.filter(field => isSafeApplicationDataKey(field.id)
          && isEntryColumn(origin, section, field, storedData[field.id]));
        if (fields.length === 0) continue;
        sections.push({
            section,
            fieldIds: fields.map(field => field.id),
            // As Drupal counts: the stored length of the section's first column.
            length: (storedData[fields[0]!.id] as unknown[]).length
        });
    }
    return sections;
}

export function applicationEditEntryColumnIds(sections: ApplicationEditEntrySection[]): Set<string> {
    return new Set(sections.flatMap(entrySection => entrySection.fieldIds));
}

/**
 * The staff edit has no condition rule of its own: page check, payload and proxy call `isConditionMet`, the
 * function the citizen form's renderer uses, through `isStoredConditionMet` (the condition as the page receives it,
 * a stored number dependency as the page's text), so all of them decide visibility the same way (Drupal reproduces it).
 *
 * Visibility of one entry's element: a condition on a sibling column of the same section reads the sibling's
 * element of the same entry; any other condition reads the top-level value, the same for every entry.
 */
export function isEntryElementVisible(
    field: FormField,
    entrySection: ApplicationEditEntrySection,
    data: Record<string, unknown>,
    index: number
): boolean {
    const condition = field.conditionalOn;
    if (!condition) return true;
    const sibling = entrySection.fieldIds.includes(condition.fieldId);
    const dependency = sibling
        ? (Array.isArray(data[condition.fieldId]) ? (data[condition.fieldId] as unknown[])[index] : undefined)
        : data[condition.fieldId];
    return isStoredConditionMet(condition, dependency);
}

/** A checkbox with options: batch intake writes one option string per entry; it is checked as that one choice. */
export function isOptionCheckbox(field: FormField): boolean {
    return field.type === 'checkbox' && Array.isArray(field.options) && field.options.length > 0;
}

/**
 * A stored option string is that one choice; a blank string (batch intake keeps the manifest's `""`) is no
 * choice, so it is checked as empty, never as an option that is not offered (Drupal checks it the same way).
 */
function entryElementForCheck(field: FormField, value: unknown): unknown {
    if (!isOptionCheckbox(field) || typeof value !== 'string') return value;
    return value.trim() === '' ? [] : [value];
}

function entryRef(entrySection: ApplicationEditEntrySection, index: number): ApplicationEditEntryRef {
    return { sectionId: entrySection.section.id, sectionTitle: entrySection.section.title, index };
}

function sectionField(entrySection: ApplicationEditEntrySection, fieldId: string): FormField {
    return entrySection.section.fields.find(field => field.id === fieldId)!;
}

export function buildApplicationEditPayload(
    schema: FormSchema,
    originalData: Record<string, unknown>,
    editedData: Record<string, unknown>,
    isFieldVisible: VisibilityPredicate,
    wasFieldVisible: VisibilityPredicate,
    origin: string | null = null
): Record<string, unknown> {
    const payload: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(originalData)) {
        setSafeValue(payload, key, value);
    }

    const entrySections = applicationEditEntrySections(schema, originalData, origin);
    const columnIds = applicationEditEntryColumnIds(entrySections);

    for (const section of schema.sections) {
        for (const field of section.fields) {
            if (!isSafeApplicationDataKey(field.id)) continue;
            Reflect.deleteProperty(payload, field.id);
        }
    }

    for (const section of schema.sections) {
        for (const field of section.fields) {
            if (!isSafeApplicationDataKey(field.id) || columnIds.has(field.id)) continue;
            if (!isFieldVisible(field.id)) {
                if (!wasFieldVisible(field.id) && Object.prototype.hasOwnProperty.call(originalData, field.id)) {
                    setSafeValue(payload, field.id, originalData[field.id]);
                }
                continue;
            }
            // Files cannot be changed in the staff edit: a visible file field goes back exactly as stored, and is
            // left out when nothing is stored (never an empty list the renderer may have put into the model).
            if (field.type === 'file') {
                if (Object.prototype.hasOwnProperty.call(originalData, field.id)) setSafeValue(payload, field.id, originalData[field.id]);
                continue;
            }
            setSafeValue(payload, field.id, editedData[field.id]);
        }
    }

    // Entry columns go back as columns of the stored length, element by element; a hidden element keeps its
    // stored value when it was hidden before, and is emptied when it was visible before (the flat rule per element).
    for (const entrySection of entrySections) {
        for (const fieldId of entrySection.fieldIds) {
            const field = sectionField(entrySection, fieldId);
            const original = originalData[fieldId] as unknown[];
            const edited = Array.isArray(editedData[fieldId]) ? editedData[fieldId] as unknown[] : original;
            const column = Array.from({ length: original.length }, (_, index) => {
                if (isEntryElementVisible(field, entrySection, editedData, index)) return edited[index] ?? null;
                return isEntryElementVisible(field, entrySection, originalData, index) ? null : original[index] ?? null;
            });
            setSafeValue(payload, fieldId, column);
        }
    }

    return payload;
}

export function createApplicationEditVisibilityPredicate(
    schema: FormSchema,
    data: Record<string, unknown>,
    /** Entry columns are visible as a whole; their elements follow `isEntryElementVisible`. */
    entryColumnIds: ReadonlySet<string> = new Set()
): VisibilityPredicate {
    const conditionMap = new Map<string, { fieldId: string, value?: string | boolean }>();
    const sectionOf = new Map<string, string>();
    for (const section of schema.sections) {
        for (const field of section.fields) {
            sectionOf.set(field.id, section.id);
            if (field.conditionalOn && isSafeApplicationDataKey(field.id)) {
                conditionMap.set(field.id, field.conditionalOn);
            }
        }
    }

    return (fieldId: string) => {
        if (!isSafeApplicationDataKey(fieldId)) return false;
        if (entryColumnIds.has(fieldId)) return true;
        const condition = conditionMap.get(fieldId);
        if (!condition) return true;
        const dependency = data[condition.fieldId];
        // A field of a repeatable section that is no column (a file field) with a condition on a sibling column:
        // visible, and so required, when at least one entry of the sibling meets the condition (as Drupal).
        if (entryColumnIds.has(condition.fieldId) && sectionOf.get(condition.fieldId) === sectionOf.get(fieldId)) {
            return Array.isArray(dependency) && dependency.some(element => isStoredConditionMet(condition, element));
        }
        return isStoredConditionMet(condition, dependency);
    };
}

export function collectHiddenApplicationEditFieldRemovals(
    schema: FormSchema,
    originalData: Record<string, unknown>,
    editedData: Record<string, unknown>,
    isFieldVisible: VisibilityPredicate,
    wasFieldVisible: VisibilityPredicate,
    origin: string | null = null
): FormField[] {
    const removed: FormField[] = [];
    const entrySections = applicationEditEntrySections(schema, originalData, origin);
    const columnIds = applicationEditEntryColumnIds(entrySections);

    for (const section of schema.sections) {
        for (const field of section.fields) {
            if (!isSafeApplicationDataKey(field.id) || columnIds.has(field.id)) continue;
            if (isFieldVisible(field.id) || !wasFieldVisible(field.id)) continue;
            const value = editedData[field.id] ?? originalData[field.id];
            if (!isFieldValueEmpty(value)) {
                removed.push(field);
            }
        }
    }

    for (const entrySection of entrySections) {
        for (const fieldId of entrySection.fieldIds) {
            const field = sectionField(entrySection, fieldId);
            const original = originalData[fieldId] as unknown[];
            const edited = Array.isArray(editedData[fieldId]) ? editedData[fieldId] as unknown[] : original;
            const emptied = original.some((_, index) => !isEntryElementVisible(field, entrySection, editedData, index)
              && isEntryElementVisible(field, entrySection, originalData, index)
              && !isFieldValueEmpty(edited[index] ?? original[index]));
            if (emptied) removed.push(field);
        }
    }

    return removed;
}

/**
 * Validates the edited data. Flat fields: one value each, exactly as before. Entry columns (decided from the
 * STORED data): the edited value must be a list of the stored length (a scalar or another count is an
 * `entryShape` issue of the section), and each visible element is validated on its own with the field's rules;
 * its issues carry the entry.
 */
export function collectApplicationEditValidationIssues(
    schema: FormSchema,
    editedData: Record<string, unknown>,
    isFieldVisible: VisibilityPredicate,
    storedData: Record<string, unknown> = {},
    origin: string | null = null
): ApplicationEditValidationIssue[] {
    const issues: ApplicationEditValidationIssue[] = [];
    const entrySections = applicationEditEntrySections(schema, storedData, origin);
    const columnIds = applicationEditEntryColumnIds(entrySections);

    for (const section of schema.sections) {
        for (const field of section.fields) {
            if (!isSafeApplicationDataKey(field.id)) continue;
            if (field.type === 'file') continue;
            if (columnIds.has(field.id)) continue;
            if (!isFieldVisible(field.id)) continue;

            for (const issue of validateFormFieldValue(field, editedData[field.id])) {
                issues.push({ field, issue });
            }
        }
    }

    for (const entrySection of entrySections) {
        for (const fieldId of entrySection.fieldIds) {
            const field = sectionField(entrySection, fieldId);
            const edited = editedData[fieldId];
            if (!Array.isArray(edited)) {
                issues.push({ field, issue: { code: 'entryColumn', expected: entrySection.length } });
                continue;
            }
            if (edited.length !== entrySection.length) {
                issues.push({ field, issue: { code: 'entryCount', expected: entrySection.length } });
                continue;
            }
            edited.forEach((value, index) => {
                if (!isEntryElementVisible(field, entrySection, editedData, index)) return;
                for (const issue of validateFormFieldValue(field, entryElementForCheck(field, value))) {
                    issues.push({ field, issue, entry: entryRef(entrySection, index) });
                }
            });
        }
    }

    return issues;
}

/**
 * The flat hidden-field rule of Drupal, per element of an entry column (an empty element `null` stands for
 * "absent"): an element hidden that carries a value must equal its stored value and must have been hidden
 * before ("cannot be changed"); an element hidden that is absent must not have been a stored hidden
 * value ("cannot be removed").
 */
export function collectEntryHiddenElementViolations(
    schema: FormSchema,
    originalData: Record<string, unknown>,
    editedData: Record<string, unknown>,
    origin: string | null = null
): ApplicationEditHiddenElementViolation[] {
    const violations: ApplicationEditHiddenElementViolation[] = [];
    for (const entrySection of applicationEditEntrySections(schema, originalData, origin)) {
        for (const fieldId of entrySection.fieldIds) {
            const field = sectionField(entrySection, fieldId);
            const original = originalData[fieldId] as unknown[];
            const edited = editedData[fieldId];
            if (!Array.isArray(edited)) continue;
            edited.forEach((value, index) => {
                if (isEntryElementVisible(field, entrySection, editedData, index)) return;
                const wasVisible = isEntryElementVisible(field, entrySection, originalData, index);
                const stored = original[index] ?? null;
                const absent = value === null || value === undefined;
                if (absent) {
                    if (!wasVisible && stored !== null) violations.push({ field, entry: entryRef(entrySection, index), kind: 'removed' });
                    return;
                }
                if (wasVisible || stored === null || stableJson(value) !== stableJson(stored)) {
                    violations.push({ field, entry: entryRef(entrySection, index), kind: 'changed' });
                }
            });
        }
    }
    return violations;
}

/** Why a value was refused, in the office's words (`admin.detail.fieldHint.<reason>`). */
const REFUSAL_REASONS = [
    'required', 'fileRequired', 'checked', 'text', 'boolean', 'address', 'number', 'email', 'date', 'url',
    'option', 'tooShort', 'tooLong', 'pattern', 'belowMin', 'aboveMax', 'step', 'hidden'
] as const;
export type ApplicationEditRefusalReason = typeof REFUSAL_REASONS[number];
export function isApplicationEditRefusalReason(value: unknown): value is ApplicationEditRefusalReason {
    return typeof value === 'string' && (REFUSAL_REASONS as readonly string[]).includes(value);
}

export type ApplicationEditRefusal
    = | { kind: 'entryCount' | 'entryColumn', sectionId: string, section: string, field: string, label: string, expected?: number }
      | { kind: 'field', field: string, label: string, reason: ApplicationEditRefusalReason, sectionId?: string, section?: string, number?: number }
      | { kind: 'unknownField' };

/** The reason of an issue of the shared check, in the same terms as a Drupal refusal. */
export function refusalReasonOfIssue(field: FormField, code: string): ApplicationEditRefusalReason {
    switch (code) {
        case 'required': return field.type === 'file' ? 'fileRequired' : field.type === 'checkbox' && !isOptionCheckbox(field) ? 'checked' : 'required';
        case 'option': return 'option';
        case 'minLength': return 'tooShort';
        case 'maxLength': return 'tooLong';
        case 'min': return 'belowMin';
        case 'max': return 'aboveMax';
        case 'step': return 'step';
        case 'pattern': return 'pattern';
        default:
            if (field.type === 'email') return 'email';
            if (field.type === 'date') return 'date';
            if (field.type === 'number') return 'number';
            if (field.type === 'address') return 'address';
            if (field.type === 'checkbox' && !isOptionCheckbox(field)) return 'boolean';
            return field.format === 'url' ? 'url' : 'text';
    }
}

const FLAT_REFUSALS: Array<[RegExp, ApplicationEditRefusalReason | 'requiredOrFile']> = [
    [/^Required field "([^"]+)" is empty\.$/u, 'requiredOrFile'],
    [/^Required checkbox field "([^"]+)" must be checked\.$/u, 'checked'],
    [/^Field "([^"]+)" must be a string\.$/u, 'text'],
    [/^Field "([^"]+)" must be a boolean\.$/u, 'boolean'],
    [/^Field "([^"]+)" must be a structured address\.$/u, 'address'],
    [/^Field "([^"]+)" must be numeric\.$/u, 'number'],
    [/^Field "([^"]+)" must be an email address\.$/u, 'email'],
    [/^Field "([^"]+)" must be an ISO date\.$/u, 'date'],
    [/^Field "([^"]+)" must be a valid URL\.$/u, 'url'],
    [/^Field "([^"]+)" must be a list of options\.$/u, 'option'],
    [/^Field "([^"]+)" contains an invalid option\.$/u, 'option'],
    [/^Field "([^"]+)" is too short\.$/u, 'tooShort'],
    [/^Field "([^"]+)" is too long\.$/u, 'tooLong'],
    [/^Field "([^"]+)" does not match the required pattern\.$/u, 'pattern'],
    [/^Field "([^"]+)" is below the minimum\.$/u, 'belowMin'],
    [/^Field "([^"]+)" is above the maximum\.$/u, 'aboveMax'],
    [/^Field "([^"]+)" does not match the required step\.$/u, 'step'],
    [/^Hidden field "([^"]+)" cannot be (?:changed|removed)\.$/u, 'hidden']
];

/**
 * Drupal's refusals of this route carry no code, only a message (`beantragt_application`
 * ApplicationDataEditValidator, flat messages and the entry messages of E1). This reads every one of them
 * back into field, label (from the schema, never the id), reason and, for an entry, section and a one-based
 * number. Only ids are in these messages, no values. Anything else returns null.
 */
export function parseDrupalRefusal(schema: FormSchema, detail: string): ApplicationEditRefusal | null {
    const sectionById = (id: string) => schema.sections.find(item => item.id === id);
    const fieldById = (id: string) => schema.sections.flatMap(section => section.fields).find(item => item.id === id);
    const labelOf = (id: string) => fieldById(id)?.label || id;

    let match = /^Section "([^"]+)" must keep (\d+) entries; field "([^"]+)" has \d+\.$/u.exec(detail);
    if (match) return { kind: 'entryCount', sectionId: match[1]!, section: sectionById(match[1]!)?.title ?? match[1]!, field: match[3]!, label: labelOf(match[3]!), expected: Number(match[2]) };
    match = /^Field "([^"]+)" of section "([^"]+)" must keep one value per entry\.$/u.exec(detail);
    if (match) return { kind: 'entryColumn', sectionId: match[2]!, section: sectionById(match[2]!)?.title ?? match[2]!, field: match[1]!, label: labelOf(match[1]!) };
    if (/^Unknown (?:stored|submitted) field "[^"]+" /u.test(detail)) return { kind: 'unknownField' };

    let entry: { sectionId: string, number: number } | null = null;
    let message = detail;
    match = /^Section "([^"]+)", entry (\d+): (.*)$/u.exec(detail);
    if (match) {
        entry = { sectionId: match[1]!, number: Number(match[2]) + 1 };
        message = match[3]!;
    }
    for (const [pattern, reason] of FLAT_REFUSALS) {
        const flat = pattern.exec(message);
        if (!flat) continue;
        const fieldId = flat[1]!;
        const resolved = reason === 'requiredOrFile' ? (fieldById(fieldId)?.type === 'file' ? 'fileRequired' : 'required') : reason;
        return {
            kind: 'field',
            field: fieldId,
            label: labelOf(fieldId),
            reason: resolved,
            ...(entry ? { sectionId: entry.sectionId, section: sectionById(entry.sectionId)?.title ?? entry.sectionId, number: entry.number } : {})
        };
    }
    return null;
}
