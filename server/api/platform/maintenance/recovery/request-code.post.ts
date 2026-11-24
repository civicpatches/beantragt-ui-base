import { requireSameOriginRequest, setPrivateNoStore } from '~~/server/utils/request-security';
import {
    getMaintenanceClientIp,
    proxyMaintenanceMutation
} from '../../../../utils/maintenance-recovery-proxy';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default defineEventHandler(async (event) => {
    requireSameOriginRequest(event);
    setPrivateNoStore(event);

    const clientIp = getMaintenanceClientIp(event);
    checkRateLimit(clientIp, 'maintenance_recovery_request', event);

    const body = await readBody<{ email?: unknown }>(event);
    const email = typeof body?.email === 'string' ? body.email.trim() : '';
    if (!EMAIL_PATTERN.test(email)) {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.maintenance.emailInvalid',
            data: { code: 'errors.maintenance.emailInvalid' }
        });
    }
    const requestedLanguage = (getHeader(event, 'accept-language') || '').toLowerCase();
    const locale = requestedLanguage.startsWith('en') ? 'en' : 'de';

    return proxyMaintenanceMutation(event, {
        path: '/api/platform/maintenance/recovery/request-code',
        method: 'POST',
        scope: 'maintenance-recovery-request',
        body: { email },
        response: 'request-code',
        clientIp,
        locale
    });
});
