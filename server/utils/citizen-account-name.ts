import type { H3Event } from 'h3';
import { buildDrupalRequestHeaders, citizenAccountKind, drupalSessionRequest, type AuthUser } from './auth';
import { drupalSessionCookieHeader } from './session';

export interface CitizenAuthResponse {
    authenticated?: boolean
    success?: boolean
    user?: AuthUser | null
}

const ACCOUNT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** Resolve the label with the same session as the auth reply, before the header renders it. */
export async function withCitizenAccountName(event: H3Event, auth: CitizenAuthResponse, cookies: string) {
    const user = auth?.user;
    const cookieHeader = drupalSessionCookieHeader(cookies);
    if (!cookieHeader || user?.auth_provider !== 'passwordless') return auth;
    if (auth.authenticated === false || auth.success === false || citizenAccountKind(user) !== 'citizen') return auth;

    const signal = AbortSignal.timeout(2000);
    async function readOwnData<T>(path: string, accept: string): Promise<T | null> {
        try {
            const response = await drupalSessionRequest(event, path, {
                headers: buildDrupalRequestHeaders(event, { accept, cookieHeader }),
                signal,
                maxResponseBytes: 512 * 1024
            });
            return response.ok ? await response.json<T>() : null;
        } catch {
            // Missing profile data must never invalidate a successful login.
            return null;
        }
    }

    let displayName = '';
    if (user.uuid && ACCOUNT_UUID.test(user.uuid)) {
        // Only the signed-in account's two name fields. Drupal's login name
        // can be an e-mail, an internal identifier or a numbered demo login.
        const account = await readOwnData<{
            data?: { id?: string, attributes?: { field_first_name?: string, field_last_name?: string } }
        }>(`/jsonapi/user/user/${user.uuid}?fields[user--user]=field_first_name,field_last_name`, 'application/vnd.api+json');
        if (account?.data?.id === user.uuid) {
            const fields = account.data.attributes;
            const first = typeof fields?.field_first_name === 'string' && fields.field_first_name.trim();
            const last = typeof fields?.field_last_name === 'string' && fields.field_last_name.trim();
            if (first && last) displayName = `${first} ${last}`;
        }
    }
    if (!displayName) {
        const profile = await readOwnData<{ data?: { fullName?: string } | null }>('/api/citizen/applicant-profile', 'application/json');
        if (typeof profile?.data?.fullName === 'string') displayName = profile.data.fullName.trim();
    }
    return displayName ? { ...auth, user: { ...user, displayName } } : auth;
}
