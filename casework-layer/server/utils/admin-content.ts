import type { H3Event } from 'h3';
import {
    buildDrupalRequestHeaders,
    drupalSessionRequest,
    fetchCsrfToken,
    requireAuth
} from '~~/server/utils/auth';
import { createSafeError } from '~~/server/utils/error-handling';
import { safeErrorFromDrupal } from '~~/server/utils/jurisdiction-settings';

const CONTENT_KIND_PATTERN = /^(page|boilerplate|section|content_section|pages|boilerplates|sections)$/u;
const CONTENT_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PUBLIC_DOCUMENT_PLACEMENTS = new Set([
    'footer',
    'org_start',
    'form_intro',
    'form_downloads',
    'form_sidebar',
    'submission_success'
]);
const PUBLIC_DOCUMENT_MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);

export interface AdminDocumentProjection {
    id: string
    internalId: number
    kind: 'public_document'
    title: string
    status: boolean
    langcode: string
    changed: number
    revisionId: number | null
    scope: {
        jurisdictionInternalId: number | null
        organisationInternalId: number | null
    }
    body: {
        value: string
        processed: string
        format: string | null
    }
    document: {
        placement: string
        order: number
        form: {
            id: string
            title: string
        } | null
        file: {
            filename: string
            mimeType: string
            size: number
            url: string | null
        } | null
    }
}

export function validateAdminContentKind(value: unknown): string | null {
    if (value === undefined || value === null || value === '') return null;
    const raw = Array.isArray(value) ? value[0] : value;
    if (typeof raw === 'string') {
        const kind = raw.trim().toLowerCase();
        if (CONTENT_KIND_PATTERN.test(kind)) {
            return kind;
        }
    }
    throw createSafeError({
        statusCode: 400,
        message: 'errors.admin.contentKindInvalid',
        data: { code: 'errors.admin.contentKindInvalid' }
    });
}

export function validateAdminContentId(value: unknown): string {
    const raw = Array.isArray(value) ? value[0] : value;
    if (typeof raw === 'string') {
        const id = raw.trim().toLowerCase();
        if (CONTENT_UUID_PATTERN.test(id)) {
            return id;
        }
    }
    throw createSafeError({
        statusCode: 404,
        message: 'errors.admin.contentNotFound',
        data: { code: 'errors.admin.contentNotFound' }
    });
}

export function extractAdminContentPayload(body: unknown): Record<string, unknown> {
    if (body && typeof body === 'object' && !Array.isArray(body)) {
        return body as Record<string, unknown>;
    }
    throw createSafeError({
        statusCode: 400,
        message: 'errors.admin.contentDataInvalid',
        data: { code: 'errors.admin.contentDataInvalid' }
    });
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function numberOrNull(value: unknown): number | null | false {
    if (value === null || value === undefined) return null;
    return typeof value === 'number' && Number.isFinite(value) ? value : false;
}

function projectBody(value: unknown): AdminDocumentProjection['body'] | null {
    if (!isRecord(value)) return null;
    if (typeof value.value !== 'string' || typeof value.processed !== 'string') return null;
    if (value.format !== null && typeof value.format !== 'string') return null;
    return {
        value: value.value,
        processed: value.processed,
        format: typeof value.format === 'string' ? value.format : null
    };
}

function projectForm(value: unknown): AdminDocumentProjection['document']['form'] | null | false {
    if (value === null) return null;
    if (!isRecord(value)) return false;
    if (typeof value.id !== 'string' || !CONTENT_UUID_PATTERN.test(value.id)) return false;
    if (typeof value.title !== 'string' || value.title.trim() === '') return false;
    return {
        id: value.id,
        title: value.title
    };
}

function isSafeAdminDocumentDownloadUrl(value: unknown, documentId: string, placement: string): value is string {
    if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) {
        return false;
    }
    let url: URL;
    try {
        url = new URL(value, 'https://beantragt.invalid');
    } catch {
        return false;
    }

    const pathPattern = new RegExp(`^/api/v1/jurisdictions/[a-z0-9-]{2,80}/documents/${documentId}/file$`, 'u');
    if (!pathPattern.test(url.pathname)) return false;
    for (const key of url.searchParams.keys()) {
        if (!['placement', 'organisation', 'form'].includes(key)) return false;
    }
    if (url.searchParams.get('placement') !== placement) return false;
    if (url.searchParams.has('organisation') && !/^[a-z0-9][a-z0-9-]{1,79}$/u.test(url.searchParams.get('organisation') || '')) {
        return false;
    }
    if (url.searchParams.has('form') && !CONTENT_UUID_PATTERN.test(url.searchParams.get('form') || '')) {
        return false;
    }
    return true;
}

