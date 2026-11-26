import { publicLoginPath, publicWorkspaceFromRoute } from '~/utils/public-form-path';
import { isSsoErrorCode } from '~/utils/sso-error';

import { canonicalUiPath, uiPageDocument } from '#shared/ui-path';

export default defineNuxtRouteMiddleware(async (to) => {
    if (useRuntimeConfig().public.uiMode !== 'citizen') return;
    const canonical = uiPageDocument(canonicalUiPath(to.path));
    const normalized = canonical === to.path ? to : useRouter().resolve({ path: canonical });
    if (to.meta.uiAccess === 'closed' || normalized.meta.uiAccess === 'closed' || to.redirectedFrom?.meta.uiAccess === 'closed') {
        throw createError({ statusCode: 404, statusMessage: 'Page not found', fatal: true });
    }
    const auth = useAuth();
    await auth.ensureStatus();
    const login = publicLoginPath(publicWorkspaceFromRoute(to));
    if (auth.notAllowedOnHost.value && to.path !== login) {
        const ssoError = to.query.sso_error;
        const target = isSsoErrorCode(ssoError) ? { path: login, query: { sso_error: ssoError } } : login;
        return navigateTo(target, { replace: true });
    }
});
