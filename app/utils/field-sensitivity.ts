import type { FormField } from '~/types/form';
import { isHighRiskFormField, isSensitiveFlag } from '~/utils/form-schema';

/**
 * Data-minimisation for the assisted assistant flow (ADR-6 §4).
 *
 * Sensitive field values are captured in client-side widgets and submitted
 * straight to /api/submit; they are NOT mirrored back into the LLM context via
 * the render_form_fields tool result. A field counts as sensitive when it
 * carries an explicit `sensitive` flag (ADR-3), maps to a person CRM key, or
 * uses a strongly-identifying format.
 */

/**
 * Identifying CRM keys whose values must stay out of the LLM context. Includes
 * company identifiers because a sole trader's VAT / register number is tied to a
 * natural person (DSGVO Art. 4(1)).
 */
const SENSITIVE_CRM_KEYS = new Set<string>([
    'person.full_name',
    'person.first_name',
    'person.last_name',
    'person.birthdate',
    'person.address',
    'person.street',
    'person.postal_code',
    'person.city',
    'person.phone',
    'person.email',
    'person.iban',
    'person.account_holder',
    'person.tax_id',
    'person.nationality',
    'person.marital_status',
    'person.gender',
    'company.vat_id',
    'company.register_number',
    'company.contact_person'
]);

/** Formats that identify a person or a payment instrument. */
const SENSITIVE_FORMATS = new Set<string>(['iban', 'bic', 'tax_id', 'postal_code']);

/**
 * Field types that inherently carry contact PII even without a CRM key (e.g. a
 * form freshly compiled from a PDF where crm_key is not assigned yet).
 */
const SENSITIVE_FIELD_TYPES = new Set<string>(['email', 'tel', 'address']);

export function isSensitiveField(field: FormField): boolean {
    if (isSensitiveFlag(field.sensitive)) return true;
    if (field.privacy?.kind === 'not_personal') return false;
    if (field.crm_key && SENSITIVE_CRM_KEYS.has(field.crm_key)) return true;
    if (field.format && SENSITIVE_FORMATS.has(field.format)) return true;
    if (SENSITIVE_FIELD_TYPES.has(field.type)) return true;
    if (isHighRiskFormField(field)) return true;
    const context = [field.id, field.label, field.placeholder]
        .filter((value): value is string => typeof value === 'string')
        .join(' ')
        .toLowerCase();
    if (/\b(name|vorname|nachname|geburtsdatum|birthdate|adresse|anschrift|strasse|straße|hausnummer|plz|postleitzahl|ort|stadt|telefon|phone|e-?mail|email|iban|kontoinhaber(?:in)?|steuer(?:[- ]?id)?|steueridentifikationsnummer)\b/u.test(context)) {
        return true;
    }
    return false;
}

/** Placeholder returned to the LLM in place of a sensitive value. */
export const REDACTED_VALUE = '[vom Bürger erfasst]';

export interface AssistantAttachmentToolResult {
    status: 'uploaded' | 'not_provided'
    count: number
}

/**
 * Build the render_form_fields tool result: sensitive values are replaced with
 * a redaction marker and empty values are dropped entirely. This is only a
 * client-side second layer: the server masks every value to a filled marker
 * before anything reaches the model and uses the non-sensitive values only
 * request-locally for conditionalOn eligibility (
 * server/utils/assistant-form-value-mask.ts).
 */
export function buildToolResultValues(
    fields: FormField[],
    values: Record<string, unknown>
): Record<string, unknown> {
    const byId = new Map(fields.map(field => [field.id, field]));
    const out: Record<string, unknown> = {};
    for (const [id, value] of Object.entries(values)) {
        const field = byId.get(id);
        if (field?.type === 'file') {
            const count = Array.isArray(value)
                ? value.filter(item => Boolean(item) && typeof item === 'object' && !Array.isArray(item)).length
                : 0;
            out[id] = {
                status: count > 0 ? 'uploaded' : 'not_provided',
                count
            } satisfies AssistantAttachmentToolResult;
            continue;
        }
        if (value === '' || value === null || value === undefined || value === false) continue;
        if (Array.isArray(value) && value.length === 0) continue;
        out[id] = field && isSensitiveField(field) ? REDACTED_VALUE : value;
    }
    return out;
}
