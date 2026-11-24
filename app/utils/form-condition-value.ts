import type { FormField, FormSchema } from '../types/form';
import { isConditionMet, type FormFieldCondition } from './form-conditional';

/**
 * The value of a stored `conditionalOn` as the citizen page receives it. The public schema route keeps a string
 * or a boolean and drops anything else (a number, null), so the page then evaluates "any answer" (`isConditionMet`
 * without a value). Every server-side check of a citizen submission normalizes the same way, so the server, the
 * page and Drupal decide visibility alike.
 */
export function publicConditionValue(value: unknown): string | boolean | undefined {
    return typeof value === 'string' || typeof value === 'boolean' ? value : undefined;
}

/** A condition as the page receives it: the field id, and the value only when it is a string or a boolean. */
export function publicCondition(condition: { fieldId: string, value?: unknown }): FormFieldCondition {
    const value = publicConditionValue(condition.value);
    return value === undefined ? { fieldId: condition.fieldId } : { fieldId: condition.fieldId, value };
}

/** The field with its condition as the page receives it (same object when nothing changes). */
export function withPublicCondition<T extends Pick<FormField, 'conditionalOn'>>(field: T): T {
    const condition = field.conditionalOn;
    if (!condition) return field;
    const normalized = publicCondition(condition);
    return normalized.value === (condition as { value?: unknown }).value
        ? field
        : { ...field, conditionalOn: normalized as NonNullable<T['conditionalOn']> };
}

/**
 * The schema with every condition as the page receives it. The staff edit works on the stored schema revision,
 * not the public projection; it hands this to its renderers so they decide visibility as the page, the submit
 * route and Drupal do.
 */
export function withPublicConditions(schema: FormSchema): FormSchema {
    return { ...schema, sections: schema.sections.map(section => ({ ...section, fields: section.fields.map(field => withPublicCondition(field)) })) };
}

/**
 * The stored schema JSON with every condition as the page receives it, for a route that hands the stored schema
 * on (the staff schema of the assistant). Unchanged text when no condition changes or the JSON is not a schema.
 */
export function withPublicConditionsInSchemaJson(raw: string): string {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return raw;
    }
    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { sections?: unknown }).sections)) return raw;
    let changed = false;
    const sections = ((parsed as { sections: unknown[] }).sections).map((section) => {
        if (!section || typeof section !== 'object' || !Array.isArray((section as { fields?: unknown }).fields)) return section;
        const fields = (section as { fields: unknown[] }).fields.map((field) => {
            if (!field || typeof field !== 'object') return field;
            const condition = (field as { conditionalOn?: unknown }).conditionalOn;
            if (!condition || typeof condition !== 'object' || typeof (condition as { fieldId?: unknown }).fieldId !== 'string') return field;
            const normalized = withPublicCondition(field as Pick<FormField, 'conditionalOn'>);
            if (normalized !== field) changed = true;
            return normalized;
        });
        return { ...(section as object), fields };
    });
    return changed ? JSON.stringify({ ...(parsed as object), sections }) : raw;
}

/**
 * A dependency value as the page holds it. The page keeps a number field as text ("0"), so a value that arrives as
 * a JSON number (a request to the submit route, a batch manifest's stored number) is read as `String(value)`:
 * 0 is then an answer, as on the page. Everything else is passed on unchanged.
 */
export function dependencyAsPageValue(value: unknown): unknown {
    return typeof value === 'number' ? String(value) : value;
}

/**
 * The one server-side visibility decision for stored or submitted data: the page's rule (`isConditionMet`) on the
 * condition as the page receives it (`publicCondition`) and the dependency as the page holds it
 * (`dependencyAsPageValue`). Used by the submit route, the staff edit (its check, payload and proxy) and the
 * attachment count; Drupal reproduces it.
 */
export function isStoredConditionMet(condition: { fieldId: string, value?: unknown }, dependencyValue: unknown): boolean {
    return isConditionMet(publicCondition(condition), dependencyAsPageValue(dependencyValue));
}

/**
 * Whether a field of a citizen submission is visible for the submitted data (`isStoredConditionMet`). A field
 * without a condition is visible.
 */
export function isSubmissionFieldVisible(field: Pick<FormField, 'conditionalOn'>, data: Record<string, unknown>): boolean {
    const condition = field.conditionalOn;
    if (!condition) return true;
    return isStoredConditionMet(condition, data[condition.fieldId]);
}
