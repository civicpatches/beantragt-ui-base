import type { GeocodingResult } from '~~/app/types/form';
import { getGeocodingProvider } from '../../utils/geocoding';
import { readGeocodingRequestBody } from '../../utils/geocoding-request';
import { checkRateLimit, getClientIp, getTrustedProxyClientIp } from '../../utils/rate-limit';
import { requireSameOriginRequest, setPrivateNoStore } from '../../utils/request-security';

interface GeocodingReverseBody {
    lat?: unknown
    lng?: unknown
}

export default defineEventHandler(async (event): Promise<{ data: GeocodingResult }> => {
    requireSameOriginRequest(event);
    setPrivateNoStore(event);
    const config = useRuntimeConfig();
    const clientIp = config.trustProxyIpHeaders === true
        ? getTrustedProxyClientIp(event)
        : getClientIp(event);
    checkRateLimit(clientIp, 'geocoding', event);
    const body = await readGeocodingRequestBody<GeocodingReverseBody>(event);
    const lat = typeof body?.lat === 'number' ? body.lat : Number.NaN;
    const lng = typeof body?.lng === 'number' ? body.lng : Number.NaN;
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.geocoding.invalidQuery',
            data: { code: 'errors.geocoding.invalidQuery' }
        });
    }

    try {
        const data = await getGeocodingProvider(config).reverseGeocode(lat, lng);
        return { data };
    } catch {
        throw createSafeError({
            statusCode: 502,
            message: 'errors.geocoding.unavailable',
            data: { code: 'errors.geocoding.unavailable' }
        });
    }
});
