import {
    normalizePublicWorkspaceSlug,
    resolvePublicWorkspaceBySlugs
} from './public-workspace';

const PUBLIC_ASSET_PREFIXES = [
    '/_nuxt/',
    '/_nuxt_icon/',
    '/@vite/',
    '/__nuxt/'
];

const PUBLIC_FILE_RE = /\.(?:css|js|mjs|map|json|png|jpg|jpeg|gif|svg|ico|webp|woff2?|ttf)$/i;
const PUBLIC_ICON_RE = /^\/(?:favicon(?:-[a-z0-9-]+)?|apple-touch-icon(?:-[a-z0-9-]+)?)\.[a-z0-9]+$/i;

const RESERVED_TOP_LEVEL_SEGMENTS = new Set([
    '_nuxt',
    '_nuxt_icon',
    '__nuxt',
    '@vite',
    '__vite_ping',
    'admin',
    'api',
    'auth',
    'accessibility',
    'barrierefreiheit',
    'confirm',
    'datenschutz',
    'demo',
    'demo-access',
    'easy-language',
    'form',
    'gebaerdensprache',
    'impressum',
    'legal-notice',
    'leichte-sprache',
    'maintenance',
    'meine-antraege',
    'meine-daten',
    'pages',
    'privacy',
    'sign-language',
    'start',
    'status',
    'workspace'
]);

const JURISDICTION_ROUTE_SEGMENTS = new Set([
    'admin',
    'auth',
    'form',
    'meine-antraege',
    'meine-daten',
    'pages',
    'start',
    'status'
]);

const WORKSPACE_ROUTE_CACHE_TTL_MS = 60_000;
const WORKSPACE_ROUTE_CACHE_MAX_ENTRIES = 512;

type WorkspaceRouteCacheEntry = {
    expiresAt: number
    exists: boolean
};

export type PublicWorkspaceRouteScope = {
    valid: true
    jurisdictionSlug: string
    organisationSlug: string | null
} | {
    valid: false
};

const workspaceRouteCache = new Map<string, WorkspaceRouteCacheEntry>();
const workspaceRouteLookups = new Map<string, Promise<boolean>>();

function isKnownPublicAssetPath(pathname: string): boolean {
    if (pathname === '/__nuxt' || pathname === '/__vite_ping' || pathname === '/robots.txt' || pathname === '/site.webmanifest') {
        return true;
    }
    if (PUBLIC_ASSET_PREFIXES.some(prefix => pathname.startsWith(prefix))) {
        return true;
    }

    return PUBLIC_ICON_RE.test(pathname);
}

function pruneWorkspaceRouteCache(now: number): void {
    for (const [key, entry] of workspaceRouteCache.entries()) {
        if (entry.expiresAt <= now) {
            workspaceRouteCache.delete(key);
        }
    }

    while (workspaceRouteCache.size > WORKSPACE_ROUTE_CACHE_MAX_ENTRIES) {
        const oldestKey = workspaceRouteCache.keys().next().value;
        if (!oldestKey) return;
        workspaceRouteCache.delete(oldestKey);
    }
}

function pathSegments(pathname: string): string[] {
    return pathname
        .split('/')
        .map(segment => segment.trim())
        .filter(Boolean);
}

export function isPublicWorkspaceDocumentRequest(
    method: string,
    pathname: string,
    acceptHeader: string | null | undefined
): boolean {
    const normalizedMethod = method.toUpperCase();
    if (normalizedMethod !== 'GET' && normalizedMethod !== 'HEAD') return false;

    const accept = acceptHeader?.trim().toLowerCase() || '';
    const wantsDocument = !accept || accept.includes('text/html') || accept.includes('*/*');
    if (!wantsDocument) return false;

    if (isKnownPublicAssetPath(pathname)) return false;
    if (PUBLIC_FILE_RE.test(pathname) && !accept.includes('text/html')) return false;

    return true;
}

export function publicWorkspaceRouteScope(pathname: string): PublicWorkspaceRouteScope | null {
    const segments = pathSegments(pathname);
    if (segments.length === 0) return null;

    const jurisdictionSegment = segments[0];
    if (!jurisdictionSegment) return null;

    const maybeOrganisationOrRoute = segments[1];
    if (RESERVED_TOP_LEVEL_SEGMENTS.has(jurisdictionSegment)) {
        return null;
    }

    const jurisdictionSlug = normalizePublicWorkspaceSlug(jurisdictionSegment);
    if (!jurisdictionSlug) {
        return { valid: false };
    }

    if (!maybeOrganisationOrRoute || JURISDICTION_ROUTE_SEGMENTS.has(maybeOrganisationOrRoute)) {
        return {
            valid: true,
            jurisdictionSlug,
            organisationSlug: null
        };
    }

    const organisationSlug = normalizePublicWorkspaceSlug(maybeOrganisationOrRoute);
    if (!organisationSlug) {
        return { valid: false };
    }

    return {
        valid: true,
        jurisdictionSlug,
        organisationSlug
    };
}

export function clearPublicWorkspaceRouteCacheForTests() {
    workspaceRouteCache.clear();
    workspaceRouteLookups.clear();
}

export async function publicWorkspaceRouteExists(
    scope: Extract<PublicWorkspaceRouteScope, { valid: true }>
): Promise<boolean> {
    const cacheKey = `${scope.jurisdictionSlug}/${scope.organisationSlug || ''}`;
    const now = Date.now();
    pruneWorkspaceRouteCache(now);

    const cached = workspaceRouteCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
        return cached.exists;
    }

    const pendingLookup = workspaceRouteLookups.get(cacheKey);
    if (pendingLookup) {
        return pendingLookup;
    }

    const lookup = (async () => {
        const workspace = await resolvePublicWorkspaceBySlugs(
            scope.jurisdictionSlug,
            scope.organisationSlug
        );
        const exists = Boolean(workspace);

        workspaceRouteCache.set(cacheKey, {
            exists,
            expiresAt: Date.now() + WORKSPACE_ROUTE_CACHE_TTL_MS
        });
        pruneWorkspaceRouteCache(Date.now());

        return exists;
    })();

    workspaceRouteLookups.set(cacheKey, lookup);

    try {
        return await lookup;
    } finally {
        workspaceRouteLookups.delete(cacheKey);
    }
}
