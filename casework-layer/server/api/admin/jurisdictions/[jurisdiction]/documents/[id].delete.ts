/**
 * DELETE /api/admin/jurisdictions/:jurisdiction/documents/:id
 *
 * Deletes a document that is bound to one form after the form schema no
 * longer selects it as context or precheck evidence.
 */
import { requireAdmin } from '~~/server/utils/auth';
import { validateJurisdictionIdentifier } from '~~/server/utils/jurisdiction-settings';
import { checkRateLimit, getClientIp } from '~~/server/utils/rate-limit';
import { requireSameOriginRequest, setPrivateNoStore } from '~~/server/utils/request-security';
import {
    drupalAdminContentRequest,
    validateAdminContentId,
    validateAdminDocumentDeleteResponse
} from '../../../../../utils/admin-content';

export default defineEventHandler(async (event) => {
    setPrivateNoStore(event);

    checkRateLimit(getClientIp(event), 'admin_document_delete', event);
    requireSameOriginRequest(event);
    await requireAdmin(event);

    const jurisdiction = validateJurisdictionIdentifier(getRouterParam(event, 'jurisdiction'));
    const id = validateAdminContentId(getRouterParam(event, 'id'));
    const query = getQuery(event);
    const form = validateAdminContentId(query.form);

    const response = await drupalAdminContentRequest(
        event,
        `/api/admin/jurisdictions/${encodeURIComponent(jurisdiction)}/documents/${encodeURIComponent(id)}?form=${encodeURIComponent(form)}`,
        {
            method: 'DELETE',
            fallbackKey: 'errors.admin.documentDeleteFailed'
        }
    );
    return validateAdminDocumentDeleteResponse(response, id);
});
