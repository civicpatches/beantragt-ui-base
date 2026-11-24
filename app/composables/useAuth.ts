/**
 * Authentication composable for beantragt.ai
 *
 * Manages passwordless auth state via code verification.
 * All API calls go through Nuxt server proxy routes to avoid CORS.
 *
 */
import { resolveApiErrorMessageWithTranslator } from '~/composables/api/useApiErrorMessage';

import { STAFF_HOST_ERROR } from '#shared/ui-mode';

interface AuthUser {
    name?: string
    displayName?: string
    uid: number
    uuid?: string
    email: string
    roles: string[]
    auth_provider?: string
    assurance_level?: string | null
}

interface AuthState {
    notAllowedOnHost: boolean
    hostErrorCode: string
    authenticated: boolean
    /**
     * True once the server answered whether a session exists. Pages without
     * the `auth` middleware never asked before, so the header showed
     * "Anmelden" for a signed-in citizen until a protected page was opened.
     */
    statusChecked: boolean
    user: AuthUser | null
    loading: boolean
    error: string | null
    step: 'email' | 'code-sent' | 'authenticated'
    codeSentEmail: string | null
    codeLength: number
    challengeId: string | null
    mailJurisdiction: string | null
    mailLangcode: string | null
}

export type AuthStatusResult = 'authenticated' | 'unauthenticated' | 'error';

const DEFAULT_CODE_LENGTH = 6;

/** One shared request while the header asks for the session status. */
let pendingStatusProbe: Promise<void> | null = null;

function normalizeCodeLength(value: unknown): number {
    const length = Number(value ?? DEFAULT_CODE_LENGTH);
    if (!Number.isInteger(length)) return DEFAULT_CODE_LENGTH;
    return Math.max(4, Math.min(9, length));
}

function createAuthErrorTranslator() {
    const nuxtApp = useNuxtApp();
    const i18n = nuxtApp.$i18n as { t?: (key: string, params?: Record<string, unknown>) => string } | undefined;

    return (key: string, params?: Record<string, unknown>) =>
        i18n?.t ? i18n.t(key, params) : key;
}

