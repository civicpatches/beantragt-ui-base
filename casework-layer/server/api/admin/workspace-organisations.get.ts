/**
 * GET /api/admin/workspace-organisations
 *
 * Lists organisation workspaces below the selected jurisdiction.
 */
import { createSafeError } from '~~/server/utils/error-handling';
import { setPrivateNoStore } from '~~/server/utils/request-security';
import {
    safeErrorFromDrupal,
    validateWorkspaceOrganisationsQuery
} from '~~/server/utils/jurisdiction-settings';

export default defineEventHandler(async (event) => {
    setPrivateNoStore(event);

    await requireAdmin(event);

    const ip = getClientIp(event);
    checkRateLimit(ip, 'admin', event);

    const params = validateWorkspaceOrganisationsQuery(getQuery(event));

    try {
        const cookieHeader = getHeader(event, 'cookie') || '';
        const response = await drupalSessionRequest(
            event,
            `/api/admin/workspace-organisations?${params.toString()}`,
            {
                headers: buildDrupalRequestHeaders(event, { accept: 'application/json', cookieHeader })
            }
        );

        if (!response.ok) {
            const errorBody = await response.text().catch(() => '');
            console.error(`[workspace-organisations] GET failed (${response.status})`);
            throw safeErrorFromDrupal(
                response.status,
                errorBody,
                'errors.admin.workspaceOrganisationsLoadFailed'
            );
        }

        return await response.json<{
            jurisdiction: Record<string, unknown>
            organisations: Record<string, unknown>[]
            count: number
        }>();
    } catch (e: unknown) {
        if (e && typeof e === 'object' && 'statusCode' in e) {
            throw e;
        }

        console.error(
            '[workspace-organisations] Failed to load organisations:',
            e instanceof Error ? e.message : e
        );
        throw createSafeError({
            statusCode: 500,
            message: 'errors.admin.workspaceOrganisationsLoadFailed',
            data: { code: 'errors.admin.workspaceOrganisationsLoadFailed' }
        });
    }
});
