/**
 * Finite vocabulary of the docgen staff API (beantragt_docgen).
 *
 * The Nuxt proxy forwards only these codes; anything else becomes
 * docgen.internal_error. Every code has a translation under `docgen.*` in
 * both locales (tests/unit/utils/docgen.test.ts checks that).
 */
export const DOCGEN_ERROR_CODES = [
    'docgen.access_denied',
    'docgen.csrf_invalid',
    'docgen.invalid_json',
    'docgen.input_invalid',
    'docgen.unknown_key',
    'docgen.scope_required',
    'docgen.json_required',
    'docgen.input_too_large',
    'docgen.scope_not_found',
    'docgen.form_not_found',
    'docgen.template_not_found',
    'docgen.application_not_found',
    'docgen.document_not_found',
    'docgen.letterhead_invalid',
    'docgen.letterhead_missing',
    'docgen.docx_invalid',
    'docgen.docx_too_large',
    'docgen.docx_macro',
    'docgen.docx_forbidden_content',
    'docgen.docx_rejected',
    'docgen.scan_failed',
    'docgen.scan_unavailable',
    'docgen.template_invalid',
    'docgen.template_has_errors',
    'docgen.template_immutable',
    'docgen.template_in_use',
    'docgen.template_not_allowed',
    'docgen.form_not_configured',
    'docgen.form_uses_case_system',
    'docgen.application_anonymized',
    'docgen.document_released',
    'docgen.request_exists',
    'docgen.document_releasing',
    'docgen.preview_missing',
    'docgen.preview_stale',
    'docgen.preview_not_viewed',
    'docgen.agents_stopped',
    'docgen.pdf_not_compliant',
    'docgen.release_count_invalid',
    'docgen.release_invalid',
    'docgen.release_outcome_conflict',
    'docgen.locked',
    'docgen.busy',
    'docgen.unavailable',
    'docgen.not_configured',
    'docgen.conversion_failed',
    'docgen.too_large',
    'docgen.integrity_failed',
    'docgen.storage_unavailable',
    'docgen.delivery_unavailable',
    'docgen.delivery_failed',
    // Request letters with a cover sheet and a deadline from the render day
    // (Nachreichung step 1): blockers and drafting errors.
    'docgen.cover_sheet_missing',
    'docgen.cover_sheet_unavailable',
    'docgen.holiday_region_required',
    'docgen.deadline_outdated',
    'docgen.request_details_missing',
    'docgen.internal_error',
    // Proxy-side codes.
    'docgen.workspace_required',
    'docgen.rate_limited',
    'docgen.route_not_found',
    // Browser-side code: Web Crypto exists only in a secure context.
    'docgen.insecure_context'
] as const;

/** Warning codes of the form settings projection (never errors). */
export const DOCGEN_WARNING_CODES = [
    'docgen.template_missing',
    'docgen.template_not_released',
    'docgen.placeholders_unknown',
    'docgen.no_template_assigned'
] as const;

/** `details.reason` values the UI explains in its own words. */
export const DOCGEN_REASONS = [
    'protected_values',
    'not_zip',
    'not_docx',
    'entry_count',
    'entry_unreadable',
    'entry_name',
    'expansion',
    'encoding',
    'xml',
    'content_type',
    'altchunk_or_ole',
    'embedded_object',
    'relationship_type',
    'external_relationship',
    'field_code',
    'dtd',
    'xml_too_large'
] as const;

export type DocgenErrorCode = typeof DOCGEN_ERROR_CODES[number];
export type DocgenWarningCode = typeof DOCGEN_WARNING_CODES[number];
export type DocgenReason = typeof DOCGEN_REASONS[number];

const ERROR_SET = new Set<string>(DOCGEN_ERROR_CODES);
const WARNING_SET = new Set<string>(DOCGEN_WARNING_CODES);
const REASON_SET = new Set<string>(DOCGEN_REASONS);

export function isDocgenErrorCode(value: unknown): value is DocgenErrorCode {
    return typeof value === 'string' && ERROR_SET.has(value);
}

export function isDocgenWarningCode(value: unknown): value is DocgenWarningCode {
    return typeof value === 'string' && WARNING_SET.has(value);
}

export function isDocgenReason(value: unknown): value is DocgenReason {
    return typeof value === 'string' && REASON_SET.has(value);
}

/** i18n key below `docgen.` for a code: `docgen.busy` -> `docgen.busy`. */
export function docgenCode(value: unknown): DocgenErrorCode {
    return isDocgenErrorCode(value) ? value : 'docgen.internal_error';
}
