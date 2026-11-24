import {
    publicLoginPath,
    publicWorkspaceFromRoute,
    type PublicFormPathInput
} from '~/utils/public-form-path';
import { useGlobalMaintenance } from '~/composables/useGlobalMaintenance';
import { registerUnauthorizedApiErrorHandler } from '~/composables/api/useErrorHandler';

export interface StaffSessionRoute {
    path?: string
    fullPath?: string
    params?: Record<string, unknown>
}

export interface StaffSessionLoginTarget {
    path: string
    query: {
        redirect: string
        session_expired?: '1'
    }
}

type StaffFetchRequest = Parameters<typeof $fetch>[0];
type StaffFetchOptions = Parameters<typeof $fetch>[1];

let redirectPromise: Promise<unknown> | null = null;

function statusFromError(error: unknown): number | null {
    const candidate = (error ?? {}) as {
        statusCode?: unknown
        status?: unknown
        response?: { status?: unknown }
        data?: { statusCode?: unknown }
    };
    const status = candidate.statusCode
      ?? candidate.status
      ?? candidate.response?.status
      ?? candidate.data?.statusCode;
    return typeof status === 'number' ? status : null;
}

function cleanRoutePath(route: StaffSessionRoute): string {
    return (route.path || route.fullPath || '/').split('?')[0] || '/';
}

function routeParam(value: unknown): string | null {
    const candidate = Array.isArray(value) ? value[0] : value;
    return typeof candidate === 'string' ? candidate : null;
}

export function isStaffSessionRoute(route: StaffSessionRoute): boolean {
    const segments = cleanRoutePath(route).split('/').filter(Boolean);
    const workspace = routeParam(route.params?.workspace);
    const organisation = routeParam(route.params?.organisation);
    const staffIndex = organisation ? 2 : workspace ? 1 : 0;
    if (workspace && segments[0] !== workspace) return false;
    if (organisation && segments[1] !== organisation) return false;
    return segments[staffIndex] === 'admin' || segments[staffIndex] === 'dashboard';
}

function inferredWorkspace(route: StaffSessionRoute): PublicFormPathInput {
    const fromParams = publicWorkspaceFromRoute(route);
    if (fromParams.jurisdictionSlug) return fromParams;

    const segments = cleanRoutePath(route).split('/').filter(Boolean);
    const staffIndex = segments.findIndex(segment => segment === 'admin' || segment === 'dashboard');
    if (staffIndex <= 0) return fromParams;
    return {
        jurisdictionSlug: segments[0] ?? null,
        organisationSlug: staffIndex === 2 ? segments[1] ?? null : null
    };
}

export function staffSessionLoginTarget(route: StaffSessionRoute): StaffSessionLoginTarget {
    return {
        path: publicLoginPath(inferredWorkspace(route)),
        query: {
            redirect: route.fullPath || route.path || '/'
        }
    };
}

export function expiredStaffSessionLoginTarget(route: StaffSessionRoute): StaffSessionLoginTarget {
    const target = staffSessionLoginTarget(route);
    return {
        ...target,
        query: {
            ...target.query,
            session_expired: '1'
        }
    };
}

export function staffSessionRedirectTarget(
    error: unknown,
    route: StaffSessionRoute
): StaffSessionLoginTarget | null {
    if (statusFromError(error) !== 401 || !isStaffSessionRoute(route)) return null;
    return expiredStaffSessionLoginTarget(route);
}

export async function redirectStaffSessionOnUnauthorized(
    error: unknown,
    route?: StaffSessionRoute
): Promise<boolean> {
    if (statusFromError(error) !== 401) return false;
    const target = staffSessionRedirectTarget(error, route ?? useRoute());
    if (!target) return false;
    useAuth().expireSession();
    if (!redirectPromise) {
        redirectPromise = Promise.resolve(navigateTo(target, { replace: true }));
    }
    try {
        await redirectPromise;
    } finally {
        redirectPromise = null;
    }
    return true;
}

export function installStaffSessionErrorHandler(): void {
    registerUnauthorizedApiErrorHandler((error, route) => {
        if (!staffSessionRedirectTarget(error, route)) return false;
        void redirectStaffSessionOnUnauthorized(error, route).catch(() => {});
        return true;
    });
}

export async function staffFetch<T>(
    request: StaffFetchRequest,
    options?: StaffFetchOptions
): Promise<T> {
    try {
        return options === undefined
            ? await $fetch<T>(request)
            : await $fetch<T>(request, options);
    } catch (error: unknown) {
        const unauthorizedRedirected = await redirectStaffSessionOnUnauthorized(error);
        if (!unauthorizedRedirected) {
            await useGlobalMaintenance().handleRequestError(error);
        }
        throw error;
    }
}
