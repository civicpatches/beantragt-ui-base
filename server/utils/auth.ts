/**
 * Server-side auth utilities for beantragt.ai.
 *
 * Authentication strategy:
 * - requireAuth(): Fast cookie check only (no HTTP roundtrip).
 *   The downstream Drupal JSON:API call with the forwarded cookie
 *   IS the real auth check. If the session is stale, Drupal returns 401/403.
 * - requireAdmin(): Roundtrip to /auth/status to verify the administrator role.
 *   Result is cached in event.context for the duration of the request.
 */
import { createHash } from 'node:crypto';
import http from 'node:http';
import type { Readable } from 'node:stream';
import https from 'node:https';
import type { H3Event } from 'h3';
import { hasValidDrupalSession } from './session';
import { createSafeError } from './error-handling';
import { getForwardableClientIp } from './rate-limit';

export interface AuthUser {
    uid: number
    uuid?: string
    email: string
    roles: string[]
    auth_provider?: string
    assurance_level?: string | null
}

interface AuthStatusResponse {
    authenticated: boolean
    user?: AuthUser
}

const ADMIN_ROLES = new Set(['administrator', 'department_admin']);
const STAFF_ROLES = new Set(['administrator', 'department_admin', 'case_worker']);

export function hasStaffRole(user: AuthUser): boolean {
    return user.roles?.some(role => STAFF_ROLES.has(role)) === true;
}

export function citizenAccountKind(user: AuthUser): 'citizen' | 'staff' | 'unknown' {
    const roles = user.roles;
    if (!Array.isArray(roles) || !roles.length || !roles.every(role => typeof role === 'string' && /^[a-z0-9_]+$/u.test(role))) {
        return 'unknown';
    }
    return roles.some(role => STAFF_ROLES.has(role) || role === 'service_account' || role === 'nuxt_service') ? 'staff' : 'citizen';
}

// ─── CSRF Token Cache ────────────────────────────────────────────────
// Module-level cache keyed by cookie header hash. TTL: 30 minutes.
// Drupal CSRF tokens are per-session, so caching by cookie is correct.
const CSRF_CACHE_TTL = 30 * 60 * 1000; // 30 minutes
const csrfCache = new Map<string, { token: string, timestamp: number }>();

interface DrupalRequestHeaderOptions {
    accept?: string
    contentType?: string
    cookieHeader?: string
    publicUrl?: URL
}

interface DrupalSessionRequestOptions {
    signal?: AbortSignal
    method?: string
    headers?: Record<string, string>
    body?: string | Buffer
    maxResponseBytes?: number
    redirect?: RequestRedirect
}

interface DrupalSessionResponse {
    ok: boolean
    status: number
    headers: http.IncomingHttpHeaders
    setCookieHeaders: string[]
    text: () => Promise<string>
    json: <T = unknown>() => Promise<T>
    arrayBuffer: () => Promise<ArrayBuffer>
}

export class DrupalResponseBodyTooLargeError extends Error {
    constructor(public readonly maxBytes: number) {
        super(`Drupal response exceeds the ${maxBytes} byte limit.`);
        this.name = 'DrupalResponseBodyTooLargeError';
    }
}

function getExternalDrupalUrl(_event: H3Event): URL | null {
    const config = useRuntimeConfig();
    const publicConfig = config.public && typeof config.public === 'object'
        ? config.public as Record<string, unknown>
        : {};
    const publicApiBase = typeof publicConfig.apiBase === 'string' ? publicConfig.apiBase : '';

    if (publicApiBase) {
        try {
            return new URL(publicApiBase);
        } catch {
            return null;
        }
    }

    return null;
}

function shouldForwardPublicDrupalHost(apiBase: string, publicDrupalUrl: URL): boolean {
    try {
        return new URL(apiBase).host !== publicDrupalUrl.host;
    } catch {
        return false;
    }
}

export function getDrupalSessionApiBase(event: H3Event): string {
    const config = useRuntimeConfig();
    return config.apiBase || getExternalDrupalUrl(event)?.origin || '';
}

