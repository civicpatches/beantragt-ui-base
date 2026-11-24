/**
 * GET /api/admin/jurisdictions/:jurisdiction/content
 *
 * Lists editable pages and boilerplates for the current admin workspace.
 */
import { requireAdmin } from '~~/server/utils/auth';
import { normalizeWorkspaceSlug } from '~~/casework-layer/server/utils/admin-workspace';
import { createSafeError } from '~~/server/utils/error-handling';
import { validateJurisdictionIdentifier } from '~~/server/utils/jurisdiction-settings';
import { checkRateLimit, getClientIp } from '~~/server/utils/rate-limit';
import { setPrivateNoStore } from '~~/server/utils/request-security';
import {
    drupalAdminContentRequest,
    validateAdminContentKind,
    validateAdminContentListResponse
} from '../../../../utils/admin-content';

export default defineEventHandler(async (event) => {
    setPrivateNoStore(event);

    checkRateLimit(getClientIp(event), 'admin', event);
    await requireAdmin(event);

    const jurisdiction = validateJurisdictionIdentifier(getRouterParam(event, 'jurisdiction'));
    const query = getQuery(event);
    const params = new URLSearchParams();
    const kind = validateAdminContentKind(query.kind);
    if (kind) {
        params.set('kind', kind);
    }

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

    const response = await drupalAdminContentRequest(
        event,
        `/api/admin/jurisdictions/${encodeURIComponent(jurisdiction)}/content${params.size ? `?${params.toString()}` : ''}`,
        { fallbackKey: 'errors.admin.contentLoadFailed' }
    );
    return validateAdminContentListResponse(response);
});
