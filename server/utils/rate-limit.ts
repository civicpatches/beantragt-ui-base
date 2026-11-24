/**
 * Rate limiter for beantragt.ai server routes.
 *
 * Per-endpoint type configuration with smart identifier (IP + verified token)
 * and TTL-based cleanup of stale entries.
 *
 * Ported from Mark-a-Spot's production rate-limiter pattern.
 * Adapted for beantragt.ai's endpoint types.
 */
import { isIP } from 'node:net';
import type { H3Event } from 'h3';
import { DEFAULT_ADMIN_CASE_READ_LIMIT_PER_MINUTE } from '../../shared/rate-limits';

// ── Rate Limits Configuration ───────────────────────────────────────────
// Each type has a max count and sliding window duration.

export const rateLimits = {
    application: { max: 10, windowMs: 60_000 }, // 10/min
    bulk_poll: { max: 120, windowMs: 60_000 }, // Separate from unrelated admin traffic.
    bulk_sichtung: { max: 600, windowMs: 60_000 }, // Audited reads and decisions per verified staff user.
    bulk_sichtung_auth: { max: 6000, windowMs: 60_000 }, // Pre-auth bound, allowing a shared municipal NAT.
    bulk_upload: { max: 3, windowMs: 60_000 }, // 3/min per authenticated staff user
    attachment_upload: { max: 10, windowMs: 60_000 }, // 10/min
    attachment_analysis_consent: { max: 5, windowMs: 60_000 }, // 5/min
    // The form polls a running upload check with backoff (3, 5, 8, then
    // 13 s); a few files checked at once stay well below this.
    attachment_analysis_poll: { max: 60, windowMs: 60_000 }, // 60/min
    // One start page view fans out to catalogue, pages, sections, documents
    // and one config per jurisdiction; browsing a few forms adds up fast.
    schema_fetch: { max: 120, windowMs: 60_000 }, // 120/min
    public_document_file: { max: 60, windowMs: 60_000 }, // 60/min
    auth_request: { max: 5, windowMs: 60_000 }, // 5/min
    auth_verify: { max: 5, windowMs: 60_000 }, // 5/min
    geocoding: { max: 30, windowMs: 60_000 }, // 30/min
    excel_export: { max: 5, windowMs: 60_000 }, // 5/min
    integration_transition: { max: 10, windowMs: 60_000 },
    // Drafts, previews, uploads and releases each run a conversion in docgen.
    docgen_action: { max: 20, windowMs: 60_000 }, // 20/min
    // "Deckblatt drucken" per verified staff user: every print issues a new
    // identifier and runs a PDF/A conversion (Drupal floods at the same rate).
    nachreichung_print: { max: 10, windowMs: 60 * 60_000 }, // 10/hour
    // Envelope target lookups (Aktenzeichen or identifier typed by hand) per
    // verified staff user, a brake against guessing; Drupal floods at the same rate.
    bulk_target: { max: 30, windowMs: 60_000 }, // 30/min
    admin: { max: 60, windowMs: 60_000 }, // 60/min
    admin_read: { max: DEFAULT_ADMIN_CASE_READ_LIMIT_PER_MINUTE, windowMs: 60_000 }, // Staff case overviews per verified user and IP.
    profile_update: { max: 20, windowMs: 60_000 }, // 20/min
    admin_document_upload: { max: 10, windowMs: 60_000 }, // 10/min
    admin_document_delete: { max: 20, windowMs: 60_000 }, // 20/min
    status_check: { max: 20, windowMs: 60_000 }, // 20/min
    status_otp_request: { max: 5, windowMs: 60_000 }, // 5/min
    status_otp_verify: { max: 10, windowMs: 60_000 }, // 10/min
    workspace_document: { max: 60, windowMs: 60_000 }, // 60/min
    workspace_invite_verify: { max: 30, windowMs: 60_000 }, // 30/min
    workspace_invite_claim: { max: 10, windowMs: 60_000 }, // 10/min
    workspace_invite_issue: { max: 10, windowMs: 60_000 }, // 10/min
    application_confirm: { max: 20, windowMs: 60_000 }, // 20/min
    application_confirm_resend: { max: 3, windowMs: 60 * 60_000 }, // 3/hour
    maintenance_recovery_request: { max: 5, windowMs: 60 * 60_000 }, // 5/hour
    maintenance_recovery_verify: { max: 10, windowMs: 15 * 60_000 }, // 10/15min
    maintenance_recovery_disable: { max: 5, windowMs: 15 * 60_000 } // 5/15min
};

type RateLimit = { max: number, windowMs: number };
export type RateLimitType = keyof typeof rateLimits;

