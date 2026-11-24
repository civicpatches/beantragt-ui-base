import type { FormField } from '~/types/form';

/**
 * Product-wide limits for attachments of a file field. A field may set lower
 * limits (`validation.maxFiles`, `validation.maxSizeBytes`); a higher value is cut to these.
 * The server routes keep their own copy of the size limit, as they cannot import app code.
 */
export const ATTACHMENT_MAX_FILES_PER_FIELD = 5;
export const ATTACHMENT_MAX_SIZE_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_ATTACHMENT_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
export const ACCEPTED_ATTACHMENT_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png'] as const;
/** The accepted types as people name them (PDF, JPG, PNG). */
export const ACCEPTED_ATTACHMENT_TYPE_NAMES = ['PDF', 'JPG', 'PNG'] as const;

function positiveInteger(value: unknown): number | null {
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
    if (typeof value === 'string' && /^[1-9][0-9]{0,11}$/.test(value)) return Number.parseInt(value, 10);
    return null;
}

export function fileFieldMaxFiles(field: FormField): number {
    const configured = positiveInteger(field.validation?.maxFiles) ?? positiveInteger(field.maxFiles);
    return Math.min(configured ?? ATTACHMENT_MAX_FILES_PER_FIELD, ATTACHMENT_MAX_FILES_PER_FIELD);
}

export function fileFieldMaxSizeBytes(field: FormField): number {
    const configured = positiveInteger(field.validation?.maxSizeBytes)
      ?? positiveInteger(field.validation?.maxFileSizeBytes)
      ?? positiveInteger(field.maxSizeBytes)
      ?? positiveInteger(field.maxFileSizeBytes);
    return Math.min(configured ?? ATTACHMENT_MAX_SIZE_BYTES, ATTACHMENT_MAX_SIZE_BYTES);
}
