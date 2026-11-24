import type { H3Event } from 'h3';
import { hasStaffRole, type AuthUser } from './auth';
import { beginCaseRead } from './rate-limit';
import { hasValidDrupalSession } from './session';

export async function rateLimitCaseRead<T extends AuthUser | null>(event: H3Event, verify: (event: H3Event) => Promise<T>): Promise<T> {
    const chargeUser = beginCaseRead(event, getClientIp(event));
    const user = await verify(event);
    if (user) chargeUser(user.uid, hasStaffRole(user));
    return user;
}

export function requireCaseStaff(event: H3Event, overview: boolean) {
    if (overview) return rateLimitCaseRead(event, requireStaff);
    checkRateLimit(getClientIp(event), 'admin', event);
    return requireStaff(event);
}

export async function checkCommentReadLimit(event: H3Event) {
    await rateLimitCaseRead(event, async () => {
        if (!hasValidDrupalSession(event)) return null;
        // Drupal still authorizes the comments request with the original cookie.
        // Without a confirmed identity, only the anonymous allowance applies.
        return getAuthenticatedUser(event).catch(() => null);
    });
}
