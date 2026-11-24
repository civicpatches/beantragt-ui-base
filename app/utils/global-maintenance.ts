export interface GlobalMaintenanceStatus {
    maintenance: boolean
}

export function normalizeGlobalMaintenanceStatus(value: unknown): GlobalMaintenanceStatus | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (Object.keys(record).length !== 1 || typeof record.maintenance !== 'boolean') return null;
    return { maintenance: record.maintenance };
}

export function requestErrorStatus(error: unknown): number | null {
    const candidate = (error ?? {}) as {
        statusCode?: unknown
        status?: unknown
        response?: { status?: unknown }
        data?: { statusCode?: unknown }
    };
    const status = candidate.statusCode
      ?? candidate.status
      ?? candidate.response?.status
      ?? candidate.data?.statusCode;
    return typeof status === 'number' ? status : null;
}

export function isMaintenanceRoute(path: string): boolean {
    return path.replace(/\/+$/u, '') === '/maintenance';
}

/**
 * Accept only a same-site absolute path. Backslashes and protocol-relative
 * forms are rejected because browsers may normalize them into another host.
 */
export function validInternalReturnPath(value: unknown, fallback = '/'): string {
    const candidate = Array.isArray(value) ? value[0] : value;
    const containsControlCharacter = typeof candidate === 'string'
      && [...candidate].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
    if (typeof candidate !== 'string'
      || !candidate.startsWith('/')
      || candidate.startsWith('//')
      || candidate.includes('\\')
      || containsControlCharacter) {
        return fallback;
    }

    try {
        const url = new URL(candidate, 'https://beantragt.invalid');
        if (url.origin !== 'https://beantragt.invalid') return fallback;
        const path = `${url.pathname}${url.search}${url.hash}`;
        return isMaintenanceRoute(url.pathname) ? fallback : path;
    } catch {
        return fallback;
    }
}

export function internalReturnPathForLocale(value: unknown, locale: unknown): string {
    const returnPath = validInternalReturnPath(value);
    if (locale !== 'de' && locale !== 'en') return returnPath;

    const url = new URL(returnPath, 'https://beantragt.invalid');
    url.searchParams.set('lang', locale);
    return `${url.pathname}${url.search}${url.hash}`;
}

export function maintenanceRouteTarget(returnTo: unknown): {
    path: string
    query: { returnTo: string, lang?: 'de' | 'en' }
} {
    const returnPath = validInternalReturnPath(returnTo);
    const locale = new URL(returnPath, 'https://beantragt.invalid').searchParams.get('lang');
    return {
        path: '/maintenance',
        query: {
            returnTo: returnPath,
            ...(locale === 'de' || locale === 'en' ? { lang: locale } : {})
        }
    };
}
