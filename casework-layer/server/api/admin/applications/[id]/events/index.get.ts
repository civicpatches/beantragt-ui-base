import { fetchStaffApplicationDetail } from '../../../../../utils/staff-applications';
import { DATA_EDIT_HISTORY_CURSOR_INVALID } from '~~/casework-layer/app/utils/application-data-corrections';

function invalidCursor() {
    return createSafeError({ statusCode: 400, message: DATA_EDIT_HISTORY_CURSOR_INVALID, data: { code: DATA_EDIT_HISTORY_CURSOR_INVALID } });
}

/** The default request reads event counts. Correction history requires an explicit opt-in. */
export default defineEventHandler(async (event) => {
    await requireStaff(event);
    setPrivateNoStore(event);
    const id = getRouterParam(event, 'id');
    if (!id) throw createSafeError({ statusCode: 400, message: 'errors.applications.idMissing' });
    validateUuid(id, 'applicationId');
    const workspace = await resolveRequiredAdminWorkspace(event);
    const query = getQuery(event);
    const includeCorrections = query.includeDataCorrections === '1';
    const before = query.dataCorrectionsBefore;
    if (includeCorrections && before !== undefined && typeof before !== 'string') throw invalidCursor();
    try {
        const { events, corrections } = await fetchStaffApplicationDetail(event, workspace, id, {
            eventsOnly: true,
            ...(includeCorrections && { dataCorrections: { before: typeof before === 'string' ? before : undefined } })
        });
        return { meta: { events, ...corrections } };
    } catch (error: unknown) {
        const failure = error as { statusCode?: number, data?: { upstreamCode?: unknown } } | undefined;
        if (includeCorrections && failure?.statusCode === 400 && failure.data?.upstreamCode === DATA_EDIT_HISTORY_CURSOR_INVALID) {
            throw invalidCursor();
        }
        throw error;
    }
});