export function buildDrupalRequestHeaders(
    event: H3Event,
    options: DrupalRequestHeaderOptions = {}
): Record<string, string> {
    const config = useRuntimeConfig();
    const headers: Record<string, string> = {};
    const cookieHeader = options.cookieHeader ?? getHeader(event, 'cookie') ?? '';

    if (options.accept) {
        headers.Accept = options.accept;
    }
    if (options.contentType) {
        headers['Content-Type'] = options.contentType;
    }
    if (cookieHeader) {
        headers.Cookie = cookieHeader;
    }
    // Never relays a client-sent header: the value is resolved here.
    const clientIp = getForwardableClientIp(event);
    if (clientIp) {
        headers['X-Forwarded-For'] = clientIp;
    }

    const publicDrupalUrl = options.publicUrl ?? getExternalDrupalUrl(event);
    if (publicDrupalUrl && (options.publicUrl || shouldForwardPublicDrupalHost(config.apiBase, publicDrupalUrl))) {
        headers.Host = publicDrupalUrl.host;
        headers['X-Forwarded-Host'] = publicDrupalUrl.host;
        headers['X-Forwarded-Proto'] = publicDrupalUrl.protocol.replace(':', '');
        if (options.publicUrl) {
            headers['X-Forwarded-Port'] = publicDrupalUrl.port || (publicDrupalUrl.protocol === 'https:' ? '443' : '80');
        }
    }

    return headers;
}

function allowSelfSignedSessionTarget(url: URL): boolean {
    return process.env.NODE_ENV === 'development'
      && (url.hostname.endsWith('.ddev.site') || url.hostname === 'localhost' || url.hostname === '127.0.0.1');
}

function standaloneArrayBuffer(buffer: Buffer): ArrayBuffer {
    return buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength
    ) as ArrayBuffer;
}

async function readBoundedFetchBody(response: Response, maxBytes: number): Promise<ArrayBuffer> {
    const advertisedLength = Number.parseInt(response.headers.get('content-length') || '', 10);
    if (Number.isFinite(advertisedLength) && advertisedLength > maxBytes) {
        await response.body?.cancel();
        throw new DrupalResponseBodyTooLargeError(maxBytes);
    }
    if (!response.body) {
        const body = Buffer.from(await response.arrayBuffer());
        if (body.length > maxBytes) {
            throw new DrupalResponseBodyTooLargeError(maxBytes);
        }
        return standaloneArrayBuffer(body);
    }

    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let bytesRead = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            bytesRead += value.byteLength;
            if (bytesRead > maxBytes) {
                await reader.cancel();
                throw new DrupalResponseBodyTooLargeError(maxBytes);
            }
            chunks.push(Buffer.from(value));
        }
    } finally {
        reader.releaseLock();
    }
    return standaloneArrayBuffer(Buffer.concat(chunks, bytesRead));
}

function sessionResponseFromFetch(response: Response, maxResponseBytes?: number): DrupalSessionResponse {
    const getSetCookie = response.headers.getSetCookie?.bind(response.headers);
    const setCookieHeader = response.headers.get('set-cookie');
    let boundedBody: Promise<ArrayBuffer> | null = null;
    const arrayBuffer = () => {
        if (maxResponseBytes === undefined) {
            return response.arrayBuffer();
        }
        boundedBody ||= readBoundedFetchBody(response, maxResponseBytes);
        return boundedBody;
    };

    return {
        ok: response.ok,
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        setCookieHeaders: getSetCookie
            ? getSetCookie()
            : setCookieHeader
                ? [setCookieHeader]
                : [],
        text: async () => maxResponseBytes === undefined
            ? response.text()
            : Buffer.from(await arrayBuffer()).toString('utf8'),
        json: async <T = unknown>() => maxResponseBytes === undefined
            ? await response.json() as T
            : JSON.parse(Buffer.from(await arrayBuffer()).toString('utf8')) as T,
        arrayBuffer
    };
}

