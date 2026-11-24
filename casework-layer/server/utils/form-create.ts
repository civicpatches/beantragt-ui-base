import type { H3Event } from 'h3';
import { schemaRefusalOf } from '~~/app/utils/schema-refusal';

export function formCreateError(statusCode: number, code: string) {
    return createSafeError({ statusCode, message: code, data: { code } });
}

export function normalizeFormCreateError(error: unknown, fallback: string, {
    includeSchemaRefusal = true,
    forbiddenCode = 'errors.schema.writeForbidden'
} = {}) {
    const failure = error as { statusCode?: number, data?: { upstreamCode?: string, code?: string } } | null;
    const status = failure?.statusCode || 500;
    const code = failure?.data?.upstreamCode ?? failure?.data?.code;
    if (status === 401) return formCreateError(401, 'errors.auth.notAuthenticated');
    if (status === 403) {
        return formCreateError(403, code === 'errors.auth.csrfInvalid' ? code : forbiddenCode);
    }
    if (status === 404 && (code === 'errors.workspace.notFound' || code === 'errors.schema.notFound')) {
        return formCreateError(404, code);
    }
    if (status === 422) {
        const refusal = includeSchemaRefusal ? schemaRefusalOf(error) : null;
        const code = 'errors.schema.invalid';
        return createSafeError({
            statusCode: 422,
            message: code,
            data: {
                code,
                ...(refusal ? { detail: `[${refusal.code} pointer=${refusal.pointer} field=${refusal.fieldId}]` } : {})
            }
        });
    }
    return formCreateError(status, fallback);
}

export async function postFormResourceAsSession<T>(event: H3Event, path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    return writeFormResourceAsSession<T>(event, path, { method: 'POST', body, ...(signal ? { signal } : {}) });
}

export async function writeFormResourceAsSession<T>(
    event: H3Event,
    path: string,
    options: { method: 'POST' | 'PATCH', body: unknown, expectedRevisionId?: number, signal?: AbortSignal }
): Promise<T> {
    try {
        return await drupalSessionFetch<T>(event, path, {
            ...options,
            errorMessageCodes: {
                'X-CSRF-Token request header is missing': 'errors.auth.csrfInvalid',
                'X-CSRF-Token request header is invalid': 'errors.auth.csrfInvalid'
            }
        });
    } catch (error: unknown) {
        const failure = error as { statusCode?: number, data?: { upstreamCode?: string } } | null;
        if (failure?.statusCode === 403 && failure.data?.upstreamCode !== 'errors.schema.writeForbidden') {
            // Drupal can deny a write as anonymous after the session expires
            // between verification and persistence. Bypass the request cache.
            await getAuthenticatedUser(event, getHeader(event, 'cookie') || '', options.signal);
        }
        throw error;
    }
}
