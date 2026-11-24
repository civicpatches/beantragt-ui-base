import { resolveRequiredAdminWorkspace } from '~~/casework-layer/server/utils/admin-workspace';
import { fetchStaffApplicationCounts } from '~~/casework-layer/server/utils/staff-applications';

/**
 * GET /api/admin/schema-group-counts
 *
 * Returns per schema in how many visible form schema groups (flows) of the
 * active workspace it is used, from the same Drupal aggregate as the
 * application counts. Requires admin authentication.
 */
export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    setPrivateNoStore(event);

    try {
        const workspace = await resolveRequiredAdminWorkspace(event);
        const counts = await fetchStaffApplicationCounts(event, workspace);

        return { counts: counts.formGroupsByForm };
    } catch (e: unknown) {
        console.error('[admin] Failed to count form schema groups:', e instanceof Error ? e.message : e);
        throw createSafeError({
            statusCode: 502,
            message: 'errors.admin.schemaGroupCountsLoadFailed',
            data: { code: 'errors.admin.schemaGroupCountsLoadFailed' }
        });
    }
});