export function drupalSessionRequest(
    event: H3Event,
    path: string,
    options: DrupalSessionRequestOptions = {}
): Promise<DrupalSessionResponse> {
    const url = new URL(path, getDrupalSessionApiBase(event));
    const method = options.method || 'GET';
    const headers = { ...(options.headers || {}) };
    const body = options.body;
    const requiresNativeRequest = Boolean(headers.Host || headers.host) || allowSelfSignedSessionTarget(url);

    if (!requiresNativeRequest) {
        const fetchBody = Buffer.isBuffer(body) ? new Uint8Array(body) : body;
        return fetch(url, {
            method,
            signal: options.signal,
            headers,
            body: fetchBody,
            redirect: options.redirect
        }).then(response => sessionResponseFromFetch(response, options.maxResponseBytes));
    }

    if (body && !headers['Content-Length']) {
        headers['Content-Length'] = Buffer.byteLength(body).toString();
    }

    const requestOptions: http.RequestOptions | https.RequestOptions = {
        method,
        signal: options.signal,
        headers
    };
    if (url.protocol === 'https:' && allowSelfSignedSessionTarget(url)) {
        (requestOptions as https.RequestOptions).rejectUnauthorized = false;
    }

    // Native HTTP(S) requests always return the first response.
    const client = url.protocol === 'https:' ? https : http;

    return new Promise((resolve, reject) => {
        const request = client.request(url, requestOptions, (response) => {
            const chunks: Buffer[] = [];
            let responseBytes = 0;
            let settled = false;
            const advertisedLength = Number.parseInt(String(response.headers['content-length'] || ''), 10);
            const rejectResponse = (error: Error) => {
                if (settled) return;
                settled = true;
                response.destroy();
                reject(error);
            };
            if (
                options.maxResponseBytes !== undefined
                && Number.isFinite(advertisedLength)
                && advertisedLength > options.maxResponseBytes
            ) {
                rejectResponse(new DrupalResponseBodyTooLargeError(options.maxResponseBytes));
                return;
            }

            response.on('data', (chunk: Buffer | string) => {
                if (settled) return;
                const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                responseBytes += buffer.length;
                if (
                    options.maxResponseBytes !== undefined
                    && responseBytes > options.maxResponseBytes
                ) {
                    rejectResponse(new DrupalResponseBodyTooLargeError(options.maxResponseBytes));
                    return;
                }
                chunks.push(buffer);
            });
            response.on('end', () => {
                if (settled) return;
                settled = true;
                const rawBodyBuffer = Buffer.concat(chunks);
                const rawBody = rawBodyBuffer.toString('utf8');
                const status = response.statusCode || 0;
                const setCookieHeader = response.headers['set-cookie'];
                const setCookieHeaders = Array.isArray(setCookieHeader)
                    ? setCookieHeader
                    : setCookieHeader
                        ? [setCookieHeader]
                        : [];

                resolve({
                    ok: status >= 200 && status < 300,
                    status,
                    headers: response.headers,
                    setCookieHeaders,
                    text: async () => rawBody,
                    json: async <T = unknown>() => JSON.parse(rawBody) as T,
                    arrayBuffer: async () => standaloneArrayBuffer(rawBodyBuffer)
                });
            });
            response.on('error', rejectResponse);
        });

        request.on('error', reject);
        if (body) {
            request.write(body);
        }
        request.end();
    });
}

/**
 * Collision-resistant cache key for a cookie header.
 *
 * Keyed into the CSRF token cache, so a key collision would let two distinct
 * sessions share a token. A truncated SHA-256 gives 128 bits of collision
 * resistance; the raw cookie value is never stored.
 */
function hashCookie(cookie: string): string {
    return createHash('sha256').update(cookie, 'utf8').digest('hex').slice(0, 32);
}

/**
 * Build the development-only `data` debug payload for a failed Drupal request.
 *
 * Parses the JSON:API error body when possible; if the body is not valid JSON
 * it falls back to a truncated raw string so a malformed upstream response
 * cannot crash the error path. Returns an empty object outside development.
 */
function devDrupalErrorDebug(errorBody: string): Record<string, unknown> {
    if (process.env.NODE_ENV !== 'development' || !errorBody) {
        return {};
    }
    try {
        return { errors: JSON.parse(errorBody).errors };
    } catch {
        return { rawError: errorBody.substring(0, 500) };
    }
}

function upstreamDrupalErrorCode(errorBody: string, errorMessageCodes: Record<string, string> = {}): string | undefined {
    if (!errorBody) return undefined;
    try {
        const parsed = JSON.parse(errorBody) as {
            errors?: Array<{ code?: unknown, detail?: unknown }>
            error?: { code?: unknown, message?: unknown }
        };
        const first = Array.isArray(parsed.errors) ? parsed.errors[0] : undefined;
        // Only product codes: Drupal core JSON:API may put a numeric exception code here.
        if (typeof first?.code === 'string' && first.code.startsWith('errors.')) return first.code;
        if (typeof parsed.error?.code === 'string') return parsed.error.code;
        const message = first?.detail ?? parsed.error?.message;
        return typeof message === 'string' ? errorMessageCodes[message] : undefined;
    } catch {
        return undefined;
    }
}

