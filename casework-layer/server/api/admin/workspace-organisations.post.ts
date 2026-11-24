/**
 * POST /api/admin/workspace-organisations
 *
 * Creates an organisation workspace below the selected jurisdiction.
 */
import { createSafeError } from '~~/server/utils/error-handling';
import { requireSameOriginRequest, setPrivateNoStore } from '~~/server/utils/request-security';
import {
    extractSettingsData,
    safeErrorFromDrupal,
    validateWorkspaceOrganisationsQuery
} from '~~/server/utils/jurisdiction-settings';

export default defineEventHandler(async (event) => {
    requireSameOriginRequest(event);
    setPrivateNoStore(event);

    await requireAdmin(event);

    const ip = getClientIp(event);
    checkRateLimit(ip, 'admin', event);

    const params = validateWorkspaceOrganisationsQuery(getQuery(event));
    const data = extractSettingsData(await readBody<unknown>(event));

    try {
        const cookieHeader = getHeader(event, 'cookie') || '';
        const headers = buildDrupalRequestHeaders(event, {
            accept: 'application/json',
            contentType: 'application/json',
            cookieHeader
        });
        headers['X-CSRF-Token'] = await fetchCsrfToken(cookieHeader, event);

        const response = await drupalSessionRequest(
            event,
            `/api/admin/workspace-organisations?${params.toString()}`,
            {
                method: 'POST',
                headers,
                body: JSON.stringify({ data })
            }
        );

        if (!response.ok) {
            const errorBody = await response.text().catch(() => '');
            console.error(`[workspace-organisations] POST failed (${response.status})`);
            throw safeErrorFromDrupal(
                response.status,
                errorBody,
                'errors.admin.workspaceOrganisationSaveFailed'
            );
        }

        return await response.json<{ organisation: Record<string, unknown> }>();
    } catch (e: unknown) {
        if (e && typeof e === 'object' && 'statusCode' in e) {
            throw e;
        }

        console.error(
            '[workspace-organisations] Failed to create organisation:',
            e instanceof Error ? e.message : e
        );
        throw createSafeError({
            statusCode: 500,
            message: 'errors.admin.workspaceOrganisationSaveFailed',
            data: { code: 'errors.admin.workspaceOrganisationSaveFailed' }
        });
    }
});
