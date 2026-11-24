import type { FormField } from '../types/form';

/**
 * A field's `conditionalOn` config. `value` may be missing in stored schemas,
 * which selects the not-empty mode.
 */
export type FormFieldCondition = Pick<NonNullable<FormField['conditionalOn']>, 'fieldId'> & {
    value?: string | boolean
};

/**
 * Pure `conditionalOn` predicate shared by the client widgets
 * (useConditionalFields) and the server-side assistant eligibility check, so
 * both sides decide visibility with identical semantics.
 *
 * - **Not-empty:** `value` is undefined: the field shows when the dependency
 *   is not empty (non-empty array, non-blank string, otherwise truthy).
 * - **Boolean match:** `value === true/false` checks truthy/falsy.
 * - **String match:** any other `value` checks strict string equality.
 */
export function isConditionMet(condition: FormFieldCondition, dependencyValue: unknown): boolean {
    if (condition.value === undefined) {
        if (Array.isArray(dependencyValue)) return dependencyValue.length > 0;
        if (typeof dependencyValue === 'string') return dependencyValue.trim() !== '';
        return !!dependencyValue;
    }

    if (typeof condition.value === 'boolean') {
        return condition.value ? !!dependencyValue : !dependencyValue;
    }

    return String(dependencyValue) === condition.value;
}
