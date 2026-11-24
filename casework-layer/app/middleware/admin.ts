/**
 * Admin middleware for admin-only routes.
 *
 * Extends auth middleware by additionally checking for admin role.
 * Apply to routes via definePageMeta({ middleware: 'admin' }).
 */
import {
    publicApplicationsPath,
    publicWorkspaceFromRoute
} from '~/utils/public-form-path';
import {
    expiredStaffSessionLoginTarget,
    staffSessionLoginTarget
} from '~~/casework-layer/app/composables/api/useStaffSessionFetch';
import { adminNoticeUserKey, useAdminAccessNotice } from '~~/casework-layer/app/composables/useAdminAccessNotice';
import {
    ADMIN_ENTRY_PATH,
    mayEnterAdminArea,
    roleMayOpenAdminPath
} from '~~/casework-layer/app/utils/admin-access';
import type { LocationQueryRaw, LocationQueryValueRaw } from 'vue-router';

const WORKSPACE_QUERY_KEYS = new Set(['jurisdiction', 'organisation', 'organization', 'org']);
const WORKSPACE_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/;

function normalizeWorkspaceSlug(value: unknown): string | null {
    const raw = Array.isArray(value) ? value[0] : value;
    if (typeof raw !== 'string') return null;
    const slug = raw.trim().toLowerCase();
    return WORKSPACE_SLUG_PATTERN.test(slug) ? slug : null;
}

function adminPathFromRoutePath(path: string): string {
    const cleanPath = path.split('?')[0] || '/admin';
    if (cleanPath === '/admin' || cleanPath.startsWith('/admin/')) return cleanPath;
    const match = cleanPath.match(/^\/[a-z0-9-]+(?:\/(?!admin(?:\/|$))[a-z0-9-]+)?(\/admin(?:\/.*)?|$)/u);
    return match?.[1] || '/admin';
}

function workspaceKeyFromAdminRoutePath(path: string): string | null {
    const cleanPath = path.split('?')[0] || '/admin';
    if (cleanPath === '/admin' || cleanPath.startsWith('/admin/')) return null;
    const match = cleanPath.match(/^\/([a-z0-9-]+)(?:\/(?!admin(?:\/|$))([a-z0-9-]+))?(?:\/admin(?:\/.*)?|$)/u);
    if (!match) return null;
    const jurisdiction = normalizeWorkspaceSlug(match[1]);
    const organisation = normalizeWorkspaceSlug(match[2]);
    if (!jurisdiction) return null;
    return organisation ? `${jurisdiction}/${organisation}` : jurisdiction;
}

function workspaceKeyFromQuery(query: Record<string, unknown> | undefined): string | null {
    const jurisdiction = normalizeWorkspaceSlug(query?.jurisdiction);
    const organisation = normalizeWorkspaceSlug(query?.organisation ?? query?.organization ?? query?.org);
    if (!jurisdiction) return null;
    return organisation ? `${jurisdiction}/${organisation}` : jurisdiction;
}

function isRouteQueryValue(value: unknown): value is LocationQueryValueRaw {
    return typeof value === 'string'
      || typeof value === 'number'
      || value === null
      || value === undefined;
}

function passthroughQuery(query: Record<string, unknown> | undefined): LocationQueryRaw {
    const next: LocationQueryRaw = {};
    for (const [key, value] of Object.entries(query || {})) {
        if (WORKSPACE_QUERY_KEYS.has(key) || value === undefined) {
            continue;
        }
        if (Array.isArray(value)) {
            const values = value.filter(isRouteQueryValue);
            if (values.length > 0) {
                next[key] = values;
            }
            continue;
        }
        if (isRouteQueryValue(value)) {
            next[key] = value;
        }
    }
    return next;
}

/**
 * True when `ancestor` is a strict ancestor of `key`, segment by segment:
 * `musterstadt` is one of `musterstadt/buergerbuero`, `muster` is not.
 */
function isAncestorWorkspaceKey(ancestor: string, key: string): boolean {
    const ancestorSegments = ancestor.split('/');
    const keySegments = key.split('/');
    return ancestorSegments.length < keySegments.length
      && ancestorSegments.every((segment, index) => segment === keySegments[index]);
}

function samePath(pathA: string, pathB: string): boolean {
    return pathA.replace(/\/+$/u, '') === pathB.replace(/\/+$/u, '');
}

