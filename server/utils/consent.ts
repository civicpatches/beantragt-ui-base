export function requireConsentAccepted(value: unknown): void {
    if (value === true) return;

    throw createError({
        statusCode: 400,
        message: 'errors.consent.required',
        data: { code: 'errors.consent.required' }
    });
}