export function upstreamDrupalErrorDetail(errorBody: string): string | undefined {
    if (!errorBody) return undefined;
    try {
        const parsed = JSON.parse(errorBody) as {
            errors?: Array<{ detail?: unknown }>
            error?: { message?: unknown }
        };
        const details = Array.isArray(parsed.errors)
            ? [...new Set(parsed.errors
                .slice(0, 10)
                .map(error => typeof error?.detail === 'string' ? error.detail.trim().slice(0, 1000) : '')
                .filter(Boolean))]
            : [];

        if (details.length === 1) return details[0];
        if (details.length > 1) {
            return details
                .map((detail, index) => `${index + 1}. ${detail}`)
                .join(' ')
                .slice(0, 4000);
        }

        const message = parsed.error?.message;
        return typeof message === 'string' && message.trim()
            ? message.trim().slice(0, 4000)
            : undefined;
    } catch {
        return undefined;
    }
}

export function clientDrupalErrorDetail(status: number, errorBody: string): string | undefined {
    if (status !== 400 && status !== 403 && status !== 422) return undefined;

    const detail = upstreamDrupalErrorDetail(errorBody);
    if (status !== 403) return detail;

    const workspaceDetail = 'You are not authorized to manage the selected jurisdiction workspace.';
    return detail === workspaceDetail || detail === `Entity is not valid: ${workspaceDetail}`
        ? detail
        : undefined;
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Require authentication for a server route (fast, no HTTP roundtrip).
 *
 * Checks for a valid Drupal session cookie. The actual session validity
 * is verified when the forwarded cookie hits Drupal's JSON:API.
 * Throws 401 if no session cookie is present.
 */
export function requireAuth(event: H3Event): void {
    if (!hasValidDrupalSession(event)) {
        throw createSafeError({
            statusCode: 401,
            message: 'errors.auth.notAuthenticated',
            data: { code: 'errors.auth.notAuthenticated' }
        });
    }
}

/**
 * Returns the authenticated Drupal user for the forwarded browser session.
 */
export async function getAuthenticatedUser(event: H3Event, freshCookie?: string, signal?: AbortSignal, publicUrl?: URL): Promise<AuthUser> {
    if (freshCookie === undefined && event.context.authUser) {
        return event.context.authUser as AuthUser;
    }

    const apiBase = getDrupalSessionApiBase(event);
    if (!apiBase) {
        throw createSafeError({
            statusCode: 500,
            message: 'errors.server.configuration',
            data: { code: 'errors.server.configuration' }
        });
    }

    const cookieHeader = freshCookie ?? (getHeader(event, 'cookie') || '');
    const response = await drupalSessionRequest(event, '/auth/status', {
        headers: buildDrupalRequestHeaders(event, { accept: 'application/json', cookieHeader, publicUrl }),
        signal,
        redirect: publicUrl ? 'manual' : undefined,
        maxResponseBytes: publicUrl ? 512 * 1024 : undefined
    });

    if (!response.ok) {
        throw createSafeError({
            statusCode: 401,
            message: 'errors.auth.notAuthenticated',
            data: { code: 'errors.auth.notAuthenticated' }
        });
    }

    const data = await response.json() as AuthStatusResponse;
    if (freshCookie === undefined && data.authenticated === false) event.context.drupalConfirmedAnonymous = true;
    if (data.authenticated !== true || !data.user) {
        throw createSafeError({
            statusCode: 401,
            message: 'errors.auth.notAuthenticated',
            data: { code: 'errors.auth.notAuthenticated' }
        });
    }

    const uid = Number(data.user.uid);
    if (!Number.isInteger(uid) || uid <= 0) {
        throw createSafeError({
            statusCode: 401,
            message: 'errors.auth.notAuthenticated',
            data: { code: 'errors.auth.notAuthenticated' }
        });
    }

    const user = { ...data.user, uid };
    if (freshCookie === undefined) event.context.authUser = user;
    return user;
}

/**
 * Require Verwaltung role for a server route (roundtrip to Drupal).
 *
 * Makes a single HTTP call to /auth/status to verify a Verwaltung role.
 * Result is cached in event.context.adminUser so repeated calls within
 * the same request don't trigger additional roundtrips.
 * Throws 401 if not authenticated, 403 if not admin.
 */
export async function requireAdmin(event: H3Event): Promise<AuthUser> {
    // Return cached result if already verified in this request
    if (event.context.adminUser) {
        return event.context.adminUser as AuthUser;
    }

    try {
        const user = await getAuthenticatedUser(event);

        if (!user.roles?.some(role => ADMIN_ROLES.has(role))) {
            throw createSafeError({
                statusCode: 403,
                message: 'errors.auth.accessDenied',
                data: { code: 'errors.auth.accessDenied' }
            });
        }

        // Cache for this request
        event.context.adminUser = user;
        return user;
    } catch (e: unknown) {
    // Re-throw our own errors
        if (e && typeof e === 'object' && 'statusCode' in e) {
            throw e;
        }
        console.error('[auth] Admin verification failed:', e instanceof Error ? e.message : e);
        throw createSafeError({
            statusCode: 401,
            message: 'errors.auth.notAuthenticated',
            data: { code: 'errors.auth.notAuthenticated' }
        });
    }
}

/**
 * Require a staff role for case-processing routes.
 *
 * This is intentionally narrower than administrator access: case workers may
 * enter application-processing surfaces, while configuration routes keep using
 * requireAdmin().
 */
export async function requireStaff(event: H3Event): Promise<AuthUser> {
    if (event.context.staffUser) {
        return event.context.staffUser as AuthUser;
    }
    if (event.context.adminUser) {
        event.context.staffUser = event.context.adminUser;
        return event.context.staffUser as AuthUser;
    }

    try {
        const user = await getAuthenticatedUser(event);

        if (!hasStaffRole(user)) {
            throw createSafeError({
                statusCode: 403,
                message: 'errors.auth.accessDenied',
                data: { code: 'errors.auth.accessDenied' }
            });
        }

        event.context.staffUser = user;
        if (user.roles?.some(role => ADMIN_ROLES.has(role))) {
            event.context.adminUser = user;
        }
        return user;
    } catch (e: unknown) {
        if (e && typeof e === 'object' && 'statusCode' in e) {
            throw e;
        }
        console.error('[auth] Staff verification failed:', e instanceof Error ? e.message : e);
        throw createSafeError({
            statusCode: 401,
            message: 'errors.auth.notAuthenticated',
            data: { code: 'errors.auth.notAuthenticated' }
        });
    }
}

/**
 * Build the HTTP Basic Auth header for the Nuxt service account.
 * Credentials come from server-only runtime config (never exposed to client).
 */
export function getServiceAuthHeader(): string {
    const config = useRuntimeConfig();
    const user = config.drupalServiceUser;
    const pass = config.drupalServicePassword;

    if (!user || !pass) {
        console.error('[auth] NUXT_DRUPAL_SERVICE_USER or NUXT_DRUPAL_SERVICE_PASSWORD not configured');
        throw createSafeError({
            statusCode: 500,
            message: 'errors.server.serviceAccountMissing',
            data: { code: 'errors.server.serviceAccountMissing' }
        });
    }

    return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}

/**
 * Build the service-auth header when credentials are configured.
 */
export function getOptionalServiceAuthHeader(): string {
    const config = useRuntimeConfig();
    const user = config.drupalServiceUser;
    const pass = config.drupalServicePassword;

    if (!user || !pass) return '';

    return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}

/**
 * Fetch a CSRF token from Drupal for cookie-based mutation requests.
 *
 * Forwards the session cookie so Drupal returns the token for the
 * authenticated session (not the anonymous token).
 * Results are cached per session for 30 minutes.
 */
export async function fetchCsrfToken(cookieHeader: string, event?: H3Event, signal?: AbortSignal, publicUrl?: URL): Promise<string> {
    const config = useRuntimeConfig();
    const apiBase = event ? getDrupalSessionApiBase(event) : config.apiBase;
    if (!apiBase) {
        throw createSafeError({
            statusCode: 500,
            message: 'errors.server.configuration',
            data: { code: 'errors.server.configuration' }
        });
    }

    // Check cache
    const cacheKey = hashCookie(cookieHeader);
    const cached = csrfCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < CSRF_CACHE_TTL) {
        return cached.token;
    }

    try {
        const response = event
            ? await drupalSessionRequest(event, '/session/token', {
                signal,
                headers: buildDrupalRequestHeaders(event, { accept: 'text/plain', cookieHeader, publicUrl }),
                redirect: publicUrl ? 'manual' : undefined,
                maxResponseBytes: publicUrl ? 512 * 1024 : undefined
            })
            : await fetch(`${apiBase}/session/token`, {
                method: 'GET',
                signal,
                headers: {
                    Accept: 'text/plain',
                    Cookie: cookieHeader
                }
            });

        if (!response.ok) {
            throw new Error(`CSRF token fetch failed: ${response.status}`);
        }

        const token = await response.text();

        // Cache the token
        csrfCache.set(cacheKey, { token, timestamp: Date.now() });

        return token;
    } catch (e: unknown) {
        console.error('[auth] CSRF token fetch failed:', e instanceof Error ? e.message : e);
        throw createSafeError({
            statusCode: 500,
            message: 'errors.server.csrfTokenFailed',
            data: { code: 'errors.server.csrfTokenFailed' }
        });
    }
}

