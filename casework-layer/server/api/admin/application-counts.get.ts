import { resolveRequiredAdminWorkspace } from '~~/casework-layer/server/utils/admin-workspace';
import { fetchStaffApplicationCounts } from '../../utils/staff-applications';

/**
 * GET /api/admin/application-counts
 *
 * Returns application counts per schema in a single request. Drupal
 * aggregates them under the staff list's visibility rules for the active
 * workspace, with the current Drupal session as the permission source.
 * Requires admin authentication.
 */
export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    setPrivateNoStore(event);

    try {
        const workspace = await resolveRequiredAdminWorkspace(event);
        const counts = await fetchStaffApplicationCounts(event, workspace);

        return { counts: counts.applicationsByForm };
    } catch (e: unknown) {
        console.error('[admin] Failed to count applications:', e instanceof Error ? e.message : e);
        throw createSafeError({
            statusCode: 502,
            message: 'errors.admin.applicationCountsLoadFailed',
            data: { code: 'errors.admin.applicationCountsLoadFailed' }
        });
    }
});
