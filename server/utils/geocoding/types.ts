import type { GeocodingResult } from '~~/app/types/form';

export interface GeocodingOptions {
    bbox?: string
    limit?: number
    language?: string
    centerPoint?: { lat: number, lng: number }
}

export interface GeocodingProvider {
    name: string
    geocode(query: string, options?: GeocodingOptions): Promise<GeocodingResult[]>
    reverseGeocode(lat: number, lng: number): Promise<GeocodingResult>
}
