export interface PublicFormPathInput {
    id?: string
    schemaId?: string
    path?: string
    jurisdictionSlug?: string | null
    jurisdictionLabel?: string | null
    organisationSlug?: string | null
    organisationLabel?: string | null
}

interface PublicRouteLike {
    params?: Record<string, unknown>
}

const LOCAL_RETURN_ORIGIN = 'https://beantragt.invalid';
const SENSITIVE_RETURN_QUERY_KEYS = new Set([
    'code',
    'otp',
    'secret',
    'status_token',
    'statustoken',
    'token'
]);

/** One leading slash, no backslash, no control character, at most 2048 characters. */
function isLocalPathShape(value: string): boolean {
    if (value.length > 2048) return false;
    if (!value.startsWith('/') || value.startsWith('//')) return false;
    return ![...value].some((character) => {
        const codePoint = character.codePointAt(0) || 0;
        return character === '\\' || codePoint <= 31 || codePoint === 127;
    });
}

function resolvesOnOwnOrigin(value: string): URL | null {
    try {
        const target = new URL(value, LOCAL_RETURN_ORIGIN);
        return target.origin === LOCAL_RETURN_ORIGIN ? target : null;
    } catch {
        return null;
    }
}

export function normalizeLocalReturnPath(value: unknown): string | null {
    if (typeof value !== 'string' || !isLocalPathShape(value)) return null;

    const target = resolvesOnOwnOrigin(value);
    if (!target) return null;
    const normalized = `${target.pathname}${target.search}${target.hash}`;

    // The parser resolves dot segments, so `/..//evil.example` comes out as
    // `//evil.example`, a protocol-relative URL. The
    // value that is returned gets the same checks as the input.
    if (!isLocalPathShape(normalized) || !resolvesOnOwnOrigin(normalized)) return null;
    return normalized;
}

function decodedPathname(pathname: string): string | null {
    let decoded = pathname;
    try {
        for (let pass = 0; pass < 3; pass += 1) {
            const next = decodeURIComponent(decoded);
            if (next === decoded) break;
            decoded = next;
        }
        return decoded;
    } catch {
        return null;
    }
}

/**
 * Accept a same-origin return path for login flows which stay inside Nuxt.
 */
export function safeLocalAuthReturnPath(value: unknown, fallback = '/'): string {
    return normalizeLocalReturnPath(value) || normalizeLocalReturnPath(fallback) || '/';
}

/**
 * Keep bearer capabilities out of redirects which leave Nuxt for an external
 * identity provider. Those paths remain valid for local email-code flows.
 */
export function safeExternalAuthReturnPath(value: unknown, fallback = '/'): string {
    const safeFallback = safeLocalAuthReturnPath(fallback);
    const safePath = normalizeLocalReturnPath(value);
    if (!safePath) return safeFallback;

    const target = new URL(safePath, LOCAL_RETURN_ORIGIN);
    const pathname = decodedPathname(target.pathname);
    if (!pathname) return safeFallback;

    const carriesStatusBearer = /\/form\/[^/]+\/status\/[^/]+(?:\/|$)/iu.test(pathname);
    const carriesConfirmationBearer = /\/confirm\/[^/]+(?:\/|$)/iu.test(pathname);
    const carriesBearerInPath = carriesStatusBearer || carriesConfirmationBearer;
    const carriesBearerInQuery = [...target.searchParams.keys()]
        .some(key => SENSITIVE_RETURN_QUERY_KEYS.has(key.toLowerCase()));

    return carriesBearerInPath || carriesBearerInQuery ? safeFallback : safePath;
}

function normalizePathSegment(value: string | null | undefined): string | null {
    if (!value) return null;
    const segment = value.trim().toLowerCase();
    return /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/.test(segment) ? segment : null;
}

function routeParam(value: unknown): string | null {
    const raw = Array.isArray(value) ? value[0] : value;
    return typeof raw === 'string' ? raw : null;
}

export function publicWorkspaceFromRoute(route: PublicRouteLike): PublicFormPathInput {
    return {
        jurisdictionSlug: routeParam(route.params?.workspace),
        organisationSlug: routeParam(route.params?.organisation)
    };
}