/**
 * Perform an authenticated Drupal JSON:API request as the current browser user.
 * Mutations include the user's CSRF token so Drupal permissions remain the
 * source of truth instead of upgrading writes to the Nuxt service account.
 */
export async function drupalSessionFetch<T>(
    event: H3Event,
    path: string,
    options: {
        method?: string
        body?: unknown
        errorMessageCodes?: Record<string, string>
        expectedRevisionId?: number
        maxResponseBytes?: number
        signal?: AbortSignal
    } = {}
): Promise<T> {
    requireAuth(event);

    const apiBase = getDrupalSessionApiBase(event);
    if (!apiBase) {
        throw createSafeError({
            statusCode: 500,
            message: 'errors.server.configuration',
            data: { code: 'errors.server.configuration' }
        });
    }

    const method = (options.method || 'GET').toUpperCase();
    const cookieHeader = getHeader(event, 'cookie') || '';
    const headers = buildDrupalRequestHeaders(event, {
        accept: 'application/vnd.api+json',
        contentType: 'application/vnd.api+json',
        cookieHeader
    });

    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
        headers['X-CSRF-Token'] = await fetchCsrfToken(cookieHeader, event, options.signal);
    }
    if (Number.isInteger(options.expectedRevisionId) && Number(options.expectedRevisionId) > 0) {
        headers['X-Beantragt-Expected-Revision'] = String(options.expectedRevisionId);
    }

    const response = await drupalSessionRequest(event, path, {
        method,
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        maxResponseBytes: options.maxResponseBytes,
        signal: options.signal
    });

    if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        const upstreamCode = upstreamDrupalErrorCode(errorBody, options.errorMessageCodes);
        if (response.status === 403 && upstreamCode === 'errors.auth.csrfInvalid') {
            csrfCache.delete(hashCookie(cookieHeader));
        }
        console.error(`[drupalSessionFetch] ${response.status} for ${path}`);
        throw createSafeError({
            statusCode: response.status,
            message: 'errors.server.drupalRequestFailed',
            data: {
                code: 'errors.server.drupalRequestFailed',
                upstreamCode,
                detail: clientDrupalErrorDetail(response.status, errorBody),
                ...devDrupalErrorDebug(errorBody)
            }
        });
    }

    if (response.status === 204) {
        return undefined as T;
    }

    const responseBody = await response.text();
    return responseBody ? JSON.parse(responseBody) as T : undefined as T;
}

