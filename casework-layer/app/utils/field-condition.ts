import { fieldName } from './field-name';
import type { FormField, FormSchema } from '~/types/form';
import type { FormFieldCondition } from '~/utils/form-conditional';
import { isStoredConditionMet } from '~/utils/form-condition-value';

/**
 * Direct editing of a field's `conditionalOn`. The
 * answers follow `isConditionMet`: a string matches one option of a select or
 * radio field, a boolean the state of a single checkbox, a missing value any
 * answer. Multi-select checkboxes and free input can only test "answered",
 * because a string match compares the whole stored value.
 */
export type ConditionAnswerKind = 'option' | 'toggle' | 'filled';

export const CONDITION_ANSWER_FILLED = 'filled';
export const CONDITION_ANSWER_CHECKED = 'checked';
export const CONDITION_ANSWER_UNCHECKED = 'unchecked';
const OPTION_PREFIX = 'option:';

export function conditionAnswerKind(field: FormField): ConditionAnswerKind {
    const options = field.options ?? [];
    if ((field.type === 'select' || field.type === 'radio') && options.length > 0) return 'option';
    if (field.type === 'checkbox' && options.length === 0) return 'toggle';
    return 'filled';
}

/** Parent of each field in the condition graph: field id to the id it depends on. */
function conditionParents(schema: FormSchema): Map<string, string> {
    const parents = new Map<string, string>();
    for (const section of schema.sections) {
        for (const field of section.fields) {
            if (field.conditionalOn?.fieldId) parents.set(field.id, field.conditionalOn.fieldId);
        }
    }
    return parents;
}

function dependsOn(fieldId: string, target: string, parents: Map<string, string>): boolean {
    const seen = new Set<string>();
    let current = parents.get(fieldId);
    while (current && !seen.has(current)) {
        if (current === target) return true;
        seen.add(current);
        current = parents.get(current);
    }
    return false;
}

/**
 * Fields a condition of `fieldId` may depend on. Only the same section: both
 * public projections of a form (Nuxt `server/api/schema/[id].get.ts`, Drupal
 * `PublicFormApiController::fieldProjections`) keep a condition only when its
 * source is in the field's own section, so a source elsewhere would be
 * dropped and citizens would always see the field. Computed fields and
 * fields that already depend on `fieldId` (a loop) are left out.
 */
export function conditionSourceCandidates(schema: FormSchema, sectionId: string, fieldId: string): FormField[] {
    const section = schema.sections.find(candidate => candidate.id === sectionId);
    if (!section) return [];
    const parents = conditionParents(schema);
    return section.fields.filter(field =>
        field.id !== fieldId
        && !field.computed
        && !dependsOn(field.id, fieldId, parents)
    );
}

/** The key an answer choice uses for the stored condition value. */
export function conditionAnswerKey(condition: FormFieldCondition): string {
    if (condition.value === undefined) return CONDITION_ANSWER_FILLED;
    if (typeof condition.value === 'boolean') return condition.value ? CONDITION_ANSWER_CHECKED : CONDITION_ANSWER_UNCHECKED;
    return `${OPTION_PREFIX}${condition.value}`;
}

export function optionAnswerKey(option: string): string {
    return `${OPTION_PREFIX}${option}`;
}

/** The stored condition for a source field and an answer key, or null for an unknown key. */
export function conditionFromAnswer(sourceId: string, answerKey: string): FormField['conditionalOn'] | null {
    if (answerKey === CONDITION_ANSWER_FILLED) {
        // "Any answer": the stored form has no value (isConditionMet, not-empty mode).
        return { fieldId: sourceId } as FormField['conditionalOn'];
    }
    if (answerKey === CONDITION_ANSWER_CHECKED) return { fieldId: sourceId, value: true };
    if (answerKey === CONDITION_ANSWER_UNCHECKED) return { fieldId: sourceId, value: false };
    if (answerKey.startsWith(OPTION_PREFIX)) {
        // A blank value is never written; "any answer" is no value.
        const option = answerKey.slice(OPTION_PREFIX.length);
        return option.trim() === '' ? null : { fieldId: sourceId, value: option };
    }
    return null;
}

/**
 * Whether the control can show a stored condition for a source of this kind:
 * an option or "any answer" for select and radio, a boolean for a single
 * checkbox, "answered" for everything else. Anything else stays as stored.
 */
export function conditionFitsKind(condition: FormFieldCondition, kind: ConditionAnswerKind): boolean {
    if (kind === 'option') return condition.value === undefined || typeof condition.value === 'string';
    if (kind === 'toggle') return typeof condition.value === 'boolean';
    return condition.value === undefined;
}

/** Where a stored condition's source is, seen from the field that carries it. */
export type ConditionSourceState = 'same_section' | 'other_section' | 'missing' | 'excluded';

