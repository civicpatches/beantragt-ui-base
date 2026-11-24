import type { GeocodingResult, NormalizedGeocodingAddress } from '~~/app/types/form';
import { formatStructuredAddress } from '~~/app/utils/form-address';
import type { GeocodingProvider } from './types';

interface PhotonFeature {
    geometry?: { coordinates?: unknown }
    properties?: Record<string, unknown>
}

interface PhotonResponse {
    features?: PhotonFeature[]
}

type GeocodingFetch = <T>(url: string, options: Record<string, unknown>) => Promise<T>;

const ALLOWED_LANGUAGES = new Set(['de', 'en', 'fr', 'it']);
const MAX_QUERY_LENGTH = 500;

function providerBaseUrl(value: string): URL {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
        throw new Error('Invalid Photon base URL');
    }
    url.search = '';
    url.hash = '';
    url.pathname = `${url.pathname.replace(/\/+$/u, '')}/`;
    return url;
}

function stringPart(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const normalized = value.trim().replace(/\s+/gu, ' ');
    return normalized ? normalized.slice(0, 200) : undefined;
}

function normalizedAddress(properties: Record<string, unknown>): NormalizedGeocodingAddress {
    const countryCode = stringPart(properties.countrycode)?.slice(0, 2).toUpperCase();
    return {
        street: stringPart(properties.street)
          || (properties.type === 'street' ? stringPart(properties.name) : undefined),
        houseNumber: stringPart(properties.housenumber),
        postcode: stringPart(properties.postcode),
        city: stringPart(properties.city) || stringPart(properties.locality),
        district: stringPart(properties.suburb)
          || stringPart(properties.neighbourhood)
          || stringPart(properties.locality)
          || stringPart(properties.district),
        state: stringPart(properties.state),
        country: stringPart(properties.country),
        countryCode
    };
}

function transformFeature(feature: PhotonFeature): GeocodingResult | null {
    const coordinates = feature.geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
    const lng = Number(coordinates[0]);
    const lat = Number(coordinates[1]);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) return null;

    const properties = feature.properties || {};
    const address = normalizedAddress(properties);
    const formattedAddress = formatStructuredAddress(address);
    const placeName = properties.type !== 'street' ? stringPart(properties.name) : undefined;
    const displayName = [placeName, formattedAddress].filter(Boolean).join(', ')
      || stringPart(properties.name)
      || [lat.toFixed(6), lng.toFixed(6)].join(', ');
    return { lat, lng, displayName, address };
}

function language(value: string | undefined): string {
    const base = String(value || '').trim().toLowerCase().split('-')[0] || 'de';
    return ALLOWED_LANGUAGES.has(base) ? base : 'de';
}

function limit(value: number | undefined): number {
    return Number.isInteger(value) && Number(value) > 0 ? Math.min(Number(value), 10) : 5;
}

export function createPhotonProvider(baseUrl: string, fetcher?: GeocodingFetch): GeocodingProvider {
    const base = providerBaseUrl(baseUrl);
    const request = fetcher ?? ($fetch as unknown as GeocodingFetch);
    return {
        name: 'photon',
        async geocode(query, options = {}) {
            const normalizedQuery = query.trim();
            if (!normalizedQuery || normalizedQuery.length > MAX_QUERY_LENGTH) return [];
            const url = new URL('api/', base);
            url.searchParams.set('q', normalizedQuery);
            url.searchParams.set('limit', String(limit(options.limit)));
            url.searchParams.set('lang', language(options.language));
            if (options.bbox) url.searchParams.set('bbox', options.bbox);
            if (options.centerPoint) {
                url.searchParams.set('lat', String(options.centerPoint.lat));
                url.searchParams.set('lon', String(options.centerPoint.lng));
            }
            const response = await request<PhotonResponse>(url.toString(), {
                headers: { accept: 'application/json' },
                signal: AbortSignal.timeout(5000)
            });
            return Array.isArray(response.features)
                ? response.features.map(transformFeature).filter((result): result is GeocodingResult => result !== null)
                : [];
        },
        async reverseGeocode(lat, lng) {
            const url = new URL('reverse/', base);
            url.searchParams.set('lat', String(lat));
            url.searchParams.set('lon', String(lng));
            const response = await request<PhotonResponse>(url.toString(), {
                headers: { accept: 'application/json' },
                signal: AbortSignal.timeout(5000)
            });
            const result = response.features?.map(transformFeature).find(Boolean);
            return result || { lat, lng, displayName: `${lat}, ${lng}`, address: {} };
        }
    };
}
