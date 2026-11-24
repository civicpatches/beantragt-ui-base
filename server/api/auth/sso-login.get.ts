import { safeExternalAuthReturnPath } from '~/utils/public-form-path';

/**
 * GET /api/auth/sso-login
 *
 * Starts an SSO login by redirecting the browser to Drupal. The browser must
 * visit Drupal directly so the ACS flow can establish the real Drupal session
 * cookie. Frontend never fakes authentication.
 */
export default defineEventHandler((event) => {
    const config = useRuntimeConfig();
    const query = getQuery(event);
    const provider = typeof query.provider === 'string' && /^[a-zA-Z0-9_-]+$/.test(query.provider)
        ? query.provider
        : config.ssoBundidProvider;

    const requestUrl = getRequestURL(event);
    const fallbackPath = '/meine-antraege';
    const rawReturnTo = typeof query.returnTo === 'string' ? query.returnTo : fallbackPath;
    const returnPath = safeExternalAuthReturnPath(rawReturnTo, fallbackPath);
    const returnTo = `${requestUrl.origin}${returnPath}`;

    const publicApiBase = typeof config.public.apiBase === 'string' ? config.public.apiBase : '';
    if (!publicApiBase) {
        throw createError({
            statusCode: 500,
            message: 'errors.server.configuration',
            data: { code: 'errors.server.configuration' }
        });
    }

    const target = new URL(`/auth/sso/${encodeURIComponent(provider)}/login`, publicApiBase);
    target.searchParams.set('returnTo', returnTo);

    return sendRedirect(event, target.toString(), 302);
});