export function conditionSourceState(schema: FormSchema, sectionId: string, fieldId: string, sourceId: string): ConditionSourceState {
    const owner = schema.sections.find(section => section.fields.some(field => field.id === sourceId));
    if (!owner) return 'missing';
    if (owner.id !== sectionId) return 'other_section';
    return conditionSourceCandidates(schema, sectionId, fieldId).some(field => field.id === sourceId)
        ? 'same_section'
        : 'excluded';
}

/**
 * Why a stored condition does not work for citizens:
 * - `other_section`: both public projections drop a condition whose source is
 *   in another section, so the field always shows, while both submit
 *   validators still evaluate it over the whole form and drop the answer when
 *   it is not met;
 * - `missing`: the source field is gone; the field always shows, and the
 *   answer is dropped unless the condition is "not checked";
 * - `stale_answer`: the condition tests an answer the select or radio source
 *   no longer offers, so the field never shows and nothing is stored;
 * - `type_mismatch`: the condition waits for an answer the source can
 *   never hold with its type (a word on a tick box, a word on a number, any
 *   text on an upload), so the field never shows; read from the stored schema;
 * - `type_changed`: the source got a type of another kind while the
 *   form was edited, so the condition means something else (a choice
 *   that became free text, a number that became text); known only in the
 *   editing session, as a stored schema keeps no earlier type.
 */
export type BrokenConditionReason = 'other_section' | 'missing' | 'stale_answer' | 'type_mismatch' | 'type_changed';

/** What a field holds as a condition source, in kinds that read a condition alike. */
export type ConditionSourceKind = 'toggle' | 'choice' | 'multiple' | 'number' | 'date' | 'text' | 'file' | 'address';

export function conditionSourceKind(field: FormField): ConditionSourceKind {
    const options = field.options ?? [];
    if (field.type === 'checkbox') return options.length > 0 ? 'multiple' : 'toggle';
    if (field.type === 'select' || field.type === 'radio') return 'choice';
    if (field.type === 'number' || field.type === 'date' || field.type === 'file' || field.type === 'address') return field.type;
    return 'text';
}

/**
 * Values the citizen page can hold for a field of this kind, as the page model keeps them: a number
 * as the typed text, a date as ISO text, a tick box as a boolean, a multiple choice as the list of
 * ticked answers, an upload as a list of files, an address as an object. Free text can hold any text,
 * so the condition's own text is one of them.
 */
function holdableValues(field: FormField, conditionValue: unknown): unknown[] {
    const options = field.options ?? [];
    const asked = typeof conditionValue === 'string' ? conditionValue : undefined;
    switch (conditionSourceKind(field)) {
        case 'toggle': return [true, false];
        case 'choice': return ['', ...options];
        case 'multiple': return [[], ...options.map(option => [option]), options];
        case 'number': return ['', '0', '1', '-1', '1.5', ...(asked !== undefined && /^-?\d+(?:[.,]\d+)?$/u.test(asked.trim()) ? [asked] : [])];
        case 'date': return ['', '2026-01-31', ...(asked !== undefined && /^\d{4}-\d{2}-\d{2}$/u.test(asked) ? [asked] : [])];
        case 'file': return [[], [{ attachmentId: 'a', filename: 'a.pdf' }]];
        case 'address': return [undefined, { formatted: 'a' }];
        default: return ['', 'a', ...(asked !== undefined ? [asked] : [])];
    }
}

/** Whether any answer the source can hold meets the condition, by the page's own rule. */
export function conditionCanBeMet(source: FormField, condition: { fieldId: string, value?: unknown }): boolean {
    return holdableValues(source, condition.value).some(value => isStoredConditionMet(condition, value));
}

/** A condition whose source changed its kind in this editing session. */
export interface ConditionTypeChange {
    /** The field that carries the condition. */
    fieldId: string
    sourceId: string
    kindBefore: ConditionSourceKind
    /** The condition as it was then; editing it ends the note. */
    condition: string
}

export interface ConditionTypeChangeEffect {
    sourceId: string
    sourceLabel: string
    kindBefore: ConditionSourceKind
    kindAfter: ConditionSourceKind
    /** Every field that depends on the source; `breaks` when its condition no longer means the same. */
    dependents: Array<{ fieldId: string, fieldLabel: string, sectionId: string, breaks: boolean }>
}

function fieldsById(schema: FormSchema): Map<string, { sectionId: string, field: FormField }> {
    const map = new Map<string, { sectionId: string, field: FormField }>();
    for (const section of schema.sections) {
        for (const field of section.fields) map.set(field.id, { sectionId: section.id, field });
    }
    return map;
}

/**
 * Fields whose kind as a condition source changed from `before` to `after`, with the fields that
 * depend on them. A condition that names a value (an answer, ticked or not) breaks: it means
 * something else or can never be met; "any answer" keeps its meaning.
 */
