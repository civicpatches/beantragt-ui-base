/**
 * Which admin paths a staff role may open in the interface.
 *
 * The one place for the role part of the admin route middleware
 * (`middleware/admin.ts` calls `mayEnterAdminArea` and `roleMayOpenAdminPath`)
 * and for every link that leads into the admin area (header link
 * "Verwaltung"), so a link is shown exactly when the middleware lets the role
 * through. Workspace membership is a separate, later step of the middleware.
 * The server stays the authority; this only mirrors the route gate.
 *
 * Case-insensitive like the router (vue-router matches paths without regard to
 * case), so `/admin/bulk/Betrieb` is refused like `/admin/bulk/betrieb`.
 */
import { ADMIN_ENTRY_PATH } from '~/utils/public-form-path';
import { staffPathRules, type StaffPathRule } from './staff-extensions';

/**
 * The application list and everything below it is open to every staff role (case workers included).
 * The forms list uses the default admin-only gate.
 * Pro adds the assistant, batch processing and the admin-only batch operations (`pro-staff-extensions.ts`).
 */
export const CASEWORK_STAFF_PATH_RULES: readonly StaffPathRule[] = [
    { pattern: /^\/admin\/applications(?:\/|$)/iu }
];

/** The application list: entry of the admin area for every staff role (defined with the public paths). */
export { ADMIN_ENTRY_PATH };

export interface AdminRoleAccess {
    isStaff: boolean
    isAdmin: boolean
}

/**
 * True for an admin path (without workspace prefix) that non-admin staff may open: a registered rule opens it and
 * no admin-only rule takes it back.
 */
export function isStaffAdminPath(adminPath: string): boolean {
    const rules = staffPathRules();
    return rules.some(rule => !rule.adminOnly && rule.pattern.test(adminPath))
      && !rules.some(rule => rule.adminOnly && rule.pattern.test(adminPath));
}

/** May the role enter the admin area at all? Citizens may not. */
export function mayEnterAdminArea(access: AdminRoleAccess): boolean {
    return access.isStaff;
}

/** The role part of the middleware: may this role open the admin path? */
export function roleMayOpenAdminPath(adminPath: string, access: AdminRoleAccess): boolean {
    if (!mayEnterAdminArea(access)) return false;
    return access.isAdmin || isStaffAdminPath(adminPath);
}
