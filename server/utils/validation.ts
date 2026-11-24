const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateUuid(value: unknown, fieldName: string): string {
    if (typeof value !== 'string' || !UUID_REGEX.test(value)) {
        throw createError({
            statusCode: 400,
            message: 'errors.validation.invalidField',
            data: { code: 'errors.validation.invalidField', field: fieldName }
        });
    }
    return value;
}

export function sanitizeString(value: unknown, maxLength = 10000): string {
    if (typeof value !== 'string') return '';
    return value.substring(0, maxLength);
}
