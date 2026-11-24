import { publicLoginPath, publicWorkspaceFromRoute } from '~/utils/public-form-path';

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
    if (auth.notAllowedOnHost.value && to.path !== login) return navigateTo(login, { replace: true });
});
