/**
 * POST /api/status/:ref/request-code
 *
 * Requests a one-time email code for manual public status lookup.
 */
import { requireSameOriginRequest, setPrivateNoStore } from '../../../utils/request-security';
import { publicStatusProxyHeaders } from '../../../utils/public-status-proxy';

const REF_PATTERN = /^[A-Z0-9][A-Z0-9-]{2,63}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default defineEventHandler(async (event) => {
    requireSameOriginRequest(event);
    setPrivateNoStore(event);

    const ip = getRequestClientIp(event);
    checkRateLimit(ip, 'status_otp_request');

    const ref = getRouterParam(event, 'ref');
    if (!ref || !REF_PATTERN.test(ref)) {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.status.referenceFormatInvalid',
            data: { code: 'errors.status.referenceFormatInvalid' }
        });
    }

    const body = await readBody<{ email?: unknown, langcode?: unknown }>(event);
    const langcode = body.langcode === 'de' || body.langcode === 'en' ? body.langcode : undefined;
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    if (!EMAIL_PATTERN.test(email)) {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.status.emailInvalid',
            data: { code: 'errors.status.emailInvalid' }
        });
    }

    const config = useRuntimeConfig();
    const apiBase = config.apiBase;
    if (!apiBase) {
        throw createSafeError({
            statusCode: 500,
            message: 'errors.server.configuration',
            data: { code: 'errors.server.configuration' }
        });
    }

    const response = await fetch(`${apiBase}/api/status/${ref}/request-code`, {
        method: 'POST',
        headers: {
            'Accept': 'application/json',
            ...publicStatusProxyHeaders(ip),
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email, ...(langcode ? { langcode } : {}) })
    });

    if (!response.ok) {
        throw createSafeError({
            statusCode: response.status,
            message: response.status === 429 ? 'errors.rateLimit.tooManyRequests' : 'errors.status.codeRequestFailed',
            data: { code: response.status === 429 ? 'errors.rateLimit.tooManyRequests' : 'errors.status.codeRequestFailed' }
        });
    }

    return {
        success: true
    };
});
