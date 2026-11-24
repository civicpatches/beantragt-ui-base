/**
 * GET /api/jurisdictions/:slug/documents
 *
 * Anonymous proxy for jurisdiction-scoped public editorial downloads.
 */
import { createSafeError } from '../../../../utils/error-handling';
import { checkRateLimit, getClientIp } from '../../../../utils/rate-limit';
import { validatePublicJurisdictionSlug } from '../../../../utils/jurisdiction-settings';
import { normalizeOrganisationQuery } from '../../../../utils/public-content-query';
import { normalizePublicWorkspaceSlug } from '../../../../utils/public-workspace';
import { getOptionalServiceAuthHeader } from '../../../../utils/auth';
import { serviceProxyRateLimitIdentifier } from '../../../../utils/public-status-proxy';

const PUBLIC_DOCUMENT_MAX_AGE_SECONDS = 300;
const SUPPORTED_LANGUAGES = new Set(['de', 'en']);
const PUBLIC_FORM_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PUBLIC_DOCUMENT_UUID_PATTERN = PUBLIC_FORM_UUID_PATTERN;
const PUBLIC_DOCUMENT_PLACEMENTS = new Set([
    'footer',
    'org_start',
    'form_intro',
    'form_downloads',
    'form_sidebar',
    'submission_success'
]);
const PUBLIC_DOCUMENT_MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);

interface PublicDocumentProjection {
    type: 'publicDocument'
    id: string
    attributes: {
        title: string
        description: {
            value: string
            processed: string
            format: string | null
        }
        placement: string
        order: number
        file: {
            filename: string
            mimeType: string
            size: number
            url: string
        }
        form: {
            id: string
            title: string
        } | null
        langcode: string
        changed: number
    }
}

function firstQueryValue(value: unknown): unknown {
    return Array.isArray(value) ? value[0] : value;
}

function normalizeLang(value: unknown): string | null {
    const raw = firstQueryValue(value);
    if (typeof raw !== 'string') return null;
    const lang = raw.trim().toLowerCase();
    return SUPPORTED_LANGUAGES.has(lang) ? lang : null;
}

function normalizeFormQuery(query: Record<string, unknown>): string | null {
    if (query.form === undefined && query.formSchema === undefined && query.form_schema === undefined) {
        return null;
    }

    const raw = firstQueryValue(query.form ?? query.formSchema ?? query.form_schema);
    if (typeof raw !== 'string') {
        throw createSafeError({
            statusCode: 404,
            message: 'errors.content.documentNotFound',
            data: { code: 'errors.content.documentNotFound' }
        });
    }
    const form = raw.trim().toLowerCase();
    if (PUBLIC_FORM_UUID_PATTERN.test(form)) {
        return form;
    }

    throw createSafeError({
        statusCode: 404,
        message: 'errors.content.documentNotFound',
        data: { code: 'errors.content.documentNotFound' }
    });
}

function normalizePlacementQuery(value: unknown): string | null {
    if (value === undefined || value === null || value === '') {
        return null;
    }
    const raw = firstQueryValue(value);
    if (typeof raw !== 'string') {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.content.documentInvalidQuery',
            data: { code: 'errors.content.documentInvalidQuery' }
        });
    }
    const placement = raw.trim().toLowerCase();
    if (PUBLIC_DOCUMENT_PLACEMENTS.has(placement)) {
        return placement;
    }

    throw createSafeError({
        statusCode: 400,
        message: 'errors.content.documentInvalidQuery',
        data: { code: 'errors.content.documentInvalidQuery' }
    });
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isSafePublicDocumentDownloadUrl(
    value: unknown,
    context: {
        slug: string
        id: string
        placement: string
        organisation: string | null
        form: string | null
    }
): value is string {
    if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) {
        return false;
    }
    let url: URL;
    try {
        url = new URL(value, 'https://beantragt.invalid');
    } catch {
        return false;
    }

    const expectedPath = `/api/v1/jurisdictions/${encodeURIComponent(context.slug)}/documents/${encodeURIComponent(context.id)}/file`;
    if (url.pathname !== expectedPath) return false;

    const allowedKeys = new Set(['placement']);
    if (context.organisation) allowedKeys.add('organisation');
    if (context.form) {
        allowedKeys.add('form');
        if (!context.organisation) allowedKeys.add('organisation');
    }
    for (const key of url.searchParams.keys()) {
        if (!allowedKeys.has(key)) return false;
    }

    if (url.searchParams.get('placement') !== context.placement) return false;
    if (context.organisation && url.searchParams.get('organisation') !== context.organisation) return false;
    if (!context.organisation && !context.form && url.searchParams.has('organisation')) return false;
    if (!context.organisation && context.form && url.searchParams.has('organisation')) {
        const organisation = normalizePublicWorkspaceSlug(url.searchParams.get('organisation'));
        if (!organisation) return false;
    }
    if (context.form && url.searchParams.get('form') !== context.form) return false;
    if (!context.form && url.searchParams.has('form')) return false;

    return true;
}

