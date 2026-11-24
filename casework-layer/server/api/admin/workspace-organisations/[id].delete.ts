/**
 * DELETE /api/admin/workspace-organisations/:id
 *
 * Archives an organisation workspace below the selected jurisdiction.
 */
import { createSafeError } from '~~/server/utils/error-handling';
import { requireSameOriginRequest, setPrivateNoStore } from '~~/server/utils/request-security';
import {
    safeErrorFromDrupal,
    validateWorkspaceOrganisationIdentifier,
    validateWorkspaceOrganisationsQuery
} from '~~/server/utils/jurisdiction-settings';

export default defineEventHandler(async (event) => {
    requireSameOriginRequest(event);
    setPrivateNoStore(event);

    await requireAdmin(event);

    const ip = getClientIp(event);
    checkRateLimit(ip, 'admin', event);

    const organisationId = validateWorkspaceOrganisationIdentifier(getRouterParam(event, 'id'));
    const params = validateWorkspaceOrganisationsQuery(getQuery(event));

    try {
        const cookieHeader = getHeader(event, 'cookie') || '';
        const headers = buildDrupalRequestHeaders(event, {
            accept: 'application/json',
            cookieHeader
        });
        headers['X-CSRF-Token'] = await fetchCsrfToken(cookieHeader, event);

        const response = await drupalSessionRequest(
            event,
            `/api/admin/workspace-organisations/${organisationId}?${params.toString()}`,
            {
                method: 'DELETE',
                headers
            }
        );

        if (!response.ok) {
            const errorBody = await response.text().catch(() => '');
            console.error(`[workspace-organisations] DELETE failed (${response.status})`);
            throw safeErrorFromDrupal(
                response.status,
                errorBody,
                'errors.admin.workspaceOrganisationDeleteFailed'
            );
        }

        return await response.json<{
            organisation: Record<string, unknown>
            archived: boolean
        }>();
    } catch (e: unknown) {
        if (e && typeof e === 'object' && 'statusCode' in e) {
            throw e;
        }

        console.error(
            '[workspace-organisations] Failed to archive organisation:',
            e instanceof Error ? e.message : e
        );
        throw createSafeError({
            statusCode: 500,
            message: 'errors.admin.workspaceOrganisationDeleteFailed',
            data: { code: 'errors.admin.workspaceOrganisationDeleteFailed' }
        });
    }
});
