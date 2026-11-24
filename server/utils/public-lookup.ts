const PUBLIC_LOOKUP_TIMEOUT_MS = 10_000;

type PublicLookupUnavailableError = Error & {
    statusCode: 503
    data: { code: 'errors.serviceUnavailable' }
};

export function publicLookupUnavailableError(): PublicLookupUnavailableError {
    const error = new Error('errors.serviceUnavailable') as PublicLookupUnavailableError;
    error.statusCode = 503;
    error.data = { code: 'errors.serviceUnavailable' };
    if (process.env.NODE_ENV !== 'development') {
        delete error.stack;
    }
    return error;
}

export async function withPublicLookupTimeout<T>(
    loader: (signal: AbortSignal) => Promise<T>
): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PUBLIC_LOOKUP_TIMEOUT_MS);

    try {
        return await loader(controller.signal);
    } catch (error) {
        if (controller.signal.aborted) {
            throw publicLookupUnavailableError();
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}
