// Brackets mark it as a placeholder, never a value, also after copy and paste.
export const PROTECTED_VALUE_LABEL = '[geschützt]';

const ENCRYPTED_MARKER = '__beantragt_encrypted';
const REDACTED_MARKER = '__beantragt_redacted';

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

export function redactProtectedApplicationDataValue(value: unknown): unknown {
    if (isProtectedApplicationDataValue(value) || isRedactedApplicationDataValue(value)) {
        return PROTECTED_VALUE_LABEL;
    }
    return value;
}

export function parseApplicationFieldData(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }
    if (typeof value !== 'string' || value.trim() === '') {
        return {};
    }
    try {
        const parsed = JSON.parse(value) as unknown;
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed as Record<string, unknown>
            : {};
    } catch {
        return {};
    }
}

export function sensitiveFieldIdsFromFormSchemaResource(resource: unknown): Set<string> | null {
    if (!resource || typeof resource !== 'object' || Array.isArray(resource)) {
        return null;
    }
    const attributes = (resource as { attributes?: Record<string, unknown> }).attributes;
    const fieldSchema = attributes?.field_schema;
    const schemaValue = typeof fieldSchema === 'string'
        ? fieldSchema
        : fieldSchema && typeof fieldSchema === 'object' && !Array.isArray(fieldSchema)
            ? (fieldSchema as { value?: unknown }).value
            : undefined;
    return sensitiveFieldIdsFromFormSchema(schemaValue);
}

export function sensitiveFieldIdsFromFormSchema(value: unknown): Set<string> | null {
    const schema = parseFormSchema(value);
    if (!schema) {
        return null;
    }
    if (!Array.isArray(schema.sections)) {
        return null;
    }
    const sections = schema.sections;
    const ids = new Set<string>();
    for (const section of sections) {
        if (!section || typeof section !== 'object' || Array.isArray(section)) {
            return null;
        }
        if (!Array.isArray((section as { fields?: unknown }).fields)) {
            return null;
        }
        const fields = (section as { fields: unknown[] }).fields;
        for (const field of fields) {
            if (!field || typeof field !== 'object' || Array.isArray(field)) {
                return null;
            }
            const id = (field as { id?: unknown }).id;
            if (typeof id !== 'string' || id === '') {
                return null;
            }
            if (isSensitiveSchemaField(field)) {
                ids.add(id);
            }
        }
    }
    return ids;
}

export function redactProtectedApplicationData(
    value: unknown,
    sensitiveFieldIds: ReadonlySet<string> = new Set()
): Record<string, unknown> {
    const data = parseApplicationFieldData(value);
    return Object.fromEntries(
        Object.entries(data).map(([key, fieldValue]) => [
            key,
            sensitiveFieldIds.has(key)
                ? PROTECTED_VALUE_LABEL
                : redactProtectedApplicationDataValue(fieldValue)
        ])
    );
}

export function redactAllApplicationData(value: unknown): Record<string, unknown> {
    const data = parseApplicationFieldData(value);
    return Object.fromEntries(
        Object.keys(data).map(key => [key, PROTECTED_VALUE_LABEL])
    );
}

function isSensitiveSchemaField(field: object): boolean {
    const sensitive = (field as { sensitive?: unknown }).sensitive;
    if (typeof sensitive === 'boolean') return sensitive;
    if (typeof sensitive === 'number') return sensitive === 1;
    if (typeof sensitive === 'string') {
        return ['1', 'true', 'yes', 'on'].includes(sensitive.trim().toLowerCase());
    }
    return false;
}

function parseFormSchema(value: unknown): Record<string, unknown> | null {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }
    if (typeof value !== 'string' || value.trim() === '') {
        return null;
    }
    try {
        const parsed = JSON.parse(value) as unknown;
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed as Record<string, unknown>
            : null;
    } catch {
        return null;
    }
}
