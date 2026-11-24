/**
 * POST /api/confirm/resend
 *
 * Same-origin Nuxt proxy for public application confirmation resend.
 */
import type { H3Event } from 'h3';
import { requireSameOriginRequest, setPrivateNoStore } from '../../utils/request-security';
import { proxyPublicConfirmationRequest } from '../../utils/public-confirmation-proxy';
import { checkRateLimit, getClientIp } from '../../utils/rate-limit';

function isRateLimitError(error: unknown): boolean {
    return Boolean(error && typeof error === 'object' && (error as { statusCode?: unknown }).statusCode === 429);
}

function rateLimitResponse(event: H3Event): { error: { code: 'rate_limit.exceeded' } } {
    setResponseStatus(event, 429);
    return { error: { code: 'rate_limit.exceeded' } };
}

export default defineEventHandler(async (event) => {
    requireSameOriginRequest(event);
    setPrivateNoStore(event);

    const body = await readBody<{ reference?: unknown, email?: unknown }>(event);
    const reference = typeof body?.reference === 'string' ? body.reference.trim() : '';
    const email = typeof body?.email === 'string' ? body.email.trim() : '';
    const ip = getClientIp(event);
    try {
        checkRateLimit(ip, 'application_confirm_resend', event);
        checkRateLimit(`email:${email.toLowerCase()}`, 'application_confirm_resend');
    } catch (error: unknown) {
        if (isRateLimitError(error)) return rateLimitResponse(event);
        throw error;
    }

    return proxyPublicConfirmationRequest(
        event,
        '/api/v1/public/applications/confirm/resend',
        { reference, email },
        [200, 429],
        'application-confirm-resend'
    );
});
