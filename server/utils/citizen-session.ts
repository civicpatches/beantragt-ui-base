import type { H3Event } from 'h3';
import { STAFF_HOST_ERROR } from '../../shared/ui-mode';
import { buildDrupalRequestHeaders, drupalSessionRequest, fetchCsrfToken, getAuthenticatedUser, citizenAccountKind } from './auth';
import { setPrivateNoStore } from './request-security';
import { drupalSessionCookieHeader, DRUPAL_SESSION_COOKIE_NAME_PATTERN } from './session';

export function refuseCitizenSession(event: H3Event, challengeConsumed = false, code = STAFF_HOST_ERROR): never {
    setPrivateNoStore(event);
    throw createError({ statusCode: 403, message: code, data: { code, challengeConsumed } });
}

export async function requireCitizenSession(event: H3Event, freshCookie?: string, anonymousOtp = false) {
    let user;
    try {
        user = await getAuthenticatedUser(event, freshCookie, AbortSignal.timeout(5000));
    } catch {
        // Drupal binds the code to an anonymous session. Only a successful,
        // explicitly anonymous status response may proceed to the OTP handlers.
        if (anonymousOtp && event.context.drupalConfirmedAnonymous === true) return;
        return refuseCitizenSession(event, freshCookie !== undefined, 'errors.auth.statusUnavailable');
    }
    const kind = citizenAccountKind(user);
    if (kind === 'citizen') return user;
    return refuseCitizenSession(event, freshCookie !== undefined, kind === 'staff' ? STAFF_HOST_ERROR : 'errors.auth.statusUnavailable');
}

async function revokeNewSession(event: H3Event, cookieHeader: string) {
    const signal = AbortSignal.timeout(5000);
    const token = await fetchCsrfToken(cookieHeader, event, signal);
    const response = await drupalSessionRequest(event, '/auth/logout', {
        method: 'POST', signal,
        headers: { ...buildDrupalRequestHeaders(event, { cookieHeader }), 'X-CSRF-Token': token }
    });
    if (!response.ok) throw new Error('Upstream session revocation failed');
}

const OTP_COOKIE_PATH = '/api/auth/';

export function scopeChallengeCookie(cookie: string): string {
    const [pair, ...attributes] = cookie.split(';');
    if (!DRUPAL_SESSION_COOKIE_NAME_PATTERN.test(pair?.split('=')[0] ?? '')) return cookie;
    const retained = attributes.filter(attribute => !/^\s*(?:path|domain)=/iu.test(attribute));
    return [pair, ...retained, ' Path=' + OTP_COOKIE_PATH].join(';');
}

export function clearChallengeCookies(event: H3Event) {
    const cookies = drupalSessionCookieHeader(getHeader(event, 'cookie') || '');
    for (const pair of cookies.split('; ').filter(Boolean)) {
        deleteCookie(event, pair.split('=')[0]!, { path: OTP_COOKIE_PATH });
    }
}

export async function checkNewCitizenSession(event: H3Event, cookies: string[]) {
    const fresh = drupalSessionCookieHeader(cookies.map(cookie => cookie.split(';', 1)[0]).join('; '));
    if (!fresh) return refuseCitizenSession(event, true, 'errors.auth.statusUnavailable');
    try {
        await requireCitizenSession(event, fresh);
    } catch (error) {
        try {
            await revokeNewSession(event, fresh);
        } catch {
            try {
                await revokeNewSession(event, fresh);
            } catch {
                console.error('[auth] Upstream refused OTP session revocation after retry');
                return refuseCitizenSession(event, true, 'errors.auth.statusUnavailable');
            }
        }
        // Never publish a new credential, even when upstream revocation fails.
        throw error;
    }
}