export function useAuth() {
    const translateError = createAuthErrorTranslator();

    // Shared state across all components using this composable
    const state = useState<AuthState>('auth', () => ({
        notAllowedOnHost: false,
        hostErrorCode: STAFF_HOST_ERROR,
        authenticated: false,
        statusChecked: false,
        user: null,
        loading: false,
        error: null,
        step: 'email',
        codeSentEmail: null,
        codeLength: DEFAULT_CODE_LENGTH,
        challengeId: null,
        mailJurisdiction: null,
        mailLangcode: null
    }));

    const authenticated = computed(() => state.value.authenticated);
    const statusChecked = computed(() => state.value.statusChecked);
    const user = computed(() => state.value.user);
    const loading = computed(() => state.value.loading);
    const error = computed(() => state.value.error);
    const step = computed(() => state.value.step);
    const codeSentEmail = computed(() => state.value.codeSentEmail);
    const codeLength = computed(() => state.value.codeLength);

    // Role checks
    const isAdmin = computed(() => {
        const roles = state.value.user?.roles ?? [];
        return roles.includes('administrator') || roles.includes('department_admin');
    });

    const isStaff = computed(() => {
        const roles = state.value.user?.roles ?? [];
        return roles.includes('administrator') || roles.includes('department_admin') || roles.includes('case_worker');
    });

    const isAuthenticated = computed(() => state.value.authenticated);

    function expireSession(): void {
        state.value.notAllowedOnHost = false;
        state.value.authenticated = false;
        // The session is known to be gone; the header may show "Anmelden".
        state.value.statusChecked = true;
        state.value.user = null;
        state.value.loading = false;
        state.value.error = null;
        state.value.step = 'email';
        state.value.codeSentEmail = null;
        state.value.codeLength = DEFAULT_CODE_LENGTH;
        state.value.challengeId = null;
        state.value.mailJurisdiction = null;
        state.value.mailLangcode = null;
    }

    /**
   * Extract a localized error message from an API error.
   *
   * Server routes carry a stable i18n key in `data.code`; rate-limit errors
   * additionally carry `data.seconds` for wait-time interpolation. The
   * resolver renders the key with `t()` and the fallback is used only when
   * no recognizable error code or HTTP status is present.
   */
    function extractErrorMessage(e: unknown, fallback: string): string {
        const code = (e as { data?: { code?: unknown } })?.data?.code;
        const status = (e as { statusCode?: number, status?: number })?.statusCode
          ?? (e as { status?: number })?.status;

        // Use the resolver when the error carries a known code or HTTP status.
        if ((typeof code === 'string' && code.startsWith('errors.')) || typeof status === 'number') {
            return resolveApiErrorMessageWithTranslator(e, undefined, translateError);
        }

        return translateError(fallback);
    }

    /**
   * Request a login code for the given email.
   * Always shows success to prevent email enumeration.
   */
    async function login(
        email: string,
        jurisdiction?: string | null,
        langcode?: string | null
    ): Promise<{ success: boolean, codeLength?: number }> {
        state.value.loading = true;
        state.value.error = null;
        const mailJurisdiction = jurisdiction === undefined
            ? state.value.mailJurisdiction
            : jurisdiction;
        const mailLangcode = langcode === undefined
            ? state.value.mailLangcode
            : langcode;

        try {
            const data = await $fetch<{ codeLength?: number, challengeId?: string | null }>('/api/auth/request-code', {
                method: 'POST',
                body: {
                    email,
                    ...(mailJurisdiction ? { jurisdiction: mailJurisdiction } : {}),
                    ...(mailLangcode ? { langcode: mailLangcode } : {})
                }
            });

            if (!data.challengeId) {
                throw new Error('Missing passwordless challenge');
            }

            state.value.step = 'code-sent';
            state.value.codeSentEmail = email;
            state.value.codeLength = normalizeCodeLength(data.codeLength);
            state.value.challengeId = data.challengeId ?? null;
            state.value.mailJurisdiction = mailJurisdiction || null;
            state.value.mailLangcode = mailLangcode || null;

            return { success: true, codeLength: state.value.codeLength };
        } catch (e: unknown) {
            state.value.error = extractErrorMessage(
                e,
                'errors.server.drupalRequestFailed'
            );
            return { success: false };
        } finally {
            state.value.loading = false;
        }
    }

    /**
   * Verify the code received via email.
   * On success, sets authenticated state and user data.
   */
    async function verify(email: string, code: string): Promise<{ success: boolean, refusedOnHost?: boolean }> {
        state.value.loading = true;
        state.value.error = null;

        try {
            const data = await $fetch<{
                authenticated?: boolean
                user?: AuthUser
            }>('/api/auth/verify-code', {
                method: 'POST',
                body: { email, code, challengeId: state.value.challengeId }
            });

            if (data?.authenticated || data?.user) {
                state.value.authenticated = true;
                state.value.statusChecked = true;
                state.value.user = data.user || null;
                state.value.step = 'authenticated';
                state.value.challengeId = null;
                state.value.mailJurisdiction = null;
                state.value.mailLangcode = null;
                return { success: true };
            }

            // If backend returns success but no user, check status
            await checkStatus();
            return { success: state.value.authenticated };
        } catch (e: unknown) {
            const errorData = (e as {
                data?: {
                    code?: unknown
                    challengeConsumed?: unknown
                    data?: { challengeConsumed?: unknown, code?: unknown }
                }
            })?.data;
            const errorCode = errorData?.data?.code ?? errorData?.code;
            if (errorData?.challengeConsumed === true || errorData?.data?.challengeConsumed === true) {
                state.value.step = 'email';
                state.value.codeSentEmail = null;
                state.value.codeLength = DEFAULT_CODE_LENGTH;
                state.value.challengeId = null;
                state.value.mailJurisdiction = null;
                state.value.mailLangcode = null;
            }
            state.value.error = extractErrorMessage(
                e,
                'errors.auth.verificationFailed'
            );
            return errorCode === STAFF_HOST_ERROR ? { success: false, refusedOnHost: true } : { success: false };
        } finally {
            state.value.loading = false;
        }
    }

    function applyHostRefusal(data?: { notAllowedOnHost?: boolean, code?: string }): boolean {
        if (!data?.notAllowedOnHost) return false;
        expireSession();
        state.value.notAllowedOnHost = true;
        state.value.hostErrorCode = data.code === STAFF_HOST_ERROR ? STAFF_HOST_ERROR : 'errors.auth.statusUnavailable';
        return true;
    }

    /**
   * Check current authentication status with the server.
   * Used on initial page load and after verification.
   */
    async function checkStatus(): Promise<AuthStatusResult> {
        try {
            const data = await $fetch<{
                authenticated: boolean
                notAllowedOnHost?: boolean
                user?: AuthUser
            }>('/api/auth/status', {
                method: 'GET'
            });

            if (applyHostRefusal(data)) return 'unauthenticated';
            state.value.authenticated = data?.authenticated ?? false;
            state.value.user = data?.user ?? null;

            if (state.value.authenticated) {
                state.value.step = 'authenticated';
                return 'authenticated';
            }
            expireSession();
            return 'unauthenticated';
        } catch (e: unknown) {
            const status = (e as { statusCode?: number, status?: number, response?: { status?: number } }).statusCode
              ?? (e as { status?: number }).status
              ?? (e as { response?: { status?: number } }).response?.status;
            if (status === 401) {
                expireSession();
                return 'unauthenticated';
            }
            return 'error';
        } finally {
            // Also after an unreachable server: the header then falls back to
            // "Anmelden" instead of hiding the navigation for good.
            state.value.statusChecked = true;
        }
    }

    /**
   * Learn once whether a session exists, for pages without the `auth`
   * middleware (the header calls it on mount).
   *
   * Unlike `checkStatus()` it never touches the login flow: on the login
   * page an "unauthenticated" answer arriving after "Code anfordern" would
   * otherwise reset the challenge, and `step = 'authenticated'` would empty
   * the login card.
   */
    async function ensureStatus(): Promise<void> {
        if (state.value.authenticated || state.value.statusChecked) return;
        if (pendingStatusProbe) return pendingStatusProbe;

        pendingStatusProbe = (async () => {
            try {
                const data = await $fetch<{
                    authenticated: boolean
                    notAllowedOnHost?: boolean
                    user?: AuthUser
                }>('/api/auth/status', {
                    method: 'GET'
                });
                if (applyHostRefusal(data)) return;
                if (data?.authenticated && !state.value.authenticated) {
                    state.value.authenticated = true;
                    state.value.user = data.user ?? null;
                }
            } catch {
                // Unknown stays unauthenticated; the header shows "Anmelden".
            } finally {
                state.value.statusChecked = true;
                pendingStatusProbe = null;
            }
        })();
        return pendingStatusProbe;
    }

    /**
   * Log out: clear session on server and reset local state.
   */
    /**
     * Ends the session on the server; true once it is gone.
     *
     * A failed request (network, CSRF, server error) does not count as signed
     * out: the page stays signed in and the caller tells the person. Only when the server says that no session exists any more
     * (401, or a status probe that answers "not signed in") is the local
     * state cleared after an error.
     */
    async function logout(): Promise<boolean> {
        state.value.loading = true;

        try {
            await $fetch('/api/auth/logout', {
                method: 'POST'
            });
            expireSession();
            return true;
        } catch (e: unknown) {
            const status = (e as { statusCode?: number, status?: number, response?: { status?: number } }).statusCode
              ?? (e as { status?: number }).status
              ?? (e as { response?: { status?: number } }).response?.status;
            if (status === 401 || await sessionIsGone()) {
                expireSession();
                return true;
            }
            state.value.loading = false;
            return false;
        }
    }

    /**
     * After a failed logout: Drupal refuses its logout route to a session that
     * already ended (an expired cookie answers 403), so ask once whether a
     * session still exists. An unreachable server keeps the person signed in.
     */
    async function sessionIsGone(): Promise<boolean> {
        try {
            const data = await $fetch<{ authenticated?: boolean, notAllowedOnHost?: boolean }>('/api/auth/status', { method: 'GET' });
            return data?.authenticated === false && !data.notAllowedOnHost;
        } catch (e: unknown) {
            const status = (e as { statusCode?: number, status?: number }).statusCode ?? (e as { status?: number }).status;
            return status === 401;
        }
    }

    function resetFlow(): void {
        state.value.step = 'email';
        state.value.codeSentEmail = null;
        state.value.error = null;
        state.value.codeLength = DEFAULT_CODE_LENGTH;
        state.value.challengeId = null;
        state.value.mailJurisdiction = null;
        state.value.mailLangcode = null;
    }

    function clearError(): void {
        state.value.error = null;
    }

    return {
    // State
        authenticated,
        notAllowedOnHost: computed(() => state.value.notAllowedOnHost),
        hostRefusalMessage: computed(() => resolveApiErrorMessageWithTranslator({ data: { code: state.value.hostErrorCode } }, undefined, translateError)),
        statusChecked,
        user,
        loading,
        error,
        step,
        codeSentEmail,
        codeLength,
        isAdmin,
        isStaff,
        isAuthenticated,

        // Actions
        login,
        verify,
        checkStatus,
        ensureStatus,
        expireSession,
        logout,
        resetFlow,
        clearError
    };
}