export function conditionTypeChangeEffects(before: FormSchema, after: FormSchema, untitled?: string): ConditionTypeChangeEffect[] {
    const old = fieldsById(before);
    const effects: ConditionTypeChangeEffect[] = [];
    for (const { field } of fieldsById(after).values()) {
        const previous = old.get(field.id)?.field;
        if (!previous) continue;
        const kindBefore = conditionSourceKind(previous);
        const kindAfter = conditionSourceKind(field);
        if (kindBefore === kindAfter) continue;
        const dependents = after.sections.flatMap(section => section.fields
            .filter(candidate => candidate.conditionalOn?.fieldId === field.id)
            .map(candidate => ({
                fieldId: candidate.id,
                fieldLabel: fieldName(candidate, untitled),
                sectionId: section.id,
                breaks: candidate.conditionalOn!.value !== undefined || !conditionCanBeMet(field, candidate.conditionalOn!)
            })));
        if (dependents.length > 0) effects.push({ sourceId: field.id, sourceLabel: fieldName(field, untitled), kindBefore, kindAfter, dependents });
    }
    return effects;
}

/** The notes to keep for the conditions an effect breaks. */
export function conditionTypeChangeNotes(after: FormSchema, effects: ConditionTypeChangeEffect[]): ConditionTypeChange[] {
    const fields = fieldsById(after);
    return effects.flatMap(effect => effect.dependents.filter(dependent => dependent.breaks).map(dependent => ({
        fieldId: dependent.fieldId,
        sourceId: effect.sourceId,
        kindBefore: effect.kindBefore,
        condition: JSON.stringify(fields.get(dependent.fieldId)?.field.conditionalOn ?? null)
    })));
}

export interface BrokenCondition {
    fieldId: string
    sectionId: string
    fieldLabel: string
    sourceId: string
    sourceLabel: string
    reason: BrokenConditionReason
    /** The stored answer, for `stale_answer` and the "not checked" case of `missing`. */
    value?: string | boolean
}

/** `untitled`: the name of a field without a label; without it the key, as before. */
export function brokenConditions(schema: FormSchema, typeChanges: readonly ConditionTypeChange[] = [], untitled?: string): BrokenCondition[] {
    const owners = new Map<string, { sectionId: string, field: FormField }>();
    for (const section of schema.sections) {
        for (const field of section.fields) owners.set(field.id, { sectionId: section.id, field });
    }
    const broken: BrokenCondition[] = [];
    for (const section of schema.sections) {
        for (const field of section.fields) {
            const condition = field.conditionalOn;
            if (!condition?.fieldId) continue;
            const owner = owners.get(condition.fieldId);
            const base = {
                fieldId: field.id,
                sectionId: section.id,
                fieldLabel: fieldName(field, untitled),
                sourceId: condition.fieldId,
                // A source that does not exist any more has only its key.
                sourceLabel: owner ? fieldName(owner.field, untitled) : condition.fieldId,
                ...(condition.value !== undefined ? { value: condition.value } : {})
            };
            if (!owner) {
                broken.push({ ...base, reason: 'missing' });
            } else if (owner.sectionId !== section.id) {
                broken.push({ ...base, reason: 'other_section' });
            } else if (
                typeof condition.value === 'string'
                && conditionAnswerKind(owner.field) === 'option'
                && !(owner.field.options ?? []).includes(condition.value)
            ) {
                broken.push({ ...base, reason: 'stale_answer' });
            } else if (!conditionCanBeMet(owner.field, condition)) {
                broken.push({ ...base, reason: 'type_mismatch' });
            }
        }
    }
    // Conditions whose source changed its kind in this session, while nothing else is wrong
    // with them, until the condition is edited or the source gets its old kind back.
    for (const note of typeChanges) {
        if (broken.some(item => item.fieldId === note.fieldId)) continue;
        const dependent = [...owners.values()].find(entry => entry.field.id === note.fieldId);
        const source = owners.get(note.sourceId);
        const condition = dependent?.field.conditionalOn;
        if (!dependent || !source || !condition || condition.fieldId !== note.sourceId) continue;
        if (JSON.stringify(condition) !== note.condition || conditionSourceKind(source.field) === note.kindBefore) continue;
        broken.push({
            fieldId: dependent.field.id,
            sectionId: dependent.sectionId,
            fieldLabel: fieldName(dependent.field, untitled),
            sourceId: note.sourceId,
            sourceLabel: fieldName(source.field, untitled),
            reason: 'type_changed',
            ...(condition.value !== undefined ? { value: condition.value } : {})
        });
    }
    return broken;
}

/** Conditions broken in `after` that were fine (or did not exist) in `before`. */
export function newlyBrokenConditions(before: FormSchema, after: FormSchema, typeChanges: readonly ConditionTypeChange[] = [], untitled?: string): BrokenCondition[] {
    const known = new Set(brokenConditions(before, typeChanges).map(item => `${item.fieldId}\u0000${item.reason}`));
    return brokenConditions(after, typeChanges, untitled).filter(item => !known.has(`${item.fieldId}\u0000${item.reason}`));
}
