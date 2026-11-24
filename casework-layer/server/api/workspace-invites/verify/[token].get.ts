import { setPrivateNoStore } from '~~/server/utils/request-security';
import {
    assertWorkspaceInviteToken,
    proxyWorkspaceInviteRequest
} from '../../../utils/workspace-invites';

/**
 * GET /api/workspace-invites/verify/:token
 *
 * Public same-origin proxy for token-based workspace invite inspection.
 */
export default defineEventHandler(async (event) => {
    setPrivateNoStore(event);
    const ip = getClientIp(event);
    checkRateLimit(ip, 'workspace_invite_verify', event);

    const token = assertWorkspaceInviteToken(getRouterParam(event, 'token'));

    try {
        return await proxyWorkspaceInviteRequest(token, 'verify', undefined, event);
    } catch (e: unknown) {
        if (e && typeof e === 'object' && 'statusCode' in e) {
            throw e;
        }

        console.error('[workspace-invites/verify] Proxy error:', e instanceof Error ? e.message : e);
        throw createSafeError({
            statusCode: 502,
            message: 'workspace_invite.upstream_error',
            data: { code: 'workspace_invite.upstream_error' }
        });
    }
});