export function publicWorkspaceFromKey(key: string | null | undefined): PublicFormPathInput {
    const [jurisdictionSlug, organisationSlug] = (key || '').replace(/^\/+|\/+$/gu, '').split('/');
    return {
        jurisdictionSlug: jurisdictionSlug || null,
        organisationSlug: organisationSlug || null
    };
}

export function publicWorkspacePath(input: PublicFormPathInput): string {
    const jurisdictionSlug = normalizePathSegment(input.jurisdictionSlug);
    const organisationSlug = normalizePathSegment(input.organisationSlug);
    if (!jurisdictionSlug) return '';
    return organisationSlug ? `/${jurisdictionSlug}/${organisationSlug}` : `/${jurisdictionSlug}`;
}

export function publicHomePath(input: PublicFormPathInput = {}): string {
    const workspacePath = publicWorkspacePath(input);
    return workspacePath ? `${workspacePath}/start` : '/';
}

export function publicStartPath(input: PublicFormPathInput = {}): string {
    return `${publicWorkspacePath(input)}/start`;
}

export function publicLoginPath(input: PublicFormPathInput = {}): string {
    return `${publicWorkspacePath(input)}/auth/login`;
}

// `/<ws>/form/<id>` or `/<ws>/<org>/form/<id>`, with or without more after it.
// Without regard to case, as the router matches (`/musterstadt/Form/abc` is the form page).
const PUBLIC_FORM_RETURN_PATH = /^\/(?:[^/?#]+\/){0,2}form\/[^/?#]+/iu;

/**
 * The query of the header's "Anmelden". A public form page stays a hard
 * `redirect`: whoever fills a form comes back to it. Any other page is a soft
 * `return`: the login page brings a citizen back to it and staff into the
 * administration. `returnPath` must already be a safe local path.
 */
export function headerLoginQuery(returnPath: string): { redirect: string } | { return: string } {
    return PUBLIC_FORM_RETURN_PATH.test(returnPath) ? { redirect: returnPath } : { return: returnPath };
}

export function publicApplicationsPath(input: PublicFormPathInput = {}): string {
    return `${publicWorkspacePath(input)}/meine-antraege`;
}

/** The application list: entry of the admin area for every staff role. */
export const ADMIN_ENTRY_PATH = '/admin/applications';

/**
 * The entry of the administration for the workspace of a public page, or null
 * on a page without a workspace. One source for the header's "Verwaltung", the
 * signed-in panel's "Zum Verwaltungsbereich" and the target after a staff
 * sign-in without an explicit return path.
 */
export function publicAdministrationPath(input: PublicFormPathInput = {}): string | null {
    const workspacePath = publicWorkspacePath(input);
    return workspacePath ? `${workspacePath}${ADMIN_ENTRY_PATH}` : null;
}

export function publicStatusLookupPath(input: PublicFormPathInput & { referenceNumber?: string | null } = {}): string {
    const path = `${publicWorkspacePath(input)}/status`;
    return input.referenceNumber ? `${path}?ref=${encodeURIComponent(input.referenceNumber)}` : path;
}

export function publicApplicationPath(input: PublicFormPathInput & { applicationId?: string | null }): string {
    if (!input.applicationId) return publicApplicationsPath(input);
    return `${publicApplicationsPath(input)}/${input.applicationId}`;
}

export function publicMyDataPath(input: PublicFormPathInput = {}): string {
    return `${publicWorkspacePath(input)}/meine-daten`;
}

export function publicFormPath(input: PublicFormPathInput): string {
    if (input.path) return input.path;

    const id = input.schemaId || input.id;
    if (!id) return publicStartPath(input);

    return `${publicWorkspacePath(input)}/form/${id}`;
}

export function publicFormStatusPath(input: PublicFormPathInput & { statusToken?: string | null }): string {
    const statusToken = input.statusToken;
    if (!statusToken) return publicFormPath(input);
    return `${publicFormPath(input)}/status/${statusToken}`;
}
