import { send, setResponseStatus, type H3Event } from 'h3';
import { canonicalizeSegments, fullyDecoded } from '../../shared/ui-path';
import { getForwardableClientIp, getProxyHeaderClientIp } from './rate-limit';
import { ssoDevelopment } from './sso-runtime';
import { setPrivateNoStore } from './request-security';

export const SSO_ROUTE = '/auth/sso/**:path';
export const SSO_LOGIN_ROUTE = '/api/auth/sso-login';
export const SSO_AVAILABILITY_ROUTE = '/api/auth/sso-bundid-availability';
export const SSO_PROVIDER_ID = /^[a-zA-Z0-9_-]+$/u;

export function ssoOperation(path: string) {
    const action = /^\/auth\/sso\/[a-zA-Z0-9_-]+\/(login|acs|metadata|mock-idp|mock-login)$/u.exec(path)?.[1];
    if (!action) return null;
    if (!ssoDevelopment && (action === 'mock-idp' || action === 'mock-login')) return null;
    return { action, method: action === 'acs' ? 'POST' : 'GET' } as const;
}

export function isSsoNamespace(path: string): boolean {
    const prefix = /^\/auth\/sso(?:\/|$)/iu;
    if (prefix.test(path)) return true;
    const decoded = fullyDecoded(path).replace(/[/\\]+/gu, '/');
    return prefix.test(decoded) || prefix.test(canonicalizeSegments(decoded));
}

export function rawSsoTarget(event: H3Event, base: string): string {
    // H3 decodes the routed path before invoking handlers. Never validate that
    // representation because Drupal and other HTTP hops can normalize it again.
    const target = event.node.req.originalUrl || event.node.req.url || event.path;
    return base && target.startsWith(`${base}/`) ? target.slice(base.length) : target;
}

export function rejectSsoRequest(event: H3Event, status: number) {
    setPrivateNoStore(event);
    setResponseStatus(event, status);
    return send(event, '');
}

let proxyIpErrorLogged = false;

export function ssoLoginClientIp(event: H3Event): string | null {
    // Nuxt dev's internal server adapter may omit the socket peer.
    if (ssoDevelopment) return getForwardableClientIp(event) ?? '127.0.0.1';

    const ip = useRuntimeConfig(event).trustProxyIpHeaders === true ? getProxyHeaderClientIp(event) : null;
    if (ip) return ip;

    if (!proxyIpErrorLogged) {
        proxyIpErrorLogged = true;
        console.error('[sso] Login requires NUXT_TRUST_PROXY_IP_HEADERS=true and a client IP supplied by the trusted proxy.');
    }
    return null;
}
