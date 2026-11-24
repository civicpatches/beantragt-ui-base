/**
 * The address a signed-in person may read as "Angemeldet als ...", with the rule of the form's applicant card
 * (`app/components/submission/Identity.vue`): only the e-mail login carries
 * the person's own address. A BundID or other SSO account without a usable
 * address has a technical placeholder (`<provider>.<hash>@sso.local.invalid`)
 * that is no address of theirs; it is never shown.
 */
const AUTH_PROVIDER_ALIASES: Record<string, string> = {
    bundid_mock: 'bundid'
};

interface AccountLike {
    email?: string | null
    auth_provider?: string | null
    displayName?: string | null
}

function normalizedProvider(value: unknown): string {
    if (typeof value !== 'string') return 'unknown';
    const provider = value.trim().toLowerCase();
    if (!provider) return 'unknown';
    return AUTH_PROVIDER_ALIASES[provider] || provider;
}

/** The login address to show, or null when the page uses neutral words. */
export function accountLoginAddress(user: AccountLike | null | undefined): string | null {
    if (!user || normalizedProvider(user.auth_provider) !== 'passwordless') return null;
    const email = typeof user.email === 'string' ? user.email.trim() : '';
    return email || null;
}

export function accountHeaderIdentity(user: AccountLike | null | undefined): string | null {
    if (!user || normalizedProvider(user.auth_provider) !== 'passwordless') return null;
    return user.displayName?.trim() || accountLoginAddress(user);
}
