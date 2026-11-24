/**
 * POST /api/comments/:applicationId/upload
 *
 * Same-origin upload proxy for comment attachments. The file is stored by
 * Drupal as a temporary private file and linked when the comment is created.
 */
import { randomBytes } from 'node:crypto';
import { createSafeError } from '../../../utils/error-handling';
import { requireSameOriginRequest, setPrivateNoStore } from '../../../utils/request-security';

const MAX_FILE_SIZE = 10 * 1024 * 1024;

type MultipartParts = Awaited<ReturnType<typeof readMultipartFormData>>;

interface CommentUploadPayload {
    data?: {
        file_id?: number
        filename?: string
    }
    error?: string
}

function mapCommentUploadError(status: number, payload?: CommentUploadPayload | null): string {
    if (status === 413) return 'errors.attachments.fileTooLarge';
    if (status === 422) {
        if (payload?.error === 'Attachment was quarantined by malware scanning.') {
            return 'errors.attachments.quarantined';
        }
        return 'errors.attachments.unsupportedType';
    }
    if (status === 400) return 'errors.attachments.fileMissing';
    if (status === 429) return 'errors.rateLimit.tooManyRequests';
    return 'errors.attachments.uploadFailed';
}

function filePart(parts: MultipartParts) {
    return parts?.find(item => item.name === 'file' && item.data);
}

function safeMultipartFilename(filename: string | undefined): string {
    const safe = (filename || 'attachment')
        .replace(/[\r\n"]/g, '_')
        .slice(0, 180)
        .trim();
    return safe || 'attachment';
}

function multipartUploadBody(upload: NonNullable<ReturnType<typeof filePart>>): { body: Buffer, contentType: string } {
    const boundary = `----beantragt-comment-${randomBytes(12).toString('hex')}`;
    const filename = safeMultipartFilename(upload.filename);
    const contentType = upload.type || 'application/octet-stream';
    const head = Buffer.from(
        `--${boundary}\r\n`
        + `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n`
        + `Content-Type: ${contentType}\r\n\r\n`,
        'utf8'
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
    return {
        body: Buffer.concat([head, Buffer.from(upload.data), tail]),
        contentType: `multipart/form-data; boundary=${boundary}`
    };
}

export default defineEventHandler(async (event) => {
    requireSameOriginRequest(event);
    setPrivateNoStore(event);

    const applicationId = getRouterParam(event, 'applicationId');
    validateUuid(applicationId, 'applicationId');

    const ip = getClientIp(event);
    checkRateLimit(ip, 'attachment_upload', event);

    const cookieHeader = getHeader(event, 'cookie') || '';
    await getAuthenticatedUser(event);

    const contentLengthHeader = getHeader(event, 'content-length');
    if (contentLengthHeader) {
        const contentLength = Number(contentLengthHeader);
        if (!Number.isFinite(contentLength) || contentLength <= 0) {
            throw createSafeError({
                statusCode: 400,
                message: 'errors.attachments.invalidRequest',
                data: { code: 'errors.attachments.invalidRequest' }
            });
        }
        if (contentLength > MAX_FILE_SIZE + 64_000) {
            throw createSafeError({
                statusCode: 413,
                message: 'errors.attachments.fileTooLarge',
                data: { code: 'errors.attachments.fileTooLarge' }
            });
        }
    }

    const parts = await readMultipartFormData(event);
    const upload = filePart(parts);
    if (!upload?.data) {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.attachments.fileMissing',
            data: { code: 'errors.attachments.fileMissing' }
        });
    }
    if (upload.data.length > MAX_FILE_SIZE) {
        throw createSafeError({
            statusCode: 413,
            message: 'errors.attachments.fileTooLarge',
            data: { code: 'errors.attachments.fileTooLarge' }
        });
    }

    const csrfToken = await fetchCsrfToken(cookieHeader, event);
    const apiBase = getDrupalSessionApiBase(event);
    if (!apiBase) {
        throw createSafeError({
            statusCode: 500,
            message: 'errors.server.configuration',
            data: { code: 'errors.server.configuration' }
        });
    }

    const multipart = multipartUploadBody(upload);

    const response = await drupalSessionRequest(event, `/api/comments/${applicationId}/upload`, {
        method: 'POST',
        headers: {
            ...buildDrupalRequestHeaders(event, { accept: 'application/json', cookieHeader }),
            'Content-Type': multipart.contentType,
            'Content-Length': String(multipart.body.length),
            'X-CSRF-Token': csrfToken
        },
        body: multipart.body
    });

    const payload = await response.json().catch(() => null) as CommentUploadPayload | null;
    if (!response.ok) {
        const code = mapCommentUploadError(response.status, payload);
        throw createSafeError({
            statusCode: response.status,
            message: code,
            data: {
                code,
                ...(code === 'errors.rateLimit.tooManyRequests' ? { seconds: 60 } : {})
            }
        });
    }

    const fileId = payload?.data?.file_id;
    const filename = payload?.data?.filename;
    if (!Number.isInteger(fileId) || typeof filename !== 'string') {
        throw createSafeError({
            statusCode: 502,
            message: 'errors.attachments.uploadFailed',
            data: { code: 'errors.attachments.uploadFailed' }
        });
    }

    return {
        id: fileId,
        filename
    };
});
