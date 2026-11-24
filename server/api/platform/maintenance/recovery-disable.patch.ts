import { requireSameOriginRequest, setPrivateNoStore } from '~~/server/utils/request-security';
import {
    getMaintenanceClientIp,
    proxyMaintenanceMutation
} from '../../../utils/maintenance-recovery-proxy';

const RECOVERY_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export default defineEventHandler(async (event) => {
    requireSameOriginRequest(event);
    setPrivateNoStore(event);

    const authorization = getHeader(event, 'authorization') || '';
    const match = authorization.match(/^Bearer ([A-Za-z0-9_-]{43})$/);
    const recoveryToken = match?.[1] || '';
    if (!RECOVERY_TOKEN_PATTERN.test(recoveryToken)) {
        throw createSafeError({
            statusCode: 403,
            message: 'errors.maintenance.recoveryDenied',
            data: { code: 'errors.maintenance.recoveryDenied' }
        });
    }

    const clientIp = getMaintenanceClientIp(event);
    checkRateLimit(clientIp, 'maintenance_recovery_disable', event);

    return proxyMaintenanceMutation(event, {
        path: '/api/platform/maintenance',
        method: 'PATCH',
        scope: 'maintenance-recovery-disable',
        body: { maintenance: false },
        response: 'disable',
        clientIp,
        bearerToken: recoveryToken
    });
});
