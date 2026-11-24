/**
 * A refused form-schema save that names the field .
 *
 * Drupal refuses a save that brings in a field condition with a blank value (422, source pointer
 * `/data`) and ends the detail with a machine token, for example
 * `[schema.condition_value_empty pointer=/sections/0/fields/1/conditionalOn/value field=detail]`
 * (`FormSchema::CONDITION_VALUE_EMPTY`). The Nuxt proxies pass the detail through
 * (`drupalSessionFetch` -> `data.detail`). This parser is closed: it knows exactly the codes
 * below, a pointer of their shape and a field id; anything else is the general refusal (null).
 */
export const SCHEMA_REFUSAL_CONDITION_VALUE_EMPTY = 'schema.condition_value_empty';

export interface SchemaRefusal {
    code: typeof SCHEMA_REFUSAL_CONDITION_VALUE_EMPTY
    /** JSON pointer into the schema, `/sections/<i>/fields/<j>/conditionalOn/value`. */
    pointer: string
    sectionIndex: number
    fieldIndex: number
    fieldId: string
}

const TOKEN = /\[(schema\.[a-z_]+) pointer=(\/sections\/(\d+)\/fields\/(\d+)\/conditionalOn\/value) field=([A-Za-z0-9_.-]+)\]$/u;

/** The detail of an API error as the client receives it (same envelope as `resolveApiErrorMessage`). */
export function apiErrorDetail(error: unknown): string {
    const envelope = (error as { data?: { detail?: unknown, data?: { detail?: unknown } } } | null)?.data;
    const nested = envelope?.data && typeof envelope.data === 'object' ? envelope.data.detail : undefined;
    const detail = typeof nested === 'string' ? nested : envelope?.detail;
    return typeof detail === 'string' ? detail.trim() : '';
}

export function parseSchemaRefusal(detail: unknown): SchemaRefusal | null {
    if (typeof detail !== 'string') return null;
    const match = TOKEN.exec(detail.trim());
    if (!match || match[1] !== SCHEMA_REFUSAL_CONDITION_VALUE_EMPTY) return null;
    return {
        code: SCHEMA_REFUSAL_CONDITION_VALUE_EMPTY,
        pointer: match[2]!,
        sectionIndex: Number(match[3]),
        fieldIndex: Number(match[4]),
        fieldId: match[5]!
    };
}

/** The refusal of a failed request, or null for every other error. */
export function schemaRefusalOf(error: unknown): SchemaRefusal | null {
    return parseSchemaRefusal(apiErrorDetail(error));
}
