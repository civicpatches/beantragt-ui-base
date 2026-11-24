/**
 * POST /api/admin/jurisdictions/:jurisdiction/documents
 *
 * Creates a public editorial download in the current admin workspace.
 */
import { requireAdmin } from '~~/server/utils/auth';
import { normalizeWorkspaceSlug } from '~~/casework-layer/server/utils/admin-workspace';
import { createSafeError } from '~~/server/utils/error-handling';
import { validateJurisdictionIdentifier } from '~~/server/utils/jurisdiction-settings';
import { checkRateLimit, getClientIp } from '~~/server/utils/rate-limit';
import { requireSameOriginRequest, setPrivateNoStore } from '~~/server/utils/request-security';
import {
    drupalAdminContentRequest,
    validateAdminDocumentItemResponse
} from '~~/casework-layer/server/utils/admin-content';
import { normalizePublicDocumentMultipartPayload } from '~~/casework-layer/server/utils/admin-public-documents';

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

    const payload = normalizePublicDocumentMultipartPayload(await readMultipartFormData(event), { requireFile: true });
    const response = await drupalAdminContentRequest(
        event,
        `/api/admin/jurisdictions/${encodeURIComponent(jurisdiction)}/documents${params.size ? `?${params.toString()}` : ''}`,
        {
            method: 'POST',
            body: payload as unknown as Record<string, unknown>,
            fallbackKey: 'errors.admin.documentSaveFailed'
        }
    );
    return validateAdminDocumentItemResponse(response);
});
