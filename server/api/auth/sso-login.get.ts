import { safeExternalAuthReturnPath } from '~/utils/public-form-path';
import { appBasePath } from '#shared/app-base-path';
import { setPrivateNoStore } from '../../utils/request-security';
import { rejectSsoRequest, SSO_PROVIDER_ID } from '../../utils/sso-routing';
import { ssoPublicUiUrl } from '../../utils/sso-runtime';

/**
 * GET /api/auth/sso-login
 *
 * Starts SSO on the UI origin, where the ACS also receives the browser response.
 */
export default defineEventHandler((event) => {
    const config = useRuntimeConfig(event);
    const query = getQuery(event);
    const provider = typeof query.provider === 'string' && SSO_PROVIDER_ID.test(query.provider)
        ? query.provider
        : config.ssoBundidProvider;
    if (!SSO_PROVIDER_ID.test(provider)) return rejectSsoRequest(event, 503);

    const fallbackPath = '/meine-antraege';
    const rawReturnTo = typeof query.returnTo === 'string' ? query.returnTo : fallbackPath;
    const returnPath = safeExternalAuthReturnPath(rawReturnTo, fallbackPath);
    const base = config.app.baseURL;
    const returnTo = `${ssoPublicUiUrl(event)?.origin ?? ''}${appBasePath(base, returnPath)}`;
    const search = new URLSearchParams({ returnTo });

    setPrivateNoStore(event);
    return sendRedirect(event, `${appBasePath(base, `/auth/sso/${provider}/login`)}?${search}`, 302);
});
