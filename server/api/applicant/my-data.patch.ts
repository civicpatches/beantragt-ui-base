/**
 * PATCH /api/applicant/my-data
 *
 * Updates allowlisted basic fields on the authenticated citizen's own
 * applicant profile. Identity is derived exclusively from the Drupal session.
 */
import { createSafeError } from '../../utils/error-handling';
import { requireSameOriginRequest, setPrivateNoStore } from '../../utils/request-security';

const FIELD_LIMITS: Record<string, number> = {
    fullName: 255,
    phone: 50,
    address: 500,
    street: 255,
    postalCode: 20,
    city: 255
};

function normalizeUpdates(value: unknown): Record<string, string> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.citizen.profileSaveFailed',
            data: { code: 'errors.citizen.profileSaveFailed' }
        });
    }

    const updates: Record<string, string> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
        const max = FIELD_LIMITS[key];
        if (max === undefined || (typeof raw !== 'string' && raw !== null)) {
            throw createSafeError({
                statusCode: 400,
                message: 'errors.citizen.profileSaveFailed',
                data: { code: 'errors.citizen.profileSaveFailed' }
            });
        }

        const normalized = (raw ?? '').trim();
        if (normalized.length > max) {
            throw createSafeError({
                statusCode: 422,
                message: 'errors.citizen.profileSaveFailed',
                data: { code: 'errors.citizen.profileSaveFailed' }
            });
        }
        updates[key] = normalized;
    }

    if (!Object.keys(updates).length) {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.citizen.profileSaveFailed',
            data: { code: 'errors.citizen.profileSaveFailed' }
        });
    }

    return updates;
}

export default defineEventHandler(async (event) => {
    requireSameOriginRequest(event);
    setPrivateNoStore(event);
    requireAuth(event);
    checkRateLimit(getClientIp(event), 'profile_update', event);

    const body = await readBody<{ id?: unknown, data?: unknown }>(event);
    const data = normalizeUpdates(body?.data);
    const id = body?.id;
    if (id !== undefined && !(typeof id === 'number' && Number.isInteger(id) && id > 0)) {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.citizen.profileSaveFailed',
            data: { code: 'errors.citizen.profileSaveFailed' }
        });
    }

    try {
        const cookieHeader = getHeader(event, 'cookie') || '';
        const headers = buildDrupalRequestHeaders(event, {
            accept: 'application/json',
            contentType: 'application/json',
            cookieHeader
        });
        headers['X-CSRF-Token'] = await fetchCsrfToken(cookieHeader, event);

        const response = await drupalSessionRequest(event, '/api/citizen/applicant-profile', {
            method: 'PATCH',
            headers,
            body: JSON.stringify(id === undefined ? { data } : { id, data })
        });

        if (!response.ok) {
            const payload = await response.json().catch(() => null) as {
                error?: { code?: string }
            } | null;
            const code = payload?.error?.code || 'errors.citizen.profileSaveFailed';
            throw createSafeError({
                statusCode: response.status,
                message: code,
                data: { code }
            });
        }

        return await response.json();
    } catch (error: unknown) {
        if (error && typeof error === 'object' && 'statusCode' in error) {
            throw error;
        }

        console.error('[applicant/my-data] Profile save failed:', error instanceof Error ? error.message : error);
        throw createSafeError({
            statusCode: 500,
            message: 'errors.citizen.profileSaveFailed',
            data: { code: 'errors.citizen.profileSaveFailed' }
        });
    }
});
