import { getHeader, isError, send, setHeader, setResponseStatus, type H3Event } from 'h3';
import { appBasePath } from '#shared/app-base-path';
import { STAFF_HOST_ERROR } from '#shared/ui-mode';
import { buildDrupalRequestHeaders, drupalSessionRequest } from '../../../utils/auth';
import { checkNewCitizenSession } from '../../../utils/citizen-session';
import { checkRateLimit } from '../../../utils/rate-limit';
import { setPrivateNoStore } from '../../../utils/request-security';
import { DRUPAL_SESSION_COOKIE_NAME_PATTERN } from '../../../utils/session';
import { rawSsoTarget, rejectSsoRequest, ssoLoginClientIp, ssoOperation } from '../../../utils/sso-routing';
import { ssoProxyPublicUrl } from '../../../utils/sso-runtime';
import { serverUiMode } from '../../../utils/ui-mode';

const ACS_MEDIA_TYPE = 'application/x-www-form-urlencoded';
const MAX_ACS_BYTES = 256 * 1024;
const MAX_RESPONSE_BYTES = 512 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
const BODY_TOO_LARGE = Symbol('SSO request body too large');
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const METADATA_TYPE = /^(?:text\/xml|application\/(?:json|xml|samlmetadata\+xml|[a-z0-9._-]+\+json))$/u;

function loginError(event: H3Event, base: string, code = 'unavailable') {
    setHeader(event, 'Location', appBasePath(base, `/auth/login?sso_error=${code}`));
    return rejectSsoRequest(event, 303);
}

function metadataError(event: H3Event, status: number) {
    // These statuses forbid a response body, including the JSON error.
    setResponseStatus(event, status === 204 || status === 205 || status === 304 ? 502 : status);
    return { error: { code: 'unavailable' } };
}

function rejectUnreadAcs(event: H3Event, base: string, code?: string) {
    // A rejected upload may still be sending data. Do not keep that socket alive.
    setHeader(event, 'Connection', 'close');
    return loginError(event, base, code);
}

function isCorrelationDeletion(cookie: string): boolean {
    const [pair = '', ...attributes] = cookie.split(';');
    if (!/^__Host-beantragt_sso_corr_[a-zA-Z0-9_-]+=/u.test(pair)) return false;

    const maxAge = attributes.filter(attribute => /^\s*max-age\s*=/iu.test(attribute));
    if (maxAge.length) return maxAge.length === 1 && /^\s*max-age\s*=\s*(?:0+|-[0-9]+)\s*$/iu.test(maxAge[0]!);
    const expires = attributes.filter(attribute => /^\s*expires\s*=/iu.test(attribute));
    return expires.length === 1 && Date.parse(expires[0]!.split('=')[1]!) <= Date.now();
}

function setCookies(event: H3Event, cookies: string[]) {
    if (cookies.length) setHeader(event, 'Set-Cookie', cookies);
}

function browserLocation(location: string, target: string, publicUrl: URL, apiBase: string, base: string) {
    const url = URL.parse(location, new URL(appBasePath(base, target), publicUrl));
    if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) return null;
    if (url.origin === publicUrl.origin || url.origin === new URL(apiBase).origin) {
        if (url.pathname.startsWith('//')) return null;
        const path = url.pathname === base || url.pathname.startsWith(`${base}/`) ? url.pathname : appBasePath(base, url.pathname);
        return path + url.search + url.hash;
    }
    return url.href;
}

function readAcsBody(event: H3Event, signal: AbortSignal): Promise<Buffer> {
    if (Number(getHeader(event, 'content-length')) > MAX_ACS_BYTES) return Promise.reject(BODY_TOO_LARGE);
    const request = event.node.req;
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        function cleanup() {
            request.off('data', onData).off('end', onEnd).off('error', onError);
            signal.removeEventListener('abort', onTimeout);
        }
        function onError(error: unknown) {
            cleanup();
            request.pause();
            reject(error);
        }
        function onTimeout() {
            onError(signal.reason);
        }
        function onData(chunk: Buffer) {
            bytes += chunk.length;
            if (bytes > MAX_ACS_BYTES) return onError(BODY_TOO_LARGE);
            chunks.push(chunk);
        }
        function onEnd() {
            cleanup();
            resolve(Buffer.concat(chunks, bytes));
        }

        request.once('error', onError).once('end', onEnd).on('data', onData);
        signal.addEventListener('abort', onTimeout, { once: true });
        if (signal.aborted) onTimeout();
        else if (request.readableEnded) onEnd();
    });
}

