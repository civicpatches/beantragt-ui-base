import { requireSameOriginRequest, setPrivateNoStore } from '../../utils/request-security';
import { scopeChallengeCookie } from '../../utils/citizen-session';
import { serverUiMode } from '../../utils/ui-mode';
import { drupalSessionCookieHeader } from '../../utils/session';
import {
    normalizePublicWorkspaceSlug,
    resolvePublicWorkspaceBySlugs
} from '../../utils/public-workspace';
import { randomBytes } from 'node:crypto';

const DEFAULT_CODE_LENGTH = 6;

function normalizeCodeLength(value: unknown): number {
    const length = Number(value ?? DEFAULT_CODE_LENGTH);
    if (!Number.isInteger(length)) return DEFAULT_CODE_LENGTH;
    return Math.max(4, Math.min(9, length));
}

function maskedChallengeId(): string {
    return randomBytes(32).toString('hex');
}

/**
 * POST /api/auth/request-code
 *
 * Proxies code request to Drupal passwordless auth module.
 * Accepts { email } and triggers a login code email.
 */
export default defineEventHandler(async (event) => {
    requireSameOriginRequest(event);
    setPrivateNoStore(event);

    // Rate limiting: prevent brute-force email enumeration
    const ip = getRequestClientIp(event);
    checkRateLimit(ip, 'auth_request', event);

    const body = await readBody<{ email: string, jurisdiction?: unknown, langcode?: unknown }>(event);

    if (!body.email || typeof body.email !== 'string') {
        throw createError({
            statusCode: 400,
            message: 'errors.auth.emailMissing',
            data: { code: 'errors.auth.emailMissing' }
        });
    }

    // Basic email format check
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(body.email)) {
        throw createError({
            statusCode: 400,
            message: 'errors.auth.emailInvalid',
            data: { code: 'errors.auth.emailInvalid' }
        });
    }

    const requestedJurisdiction = normalizePublicWorkspaceSlug(body.jurisdiction);
    let jurisdiction: string | undefined;
    if (requestedJurisdiction) {
        try {
            const workspace = await resolvePublicWorkspaceBySlugs(requestedJurisdiction, null);
            if (workspace?.type === 'jurisdiction') jurisdiction = requestedJurisdiction;
        } catch {
            // Authentication stays available with platform branding when the
            // public workspace lookup is temporarily unavailable.
        }
    }
    const langcode = body.langcode === 'de' || body.langcode === 'en'
        ? body.langcode
        : undefined;

    try {
        const serviceAuthHeader = getOptionalServiceAuthHeader();
        const headers = buildDrupalRequestHeaders(event, {
            accept: 'application/json',
            contentType: 'application/json',
            cookieHeader: drupalSessionCookieHeader(getHeader(event, 'cookie') || '')
        });
        if (serviceAuthHeader) {
            headers['X-Beantragt-Service-Authorization'] = serviceAuthHeader;
        }

        const response = await drupalSessionRequest(event, '/auth/request-code', {
            method: 'POST',
            headers,
            body: JSON.stringify({
                email: body.email,
                ...(jurisdiction ? { jurisdiction } : {}),
                ...(langcode ? { langcode } : {})
            })
        });
        const data = await response.json() as { success?: boolean, codeLength?: number, challengeId?: string | null };

        if (!response.ok) {
            throw createError({
                statusCode: response.status,
                message: 'errors.auth.codeRequestFailed',
                data: { code: 'errors.auth.codeRequestFailed' }
            });
        }

        if (!data.challengeId) {
            throw createError({
                statusCode: 502,
                message: 'errors.auth.challengeMissing',
                data: { code: 'errors.auth.challengeMissing' }
            });
        }

        for (const cookie of response.setCookieHeaders) {
            appendResponseHeader(event, 'Set-Cookie', serverUiMode() === 'citizen' ? scopeChallengeCookie(cookie) : cookie);
        }

        return {
            ...data,
            challengeId: data.challengeId,
            codeLength: normalizeCodeLength(data.codeLength)
        };
    } catch (e: unknown) {
        if ((e as { data?: { code?: unknown } })?.data?.code === 'errors.auth.challengeMissing') {
            throw e;
        }
        console.error('[auth/request-code] Proxy error:', e instanceof Error ? e.message : e);

        // Keep the login-start response shape masked. Verification with this
        // local challenge still fails because Drupal has no matching session.
        return { success: true, codeLength: DEFAULT_CODE_LENGTH, challengeId: maskedChallengeId() };
    }
});
