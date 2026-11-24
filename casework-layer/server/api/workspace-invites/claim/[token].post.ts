import {
    assertWorkspaceInviteToken,
    proxyWorkspaceInviteRequest
} from '../../../utils/workspace-invites';
import { requireSameOriginRequest, setPrivateNoStore } from '~~/server/utils/request-security';

/**
 * POST /api/workspace-invites/claim/:token
 *
 * Same-origin proxy for accepting a workspace invite token. Claiming an
 * invite mutates group membership, so this route requires an authenticated
 * Drupal session and forwards a CSRF token. Drupal additionally enforces that
 * the session account email matches the invitee email.
 */
export default defineEventHandler(async (event) => {
    requireSameOriginRequest(event);
    setPrivateNoStore(event);

    const ip = getClientIp(event);
    checkRateLimit(ip, 'workspace_invite_claim', event);

    const token = assertWorkspaceInviteToken(getRouterParam(event, 'token'));

    // Reject anonymous callers before doing any upstream work.
    requireAuth(event);
    const cookieHeader = getHeader(event, 'cookie') || '';
    const csrfToken = await fetchCsrfToken(cookieHeader, event);

    try {
        return await proxyWorkspaceInviteRequest(token, 'claim', {
            cookie: cookieHeader,
            csrfToken
        }, event);
    } catch (e: unknown) {
        if (e && typeof e === 'object' && 'statusCode' in e) {
            throw e;
        }

        console.error('[workspace-invites/claim] Proxy error:', e instanceof Error ? e.message : e);
        throw createSafeError({
            statusCode: 502,
            message: 'workspace_invite.upstream_error',
            data: { code: 'workspace_invite.upstream_error' }
        });
    }
});
