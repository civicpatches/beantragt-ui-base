import type { FormAddressValue, GeocodingResult, NormalizedGeocodingAddress } from '~/types/form';

const MAX_ADDRESS_PART_LENGTH = 200;
const MAX_FORMATTED_ADDRESS_LENGTH = 500;

function boundedString(value: unknown, maxLength = MAX_ADDRESS_PART_LENGTH): string | undefined {
    if (typeof value !== 'string') return undefined;
    const normalized = value.trim().replace(/\s+/gu, ' ');
    return normalized ? normalized.slice(0, maxLength) : undefined;
}

function coordinate(value: unknown, min: number, max: number): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) return undefined;
    return value;
}

export function formatStructuredAddress(address: Partial<NormalizedGeocodingAddress>): string {
    const street = [address.street, address.houseNumber].filter(Boolean).join(' ');
    const locality = [address.postcode, address.city].filter(Boolean).join(' ');
    return [street, locality].filter(Boolean).join(', ');
}

export function normalizeFormAddressValue(value: unknown): FormAddressValue | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const input = value as Record<string, unknown>;
    const normalized: NormalizedGeocodingAddress = {
        street: boundedString(input.street),
        houseNumber: boundedString(input.houseNumber),
        postcode: boundedString(input.postcode),
        city: boundedString(input.city),
        district: boundedString(input.district),
        state: boundedString(input.state),
        country: boundedString(input.country),
        countryCode: boundedString(input.countryCode, 2)?.toUpperCase()
    };
    const formatted = boundedString(input.formatted, MAX_FORMATTED_ADDRESS_LENGTH)
      || formatStructuredAddress(normalized);
    if (!formatted) return null;

    const lat = coordinate(input.lat, -90, 90);
    const lng = coordinate(input.lng, -180, 180);
    return {
        ...Object.fromEntries(Object.entries(normalized).filter(([, part]) => part !== undefined)),
        formatted,
        ...(lat !== undefined ? { lat } : {}),
        ...(lng !== undefined ? { lng } : {})
    };
}

export function addressValueFromGeocodingResult(result: GeocodingResult): FormAddressValue | null {
    return normalizeFormAddressValue({
        ...result.address,
        formatted: result.displayName,
        lat: result.lat,
        lng: result.lng
    });
}

export function displayFormAddressValue(value: unknown): string | null {
    return normalizeFormAddressValue(value)?.formatted ?? null;
}
