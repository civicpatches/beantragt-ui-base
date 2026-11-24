// Brackets mark it as a placeholder, never a value, also after copy and paste.
export const PROTECTED_VALUE_LABEL = '[geschützt]';

const ENCRYPTED_MARKER = '__beantragt_encrypted';
const REDACTED_MARKER = '__beantragt_redacted';

export interface ApplicationExportField {
    sensitive?: unknown
}

export function isSensitiveSchemaValue(value: unknown): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1;
    if (typeof value === 'string') {
        return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
    }
    return false;
}

export function isProtectedApplicationDataValue(value: unknown): boolean {
    return Boolean(
        value
        && typeof value === 'object'
        && !Array.isArray(value)
        && (value as Record<string, unknown>)[ENCRYPTED_MARKER] === true
    );
}

export function isRedactedApplicationDataValue(value: unknown): boolean {
    return Boolean(
        value
        && typeof value === 'object'
        && !Array.isArray(value)
        && (value as Record<string, unknown>)[REDACTED_MARKER] === true
    );
}

export function redactApplicationExportValue(
    value: unknown,
    field: ApplicationExportField | null | undefined
): unknown {
    if (
        isSensitiveSchemaValue(field?.sensitive)
        || isProtectedApplicationDataValue(value)
        || isRedactedApplicationDataValue(value)
    ) {
        return PROTECTED_VALUE_LABEL;
    }
    return value;
}
