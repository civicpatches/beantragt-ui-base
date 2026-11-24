import { addressMapContentSecurityPolicy } from '../../shared/address-map-security';

/**
 * Server middleware for embed frame security.
 *
 * For all routes:
 * - Sets the map resource CSP from the container runtime environment
 *
 * For /form/*, /{workspace}/form/* and /{workspace}/{organisation}/form/*
 * routes with ?embed=true:
 * - Sets CSP frame-ancestors to an explicit origin allowlist (ENV-configured)
 * - Removes X-Frame-Options (CSP frame-ancestors takes precedence in modern browsers)
 *
 * Without NUXT_EMBED_ALLOWED_ORIGINS configured, only same-origin embedding
 * is permitted (the default SAMEORIGIN from route rules stays in effect).
 */
export function normalizeFrameAncestorOrigin(value: string): string | null {
    const source = value.trim();
    if (!source || /[\s*]/u.test(source)) return null;

    try {
        const url = new URL(source);
        if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
        if (url.username || url.password) return null;
        if (url.pathname !== '/' || url.search || url.hash) return null;
        if (url.origin === 'null') return null;

        return url.origin;
    } catch {
        return null;
    }
}

export function parseFrameAncestorOrigins(value: string): string[] {
    return [...new Set(
        value
            .split(',')
            .map(normalizeFrameAncestorOrigin)
            .filter((origin): origin is string => Boolean(origin))
    )];
}

export default defineEventHandler((event) => {
    const mapResources = addressMapContentSecurityPolicy(
        process.env,
        process.env.NODE_ENV === 'development'
    );
    setResponseHeader(event, 'Content-Security-Policy', mapResources);

    const url = getRequestURL(event);

    // Only apply to public form routes with ?embed=true.
    if (!/^\/(?:[a-z0-9-]+\/(?:[a-z0-9-]+\/)?)?form\//u.test(url.pathname)) return;
    if (url.searchParams.get('embed') !== 'true') return;

    // Read allowed origins from ENV. Without this, cross-origin embed stays blocked.
    const allowedOrigins = parseFrameAncestorOrigins(process.env.NUXT_EMBED_ALLOWED_ORIGINS || '');

    if (allowedOrigins.length === 0) {
    // No origins configured: keep SAMEORIGIN (the route rule default).
    // This is the secure default.
        return;
    }

    // Set CSP frame-ancestors with the explicit allowlist.
    // This is the modern, more flexible replacement for X-Frame-Options.
    const frameAncestors = `frame-ancestors 'self' ${allowedOrigins.join(' ')}`;
    setResponseHeader(event, 'Content-Security-Policy', `${mapResources}; ${frameAncestors}`);

    // Remove X-Frame-Options since CSP frame-ancestors takes precedence
    // in modern browsers, and they can conflict.
    removeResponseHeader(event, 'X-Frame-Options');
});
