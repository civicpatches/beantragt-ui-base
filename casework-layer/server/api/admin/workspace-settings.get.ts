/**
 * GET /api/admin/workspace-settings
 *
 * Loads editable workspace identity metadata from Drupal. The selected
 * workspace is addressed by query: jurisdiction plus optional organisation.
 */
import { createSafeError } from '~~/server/utils/error-handling';
import { setPrivateNoStore } from '~~/server/utils/request-security';
import {
    safeErrorFromDrupal,
    validateWorkspaceSettingsQuery
} from '~~/server/utils/jurisdiction-settings';

export default defineEventHandler(async (event) => {
    setPrivateNoStore(event);

    await requireAdmin(event);

    const ip = getClientIp(event);
    checkRateLimit(ip, 'admin', event);

    const params = validateWorkspaceSettingsQuery(getQuery(event));

    try {
        const cookieHeader = getHeader(event, 'cookie') || '';
        const response = await drupalSessionRequest(
            event,
            `/api/admin/workspace-settings?${params.toString()}`,
            {
                headers: buildDrupalRequestHeaders(event, { accept: 'application/json', cookieHeader })
            }
        );

        if (!response.ok) {
            const errorBody = await response.text().catch(() => '');
            console.error(`[workspace-settings] GET failed (${response.status})`);
            throw safeErrorFromDrupal(
                response.status,
                errorBody,
                'errors.admin.workspaceSettingsLoadFailed'
            );
        }

        return await response.json<{ workspace: Record<string, unknown> }>();
    } catch (e: unknown) {
        if (e && typeof e === 'object' && 'statusCode' in e) {
            throw e;
        }

        console.error(
            '[workspace-settings] Failed to load workspace settings:',
            e instanceof Error ? e.message : e
        );
        throw createSafeError({
            statusCode: 500,
            message: 'errors.admin.workspaceSettingsLoadFailed',
            data: { code: 'errors.admin.workspaceSettingsLoadFailed' }
        });
    }
});
