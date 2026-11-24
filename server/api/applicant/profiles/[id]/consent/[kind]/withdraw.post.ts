/**
 * POST /api/applicant/profiles/:id/consent/:kind/withdraw
 *
 * Withdraws one consent (contact or bank) on one of the authenticated
 * citizen's own applicant profiles (one per Stelle). Identity comes
 * exclusively from the Drupal session; the body is ignored. Drupal answers
 * 404 for a profile of another account, clears the profile values the
 * consent covered and records the withdrawal; applications and their consent
 * records stay.
 */
import { createSafeError } from '../../../../../../utils/error-handling';
import { requireSameOriginRequest, setPrivateNoStore } from '../../../../../../utils/request-security';

const CONSENT_KINDS = ['contact', 'bank'] as const;
type ConsentKind = typeof CONSENT_KINDS[number];

function consentKind(value: unknown): ConsentKind {
    if (typeof value === 'string' && (CONSENT_KINDS as readonly string[]).includes(value)) {
        return value as ConsentKind;
    }
    throw createSafeError({
        statusCode: 404,
        message: 'errors.citizen.consentWithdrawFailed',
        data: { code: 'errors.citizen.consentWithdrawFailed' }
    });
}

/**
 * Accepts only a positive decimal profile id, so nothing else reaches the path.
 */
function profileId(value: unknown): string {
    if (typeof value === 'string' && /^[1-9]\d{0,9}$/.test(value)) {
        return value;
    }
    throw createSafeError({
        statusCode: 404,
        message: 'errors.citizen.consentWithdrawFailed',
        data: { code: 'errors.citizen.consentWithdrawFailed' }
    });
}

export default defineEventHandler(async (event) => {
    requireSameOriginRequest(event);
    setPrivateNoStore(event);
    requireAuth(event);
    const id = profileId(getRouterParam(event, 'id'));
    const kind = consentKind(getRouterParam(event, 'kind'));
    checkRateLimit(getClientIp(event), 'profile_update', event);

    try {
        const cookieHeader = getHeader(event, 'cookie') || '';
        const headers = buildDrupalRequestHeaders(event, {
            accept: 'application/json',
            contentType: 'application/json',
            cookieHeader
        });
        headers['X-CSRF-Token'] = await fetchCsrfToken(cookieHeader, event);

        const response = await drupalSessionRequest(event, `/api/citizen/applicant-profile/${id}/consent/${kind}/withdraw`, {
            method: 'POST',
            headers,
            body: '{}'
        });

        if (!response.ok) {
            const payload = await response.json().catch(() => null) as {
                error?: { code?: string }
            } | null;
            const code = payload?.error?.code || 'errors.citizen.consentWithdrawFailed';
            throw createSafeError({
                statusCode: response.status,
                message: code,
                data: { code }
            });
        }

        return { success: true, id: Number(id), kind };
    } catch (error: unknown) {
        if (error && typeof error === 'object' && 'statusCode' in error) {
            throw error;
        }

        console.error('[applicant/consent] Withdrawal failed:', error instanceof Error ? error.message : error);
        throw createSafeError({
            statusCode: 500,
            message: 'errors.citizen.consentWithdrawFailed',
            data: { code: 'errors.citizen.consentWithdrawFailed' }
        });
    }
});
