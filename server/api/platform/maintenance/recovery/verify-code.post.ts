import { requireSameOriginRequest, setPrivateNoStore } from '~~/server/utils/request-security';
import {
    getMaintenanceClientIp,
    proxyMaintenanceMutation
} from '../../../../utils/maintenance-recovery-proxy';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_PATTERN = /^\d{6}$/;

export default defineEventHandler(async (event) => {
    requireSameOriginRequest(event);
    setPrivateNoStore(event);

    const clientIp = getMaintenanceClientIp(event);
    checkRateLimit(clientIp, 'maintenance_recovery_verify', event);

    const body = await readBody<{ email?: unknown, code?: unknown }>(event);
    const email = typeof body?.email === 'string' ? body.email.trim() : '';
    const code = typeof body?.code === 'string' ? body.code.trim() : '';
    if (!EMAIL_PATTERN.test(email) || !CODE_PATTERN.test(code)) {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.maintenance.codeInvalid',
            data: { code: 'errors.maintenance.codeInvalid' }
        });
    }

    return proxyMaintenanceMutation(event, {
        path: '/api/platform/maintenance/recovery/verify-code',
        method: 'POST',
        scope: 'maintenance-recovery-verify',
        body: { email, code },
        response: 'verify-code',
        clientIp
    });
});
