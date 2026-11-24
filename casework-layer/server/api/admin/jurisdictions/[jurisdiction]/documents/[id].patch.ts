/**
 * PATCH /api/admin/jurisdictions/:jurisdiction/documents/:id
 *
 * Updates public editorial download metadata or replaces its file.
 */
import { requireAdmin } from '~~/server/utils/auth';
import { normalizeWorkspaceSlug } from '~~/casework-layer/server/utils/admin-workspace';
import { createSafeError } from '~~/server/utils/error-handling';
import { validateJurisdictionIdentifier } from '~~/server/utils/jurisdiction-settings';
import { checkRateLimit, getClientIp } from '~~/server/utils/rate-limit';
import { requireSameOriginRequest, setPrivateNoStore } from '~~/server/utils/request-security';
import {
    drupalAdminContentRequest,
    validateAdminContentId,
    validateAdminDocumentItemResponse
} from '../../../../../utils/admin-content';
import { normalizePublicDocumentMultipartPayload } from '../../../../../utils/admin-public-documents';

const MAX_PUBLIC_DOCUMENT_REQUEST_SIZE = 20 * 1024 * 1024 + 64_000;

export default defineEventHandler(async (event) => {
    setPrivateNoStore(event);

    checkRateLimit(getClientIp(event), 'admin_document_upload', event);
    requireSameOriginRequest(event);
    await requireAdmin(event);

    const contentLengthHeader = getHeader(event, 'content-length');
    const contentLength = Number(contentLengthHeader || 0);
    if (!contentLengthHeader || !Number.isFinite(contentLength) || contentLength <= 0) {
        throw createSafeError({
            statusCode: 411,
            message: 'errors.admin.documentDataInvalid',
            data: { code: 'errors.admin.documentDataInvalid' }
        });
    }
    if (contentLength > MAX_PUBLIC_DOCUMENT_REQUEST_SIZE) {
        throw createSafeError({
            statusCode: 413,
            message: 'errors.admin.documentFileTooLarge',
            data: { code: 'errors.admin.documentFileTooLarge' }
        });
    }

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

    const payload = normalizePublicDocumentMultipartPayload(await readMultipartFormData(event), { requireFile: false });
    const response = await drupalAdminContentRequest(
        event,
        `/api/admin/jurisdictions/${encodeURIComponent(jurisdiction)}/documents/${encodeURIComponent(id)}${params.size ? `?${params.toString()}` : ''}`,
        {
            method: 'PATCH',
            body: payload as unknown as Record<string, unknown>,
            fallbackKey: 'errors.admin.documentSaveFailed'
        }
    );
    return validateAdminDocumentItemResponse(response);
});
