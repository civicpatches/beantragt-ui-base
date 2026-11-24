import type { GeocodingResult } from '~~/app/types/form';
import { getGeocodingProvider } from '../../utils/geocoding';
import { readGeocodingRequestBody } from '../../utils/geocoding-request';
import { checkRateLimit, getClientIp, getTrustedProxyClientIp } from '../../utils/rate-limit';
import { requireSameOriginRequest, setPrivateNoStore } from '../../utils/request-security';

const MAX_QUERY_LENGTH = 500;

interface GeocodingSearchBody {
    q?: unknown
    lang?: unknown
}

export default defineEventHandler(async (event): Promise<{ data: GeocodingResult[] }> => {
    requireSameOriginRequest(event);
    setPrivateNoStore(event);
    const config = useRuntimeConfig();
    const clientIp = config.trustProxyIpHeaders === true
        ? getTrustedProxyClientIp(event)
        : getClientIp(event);
    checkRateLimit(clientIp, 'geocoding', event);
    const body = await readGeocodingRequestBody<GeocodingSearchBody>(event);
    const text = typeof body?.q === 'string' ? body.q.trim() : '';
    if (text.length < 2 || text.length > MAX_QUERY_LENGTH) {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.geocoding.invalidQuery',
            data: { code: 'errors.geocoding.invalidQuery' }
        });
    }

    try {
        const provider = getGeocodingProvider(config);
        const data = await provider.geocode(text, {
            limit: 5,
            language: typeof body?.lang === 'string' ? body.lang : 'de'
        });
        return { data };
    } catch {
        throw createSafeError({
            statusCode: 502,
            message: 'errors.geocoding.unavailable',
            data: { code: 'errors.geocoding.unavailable' }
        });
    }
});
