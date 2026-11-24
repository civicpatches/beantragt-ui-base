/**
 * POST /api/auth/verify-code
 *
 * Proxies code verification to Drupal passwordless auth module.
 * Accepts { email, code } and returns session cookie on success.
 */
import { requireSameOriginRequest, setPrivateNoStore } from '../../utils/request-security';
import { checkNewCitizenSession, clearChallengeCookies } from '../../utils/citizen-session';
import { serverUiMode } from '../../utils/ui-mode';
import { drupalSessionCookieHeader } from '../../utils/session';
import { withCitizenAccountName, type CitizenAuthResponse } from '../../utils/citizen-account-name';

export default defineEventHandler(async (event) => {
    requireSameOriginRequest(event);
    setPrivateNoStore(event);

    // Rate limiting: prevent OTP brute-force
    const ip = getRequestClientIp(event);
    checkRateLimit(ip, 'auth_verify', event);

    const body = await readBody<{ email: string, code: string, challengeId?: string | null }>(event);

    if (!body.email || !body.code || !body.challengeId) {
        throw createError({
            statusCode: 400,
            message: 'errors.auth.credentialsMissing',
            data: { code: 'errors.auth.credentialsMissing' }
        });
    }

    // Sanitize code. Drupal validates the configured OTP length.
    const code = body.code.replace(/\D/g, '').substring(0, 9);
    if (code.length < 4 || code.length > 9) {
        throw createError({
            statusCode: 400,
            message: 'errors.auth.codeFormatInvalid',
            data: { code: 'errors.auth.codeFormatInvalid' }
        });
    }

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

        // Use the session request helper to capture Set-Cookie headers from Drupal.
        const response = await drupalSessionRequest(event, '/auth/verify-code', {
            method: 'POST',
            headers,
            body: JSON.stringify({ email: body.email, code, challengeId: body.challengeId })
        });

        const data = await response.json<CitizenAuthResponse>();

        // Drupal consumed this challenge. Expire only the temporary, auth-path
        // cookie; the verified session uses the normal application path.
        if (serverUiMode() === 'citizen') clearChallengeCookies(event);
        if (!response.ok) {
            const upstreamCode = data && typeof data === 'object' && 'code' in data
                ? (data as { code?: unknown }).code
                : undefined;
            throw createError({
                statusCode: response.status,
                message: 'errors.auth.verificationFailed',
                data: {
                    code: 'errors.auth.verificationFailed',
                    upstreamCode: typeof upstreamCode === 'string' ? upstreamCode : undefined,
                    challengeConsumed: true
                }
            });
        }

        if (serverUiMode() === 'citizen') await checkNewCitizenSession(event, response.setCookieHeaders);

        // Forward Set-Cookie headers from Drupal to the client
        for (const cookie of response.setCookieHeaders) {
            appendResponseHeader(event, 'Set-Cookie', cookie);
        }

        const freshCookies = response.setCookieHeaders.map(cookie => cookie.split(';', 1)[0]).join('; ');
        return await withCitizenAccountName(event, data, freshCookies);
    } catch (e: unknown) {
        if (e && typeof e === 'object' && 'statusCode' in e) {
            throw e; // Re-throw createError errors
        }

        console.error('[auth/verify-code] Proxy error:', e instanceof Error ? e.message : e);

        throw createError({
            statusCode: 401,
            message: 'errors.auth.codeInvalidOrExpired',
            data: { code: 'errors.auth.codeInvalidOrExpired' }
        });
    }
});
