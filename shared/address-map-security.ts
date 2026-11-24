interface AddressMapEnvironment {
    [key: string]: string | undefined
    NUXT_PUBLIC_ADDRESS_MAP_STYLE_URL?: string
    NUXT_PUBLIC_ADDRESS_MAP_STYLE_URL_LIGHT?: string
    NUXT_PUBLIC_ADDRESS_MAP_STYLE_URL_DARK?: string
    NUXT_PUBLIC_ADDRESS_MAP_FALLBACK_STYLE_URL_LIGHT?: string
    NUXT_PUBLIC_ADDRESS_MAP_FALLBACK_STYLE_URL_DARK?: string
    NUXT_PUBLIC_ADDRESS_MAP_ALLOWED_ORIGINS?: string
}

function normalizeOrigin(value: string, development: boolean): string | null {
    const candidate = value.trim();
    if (!candidate || candidate.startsWith('/')) return null;
    try {
        const parsed = new URL(candidate);
        if (parsed.username || parsed.password || parsed.origin === 'null') return null;
        if (parsed.protocol === 'https:') return parsed.origin;
        const localHost = parsed.hostname === 'localhost'
          || parsed.hostname === '127.0.0.1'
          || parsed.hostname === '[::1]';
        return development && parsed.protocol === 'http:' && localHost ? parsed.origin : null;
    } catch {
        return null;
    }
}

export function addressMapResourceOrigins(
    environment: AddressMapEnvironment,
    development: boolean
): string[] {
    const values = [
        environment.NUXT_PUBLIC_ADDRESS_MAP_STYLE_URL,
        environment.NUXT_PUBLIC_ADDRESS_MAP_STYLE_URL_LIGHT,
        environment.NUXT_PUBLIC_ADDRESS_MAP_STYLE_URL_DARK,
        environment.NUXT_PUBLIC_ADDRESS_MAP_FALLBACK_STYLE_URL_LIGHT,
        environment.NUXT_PUBLIC_ADDRESS_MAP_FALLBACK_STYLE_URL_DARK,
        ...(environment.NUXT_PUBLIC_ADDRESS_MAP_ALLOWED_ORIGINS || '').split(',')
    ];
    return [...new Set(values
        .filter((value): value is string => typeof value === 'string')
        .map(value => normalizeOrigin(value, development))
        .filter((origin): origin is string => Boolean(origin))
    )];
}

export function addressMapContentSecurityPolicy(
    environment: AddressMapEnvironment,
    development: boolean
): string {
    const origins = addressMapResourceOrigins(environment, development);
    const external = origins.length > 0 ? ` ${origins.join(' ')}` : '';
    const devSockets = development ? ' ws: wss:' : '';
    return [
        `connect-src 'self'${devSockets}${external}`,
        `img-src 'self' data: blob:${external}`
    ].join('; ');
}
