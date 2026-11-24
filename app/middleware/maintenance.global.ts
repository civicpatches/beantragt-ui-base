import { isMaintenanceRoute, maintenanceRouteTarget } from '~/utils/global-maintenance';

/** Runs before a page is entered, including the initial SPA bootstrap route. */
export default defineNuxtRouteMiddleware(async (to) => {
    // A refused account needs the login page to end its session, including
    // when the last known maintenance status is still active.
    if (useRuntimeConfig().public.uiMode === 'citizen' && useAuth().notAllowedOnHost.value) return;
    const maintenance = useGlobalMaintenance();
    const status = await maintenance.fetchStatus();

    if (status?.maintenance === true) {
        if (isMaintenanceRoute(to.path)) return;
        return navigateTo(maintenanceRouteTarget(to.fullPath), { replace: true });
    }

    if (status?.maintenance === false && isMaintenanceRoute(to.path)) {
        return navigateTo(maintenance.returnPath(to.query.returnTo), { replace: true });
    }
});
