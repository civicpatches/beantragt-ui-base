import { createPhotonProvider } from './photon';
import type { GeocodingProvider } from './types';

export function getGeocodingProvider(config: {
    geocodingProvider?: unknown
    geocodingPhotonBaseUrl?: unknown
}): GeocodingProvider {
    const provider = String(config.geocodingProvider || 'disabled').trim().toLowerCase();
    if (provider !== 'photon') {
        throw new Error('Geocoding provider is not enabled');
    }
    const baseUrl = String(config.geocodingPhotonBaseUrl || '').trim();
    if (!baseUrl) throw new Error('Photon base URL is required');
    return createPhotonProvider(baseUrl);
}