const extraRateLimits = new Map<string, RateLimit>();

export function registerRateLimits(limits: Readonly<Record<string, RateLimit>>): void {
    for (const [name, limit] of Object.entries(limits)) extraRateLimits.set(name, limit);
}

function rateLimitFor(type: string): RateLimit | undefined {
    return Object.hasOwn(rateLimits, type) ? rateLimits[type as RateLimitType] : extraRateLimits.get(type);
}

// ── In-Memory Store ─────────────────────────────────────────────────────

const rateTracker: Record<string, Record<string, number[]>> = {};
const identifierLastSeen: Record<string, number> = {};

// Cleanup configuration
const CLEANUP_INTERVAL_MS = 60_000; // Run cleanup at most every 60s
const IDENTIFIER_TTL_MS = 60 * 60_000; // Remove stale identifiers after 1 hour

let lastCleanupTime = 0;

/**
 * Remove stale entries from the rate tracker.
 * Called on-demand during rate checks, not on an interval timer.
 */
function cleanupRateTracker(): void {
    const now = Date.now();

    for (const identifier in rateTracker) {
        const lastSeen = identifierLastSeen[identifier] || 0;
        if (now - lastSeen > IDENTIFIER_TTL_MS) {
            Reflect.deleteProperty(rateTracker, identifier);
            Reflect.deleteProperty(identifierLastSeen, identifier);
            continue;
        }

        const identifierData = rateTracker[identifier];
        if (!identifierData) continue;

        for (const endpointType in identifierData) {
            const limit = rateLimitFor(endpointType);
            const entries = identifierData[endpointType];
            if (!limit || !entries) continue;

            identifierData[endpointType] = entries.filter(
                timestamp => now - timestamp < limit.windowMs
            );

            if (identifierData[endpointType]?.length === 0) {
                Reflect.deleteProperty(identifierData, endpointType);
            }
        }

        if (Object.keys(identifierData).length === 0) {
            Reflect.deleteProperty(rateTracker, identifier);
            Reflect.deleteProperty(identifierLastSeen, identifier);
        }
    }
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Build a unique identifier for rate limiting.
 *
 * Composition: `${ip}||${tokenFingerprint}`. Cookie values are deliberately
 * ignored here because route-level rate checks can run before Drupal has
 * verified the browser session. Bearer callers pass a validated token
 * fingerprint explicitly, otherwise the request uses the IP bucket.
 */
export function getRateLimitIdentifier(
    event: H3Event,
    ip: string,
    tokenFingerprint?: string
): string {
    const tokenFp = tokenFingerprint || '';

    return `${ip}||${tokenFp}`;
}

/**
 * Check if a request exceeds the rate limit for the given type.
 * Throws a 429 error with reset time information if exceeded.
 *
 * `tokenFingerprint` is an opaque, stable, low-collision string derived from
 * the bearer token (sha256 prefix). When provided, it isolates the bearer
 * caller into their own bucket so multiple MCP-bridge instances behind a
 * shared egress IP do not share a quota, and so bearer traffic does not
 * spill into cookie-session buckets at the same IP.
 */
export function checkRateLimit(
    ip: string,
    type: string,
    event?: H3Event,
    tokenFingerprint?: string
): void {
    const limit = rateLimitFor(type);
    if (!limit) throw new Error(`Unregistered rate limit: ${type}`);

    const identifier = event ? getRateLimitIdentifier(event, ip, tokenFingerprint) : ip;
    recordRequest(identifier, type, limit.max, limit.windowMs);
}

function recordRequest(identifier: string, type: string, max: number, windowMs: number): number {
    const now = Date.now();

    identifierLastSeen[identifier] = now;

    // Run cleanup periodically
    if (now - lastCleanupTime > CLEANUP_INTERVAL_MS) {
        cleanupRateTracker();
        lastCleanupTime = now;
    }

    if (!rateTracker[identifier]) {
        rateTracker[identifier] = {};
    }
    const tracker = rateTracker[identifier]!;
    if (!tracker[type]) {
        tracker[type] = [];
    }

    // Clean old timestamps
    tracker[type] = tracker[type].filter(
        timestamp => now - timestamp < windowMs
    );

    if (tracker[type].length >= max) {
        const oldestRequest = tracker[type].reduce((oldest, timestamp) => Math.min(oldest, timestamp));
        const resetTimeMs = oldestRequest + windowMs - now;
        const resetTimeSec = Math.ceil(resetTimeMs / 1000);

        throw createError({
            statusCode: 429,
            message: 'errors.rateLimit.tooManyRequests',
            data: {
                code: 'errors.rateLimit.tooManyRequests',
                seconds: resetTimeSec,
                resetTimeMs,
                type
            }
        });
    }

    tracker[type].push(now);
    return now;
}

/** Bound unverified sessions, including concurrent auth lookups. On success
 * move this request from the shared IP allowance to the verified user's quota.
 */
export function beginCaseRead(event: H3Event, ip: string) {
    const fallback = getRateLimitIdentifier(event, ip);
    const reservedAt = recordRequest(fallback, 'admin_read', rateLimits.admin.max, rateLimits.admin_read.windowMs);
    return (uid: number, staff: boolean) => {
        let max = rateLimits.admin.max;
        if (staff) {
            const configured = Number(useRuntimeConfig(event).adminCaseReadLimitPerMinute);
            max = Number.isSafeInteger(configured) && configured > 0 ? configured : rateLimits.admin_read.max;
        }
        recordRequest(getRateLimitIdentifier(event, ip, `user:${uid}`), 'admin_read', max, rateLimits.admin_read.windowMs);

        // Only an admitted read releases its IP slot. Rejected reads still cost an auth lookup.
        const pending = rateTracker[fallback]?.admin_read;
        const index = pending?.indexOf(reservedAt) ?? -1;
        if (pending && index >= 0) pending.splice(index, 1);
    };
}

/**
 * Get client IP from the TCP connection (not X-Forwarded-For).
 * Prevents IP spoofing via header injection.
 * Falls back to X-Real-IP (set by trusted reverse proxy) or 'unknown'.
 */
export function getClientIp(event: H3Event): string {
    // Intelligence routes may trust the client identity asserted by the
    // browser proxy only after the service gate has authenticated the hop.
    // Direct callers remain bound to their TCP connection even when they
    // provide spoofed proxy headers.
    if (event.context?.intelligenceServiceAuthorized === true) {
        return getTrustedProxyClientIp(event);
    }
    // Behind Traefik the socket peer is Traefik itself; keying on it would
    // put every visitor into one bucket. The flag is set only where Traefik
    // strips client-sent forwarding headers.
    if (trustsProxyIpHeaders()) {
        return getTrustedProxyClientIp(event);
    }

    return getClientIpFromRequest(event);
}

function trustsProxyIpHeaders(): boolean {
    try {
        return useRuntimeConfig().trustProxyIpHeaders === true;
    } catch {
        return false;
    }
}

function normalizeProxyIpHeader(value: string | undefined): string | null {
    if (!value) return null;
    const ip = value.trim();
    if (!ip) return null;
    if (/[\r\n\t,]/u.test(ip)) return null;
    return isIP(ip) === 0 ? null : ip;
}

/**
 * Get client IP from a trusted reverse proxy header.
 *
 * Only use this when the deployment proxy overwrites incoming IP headers.
 * Otherwise clients could spoof their own rate-limit identity.
 */
/**
 * Client IP to forward to Drupal as X-Forwarded-For.
 *
 * Drupal trusts the Nuxt hop as reverse proxy and keys its flood limits on
 * this value; without it every visitor shares the Nuxt container's IP.
 * Proxy headers count only where Traefik is configured as trusted.
 */
export function getForwardableClientIp(event: H3Event): string | null {
    const ip = getClientIp(event);
    return isIP(ip) === 0 ? null : ip;
}

/**
 * Visitor IP for rate limits and Drupal identifier headers.
 *
 * Same resolution as X-Forwarded-For, so Nuxt and Drupal key one request on
 * one identity; falls back to the socket peer.
 */
export function getRequestClientIp(event: H3Event): string {
    return getForwardableClientIp(event) ?? getClientIp(event);
}

export function getTrustedProxyClientIp(event: H3Event): string {
    const realIp = normalizeProxyIpHeader(getHeader(event, 'x-real-ip'));
    if (realIp) return realIp;

    // Only the nearest proxy's hop is eligible; the client can supply the prefix.
    const forwardedFor = normalizeProxyIpHeader(getHeader(event, 'x-forwarded-for')?.split(',').at(-1));
    if (forwardedFor) return forwardedFor;

    // Do not re-read a rejected X-Real-IP when no socket address is available.
    return getRequestIP(event, { xForwardedFor: false }) || 'unknown';
}

function getClientIpFromRequest(event: H3Event): string {
    // Use H3's getRequestIP which reads from the socket, not headers
    const socketIp = getRequestIP(event, { xForwardedFor: false });
    if (socketIp) return socketIp;

    // Fallback: trusted reverse proxy header (DDEV nginx)
    const realIp = getHeader(event, 'x-real-ip');
    if (realIp) return realIp;

    return 'unknown';
}