function projectAdminDocumentFile(value: unknown, documentId: string, placement: string): AdminDocumentProjection['document']['file'] | null | false {
    if (value === null) return null;
    if (!isRecord(value)) return false;
    if (typeof value.filename === 'string'
      && value.filename.trim() !== ''
      && typeof value.mimeType === 'string'
      && PUBLIC_DOCUMENT_MIME_TYPES.has(value.mimeType)
      && typeof value.size === 'number'
      && Number.isFinite(value.size)
      && value.size >= 0
      && (
          value.url === null
          || isSafeAdminDocumentDownloadUrl(value.url, documentId, placement)
      )
    ) {
        return {
            filename: value.filename,
            mimeType: value.mimeType,
            size: value.size,
            url: value.url
        };
    }
    return false;
}

function projectAdminDocumentItem(value: unknown): AdminDocumentProjection | null {
    if (!isRecord(value)) return null;
    if (typeof value.id !== 'string' || !CONTENT_UUID_PATTERN.test(value.id)) return null;
    if (value.kind !== 'public_document') return null;
    if (typeof value.title !== 'string' || value.title.trim() === '') return null;
    if (typeof value.status !== 'boolean') return null;
    if (typeof value.internalId !== 'number' || !Number.isFinite(value.internalId)) return null;
    if (typeof value.langcode !== 'string' || value.langcode.trim() === '') return null;
    if (typeof value.changed !== 'number' || !Number.isFinite(value.changed) || value.changed < 0) return null;
    const revisionId = value.revisionId === undefined ? null : numberOrNull(value.revisionId);
    if (revisionId === false || (revisionId !== null && (!Number.isInteger(revisionId) || revisionId < 1))) return null;
    if (!isRecord(value.scope) || !isRecord(value.document)) return null;
    if (typeof value.document.placement !== 'string' || !PUBLIC_DOCUMENT_PLACEMENTS.has(value.document.placement)) return null;
    if (typeof value.document.order !== 'number' || !Number.isFinite(value.document.order)) return null;

    const jurisdictionInternalId = numberOrNull(value.scope.jurisdictionInternalId);
    const organisationInternalId = numberOrNull(value.scope.organisationInternalId);
    const body = projectBody(value.body);
    const form = projectForm(value.document.form);
    const file = projectAdminDocumentFile(value.document.file, value.id, value.document.placement);
    if (jurisdictionInternalId === false || organisationInternalId === false || !body || form === false || file === false) {
        return null;
    }

    return {
        id: value.id,
        internalId: value.internalId,
        kind: 'public_document',
        title: value.title,
        status: value.status,
        langcode: value.langcode,
        changed: value.changed,
        revisionId,
        scope: {
            jurisdictionInternalId,
            organisationInternalId
        },
        body,
        document: {
            placement: value.document.placement,
            order: value.document.order,
            form,
            file
        }
    };
}

export function validateAdminContentListResponse(value: unknown): Record<string, unknown> & { data: unknown[] } {
    if (isRecord(value) && Array.isArray(value.data)) {
        return value as Record<string, unknown> & { data: unknown[] };
    }
    throw createSafeError({
        statusCode: 502,
        message: 'errors.admin.contentLoadFailed',
        data: { code: 'errors.admin.contentLoadFailed' }
    });
}

export function validateAdminContentItemResponse(value: unknown): Record<string, unknown> & { data: Record<string, unknown> } {
    if (isRecord(value) && isRecord(value.data) && typeof value.data.id === 'string') {
        return value as Record<string, unknown> & { data: Record<string, unknown> };
    }
    throw createSafeError({
        statusCode: 502,
        message: 'errors.admin.contentSaveFailed',
        data: { code: 'errors.admin.contentSaveFailed' }
    });
}

