import { createError } from 'h3';

/** Options passed to `createSafeError`. */
export interface SafeErrorData {
    statusCode: number
    message: string
    data?: unknown
}

/**
 * Create an error that strips stack traces in production.
 */
export const createSafeError = (errorData: SafeErrorData) => {
    const isDevelopment = process.env.NODE_ENV === 'development';

    if (isDevelopment) {
        return createError(errorData);
    }

    const sanitizedError = createError({
        statusCode: errorData.statusCode,
        message: errorData.message,
        data: errorData.data
    });

    // Remove stack trace in production to prevent information leakage
    delete (sanitizedError as { stack?: string }).stack;

    return sanitizedError;
};

/**
 * Recursively strip sensitive keys (stack, stacktrace) from a value.
 * Used to sanitize error responses before sending to the client.
 */
export const stripSensitive = (val: unknown): unknown => {
    if (!val) return val;
    if (typeof val === 'string') return val;
    if (Array.isArray(val)) return val.map(stripSensitive);
    if (typeof val === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
            if (k.toLowerCase() === 'stack' || k.toLowerCase() === 'stacktrace') continue;
            out[k] = stripSensitive(v);
        }
        return out;
    }
    return val;
};
