import type { FormSchema } from '~/types/form';
import { computePreview } from '~/utils/computed';

/**
 * Evaluates computed field preview values based on their `computed` config.
 *
 * The preview is purely client-side and reactive: whenever any of the arg
 * fields change, the displayed value updates instantly. The authoritative
 * value is always computed server-side by the Drupal beantragt_compute module.
 *
 * v1 constraint: computed-on-computed is not supported. If an arg field itself
 * has a `computed` spec, that arg is skipped (resolved as undefined) so the
 * preview just shows nothing rather than producing a stale or circular result.
 */
export function useComputedFields(
    schema: Ref<FormSchema> | ComputedRef<FormSchema>,
    formData: Ref<Record<string, unknown>>
) {
    /**
     * Build a lookup: field ID -> compute spec, for all fields that declare
     * a `computed` property. Also track which field IDs are themselves computed
     * so we can skip them when resolving args (no computed-on-computed).
     */
    const computedMap = computed(() => {
        const map = new Map<string, { fn: string, args: string[] }>();
        const computedFieldIds = new Set<string>();

        for (const section of schema.value.sections) {
            for (const field of section.fields) {
                if (field.computed) {
                    map.set(field.id, field.computed);
                    computedFieldIds.add(field.id);
                }
            }
        }

        return { map, computedFieldIds };
    });

    /**
     * Returns the previewed computed value for a field, or `undefined` if:
     * - the field has no `computed` spec
     * - the `fn` is not in the frontend preview registry
     * - an arg itself is a computed field (v1: no computed-on-computed)
     */
    function getComputedPreview(fieldId: string): unknown {
        const { map, computedFieldIds } = computedMap.value;
        const spec = map.get(fieldId);
        if (!spec) return undefined;

        const resolvedArgs = spec.args.map((argFieldId) => {
            // v1: skip args that are themselves computed fields
            if (computedFieldIds.has(argFieldId)) return undefined;
            return formData.value[argFieldId];
        });

        return computePreview(spec.fn, resolvedArgs);
    }

    /**
     * Returns whether a field has a `computed` spec (i.e., should be rendered
     * as read-only with the preview value).
     */
    function isComputedField(fieldId: string): boolean {
        return computedMap.value.map.has(fieldId);
    }

    return { getComputedPreview, isComputedField };
}
