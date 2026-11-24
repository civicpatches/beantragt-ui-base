import type { H3Event } from 'h3';

/**
 * Check for valid Drupal session cookie.
 * Drupal session cookies commonly start with SESS or SSESS. The suffix can
 * differ across Drupal, PHP and reverse-proxy setups, so this is only a
 * conservative precheck. Drupal remains the real session validator when the
 * forwarded cookie reaches the backend.
 *
 * A cookie is only considered valid when its value is non-empty and not the
 * literal string "deleted" (which browsers may store when a Set-Cookie with
 * Max-Age=0 / past Expires races against the next request).
 */
export const DRUPAL_SESSION_COOKIE_NAME_PATTERN = /^S?SESS[A-Za-z0-9_-]{4,128}$/;

export const isDrupalSessionCookie = (name: string, value: unknown): boolean =>
    DRUPAL_SESSION_COOKIE_NAME_PATTERN.test(name)
    && typeof value === 'string'
    && value.length > 0
    && value !== 'deleted';

export const drupalSessionCookieHeader = (cookieHeader: string): string =>
    cookieHeader
        .split(';')
        .map(value => value.trim())
        .filter((cookie) => {
            const separator = cookie.indexOf('=');
            if (separator <= 0) return false;
            return isDrupalSessionCookie(
                cookie.slice(0, separator),
                cookie.slice(separator + 1)
            );
        })
        .join('; ');

export const hasValidDrupalSession = (event: H3Event): boolean => {
    const cookieHeader = getHeader(event, 'cookie') || '';
    return drupalSessionCookieHeader(cookieHeader).length > 0;
};
