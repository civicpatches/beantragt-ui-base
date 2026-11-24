import { readRuntimeSecret } from './runtime-secret';

interface IntelligenceRuntimeConfig {
    intelligenceServiceBaseUrl?: unknown
    intelligenceServiceKey?: unknown
}

const BLOCKED_INTELLIGENCE_HOSTS = new Set([
    '169.254.169.254',
    'metadata.google.internal',
    'metadata.google.internal.'
]);
const INTERNAL_SERVICE_HOST_PATTERN = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/u;

export class IntelligenceServiceRequestError extends Error {
    constructor(
        public readonly reason: 'configuration' | 'timeout' | 'unavailable' | 'rejected' | 'invalid_response',
        public readonly statusCode?: number
    ) {
        super(`intelligence_service_${reason}`);
        this.name = 'IntelligenceServiceRequestError';
    }
}

export function normalizedServiceAuthorization(value: unknown): string {
    if (typeof value !== 'string') return '';
    const key = value.trim();
    if (!key) return '';
    return /^(?:Basic|Bearer)\s+\S+$/i.test(key) ? key : `Bearer ${key}`;
}

export function configuredIntelligenceServiceKey(): string {
    const config = useRuntimeConfig() as IntelligenceRuntimeConfig;
    return normalizedServiceAuthorization(
        config.intelligenceServiceKey
        || readRuntimeSecret({
            valueNames: [
                'NUXT_INTELLIGENCE_SERVICE_KEY',
                'INTELLIGENCE_SERVICE_KEY'
            ],
            fileNames: [
                'NUXT_INTELLIGENCE_SERVICE_KEY_FILE',
                'INTELLIGENCE_SERVICE_KEY_FILE'
            ]
        })
    );
}

function isLoopbackHost(hostname: string): boolean {
    const normalized = hostname.toLowerCase().replace(/\.$/u, '');
    return normalized === 'localhost'
      || normalized === '127.0.0.1'
      || normalized === '::1'
      || normalized === '[::1]';
}

function isTruthy(value: string | undefined): boolean {
    return ['1', 'true', 'yes', 'on'].includes(value?.trim().toLowerCase() || '');
}

function normalizedInternalServiceHosts(names: readonly string[]): Set<string> {
    const configured = names
        .map(name => process.env[name]?.trim() || '')
        .find(Boolean) || '';

    return new Set(configured
        .split(',')
        .map(host => host.trim().toLowerCase().replace(/\.$/u, ''))
        .filter(host => INTERNAL_SERVICE_HOST_PATTERN.test(host))
    );
}

function isAllowedInternalHttpHost(
    hostname: string,
    allowHttpNames: readonly string[],
    localHostNames: readonly string[]
): boolean {
    if (!allowHttpNames.some(name => isTruthy(process.env[name]))) {
        return false;
    }

    return normalizedInternalServiceHosts(localHostNames)
        .has(hostname.toLowerCase().replace(/\.$/u, ''));
}

export function intelligenceServiceAuthorization(_url: URL): string {
    return configuredIntelligenceServiceKey();
}

export function validatedIntelligenceServiceUrl(options: {
    base: string
    pathname: string
    allowHttpNames: readonly string[]
    localHostNames: readonly string[]
}): URL {
    let url: URL;
    try {
        if (!options.base) throw new Error('missing_base_url');
        url = new URL(options.pathname, `${options.base.replace(/\/+$/u, '')}/`);
    } catch {
        throw new IntelligenceServiceRequestError('configuration');
    }
    const hostname = url.hostname.toLowerCase();
    if (
        !['http:', 'https:'].includes(url.protocol)
        || url.username
        || url.password
        || BLOCKED_INTELLIGENCE_HOSTS.has(hostname)
        || hostname.startsWith('169.254.')
        || (
            url.protocol === 'http:'
            && !isLoopbackHost(hostname)
            && !isAllowedInternalHttpHost(
                hostname,
                options.allowHttpNames,
                options.localHostNames
            )
        )
    ) {
        throw new IntelligenceServiceRequestError('configuration');
    }
    return url;
}

export function intelligenceServiceUrl(pathname: string): URL {
    const config = useRuntimeConfig() as IntelligenceRuntimeConfig;
    const configuredBase = typeof config.intelligenceServiceBaseUrl === 'string'
        ? config.intelligenceServiceBaseUrl.trim()
        : '';
    const base = configuredBase
      || process.env.NUXT_INTELLIGENCE_SERVICE_BASE_URL
      || process.env.INTELLIGENCE_SERVICE_BASE_URL
      || '';
    return validatedIntelligenceServiceUrl({
        base,
        pathname,
        allowHttpNames: [
            'NUXT_INTELLIGENCE_SERVICE_ALLOW_HTTP',
            'INTELLIGENCE_SERVICE_ALLOW_HTTP'
        ],
        localHostNames: [
            'NUXT_INTELLIGENCE_SERVICE_LOCAL_HOSTS',
            'INTELLIGENCE_SERVICE_LOCAL_HOSTS'
        ]
    });
}
