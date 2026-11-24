import type { LocationQueryRaw } from 'vue-router';
import {
    publicWorkspacePath,
    type PublicFormPathInput
} from '~/utils/public-form-path';

export type SupportedLocale = 'de' | 'en';
export type PublicContentPageKey = 'privacy' | 'legal_notice' | 'accessibility' | 'easy_language' | 'sign_language';

export const SUPPORTED_LOCALES: readonly SupportedLocale[] = ['de', 'en'];
export const PUBLIC_CONTENT_PAGE_KEYS: readonly PublicContentPageKey[] = [
    'privacy',
    'legal_notice',
    'accessibility',
    'easy_language',
    'sign_language'
];
export const LOCALE_STORAGE_KEY = 'beantragt.locale';

const PUBLIC_CONTENT_PAGE_SLUGS: Record<PublicContentPageKey, Record<SupportedLocale, string>> = {
    privacy: {
        de: 'datenschutz',
        en: 'privacy'
    },
    legal_notice: {
        de: 'impressum',
        en: 'legal-notice'
    },
    accessibility: {
        de: 'barrierefreiheit',
        en: 'accessibility'
    },
    easy_language: {
        de: 'leichte-sprache',
        en: 'easy-language'
    },
    sign_language: {
        de: 'gebaerdensprache',
        en: 'sign-language'
    }
};

