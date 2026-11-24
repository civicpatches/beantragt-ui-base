/**
 * PATCH /api/admin/jurisdictions/:jurisdiction/content/:id
 *
 * Updates an editable page or boilerplate by UUID.
 */
import { requireAdmin } from '~~/server/utils/auth';
import { normalizeWorkspaceSlug } from '~~/casework-layer/server/utils/admin-workspace';
import { createSafeError } from '~~/server/utils/error-handling';
import { validateJurisdictionIdentifier } from '~~/server/utils/jurisdiction-settings';
import { checkRateLimit, getClientIp } from '~~/server/utils/rate-limit';
import { requireSameOriginRequest, setPrivateNoStore } from '~~/server/utils/request-security';
import {
    drupalAdminContentRequest,
    extractAdminContentPayload,
    validateAdminContentId,
    validateAdminContentItemResponse
} from '../../../../../utils/admin-content';

export default defineEventHandler(async (event) => {
    setPrivateNoStore(event);

    checkRateLimit(getClientIp(event), 'admin', event);
    requireSameOriginRequest(event);
    await requireAdmin(event);

    const jurisdiction = validateJurisdictionIdentifier(getRouterParam(event, 'jurisdiction'));
    const id = validateAdminContentId(getRouterParam(event, 'id'));
    const query = getQuery(event);
    const params = new URLSearchParams();

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

    const body = extractAdminContentPayload(await readBody(event));

    const response = await drupalAdminContentRequest(
        event,
        `/api/admin/jurisdictions/${encodeURIComponent(jurisdiction)}/content/${encodeURIComponent(id)}${params.size ? `?${params.toString()}` : ''}`,
        {
            method: 'PATCH',
            body,
            fallbackKey: 'errors.admin.contentSaveFailed'
        }
    );
    return validateAdminContentItemResponse(response);
});
