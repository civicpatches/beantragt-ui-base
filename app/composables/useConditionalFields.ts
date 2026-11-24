import type { FormSchema } from '~/types/form';
import { isConditionMet, type FormFieldCondition } from '~/utils/form-conditional';

/**
 * Evaluates conditional visibility for form fields based on their `conditionalOn` config.
 *
 * Supports three modes (see isConditionMet, shared with the server-side
 * assistant eligibility check):
 * - **Boolean match:** `conditionalOn.value === true/false` checks if `formData[fieldId]` is truthy/falsy
 * - **String match:** `conditionalOn.value === "some_value"` checks strict equality
 * - **Not-empty:** if `conditionalOn.value` is undefined, shows field when `formData[fieldId]` is not empty
 */
export function useConditionalFields(
    schema: Ref<FormSchema> | ComputedRef<FormSchema>,
    formData: Ref<Record<string, unknown>>
) {
    const conditionMap = computed(() => {
        const map = new Map<string, FormFieldCondition>();
        for (const section of schema.value.sections) {
            for (const field of section.fields) {
                if (field.conditionalOn) {
                    map.set(field.id, field.conditionalOn);
                }
            }
        }
        return map;
    });

    /**
   * Returns whether a field should be visible based on its conditional configuration.
   * Fields without `conditionalOn` are always visible.
   */
    function isFieldVisible(fieldId: string): boolean {
        const condition = conditionMap.value.get(fieldId);
        if (!condition) return true;

        return isConditionMet(condition, formData.value[condition.fieldId]);
    }

    return { isFieldVisible };
}
