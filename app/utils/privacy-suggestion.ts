import type { FormField } from '../types/form';
import { inferFormFieldPrivacyKind, isHighRiskFormField, isSensitiveFlag } from './form-schema';
import { suggestPrivacy, type FormPrivacyContext, type PrivacySuggestion } from './privacy-catalog';

export interface FieldPrivacyHint extends PrivacySuggestion {
    /** The publish gate treats the field as special category (health, offences). */
    gateHighRisk: boolean
}

/**
 * Privacy hint for an unclassified field, aligned with the publish gate.
 *
 * The gate reads the section title as well (a birth date under "Angaben zur
 * Schwerbehinderung" counts as health data). A hint that disagreed would be a
 * dead end: accepted, it disappears and the field stays blocked. So when the
 * gate sees high risk, the hint is special category and says why. The same
 * holds for a field already classified (by the model or a person) with a kind
 * or a missing sensitive flag the gate will not accept.
 */
export function privacyHintForField(
    field: FormField,
    sectionTitle: string,
    context: FormPrivacyContext
): FieldPrivacyHint | null {
    const current = inferFormFieldPrivacyKind(field);
    const highRisk = isHighRiskFormField(field, { sectionTitle });
    if (current) {
        const acceptedByGate = !highRisk
          || ((current === 'special_category' || current === 'criminal_offense') && isSensitiveFlag(field.sensitive));
        if (acceptedByGate) return null;
    }
    const suggestion = suggestPrivacy(field, sectionTitle, context);
    if (!highRisk) {
        return suggestion ? { ...suggestion, gateHighRisk: false } : null;
    }
    if (suggestion && (suggestion.kind === 'special_category' || suggestion.kind === 'criminal_offense')) {
        return { ...suggestion, gateHighRisk: true };
    }
    return {
        concept: suggestion?.concept ?? 'gate.high_risk',
        kind: 'special_category',
        source: suggestion?.source ?? 'section',
        match: suggestion?.match ?? sectionTitle,
        organisationContext: suggestion?.organisationContext ?? false,
        gateHighRisk: true
    };
}