/**
 * Perform an authenticated fetch to Drupal's JSON:API as the service account.
 * Uses HTTP Basic Auth. No CSRF token needed since Basic Auth is not
 * vulnerable to CSRF attacks (credentials are not sent automatically
 * by browsers like cookies are).
 */
export async function drupalServiceFetch<T>(
    path: string,
    options: {
        method?: string
        body?: unknown
        headers?: Record<string, string>
        signal?: AbortSignal
    } = {}
): Promise<T> {
    const config = useRuntimeConfig();
    const apiBase = config.apiBase;
    if (!apiBase) {
        throw createSafeError({
            statusCode: 500,
            message: 'errors.server.configuration',
            data: { code: 'errors.server.configuration' }
        });
    }

    const url: string = `${apiBase}${path}`;
    const response = await fetch(url, {
        method: options.method || 'GET',
        headers: {
            'Content-Type': 'application/vnd.api+json',
            'Accept': 'application/vnd.api+json',
            'Authorization': getServiceAuthHeader(),
            ...(options.headers || {})
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: options.signal
    });

    if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        console.error(`[drupalServiceFetch] ${response.status} for ${path}`);
        throw createSafeError({
            statusCode: response.status,
            message: 'errors.server.drupalRequestFailed',
            data: {
                code: 'errors.server.drupalRequestFailed',
                upstreamCode: upstreamDrupalErrorCode(errorBody),
                detail: clientDrupalErrorDetail(response.status, errorBody),
                ...devDrupalErrorDebug(errorBody)
            }
        });
    }

    if (response.status === 204) {
        return undefined as T;
    }

    return response.json() as Promise<T>;
}

