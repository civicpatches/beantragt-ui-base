import type { GeocodingResult } from '~/types/form';

export function useGeocoding() {
    async function geocode(query: string, options: { language?: string } = {}): Promise<GeocodingResult[]> {
        const response = await $fetch<{ data?: GeocodingResult[] }>('/api/geocoding/search', {
            method: 'POST',
            body: {
                q: query,
                lang: options.language
            }
        });
        const seen = new Set<string>();
        return (response.data || []).filter((result) => {
            const key = `${result.lat}:${result.lng}:${result.displayName}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    async function reverseGeocode(lat: number, lng: number): Promise<GeocodingResult> {
        const response = await $fetch<{ data: GeocodingResult }>('/api/geocoding/reverse', {
            method: 'POST',
            body: { lat, lng }
        });
        return response.data;
    }

    return { geocode, reverseGeocode };
}
