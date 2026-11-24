import type { H3Event } from 'h3';

const MAX_CAPABILITY_RESPONSE_BYTES = 4 * 1024 * 1024;

const DRUPAL_CAPABILITY_ERRORS: Readonly<Record<string, { status: number, code: string }>> = {
    'form_setup.form_not_found': { status: 404, code: 'errors.schema.notFound' },
    'form_setup.access_denied': { status: 403, code: 'errors.admin.accessDenied' }
};
const HTTP_CAPABILITY_ERRORS: Readonly<Partial<Record<number, string>>> = {
    401: 'errors.auth.notAuthenticated',
    403: 'errors.admin.accessDenied',
    404: 'errors.schema.notFound'
};

function capabilityError(status = 502, payload: unknown = null): Error {
    const upstreamCode = (payload as { error?: { code?: unknown } } | null)?.error?.code;
    const mapped = typeof upstreamCode === 'string' && Object.hasOwn(DRUPAL_CAPABILITY_ERRORS, upstreamCode)
        ? DRUPAL_CAPABILITY_ERRORS[upstreamCode]
        : undefined;
    const httpCode = HTTP_CAPABILITY_ERRORS[status];
    const error = mapped ?? { status: httpCode ? status : 502, code: httpCode ?? 'errors.schemaSetup.loadFailed' };
    return createSafeError({
        statusCode: error.status,
        message: error.code,
        data: { code: error.code, ...(mapped ? { upstreamCode } : {}) }
    });
}

interface DrupalSetupCapabilities {
    canEdit: boolean
    canPublish: boolean
}

function parseSetupCapabilities(value: unknown): DrupalSetupCapabilities | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const { canEdit, canPublish } = value as Partial<DrupalSetupCapabilities>;
    if (Object.keys(value).length !== 2 || !Object.hasOwn(value, 'canEdit') || !Object.hasOwn(value, 'canPublish')
      || typeof canEdit !== 'boolean' || typeof canPublish !== 'boolean') return null;
    return { canEdit, canPublish };
}

/** The internal Drupal capability GET runs as the person, on an already scoped form. */
export async function fetchSetupCapabilities(event: H3Event, formId: string): Promise<DrupalSetupCapabilities> {
    const path = `/api/admin/form-setup/forms/${encodeURIComponent(formId)}/capabilities`;
    const headers = buildDrupalRequestHeaders(event, { accept: 'application/json', cookieHeader: getHeader(event, 'cookie') || '' });
    let response: Awaited<ReturnType<typeof drupalSessionRequest>>;
    let payload: unknown;
    try {
        response = await drupalSessionRequest(event, path, { method: 'GET', headers, maxResponseBytes: MAX_CAPABILITY_RESPONSE_BYTES });
        const text = await response.text();
        try {
            payload = JSON.parse(text);
        } catch {
            payload = null;
        }
    } catch {
        throw capabilityError();
    }
    if (!response.ok) throw capabilityError(response.status, payload);

    const capabilities = parseSetupCapabilities(payload);
    if (!capabilities) throw capabilityError();
    return capabilities;
}
