/**
 * GET /api/jurisdictions/:slug/sections
 *
 * Anonymous proxy for jurisdiction-scoped public HTML content sections.
 */
import { getOptionalServiceAuthHeader } from '../../../../utils/auth';
import { createSafeError } from '../../../../utils/error-handling';
import { validatePublicJurisdictionSlug } from '../../../../utils/jurisdiction-settings';
import { normalizeOrganisationQuery } from '../../../../utils/public-content-query';
import { serviceProxyRateLimitIdentifier } from '../../../../utils/public-status-proxy';
import { checkRateLimit, getClientIp } from '../../../../utils/rate-limit';

const PUBLIC_SECTION_MAX_AGE_SECONDS = 300;
const SUPPORTED_LANGUAGES = new Set(['de', 'en']);
const PUBLIC_FORM_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PUBLIC_SECTION_UUID_PATTERN = PUBLIC_FORM_UUID_PATTERN;
const PUBLIC_SECTION_PLACEMENTS = new Set([
    'org_start',
    'form_intro',
    'form_sidebar',
    'submission_success'
]);

interface PublicContentSectionProjection {
    type: 'contentSection'
    id: string
    attributes: {
        title: string
        body: {
            value: string
            processed: string
            format: string | null
        }
        placement: string
        order: number
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
            message: 'errors.content.sectionNotFound',
            data: { code: 'errors.content.sectionNotFound' }
        });
    }
    const form = raw.trim().toLowerCase();
    if (PUBLIC_FORM_UUID_PATTERN.test(form)) {
        return form;
    }

    throw createSafeError({
        statusCode: 404,
        message: 'errors.content.sectionNotFound',
        data: { code: 'errors.content.sectionNotFound' }
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
            message: 'errors.content.sectionInvalidQuery',
            data: { code: 'errors.content.sectionInvalidQuery' }
        });
    }
    const placement = raw.trim().toLowerCase();
    if (PUBLIC_SECTION_PLACEMENTS.has(placement)) {
        return placement;
    }

    throw createSafeError({
        statusCode: 400,
        message: 'errors.content.sectionInvalidQuery',
        data: { code: 'errors.content.sectionInvalidQuery' }
    });
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function projectBody(value: unknown): PublicContentSectionProjection['attributes']['body'] | null {
    if (!isRecord(value)) return null;
    if (typeof value.value !== 'string' || typeof value.processed !== 'string') return null;
    if (value.format !== null && typeof value.format !== 'string') return null;
    return {
        value: value.value,
        processed: value.processed,
        format: typeof value.format === 'string' ? value.format : null
    };
}

function projectForm(value: unknown): PublicContentSectionProjection['attributes']['form'] | null | false {
    if (value === null) return null;
    if (!isRecord(value)) return false;
    if (typeof value.id !== 'string' || !PUBLIC_FORM_UUID_PATTERN.test(value.id)) return false;
    if (typeof value.title !== 'string' || value.title.trim() === '') return false;
    return {
        id: value.id,
        title: value.title
    };
}

function projectPublicSectionItem(value: unknown): PublicContentSectionProjection | null {
    if (!isRecord(value) || value.type !== 'contentSection') return null;
    if (typeof value.id !== 'string' || !PUBLIC_SECTION_UUID_PATTERN.test(value.id)) return null;
    if (!isRecord(value.attributes)) return null;
    if (typeof value.attributes.title !== 'string' || value.attributes.title.trim() === '') return null;
    if (typeof value.attributes.placement !== 'string' || !PUBLIC_SECTION_PLACEMENTS.has(value.attributes.placement)) return null;
    if (typeof value.attributes.order !== 'number' || !Number.isFinite(value.attributes.order)) return null;
    if (typeof value.attributes.langcode !== 'string' || !SUPPORTED_LANGUAGES.has(value.attributes.langcode)) return null;
    if (typeof value.attributes.changed !== 'number' || !Number.isFinite(value.attributes.changed) || value.attributes.changed < 0) return null;

    const body = projectBody(value.attributes.body);
    const form = projectForm(value.attributes.form);
    if (!body || form === false) return null;

    return {
        type: 'contentSection',
        id: value.id,
        attributes: {
            title: value.attributes.title,
            body,
            placement: value.attributes.placement,
            order: value.attributes.order,
            form,
            langcode: value.attributes.langcode,
            changed: value.attributes.changed
        }
    };
}

function projectPublicSectionListResponse(value: unknown): { data: PublicContentSectionProjection[], meta: { apiVersion: '1.0', resource: 'contentSectionList' } } | null {
    if (!isRecord(value) || !Array.isArray(value.data) || !isRecord(value.meta)) {
        return null;
    }
    if (value.meta.apiVersion !== '1.0' || value.meta.resource !== 'contentSectionList') {
        return null;
    }
    const items = value.data.map(projectPublicSectionItem);
    if (items.some(item => item === null)) {
        return null;
    }
    return {
        data: items as PublicContentSectionProjection[],
        meta: {
            apiVersion: '1.0',
            resource: 'contentSectionList'
        }
    };
}

export default defineEventHandler(async (event) => {
    const ip = getClientIp(event);
    checkRateLimit(ip, 'schema_fetch', event);

    const slug = validatePublicJurisdictionSlug(getRouterParam(event, 'slug'));
    const eventQuery = getQuery(event);
    const lang = normalizeLang(eventQuery.lang);
    const organisation = normalizeOrganisationQuery(eventQuery, 'errors.content.sectionNotFound');
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
        upstreamHeaders['X-Beantragt-Rate-Limit-Identifier'] = serviceProxyRateLimitIdentifier('public-sections', ip);
    }

    try {
        const response = await fetch(
            `${apiBase}/api/v1/jurisdictions/${encodeURIComponent(slug)}/sections${query.size ? `?${query.toString()}` : ''}`,
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
                    message: 'errors.content.sectionNotFound',
                    data: { code: 'errors.content.sectionNotFound' }
                });
            }
            throw createSafeError({
                statusCode: response.status,
                message: 'errors.content.sectionLoadFailed',
                data: { code: 'errors.content.sectionLoadFailed' }
            });
        }

        let raw: unknown;
        try {
            raw = await response.json();
        } catch {
            throw createSafeError({
                statusCode: 502,
                message: 'errors.content.sectionLoadFailed',
                data: { code: 'errors.content.sectionLoadFailed' }
            });
        }

        const data = projectPublicSectionListResponse(raw);
        if (!data) {
            throw createSafeError({
                statusCode: 502,
                message: 'errors.content.sectionLoadFailed',
                data: { code: 'errors.content.sectionLoadFailed' }
            });
        }

        setHeader(event, 'Cache-Control', `public, max-age=${PUBLIC_SECTION_MAX_AGE_SECONDS}`);

        return data;
    } catch (e: unknown) {
        if (e && typeof e === 'object' && 'statusCode' in e) {
            throw e;
        }

        console.error('[content-sections] Error:', e instanceof Error ? e.message : e);
        throw createSafeError({
            statusCode: 500,
            message: 'errors.content.sectionLoadFailed',
            data: { code: 'errors.content.sectionLoadFailed' }
        });
    }
});