export default defineNuxtRouteMiddleware(async (to) => {
    const { authenticated, user, isAdmin, isStaff, checkStatus } = useAuth();
    const publicWorkspace = publicWorkspaceFromRoute(to);
    const routePath = to.path || to.fullPath;
    const adminPath = adminPathFromRoutePath(routePath);
    const wasAuthenticated = authenticated.value;

    // Re-check every admin navigation so a stale local session cannot enter
    // another staff route without consulting the HttpOnly server session.
    const authStatus = await checkStatus();
    if (authStatus === 'error') {
        throw createError({
            statusCode: 503,
            statusMessage: 'Authentication status unavailable'
        });
    }

    // If not authenticated, redirect to login
    if (!authenticated.value) {
        const target = wasAuthenticated
            ? expiredStaffSessionLoginTarget(to)
            : staffSessionLoginTarget(to);
        return wasAuthenticated
            ? navigateTo(target, { replace: true })
            : navigateTo(target);
    }

    // Citizens cannot enter the staff/admin shell.
    if (!mayEnterAdminArea({ isAdmin: isAdmin.value, isStaff: isStaff.value })) {
        return navigateTo(publicApplicationsPath(publicWorkspace));
    }

    const { workspaces, loadWorkspaces } = useWorkspaceContext();
    await loadWorkspaces({ throwOnError: true, syncRoute: false });

    if (workspaces.value.length === 0) {
        throw createError({
            statusCode: 403,
            statusMessage: 'Workspace access denied'
        });
    }

    const explicitWorkspaceKey = workspaceKeyFromAdminRoutePath(routePath) || workspaceKeyFromQuery(to.query);
    const explicitWorkspaceAllowed = explicitWorkspaceKey
        ? workspaces.value.some(workspace => workspace.key === explicitWorkspaceKey)
        : true;
    const fallbackWorkspace = workspaces.value[0] ?? null;
    const explicitWorkspace = explicitWorkspaceKey
        ? workspaces.value.find(workspace => workspace.key === explicitWorkspaceKey) ?? null
        : null;

    // The role decision lives in utils/admin-access.ts (one source with the header link).
    if (!roleMayOpenAdminPath(adminPath, { isAdmin: isAdmin.value, isStaff: isStaff.value })) {
        const targetWorkspace = explicitWorkspaceAllowed && explicitWorkspace ? explicitWorkspace : fallbackWorkspace;
        if (!targetWorkspace) {
            throw createError({
                statusCode: 403,
                statusMessage: 'Workspace access denied'
            });
        }

        const targetPath = `${targetWorkspace.path}${ADMIN_ENTRY_PATH}`;
        // The role is the reason here: the list says so. A foreign workspace
        // in the same address adds no second notice; this branch returns first.
        useAdminAccessNotice().recordRoleRedirect(targetPath, adminNoticeUserKey(user?.value));
        return navigateTo({
            path: targetPath,
            query: passthroughQuery(to.query)
        }, { replace: true });
    }

    if (!explicitWorkspaceAllowed || (!explicitWorkspaceKey && fallbackWorkspace)) {
        if (!fallbackWorkspace) {
            throw createError({
                statusCode: 403,
                statusMessage: 'Workspace access denied'
            });
        }

        const targetPath = `${fallbackWorkspace.path}${adminPath}`;
        if (samePath(targetPath, routePath.split('?')[0] || routePath)) {
            return;
        }

        // The address named a workspace that is not in the person's list: the
        // page they land on says so. Only the target is recorded, never the
        // requested key, so a foreign and a non-existing workspace look the same.
        // No notice for normal navigation: an address without a workspace, and an
        // ancestor of the workspace the person lands in (a jurisdiction narrowed to
        // the own organisation inside it). The ancestor test compares only with the
        // landing workspace, which the person may see anyway.
        if (
            explicitWorkspaceKey
            && !explicitWorkspaceAllowed
            && !isAncestorWorkspaceKey(explicitWorkspaceKey, fallbackWorkspace.key)
        ) {
            useAdminAccessNotice().recordWorkspaceRedirect(targetPath, adminNoticeUserKey(user?.value));
        }

        return navigateTo({
            path: targetPath,
            query: passthroughQuery(to.query)
        }, { replace: true });
    }
});
