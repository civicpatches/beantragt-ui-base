import { buildDrupalRequestHeaders, drupalSessionRequest, fetchCsrfToken, requireAdmin } from '~~/server/utils/auth';
import { createSafeError } from '~~/server/utils/error-handling';
import { requireSameOriginRequest, setPrivateNoStore } from '~~/server/utils/request-security';

function isGroupId(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

// Nuxt-internal proxy. Drupal authorizes the workspace inviter and the target
// scope, validates the invitation and sends the claim link to the invitee.
export default defineEventHandler(async (event) => {
    requireSameOriginRequest(event);
    setPrivateNoStore(event);
    await requireAdmin(event);
    checkRateLimit(getClientIp(event), 'workspace_invite_issue', event);

    const body = await readBody<{ email?: unknown, target_parent_id?: unknown, group_id?: unknown }>(event);
    const email = typeof body?.email === 'string' ? body.email.trim() : '';
    const parent = body?.target_parent_id;
    const group = body?.group_id;
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)
      || !isGroupId(parent) || (group !== undefined && !isGroupId(group))) {
        throw createSafeError({ statusCode: 400, message: 'workspace_invite.invalid_request' });
    }

    const cookieHeader = getHeader(event, 'cookie') || '';
    const headers = buildDrupalRequestHeaders(event, {
        accept: 'application/json',
        contentType: 'application/json',
        cookieHeader
    });
    headers['X-CSRF-Token'] = await fetchCsrfToken(cookieHeader, event);
    const response = await drupalSessionRequest(event, '/api/workspace-invites', {
        method: 'POST',
        headers,
        body: JSON.stringify({
            email,
            target_parent_id: parent,
            group_id: group ?? parent,
            purpose: 'member_invite',
            roles: [group === undefined ? 'jur-member' : 'org-member']
        })
    });

    if (!response.ok) {
        throw createSafeError({ statusCode: response.status, message: 'workspace_invite.issue_failed' });
    }

    const result = await response.json<{ invite?: { id?: unknown }, mail_sent?: unknown }>().catch(() => null);
    if (typeof result?.invite?.id !== 'number' || typeof result.mail_sent !== 'boolean') {
        throw createSafeError({ statusCode: 502, message: 'workspace_invite.invalid_response' });
    }

    setResponseStatus(event, 202);
    return { status: 'invited', invite: { id: result.invite.id }, mail_sent: result.mail_sent };
});
