import type { FormFieldPrivacyKind } from '~~/app/types/form';
import type { SchemaAuthoringIssueCode } from '~~/app/utils/form-schema';

export interface DraftClassificationChoice {
    sectionIndex: number
    fieldIndex: number
    kind: FormFieldPrivacyKind
    sensitive?: true
}

export interface DraftClassificationField {
    sectionIndex: number
    fieldIndex: number
    sectionTitle: string
    fieldLabel: string
    reasons: SchemaAuthoringIssueCode[]
    protected: boolean
    highRisk: boolean
}

export interface DraftClassificationReview {
    publishable: boolean
    fields: DraftClassificationField[]
}

export function classificationFieldKey(field: Pick<DraftClassificationField, 'sectionIndex' | 'fieldIndex'>): string {
    return `${field.sectionIndex}-${field.fieldIndex}`;
}

export function needsClassification(field: DraftClassificationField): boolean {
    return field.reasons.includes('personal_data_classification_missing') || field.reasons.includes('high_risk_unmarked');
}