export default defineEventHandler(async (event) => {
    const config = useRuntimeConfig(event);
    const base = config.app.baseURL.replace(/\/$/u, '');
    const target = rawSsoTarget(event, base);
    const path = target.split('?', 1)[0] || '';
    const operation = ssoOperation(path);
    if (!operation) return rejectSsoRequest(event, 404);
    if (event.method !== operation.method) {
        setHeader(event, 'Allow', operation.method);
        return rejectSsoRequest(event, 405);
    }
    const acs = operation.action === 'acs';
    const metadata = operation.action === 'metadata';
    const mockIdp = operation.action === 'mock-idp';
    const citizenCallback = (acs || operation.action === 'mock-login') && serverUiMode() === 'citizen';
    setPrivateNoStore(event);
    const publicUrl = ssoProxyPublicUrl(event);
    if (publicUrl === 'self-loop') return metadata ? metadataError(event, 503) : rejectSsoRequest(event, 503);
    if (!publicUrl) return metadata ? metadataError(event, 503) : loginError(event, base);

    const clientIp = operation.action === 'login' ? ssoLoginClientIp(event) : null;
    if (operation.action === 'login') {
        if (!clientIp) return loginError(event, base);
        try {
            checkRateLimit(clientIp, 'sso_login');
        } catch (error) {
            return loginError(event, base, isError(error) && error.statusCode === 429 ? 'rate_limited' : 'unavailable');
        }
    }

    if (acs && getHeader(event, 'content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== ACS_MEDIA_TYPE) {
        return rejectUnreadAcs(event, base);
    }

    const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    let body: Buffer | undefined;
    if (acs) {
        try {
            body = await readAcsBody(event, signal);
        } catch (error) {
            return rejectUnreadAcs(event, base, error === BODY_TOO_LARGE ? 'acs_rejected' : 'unavailable');
        }
    }

    try {
        const headers = buildDrupalRequestHeaders(event, { publicUrl, contentType: acs ? ACS_MEDIA_TYPE : undefined });
        if (clientIp) headers['X-Forwarded-For'] = clientIp;
        if (body) headers['Content-Length'] = String(body.length);
        const response = await drupalSessionRequest(event, acs ? path : target, {
            method: operation.method, headers, body, signal,
            redirect: 'manual', maxResponseBytes: MAX_RESPONSE_BYTES
        });
        const contentType = response.headers['content-type'];
        const mediaType = contentType?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
        if (metadata || (mockIdp && response.status === 200)) {
            // The legacy development IdP is the sole HTML exception.
            if (response.status !== 200 || !contentType || (!METADATA_TYPE.test(mediaType) && !(mockIdp && mediaType === 'text/html'))) {
                return metadataError(event, response.status);
            }
            const body = await response.arrayBuffer();
            setHeader(event, 'Content-Type', contentType);
            setHeader(event, 'X-Content-Type-Options', 'nosniff');
            if (mockIdp) setCookies(event, response.setCookieHeaders);
            else setHeader(event, 'Content-Security-Policy', 'sandbox; default-src \'none\'');
            return send(event, Buffer.from(body));
        }

        const correlationCookies = citizenCallback ? response.setCookieHeaders.filter(isCorrelationDeletion) : [];
        const location = response.headers.location?.trim();
        const redirect = location && REDIRECT_STATUSES.has(response.status)
            ? browserLocation(location, target, publicUrl, config.apiBase, base)
            : null;
        if (!redirect) {
            setCookies(event, correlationCookies);
            return loginError(event, base, acs && response.status === 413 ? 'acs_rejected' : 'unavailable');
        }

        let cookies = response.setCookieHeaders;
        if (citizenCallback) {
            const sessionCookies = cookies.filter(cookie =>
                DRUPAL_SESSION_COOKIE_NAME_PATTERN.test(cookie.split('=', 1)[0]?.trim() ?? ''));
            try {
                await checkNewCitizenSession(event, sessionCookies, { publicUrl, signal });
            } catch (error) {
                setCookies(event, correlationCookies);
                const data = isError(error) ? error.data : null;
                const staff = data && typeof data === 'object' && 'code' in data && data.code === STAFF_HOST_ERROR;
                return loginError(event, base, staff ? 'account_ineligible' : 'unavailable');
            }
            cookies = [...correlationCookies, ...sessionCookies];
        }

        setHeader(event, 'Location', redirect);
        setCookies(event, cookies);
        setResponseStatus(event, response.status);
        return send(event, '');
    } catch {
        return metadata ? metadataError(event, signal.aborted ? 504 : 502) : loginError(event, base);
    }
});
