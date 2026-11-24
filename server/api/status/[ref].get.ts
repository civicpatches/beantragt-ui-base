/**
 * GET /api/status/:ref
 *
 * Deprecated reference-only status lookup. Manual status lookup must use the
 * reference-plus-email OTP flow.
 */
import { setPrivateNoStore } from '../../utils/request-security';

export default defineEventHandler(async (event) => {
    setPrivateNoStore(event);

    const ip = getClientIp(event);
    checkRateLimit(ip, 'status_check', event);

    const ref = getRouterParam(event, 'ref');
    if (!ref) {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.status.referenceMissing',
            data: { code: 'errors.status.referenceMissing' }
        });
    }

    // Allow configured reference formats while blocking path/control chars.
    const REF_PATTERN = /^[A-Z0-9][A-Z0-9-]{2,63}$/i;
    if (!REF_PATTERN.test(ref)) {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.status.referenceFormatInvalid',
            data: { code: 'errors.status.referenceFormatInvalid' }
        });
    }

    throw createSafeError({
        statusCode: 404,
        message: 'errors.status.notFound',
        data: { code: 'errors.status.notFound' }
    });
});
