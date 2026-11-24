/**
 * Auth middleware for protected routes.
 *
 * Checks authentication status and redirects to login if needed.
 * Apply to routes via definePageMeta({ middleware: 'auth' }).
 */
import {
    publicLoginPath,
    publicWorkspaceFromRoute
} from '~/utils/public-form-path';

export default defineNuxtRouteMiddleware(async (to) => {
    const { authenticated, checkStatus } = useAuth();

    // On first load, check auth status with the server
    if (!authenticated.value) {
        await checkStatus();
    }

    // If still not authenticated, redirect to login
    if (!authenticated.value) {
        return navigateTo({
            path: publicLoginPath(publicWorkspaceFromRoute(to)),
            query: {
                redirect: to.fullPath
            }
        });
    }
});
