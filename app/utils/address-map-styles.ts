export type AddressMapStyleTier = 'primary' | 'fallback';

export interface AddressMapStyleSettings {
    legacy?: unknown
    light?: unknown
    dark?: unknown
    fallbackLight?: unknown
    fallbackDark?: unknown
}

export interface AddressMapStyleCandidate {
    url: string
    tier: AddressMapStyleTier
}

function normalizeStyleUrl(value: unknown, baseOrigin: string, allowInsecureLocalhost: boolean): string | null {
    if (typeof value !== 'string') return null;
    const url = value.trim();
    if (!url || url.startsWith('//')) return null;
    try {
        const parsed = new URL(url, baseOrigin);
        if (url.startsWith('/')) {
            return parsed.origin === new URL(baseOrigin).origin ? url : null;
        }
        if (parsed.protocol === 'https:') return url;
        const localHost = parsed.hostname === 'localhost'
          || parsed.hostname === '127.0.0.1'
          || parsed.hostname === '[::1]';
        return allowInsecureLocalhost && parsed.protocol === 'http:' && localHost ? url : null;
    } catch {
        return null;
    }
}

export function getAddressMapStyleCandidates(
    settings: AddressMapStyleSettings,
    darkMode: boolean,
    options: { baseOrigin?: string, allowInsecureLocalhost?: boolean } = {}
): AddressMapStyleCandidate[] {
    const baseOrigin = options.baseOrigin || 'https://beantragt.invalid';
    const allowInsecureLocalhost = options.allowInsecureLocalhost === true;
    const candidates: AddressMapStyleCandidate[] = [];
    const seen = new Set<string>();
    const add = (value: unknown, tier: AddressMapStyleTier) => {
        const url = normalizeStyleUrl(value, baseOrigin, allowInsecureLocalhost);
        if (!url || seen.has(url)) return;
        seen.add(url);
        candidates.push({ url, tier });
    };

    if (darkMode) {
        add(settings.dark, 'primary');
        add(settings.fallbackDark, 'fallback');
        add(settings.legacy, 'primary');
        add(settings.light, 'primary');
        add(settings.fallbackLight, 'fallback');
    } else {
        add(settings.light, 'primary');
        add(settings.fallbackLight, 'fallback');
        add(settings.legacy, 'primary');
        add(settings.dark, 'primary');
        add(settings.fallbackDark, 'fallback');
    }

    return candidates;
}