function projectBody(value: unknown): PublicDocumentProjection['attributes']['description'] | null {
    if (!isRecord(value)) return null;
    if (typeof value.value !== 'string' || typeof value.processed !== 'string') return null;
    if (value.format !== null && typeof value.format !== 'string') return null;
    const format = typeof value.format === 'string' ? value.format : null;
    return {
        value: value.value,
        processed: value.processed,
        format
    };
}

function projectForm(value: unknown): PublicDocumentProjection['attributes']['form'] | null | false {
    if (value === null) return null;
    if (!isRecord(value)) return false;
    if (typeof value.id !== 'string' || !PUBLIC_FORM_UUID_PATTERN.test(value.id)) return false;
    if (typeof value.title !== 'string' || value.title.trim() === '') return false;
    return {
        id: value.id,
        title: value.title
    };
}

function projectPublicDocumentFile(
    value: unknown,
    context: {
        slug: string
        id: string
        placement: string
        organisation: string | null
        form: string | null
    }
): PublicDocumentProjection['attributes']['file'] | null {
    if (!isRecord(value)) return null;
    if (typeof value.filename !== 'string' || value.filename.trim() === '') return null;
    if (typeof value.mimeType !== 'string' || !PUBLIC_DOCUMENT_MIME_TYPES.has(value.mimeType)) return null;
    if (typeof value.size !== 'number' || !Number.isFinite(value.size) || value.size < 0) return null;
    if (!isSafePublicDocumentDownloadUrl(value.url, context)) return null;
    return {
        filename: value.filename,
        mimeType: value.mimeType,
        size: value.size,
        url: value.url
    };
}

function projectPublicDocumentItem(
    value: unknown,
    slug: string,
    organisation: string | null,
    form: string | null
): PublicDocumentProjection | null {
    if (!isRecord(value) || value.type !== 'publicDocument') return null;
    if (typeof value.id !== 'string' || !PUBLIC_DOCUMENT_UUID_PATTERN.test(value.id)) return null;
    if (!isRecord(value.attributes)) return null;
    if (typeof value.attributes.title !== 'string' || value.attributes.title.trim() === '') return null;
    if (typeof value.attributes.placement !== 'string' || !PUBLIC_DOCUMENT_PLACEMENTS.has(value.attributes.placement)) return null;
    if (typeof value.attributes.order !== 'number' || !Number.isFinite(value.attributes.order)) return null;
    if (typeof value.attributes.langcode !== 'string' || !SUPPORTED_LANGUAGES.has(value.attributes.langcode)) return null;
    if (typeof value.attributes.changed !== 'number' || !Number.isFinite(value.attributes.changed) || value.attributes.changed < 0) return null;

    const description = projectBody(value.attributes.description);
    const projectedForm = projectForm(value.attributes.form);
    const file = projectPublicDocumentFile(value.attributes.file, {
        slug,
        id: value.id,
        placement: value.attributes.placement,
        organisation,
        form
    });
    if (!description || projectedForm === false || !file) return null;

    return {
        type: 'publicDocument',
        id: value.id,
        attributes: {
            title: value.attributes.title,
            description,
            placement: value.attributes.placement,
            order: value.attributes.order,
            file,
            form: projectedForm,
            langcode: value.attributes.langcode,
            changed: value.attributes.changed
        }
    };
}