/**
 * Fetch a public Drupal API route without service-account credentials.
 */
export async function drupalPublicFetch<T>(
    path: string,
    options: {
        headers?: Record<string, string>
        signal?: AbortSignal
    } = {}
): Promise<T> {
    const config = useRuntimeConfig();
    const apiBase = config.apiBase;
    if (!apiBase) {
        throw createSafeError({
            statusCode: 500,
            message: 'errors.server.configuration',
            data: { code: 'errors.server.configuration' }
        });
    }

    const response = await fetch(`${apiBase}${path}`, {
        headers: {
            Accept: 'application/json',
            ...(options.headers || {})
        },
        signal: options.signal
    });

    if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        console.error(`[drupalPublicFetch] ${response.status} for ${path}`);
        throw createSafeError({
            statusCode: response.status,
            message: 'errors.server.drupalRequestFailed',
            data: {
                code: 'errors.server.drupalRequestFailed',
                upstreamCode: upstreamDrupalErrorCode(errorBody),
                detail: clientDrupalErrorDetail(response.status, errorBody),
                ...devDrupalErrorDebug(errorBody)
            }
        });
    }

    if (response.status === 204) {
        return undefined as T;
    }

    return response.json() as Promise<T>;
}

/** Streaming staff transport with the same host/TLS/session rules as JSON calls.
 * Never follows redirects, retries or buffers a file body.
 */
export function drupalSessionStreamRequest(
    event: H3Event,
    path: string,
    options: { method?: string, headers: Record<string, string>, body?: Readable }
): Promise<http.IncomingMessage> {
    const url = new URL(path, getDrupalSessionApiBase(event));
    const client = url.protocol === 'https:' ? https : http;
    return new Promise((resolve, reject) => {
        const request = client.request(url, {
            method: options.method || 'GET', headers: options.headers,
            ...(url.protocol === 'https:' && allowSelfSignedSessionTarget(url) ? { rejectUnauthorized: false } : {})
        }, (response) => {
            response.once('close', cleanup);
            resolve(response);
        });
        // Socket timeout below bounds inactivity; this bounds slow trickle uploads
        // and their response even when bytes keep arriving.
        const deadline = options.body
            ? setTimeout(() => request.destroy(new Error('Staff stream deadline exceeded')), 30 * 60_000)
            : undefined;
        deadline?.unref();
        const onAbort = () => request.destroy(new Error('Staff stream aborted'));
        const cleanup = () => {
            clearTimeout(deadline);
            event.node.req.off('aborted', onAbort);
            event.node.res.off('close', onAbort);
        };
        event.node.req.once('aborted', onAbort);
        event.node.res.once('close', onAbort);
        request.setTimeout(180000, () => request.destroy(new Error('Staff stream timed out')));
        request.once('error', (error) => {
            cleanup();
            reject(error);
        });
        request.once('close', () => {
            cleanup();
            options.body?.destroy();
        });
        if (options.body) {
            options.body.once('error', error => request.destroy(error));
            options.body.pipe(request);
        } else request.end();
    });
}