function matchPublicContentPagePath(path: string): {
    key: PublicContentPageKey
    locale: SupportedLocale
    slug: string
    prefix: string
} | null {
    const normalized = (path.split(/[?#]/u, 1)[0] || '/').replace(/\/+$/u, '') || '/';
    const segments = normalized.split('/');
    const slug = segments.pop() || '';
    const prefix = segments.join('/') || '';
    if (prefix !== '') {
        return null;
    }

    for (const [key, locales] of Object.entries(PUBLIC_CONTENT_PAGE_SLUGS) as Array<[PublicContentPageKey, Record<SupportedLocale, string>]>) {
        for (const locale of SUPPORTED_LOCALES) {
            if (locales[locale] === slug) {
                return { key, locale, slug, prefix };
            }
        }
    }

    return null;
}

export function normalizeSupportedLocale(value: unknown): SupportedLocale | null {
    const raw = Array.isArray(value) ? value[0] : value;
    if (typeof raw !== 'string') return null;

    const normalized = raw.trim().toLowerCase();
    return normalized === 'de' || normalized === 'en' ? normalized : null;
}

export function isPublicContentPageKey(value: unknown): value is PublicContentPageKey {
    return typeof value === 'string' && (PUBLIC_CONTENT_PAGE_KEYS as readonly string[]).includes(value);
}

/**
 * The standard page a workspace page identifier names: its key
 * (`legal_notice`) or one of its two slugs (`impressum`, `legal-notice`).
 */
export function publicContentPageKeyFromIdentifier(identifier: unknown): PublicContentPageKey | null {
    if (typeof identifier !== 'string') return null;
    const normalized = identifier.trim().toLowerCase();
    if (isPublicContentPageKey(normalized)) return normalized;
    for (const [key, slugs] of Object.entries(PUBLIC_CONTENT_PAGE_SLUGS) as Array<[PublicContentPageKey, Record<SupportedLocale, string>]>) {
        if (slugs.de === normalized || slugs.en === normalized) return key;
    }
    return null;
}

export function localeOrDefault(value: unknown, fallback: SupportedLocale = 'de'): SupportedLocale {
    return normalizeSupportedLocale(value) ?? fallback;
}

export function withLocaleQuery(
    query: Record<string, unknown>,
    locale: SupportedLocale
): LocationQueryRaw {
    const nextQuery: LocationQueryRaw = {};
    for (const [key, value] of Object.entries(query)) {
        if (typeof value === 'string' || typeof value === 'number' || value === null || value === undefined) {
            nextQuery[key] = value;
        } else if (Array.isArray(value)) {
            nextQuery[key] = value.filter((item): item is string | number => typeof item === 'string' || typeof item === 'number');
        }
    }
    nextQuery.lang = locale;
    return nextQuery;
}

export function pathForLocaleSwitch(path: string, locale: SupportedLocale): string {
    const match = matchPublicContentPagePath(path);
    if (match) {
        return `${match.prefix}/${PUBLIC_CONTENT_PAGE_SLUGS[match.key][locale]}`;
    }
    return path;
}

export function localeFromPath(path: string): SupportedLocale | null {
    return matchPublicContentPagePath(path)?.locale ?? null;
}

/** The locale of the app when nothing else decides: no `?lang=`, no language in the path, nothing chosen. */
export const DEFAULT_LOCALE: SupportedLocale = 'de';

export interface RouteLocaleDecision {
    /** Locale the page shows. */
    locale: SupportedLocale
    /** Path to replace the current one with (a legal page in the other language), or null. */
    redirectPath: string | null
}

/**
 * The language of one public page. Order: `?lang=` in the URL, then
 * the language of a legal page path (`/privacy` is English), then the
 * language the person chose in the language switcher, then German.
 *
 * Only the choice in the switcher is stored; this function never stores, so
 * reading one page in English does not turn every later page English.
 */
export function resolveRouteLocale(input: {
    path: string
    queryLang: unknown
    chosenLocale: SupportedLocale | null
}): RouteLocaleDecision {
    const queryLocale = normalizeSupportedLocale(input.queryLang);
    const locale = queryLocale ?? localeFromPath(input.path) ?? input.chosenLocale ?? DEFAULT_LOCALE;
    const nextPath = pathForLocaleSwitch(input.path, locale);
    return {
        locale,
        redirectPath: nextPath !== input.path ? nextPath : null
    };
}

/** The language the person chose in a language switcher, or null. */
export function readChosenLocale(): SupportedLocale | null {
    try {
        return normalizeSupportedLocale(globalThis.localStorage?.getItem(LOCALE_STORAGE_KEY));
    } catch {
        return null;
    }
}

/** Stores the choice of a language switcher; the only writer of `beantragt.locale`. */
export function storeChosenLocale(locale: SupportedLocale): void {
    try {
        globalThis.localStorage?.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
        // Storage can be blocked in strict privacy or embed contexts.
    }
}

export function shouldPersistLocaleOnPath(path: string): boolean {
    if (!path || path.startsWith('/api') || path.startsWith('/_nuxt')) return false;
    return !/(^|\/)admin(?:\/|$)/u.test(path);
}

export function localizedPath(path: string, locale: unknown): string {
    const normalized = localeOrDefault(locale);
    const [pathAndQuery = '', hash = ''] = path.split('#', 2);
    const [basePath, queryString = ''] = pathAndQuery.split('?', 2);
    const query = new URLSearchParams(queryString);
    query.set('lang', normalized);

    const serializedQuery = query.toString();
    return `${basePath}${serializedQuery ? `?${serializedQuery}` : ''}${hash ? `#${hash}` : ''}`;
}

export function localizedPrivacyPath(locale: unknown, workspace: PublicFormPathInput = {}): string {
    return localizedContentPagePath('privacy', locale, workspace);
}

export function localizedLegalNoticePath(locale: unknown, workspace: PublicFormPathInput = {}): string {
    return localizedContentPagePath('legal_notice', locale, workspace);
}

export function localizedContentPagePath(
    pageKey: PublicContentPageKey,
    locale: unknown,
    workspace: PublicFormPathInput = {}
): string {
    const normalized = localeOrDefault(locale);
    const prefix = publicWorkspacePath(workspace);
    const identifier = prefix ? pageKey : PUBLIC_CONTENT_PAGE_SLUGS[pageKey][normalized];
    return localizedPath(prefix ? `${prefix}/pages/${identifier}` : `/${identifier}`, normalized);
}