function projectPublicDocumentListResponse(
    value: unknown,
    slug: string,
    organisation: string | null,
    form: string | null
): { data: PublicDocumentProjection[], meta: { apiVersion: '1.0', resource: 'publicDocumentList' } } | null {
    if (!isRecord(value) || !Array.isArray(value.data) || !isRecord(value.meta)) {
        return null;
    }
    if (value.meta.apiVersion !== '1.0' || value.meta.resource !== 'publicDocumentList') {
        return null;
    }
    const items = value.data.map(item => projectPublicDocumentItem(item, slug, organisation, form));
    if (items.some(item => item === null)) {
        return null;
    }
    return {
        data: items as PublicDocumentProjection[],
        meta: {
            apiVersion: '1.0',
            resource: 'publicDocumentList'
        }
    };
}

export default defineEventHandler(async (event) => {
    const ip = getClientIp(event);
    checkRateLimit(ip, 'schema_fetch', event);

    const slug = validatePublicJurisdictionSlug(getRouterParam(event, 'slug'));
    const eventQuery = getQuery(event);
    const lang = normalizeLang(eventQuery.lang);
    const organisation = normalizeOrganisationQuery(eventQuery, 'errors.content.documentNotFound');
    const form = normalizeFormQuery(eventQuery);
    const placement = normalizePlacementQuery(eventQuery.placement);

    const config = useRuntimeConfig();
    const apiBase = config.apiBase;
    if (!apiBase) {
        throw createSafeError({
            statusCode: 500,
            message: 'errors.server.configuration',
            data: { code: 'errors.server.configuration' }
        });
    }

    const query = new URLSearchParams();
    if (lang) {
        query.set('lang', lang);
    }
    if (organisation) {
        query.set('organisation', organisation);
    }
    if (form) {
        query.set('form', form);
    }
    if (placement) {
        query.set('placement', placement);
    }
    const upstreamHeaders: Record<string, string> = { Accept: 'application/json' };
    const serviceAuthHeader = getOptionalServiceAuthHeader();
    if (serviceAuthHeader) {
        upstreamHeaders['X-Beantragt-Service-Authorization'] = serviceAuthHeader;
        upstreamHeaders['X-Beantragt-Rate-Limit-Identifier'] = serviceProxyRateLimitIdentifier('public-documents', ip);
    }

    try {
        const response = await fetch(
            `${apiBase}/api/v1/jurisdictions/${encodeURIComponent(slug)}/documents${query.size ? `?${query.toString()}` : ''}`,
            {
                method: 'GET',
                headers: upstreamHeaders
            }
        );

        if (!response.ok) {
            if (response.status === 429) {
                throw createSafeError({
                    statusCode: 429,
                    message: 'errors.rateLimit.tooManyRequests',
                    data: { code: 'errors.rateLimit.tooManyRequests' }
                });
            }
            if (response.status === 404) {
                throw createSafeError({
                    statusCode: 404,
                    message: 'errors.content.documentNotFound',
                    data: { code: 'errors.content.documentNotFound' }
                });
            }
            throw createSafeError({
                statusCode: response.status,
                message: 'errors.content.documentLoadFailed',
                data: { code: 'errors.content.documentLoadFailed' }
            });
        }

        let data: unknown;
        try {
            data = await response.json();
        } catch {
            throw createSafeError({
                statusCode: 502,
                message: 'errors.content.documentLoadFailed',
                data: { code: 'errors.content.documentLoadFailed' }
            });
        }
        const projectedData = projectPublicDocumentListResponse(data, slug, organisation, form);
        if (!projectedData) {
            throw createSafeError({
                statusCode: 502,
                message: 'errors.content.documentLoadFailed',
                data: { code: 'errors.content.documentLoadFailed' }
            });
        }

        setHeader(event, 'Cache-Control', `public, max-age=${PUBLIC_DOCUMENT_MAX_AGE_SECONDS}`);

        return projectedData;
    } catch (e: unknown) {
        if (e && typeof e === 'object' && 'statusCode' in e) {
            throw e;
        }

        console.error('[public-documents] Error:', e instanceof Error ? e.message : e);
        throw createSafeError({
            statusCode: 500,
            message: 'errors.content.documentLoadFailed',
            data: { code: 'errors.content.documentLoadFailed' }
        });
    }
});
