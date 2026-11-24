/**
 * GET /api/admin/jurisdictions/:jurisdiction/documents/:id
 *
 * Resolves the exact lifecycle state of a document after an ambiguous delete
 * response without relying on a filtered or paginated document list.
 */
import { requireAdmin } from '~~/server/utils/auth';
import { validateJurisdictionIdentifier } from '~~/server/utils/jurisdiction-settings';
import { checkRateLimit, getClientIp } from '~~/server/utils/rate-limit';
import { requireSameOriginRequest, setPrivateNoStore } from '~~/server/utils/request-security';
import {
    drupalAdminContentRequest,
    validateAdminContentId,
    validateAdminDocumentStatusResponse
} from '../../../../../utils/admin-content';

export default defineEventHandler(async (event) => {
    setPrivateNoStore(event);

    checkRateLimit(getClientIp(event), 'admin', event);
    requireSameOriginRequest(event);
    await requireAdmin(event);

    const jurisdiction = validateJurisdictionIdentifier(getRouterParam(event, 'jurisdiction'));
    const id = validateAdminContentId(getRouterParam(event, 'id'));
    const query = getQuery(event);
    const form = validateAdminContentId(query.form);

    const response = await drupalAdminContentRequest(
        event,
        `/api/admin/jurisdictions/${encodeURIComponent(jurisdiction)}/documents/${encodeURIComponent(id)}?form=${encodeURIComponent(form)}`,
        { fallbackKey: 'errors.admin.documentLoadFailed' }
    );
    return validateAdminDocumentStatusResponse(response, id);
});
