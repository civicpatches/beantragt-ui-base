/**
 * PATCH /api/admin/workspace-settings
 *
 * Persists editable workspace identity metadata to Drupal. Requires admin
 * auth, same-origin, and a session CSRF token.
 */
import { createSafeError } from '~~/server/utils/error-handling';
import { requireSameOriginRequest, setPrivateNoStore } from '~~/server/utils/request-security';
import {
    extractSettingsData,
    safeErrorFromDrupal,
    validateWorkspaceSettingsQuery
} from '~~/server/utils/jurisdiction-settings';

export default defineEventHandler(async (event) => {
    requireSameOriginRequest(event);
    setPrivateNoStore(event);

    await requireAdmin(event);

    const ip = getClientIp(event);
    checkRateLimit(ip, 'admin', event);

    const params = validateWorkspaceSettingsQuery(getQuery(event));
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
            `/api/admin/workspace-settings?${params.toString()}`,
            {
                method: 'PATCH',
                headers,
                body: JSON.stringify({ data })
            }
        );

        if (!response.ok) {
            const errorBody = await response.text().catch(() => '');
            console.error(`[workspace-settings] PATCH failed (${response.status})`);
            throw safeErrorFromDrupal(
                response.status,
                errorBody,
                'errors.admin.workspaceSettingsSaveFailed'
            );
        }

        return await response.json<{ workspace: Record<string, unknown> }>();
    } catch (e: unknown) {
        if (e && typeof e === 'object' && 'statusCode' in e) {
            throw e;
        }

        console.error(
            '[workspace-settings] Failed to save workspace settings:',
            e instanceof Error ? e.message : e
        );
        throw createSafeError({
            statusCode: 500,
            message: 'errors.admin.workspaceSettingsSaveFailed',
            data: { code: 'errors.admin.workspaceSettingsSaveFailed' }
        });
    }
});
