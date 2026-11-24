import { createSafeError } from '~~/server/utils/error-handling';
import { validateUuid } from '~~/server/utils/validation';

const MAX_PUBLIC_DOCUMENT_SIZE = 20 * 1024 * 1024;
const PUBLIC_DOCUMENT_PLACEMENTS = new Set([
    'footer',
    'org_start',
    'form_intro',
    'form_downloads',
    'form_sidebar',
    'submission_success'
]);
const ALLOWED_PUBLIC_DOCUMENT_EXTENSIONS = new Set(['pdf', 'jpg', 'jpeg', 'png']);
const ALLOWED_PUBLIC_DOCUMENT_MIME_TYPES: Record<string, string> = {
    pdf: 'application/pdf',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png'
};

type MultipartParts = Awaited<ReturnType<typeof readMultipartFormData>>;

export interface PublicDocumentUploadPayload {
    title: string
    status: boolean
    organisation: string | null
    body: { value: string }
    placement: string
    order: number
    formId: string | null
    file?: {
        filename: string
        mimeType: string
        dataBase64: string
    }
}

function firstMultipartString(parts: MultipartParts, name: string): string {
    const part = parts?.find(item => item.name === name);
    if (!part?.data) return '';
    return part.data.toString('utf8').trim();
}

function multipartBoolean(value: string): boolean {
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function normalizePlacement(value: string): string {
    const placement = value.trim().toLowerCase() || 'form_downloads';
    if (PUBLIC_DOCUMENT_PLACEMENTS.has(placement)) {
        return placement;
    }
    throw createSafeError({
        statusCode: 400,
        message: 'errors.admin.documentDataInvalid',
        data: { code: 'errors.admin.documentDataInvalid', field: 'placement' }
    });
}

function normalizeFormId(value: string): string | null {
    if (!value) return null;
    return validateUuid(value, 'formId');
}

function detectMime(data: Buffer): string | null {
    if (data.subarray(0, 5).equals(Buffer.from('%PDF-'))) return 'application/pdf';
    if (
        data.length >= 8
        && data[0] === 0x89
        && data[1] === 0x50
        && data[2] === 0x4e
        && data[3] === 0x47
        && data[4] === 0x0d
        && data[5] === 0x0a
        && data[6] === 0x1a
        && data[7] === 0x0a
    ) return 'image/png';
    if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
    return null;
}

function validateFilePart(part: NonNullable<MultipartParts>[number] | undefined, required: boolean): PublicDocumentUploadPayload['file'] {
    if (!part?.data) {
        if (!required) return undefined;
        throw createSafeError({
            statusCode: 400,
            message: 'errors.admin.documentFileRequired',
            data: { code: 'errors.admin.documentFileRequired' }
        });
    }
    if (part.data.length > MAX_PUBLIC_DOCUMENT_SIZE) {
        throw createSafeError({
            statusCode: 413,
            message: 'errors.admin.documentFileTooLarge',
            data: { code: 'errors.admin.documentFileTooLarge' }
        });
    }
    const filename = part.filename || 'document';
    const extension = filename.includes('.') ? filename.split('.').pop()?.toLowerCase() || '' : '';
    if (!ALLOWED_PUBLIC_DOCUMENT_EXTENSIONS.has(extension)) {
        throw createSafeError({
            statusCode: 422,
            message: 'errors.admin.documentFileUnsupported',
            data: { code: 'errors.admin.documentFileUnsupported' }
        });
    }
    const expectedMime = ALLOWED_PUBLIC_DOCUMENT_MIME_TYPES[extension];
    const providedMime = typeof part.type === 'string' ? part.type.toLowerCase() : '';
    if (providedMime && providedMime !== expectedMime) {
        throw createSafeError({
            statusCode: 422,
            message: 'errors.admin.documentFileUnsupported',
            data: { code: 'errors.admin.documentFileUnsupported' }
        });
    }
    if (detectMime(Buffer.from(part.data)) !== expectedMime) {
        throw createSafeError({
            statusCode: 422,
            message: 'errors.admin.documentFileUnsupported',
            data: { code: 'errors.admin.documentFileUnsupported' }
        });
    }
    return {
        filename,
        mimeType: expectedMime,
        dataBase64: Buffer.from(part.data).toString('base64')
    };
}

export function normalizePublicDocumentMultipartPayload(parts: MultipartParts, options: { requireFile: boolean }): PublicDocumentUploadPayload {
    if (!parts || parts.length === 0) {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.admin.documentDataInvalid',
            data: { code: 'errors.admin.documentDataInvalid' }
        });
    }

    const title = firstMultipartString(parts, 'title');
    if (!title) {
        throw createSafeError({
            statusCode: 422,
            message: 'errors.admin.documentTitleRequired',
            data: { code: 'errors.admin.documentTitleRequired' }
        });
    }

    const file = validateFilePart(parts.find(item => item.name === 'file' && item.data), options.requireFile);

    return {
        title,
        status: multipartBoolean(firstMultipartString(parts, 'status') || 'true'),
        organisation: firstMultipartString(parts, 'organisation') || null,
        body: { value: firstMultipartString(parts, 'body') },
        placement: normalizePlacement(firstMultipartString(parts, 'placement')),
        order: Number(firstMultipartString(parts, 'order')) || 0,
        formId: normalizeFormId(firstMultipartString(parts, 'formId')),
        ...(file ? { file } : {})
    };
}
