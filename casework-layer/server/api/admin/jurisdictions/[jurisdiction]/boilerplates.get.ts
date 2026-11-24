/**
 * GET /api/admin/jurisdictions/:jurisdiction/boilerplates
 *
 * Loads jurisdiction-scoped boilerplate text templates from Drupal.
 */
import { drupalSessionFetch, requireAdmin, requireStaff } from '~~/server/utils/auth';
import { normalizeWorkspaceSlug } from '~~/casework-layer/server/utils/admin-workspace';
import { createSafeError } from '~~/server/utils/error-handling';
import { validateJurisdictionIdentifier } from '~~/server/utils/jurisdiction-settings';
import { checkRateLimit, getClientIp } from '~~/server/utils/rate-limit';
import { setPrivateNoStore } from '~~/server/utils/request-security';

const ALLOWED_TYPES = new Set(['status_notes', 'service_provider', 'remarks']);

function normalizeBoilerplateType(value: unknown): string {
    const raw = Array.isArray(value) ? value[0] : value;
    if (typeof raw !== 'string' || raw.trim() === '') return 'status_notes';
    const type = raw.trim().toLowerCase();
    if (ALLOWED_TYPES.has(type)) return type;
    throw createSafeError({
        statusCode: 400,
        message: 'errors.admin.boilerplatesTypeInvalid',
        data: { code: 'errors.admin.boilerplatesTypeInvalid' }
    });
}

export default defineEventHandler(async (event) => {
    await requireStaff(event);
    setPrivateNoStore(event);

    const ip = getClientIp(event);
    checkRateLimit(ip, 'admin', event);

    const jurisdiction = validateJurisdictionIdentifier(getRouterParam(event, 'jurisdiction'));
    const query = getQuery(event);
    const type = normalizeBoilerplateType(query.type);
    if (type !== 'status_notes') {
        await requireAdmin(event);
    }
    const params = new URLSearchParams({ type });

    if (query.organisation !== undefined || query.organization !== undefined || query.org !== undefined) {
        const organisation = normalizeWorkspaceSlug(query.organisation || query.organization || query.org);
        if (!organisation) {
            throw createSafeError({
                statusCode: 400,
                message: 'errors.admin.organisationInvalid',
                data: { code: 'errors.admin.organisationInvalid' }
            });
        }
        params.set('organisation', organisation);
    }

    try {
        return await drupalSessionFetch(
            event,
            `/api/admin/jurisdictions/${encodeURIComponent(jurisdiction)}/boilerplates?${params.toString()}`
        );
    } catch (e: unknown) {
        if (e && typeof e === 'object' && 'statusCode' in e) {
            throw e;
        }
        console.error('[admin-boilerplates] Failed to load boilerplates:', e instanceof Error ? e.message : e);
        throw createSafeError({
            statusCode: 500,
            message: 'errors.admin.boilerplatesLoadFailed',
            data: { code: 'errors.admin.boilerplatesLoadFailed' }
        });
    }
});
