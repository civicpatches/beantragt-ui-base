import { createSafeError } from '~~/server/utils/error-handling';
import { buildDrupalRequestHeaders, drupalSessionRequest } from '~~/server/utils/auth';
import { normalizeWorkspaceSlug } from './admin-workspace';
import type { WorkspaceInviteResponse } from '~/types/api';
import type { H3Event } from 'h3';

export const WORKSPACE_INVITE_TOKEN_PATTERN = /^[a-f0-9]{64}$/;

type WorkspaceInviteAction = 'verify' | 'claim';
type WorkspaceInviteErrorCode
    = | 'workspace_invite.invalid_token'
      | 'workspace_invite.not_found'
      | 'workspace_invite.expired'
      | 'workspace_invite.auth_required'
      | 'workspace_invite.email_mismatch'
      | 'workspace_invite.already_claimed'
      | 'workspace_invite.rate_limited'
      | 'workspace_invite.upstream_error'
      | 'workspace_invite.invalid_response'
      | 'server.configuration_error';

/**
 * Authenticated request context for the claim action. The claim endpoint is
 * no longer anonymous: Drupal requires a logged-in session and a CSRF token.
 */
interface WorkspaceInviteAuth {
    cookie: string
    csrfToken: string
}

const ACTION_METHOD: Record<WorkspaceInviteAction, 'GET' | 'POST'> = {
    verify: 'GET',
    claim: 'POST'
};

function inviteError(
    statusCode: number,
    code: WorkspaceInviteErrorCode
): ReturnType<typeof createSafeError> {
    return createSafeError({
        statusCode,
        message: code,
        data: { code }
    });
}

export function assertWorkspaceInviteToken(token: string | undefined): string {
    if (!token || !WORKSPACE_INVITE_TOKEN_PATTERN.test(token)) {
        throw inviteError(400, 'workspace_invite.invalid_token');
    }

    return token;
}

function projectWorkspaceInviteResponse(value: unknown, action: WorkspaceInviteAction): WorkspaceInviteResponse | null {
    if (!value || typeof value !== 'object') return null;
    const response = value as Record<string, unknown>;
    if (!response.invite || typeof response.invite !== 'object') return null;

    const { id, purpose, target_parent_id, expires, target_parent_label, email, workspace } = response.invite as Record<string, unknown>;
    if (typeof id !== 'number' || typeof purpose !== 'string'
      || typeof target_parent_id !== 'number' || typeof expires !== 'number') return null;

    const invite = {
        id,
        purpose,
        target_parent_id,
        expires,
        ...(typeof target_parent_label === 'string' || target_parent_label === null ? { target_parent_label } : {})
    };
    if (action === 'verify' && response.status === 'pending') return { status: 'pending', invite };
    if (action === 'claim' && response.status === 'claimed' && typeof email === 'string') {
        const target = workspace as Record<string, unknown> | null | undefined;
        const jurisdictionSlug = normalizeWorkspaceSlug(target?.jurisdictionSlug);
        const organisationSlug = normalizeWorkspaceSlug(target?.organisationSlug);
        const joinedWorkspace = jurisdictionSlug && (target?.organisationSlug == null || organisationSlug)
            ? { jurisdictionSlug, organisationSlug }
            : undefined;
        return { status: 'claimed', invite: { ...invite, email, ...(joinedWorkspace && { workspace: joinedWorkspace }) } };
    }
    return null;
}

function inviteErrorCodeForStatus(status: number): WorkspaceInviteErrorCode {
    if (status === 400) return 'workspace_invite.invalid_token';
    if (status === 401) return 'workspace_invite.auth_required';
    if (status === 403) return 'workspace_invite.email_mismatch';
    if (status === 404) return 'workspace_invite.not_found';
    if (status === 409) return 'workspace_invite.already_claimed';
    if (status === 410) return 'workspace_invite.expired';
    if (status === 429) return 'workspace_invite.rate_limited';
    return 'workspace_invite.upstream_error';
}

export async function proxyWorkspaceInviteRequest(
    token: string,
    action: WorkspaceInviteAction,
    auth?: WorkspaceInviteAuth,
    event?: H3Event
): Promise<WorkspaceInviteResponse> {
    const config = useRuntimeConfig();
    const apiBase = config.apiBase;
    if (!apiBase) {
        throw inviteError(500, 'server.configuration_error');
    }
    const claimAuth = action === 'claim' ? auth : undefined;
    if (action === 'claim' && !claimAuth) {
        throw inviteError(500, 'server.configuration_error');
    }

    const headerOptions: {
        accept: string
        contentType?: string
        cookieHeader?: string
    } = {
        accept: 'application/json',
        cookieHeader: ''
    };
    if (claimAuth) {
        headerOptions.contentType = 'application/json';
        headerOptions.cookieHeader = claimAuth.cookie;
    }
    const headers: Record<string, string> = event
        ? buildDrupalRequestHeaders(event, headerOptions)
        : { Accept: 'application/json' };

    // The claim endpoint requires an authenticated Drupal session and a CSRF
    // token; the verify endpoint stays anonymous.
    if (claimAuth) {
        headers['X-CSRF-Token'] = claimAuth.csrfToken;
        if (!event) {
            headers.Cookie = claimAuth.cookie;
            headers['Content-Type'] = 'application/json';
        }
    }

    const path = `/api/workspace-invites/${action}/${token}`;
    let response: { ok: boolean, status: number, text: () => Promise<string> };
    if (event) {
        response = await drupalSessionRequest(event, path, {
            method: ACTION_METHOD[action],
            headers
        });
    } else {
        response = await fetch(`${apiBase}${path}`, {
            method: ACTION_METHOD[action],
            headers
        });
    }
    const raw = await response.text().catch(() => '');

    if (!response.ok) {
        throw inviteError(response.status, inviteErrorCodeForStatus(response.status));
    }

    let data: unknown;
    try {
        data = raw ? JSON.parse(raw) : null;
    } catch {
        throw inviteError(502, 'workspace_invite.invalid_response');
    }

    const projected = projectWorkspaceInviteResponse(data, action);
    if (!projected) {
        throw inviteError(502, 'workspace_invite.invalid_response');
    }

    return projected;
}
