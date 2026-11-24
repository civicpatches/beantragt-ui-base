/**
 * GET /api/admin/jurisdictions
 *
 * Lists jurisdiction and organisation workspaces visible to the current staff user.
 */
import type { AdminWorkspacesResponse } from '../../utils/admin-workspace';

export default defineEventHandler(async (event) => {
    await requireStaff(event);
    setPrivateNoStore(event);

    return await drupalSessionFetch<AdminWorkspacesResponse>(event, '/api/admin/workspaces');
});