export function validateAdminDocumentListResponse(value: unknown): { data: AdminDocumentProjection[] } {
    if (isRecord(value) && Array.isArray(value.data)) {
        const items = value.data.map(projectAdminDocumentItem);
        if (items.every((item): item is AdminDocumentProjection => item !== null)) {
            return { data: items };
        }
    }
    throw createSafeError({
        statusCode: 502,
        message: 'errors.admin.documentLoadFailed',
        data: { code: 'errors.admin.documentLoadFailed' }
    });
}

export function validateAdminDocumentItemResponse(value: unknown): Record<string, unknown> & { data: Record<string, unknown> } {
    if (isRecord(value)) {
        const item = projectAdminDocumentItem(value.data);
        if (item) {
            return { data: item as unknown as Record<string, unknown> };
        }
    }
    throw createSafeError({
        statusCode: 502,
        message: 'errors.admin.documentSaveFailed',
        data: { code: 'errors.admin.documentSaveFailed' }
    });
}

export function validateAdminDocumentDeleteResponse(value: unknown, expectedId: string): {
    data: {
        id: string
        deleted: true
        fileDeleted: boolean
        fileCleanup: 'deleted' | 'retained_in_use' | 'cleanup_failed' | 'not_applicable'
    }
} {
    const cleanupStates = new Set(['deleted', 'retained_in_use', 'cleanup_failed', 'not_applicable']);
    if (
        isRecord(value)
        && isRecord(value.data)
        && value.data.id === expectedId
        && value.data.deleted === true
        && typeof value.data.fileDeleted === 'boolean'
        && typeof value.data.fileCleanup === 'string'
        && cleanupStates.has(value.data.fileCleanup)
    ) {
        return {
            data: {
                id: expectedId,
                deleted: true,
                fileDeleted: value.data.fileDeleted,
                fileCleanup: value.data.fileCleanup as 'deleted' | 'retained_in_use' | 'cleanup_failed' | 'not_applicable'
            }
        };
    }
    throw createSafeError({
        statusCode: 502,
        message: 'errors.admin.documentDeleteFailed',
        data: { code: 'errors.admin.documentDeleteFailed' }
    });
}

export function validateAdminDocumentStatusResponse(value: unknown, expectedId: string): {
    data: {
        id: string
        state: 'active' | 'rebound' | 'unavailable'
    }
} {
    const states = new Set(['active', 'rebound', 'unavailable']);
    if (
        isRecord(value)
        && isRecord(value.data)
        && value.data.id === expectedId
        && typeof value.data.state === 'string'
        && states.has(value.data.state)
    ) {
        return {
            data: {
                id: expectedId,
                state: value.data.state as 'active' | 'rebound' | 'unavailable'
            }
        };
    }
    throw createSafeError({
        statusCode: 502,
        message: 'errors.admin.documentLoadFailed',
        data: { code: 'errors.admin.documentLoadFailed' }
    });
}

export async function drupalAdminContentRequest<T>(
    event: H3Event,
    path: string,
    options: {
        method?: string
        body?: Record<string, unknown>
        fallbackKey?: string
    } = {}
): Promise<T> {
    requireAuth(event);

    const method = (options.method || 'GET').toUpperCase();
    const cookieHeader = getHeader(event, 'cookie') || '';
    const headers = buildDrupalRequestHeaders(event, {
        accept: 'application/json',
        contentType: 'application/json',
        cookieHeader
    });

    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
        headers['X-CSRF-Token'] = await fetchCsrfToken(cookieHeader, event);
    }

    const response = await drupalSessionRequest(event, path, {
        method,
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined
    });

    if (!response.ok) {
        const rawBody = await response.text().catch(() => '');
        throw safeErrorFromDrupal(
            response.status,
            rawBody,
            options.fallbackKey || 'errors.admin.contentLoadFailed'
        );
    }

    if (response.status === 204) {
        return undefined as T;
    }

    const text = await response.text();
    if (!text) {
        return undefined as T;
    }

    try {
        return JSON.parse(text) as T;
    } catch {
        const code = options.fallbackKey || 'errors.admin.contentLoadFailed';
        throw createSafeError({
            statusCode: 502,
            message: code,
            data: { code }
        });
    }
}
