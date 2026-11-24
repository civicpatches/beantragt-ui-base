import type { H3Event } from 'h3';

function createRequestSecurityError(code: string): Error & { statusCode: number, data: { code: string } } {
    return Object.assign(new Error(code), { statusCode: 403, data: { code } });
}

export function setPrivateNoStore(event: H3Event): void {
    setHeader(event, 'Cache-Control', 'private, no-store');
}

function parseRequestUrl(value: string): URL {
    try {
        return new URL(value);
    } catch {
        throw createRequestSecurityError('errors.security.invalidOrigin');
    }
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function requireSameOriginRequest(event: H3Event): void {
    const host = getHeader(event, 'host');
    const origin = getHeader(event, 'origin');
    const source = origin || getHeader(event, 'referer');

    if (host && source) {
        const url = parseRequestUrl(source);
        const localHttp = url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);
        const protocol = getHeader(event, 'x-forwarded-proto') || (localHttp ? 'http' : 'https');

        if (url.protocol === `${protocol}:`
          && !url.username && !url.password
          && (!origin || origin === url.origin)
          && url.origin === `${protocol}://${host}`) {
            return;
        }
    }

    throw createRequestSecurityError('errors.security.invalidOrigin');
}
