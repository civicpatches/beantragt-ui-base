import type { H3Event } from 'h3';

export const ssoDevelopment = Boolean(import.meta.dev);

function httpUrl(value: string): URL | null {
    const url = URL.parse(value);
    return url && (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password ? url : null;
}

export function ssoPublicUiUrl(event: H3Event): URL | null {
    return httpUrl(useRuntimeConfig(event).uiPublicUrl || process.env.UI_PUBLIC_URL || '');
}

let originErrorLogged = false;
let selfLoopErrorLogged = false;

export function ssoProxyPublicUrl(event: H3Event): URL | 'self-loop' | null {
    const config = useRuntimeConfig(event);
    const uiUrl = ssoPublicUiUrl(event);
    const internalUrl = httpUrl(config.apiBase);
    if (uiUrl && internalUrl?.origin === uiUrl.origin) {
        if (!selfLoopErrorLogged) {
            selfLoopErrorLogged = true;
            console.error('[sso] NUXT_API_BASE must differ from the UI public origin.');
        }
        return 'self-loop';
    }
    if (uiUrl && internalUrl && httpUrl(config.public.apiBase)?.origin === uiUrl.origin) return uiUrl;

    if (!originErrorLogged) {
        originErrorLogged = true;
        console.error('[sso] Set NUXT_API_BASE to internal Drupal and NUXT_PUBLIC_API_BASE to the same origin as NUXT_UI_PUBLIC_URL (or UI_PUBLIC_URL).');
    }
    return null;
}
