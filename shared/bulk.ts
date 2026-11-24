/**
 * Bulk eligibility vocabulary shared by app and Nitro (Vorprüfung step 3).
 * Drupal `BulkEligibility` is the one function that decides whether a form can be
 * processed in a batch; Nuxt keeps no eligibility rule of its own, only these
 * mirrors. The parity tests on both sides keep numbers, unit and order equal.
 */

/** Every bulk text limit counts UTF-16 code units: JS `.length`, Drupal `BulkFormProjection::units()`. One emoji counts 2. */
export const BULK_LIMIT_UNIT = 'utf16_code_units';

/** Leading page ceiling; actual count also depends on the renderer byte budget. */
export const BULK_PAGE_LIMIT = 8;

/** Mirror of `BulkEligibility::LIMITS`. Label untrimmed; document type, criterion title and explanation after trim. */
export const BULK_LIMITS = { label: 200, documentType: 200, criterionTitle: 200, criterionExplanation: 2000, criteriaPerField: 40, fileFields: 100 } as const;

/** Mirror of `BulkEligibility::REASONS`, same order: jurisdiction, form, schema, then per file field and criterion. */
export const BULK_ELIGIBILITY_REASONS = [
    'bulk_disabled', 'policy_invalid', 'provider_missing',
    'form_archived', 'organisation_missing', 'schema_invalid', 'no_file_field', 'too_many_file_fields',
    'field_id_invalid', 'field_not_sovereign', 'label_invalid', 'label_too_long', 'document_type_invalid', 'document_type_too_long',
    'criterion_key_invalid', 'criterion_title_too_long', 'criterion_explanation_invalid', 'criterion_explanation_too_long', 'too_many_criteria'
] as const;
export type BulkEligibilityReasonCode = typeof BULK_ELIGIBILITY_REASONS[number];
