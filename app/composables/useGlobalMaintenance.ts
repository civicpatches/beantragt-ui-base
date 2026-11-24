import {
    isMaintenanceRoute,
    maintenanceRouteTarget,
    normalizeGlobalMaintenanceStatus,
    requestErrorStatus,
    validInternalReturnPath,
    type GlobalMaintenanceStatus
} from '~/utils/global-maintenance';

let maintenanceRedirectPromise: Promise<unknown> | null = null;

export const useGlobalMaintenance = () => {
    const status = useState<GlobalMaintenanceStatus | null>('global-maintenance-status', () => null);
    const statusResolved = useState<boolean>('global-maintenance-status-resolved', () => false);
    const checkGeneration = useState<number>('global-maintenance-check-generation', () => 0);
    const appliedCheckGeneration = useState<number>('global-maintenance-applied-check-generation', () => 0);
    const pendingChecks = useState<number>('global-maintenance-pending-checks', () => 0);
    const lastCheckFailed = useState<boolean>('global-maintenance-last-check-failed', () => false);

    const isActive = computed(() => status.value?.maintenance === true);
    const hasKnownStatus = computed(() => status.value !== null);
    const checking = computed(() => pendingChecks.value > 0);

    async function fetchStatus(): Promise<GlobalMaintenanceStatus | null> {
        const generation = ++checkGeneration.value;
        pendingChecks.value++;

        try {
            const response = await $fetch<unknown>('/api/platform/maintenance', {
                cache: 'no-store',
                headers: { Accept: 'application/json' },
                timeout: 5_000
            });
            const nextStatus = normalizeGlobalMaintenanceStatus(response);
            if (!nextStatus) throw new Error('Invalid maintenance status response');

            // A failed newer request has not observed a state and must not
            // suppress the only valid response. A newer valid response does.
            if (generation > appliedCheckGeneration.value) {
                status.value = nextStatus;
                appliedCheckGeneration.value = generation;
                statusResolved.value = true;
                lastCheckFailed.value = false;
            }
        } catch (error: unknown) {
            if (generation === checkGeneration.value) {
                // Fail open only before a valid state has ever been observed.
                // A later failed check retains a confirmed maintenance lock.
                statusResolved.value = true;
                lastCheckFailed.value = true;
                console.warn('[maintenance] Status request failed:', error);
            }
        } finally {
            pendingChecks.value = Math.max(0, pendingChecks.value - 1);
        }

        return status.value;
    }

    async function redirectToMaintenance(returnTo: unknown): Promise<boolean> {
        if (isMaintenanceRoute(useRoute().path)) return true;
        if (!maintenanceRedirectPromise) {
            maintenanceRedirectPromise = Promise.resolve(navigateTo(
                maintenanceRouteTarget(returnTo),
                { replace: true }
            ));
        }
        try {
            await maintenanceRedirectPromise;
        } finally {
            maintenanceRedirectPromise = null;
        }
        return true;
    }

    async function handleRequestError(error: unknown, returnTo?: unknown): Promise<boolean> {
        if (requestErrorStatus(error) !== 503) return false;
        const nextStatus = await fetchStatus();
        if (nextStatus?.maintenance !== true) return false;

        const route = useRoute();
        return redirectToMaintenance(returnTo ?? route.fullPath ?? route.path);
    }

    function returnPath(value: unknown): string {
        return validInternalReturnPath(value);
    }

    return {
        status: readonly(status),
        statusResolved: readonly(statusResolved),
        checking: readonly(checking),
        lastCheckFailed: readonly(lastCheckFailed),
        isActive,
        hasKnownStatus,
        fetchStatus,
        handleRequestError,
        redirectToMaintenance,
        returnPath
    };
};
