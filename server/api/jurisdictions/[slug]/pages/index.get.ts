/**
 * GET /api/jurisdictions/:slug/pages
 *
 * Anonymous proxy for the jurisdiction-scoped public content page list.
 */
import { createSafeError } from '../../../../utils/error-handling';
import { checkRateLimit, getClientIp } from '../../../../utils/rate-limit';
import { validatePublicJurisdictionSlug } from '../../../../utils/jurisdiction-settings';
import { normalizeOrganisationQuery } from '../../../../utils/public-content-query';

const PUBLIC_PAGE_MAX_AGE_SECONDS = 300;
const SUPPORTED_LANGUAGES = new Set(['de', 'en']);

function normalizeLang(value: unknown): string | null {
    const raw = Array.isArray(value) ? value[0] : value;
    if (typeof raw !== 'string') return null;
    const lang = raw.trim().toLowerCase();
    return SUPPORTED_LANGUAGES.has(lang) ? lang : null;
}

export default defineEventHandler(async (event) => {
    const ip = getClientIp(event);
    checkRateLimit(ip, 'schema_fetch', event);

    const slug = validatePublicJurisdictionSlug(getRouterParam(event, 'slug'));
    const eventQuery = getQuery(event);
    const lang = normalizeLang(eventQuery.lang);
    const organisation = normalizeOrganisationQuery(eventQuery, 'errors.content.pageNotFound');

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

    try {
        const response = await fetch(
            `${apiBase}/api/v1/jurisdictions/${encodeURIComponent(slug)}/pages${query.size ? `?${query.toString()}` : ''}`,
            {
                method: 'GET',
                headers: { Accept: 'application/json' }
            }
        );

        if (!response.ok) {
            if (response.status === 404) {
                throw createSafeError({
                    statusCode: 404,
                    message: 'errors.content.pageNotFound',
                    data: { code: 'errors.content.pageNotFound' }
                });
            }
            throw createSafeError({
                statusCode: response.status,
                message: 'errors.content.pageLoadFailed',
                data: { code: 'errors.content.pageLoadFailed' }
            });
        }

        const data = await response.json();
        if (
            !data
            || typeof data !== 'object'
            || Array.isArray(data)
            || !Array.isArray((data as { data?: unknown }).data)
        ) {
            throw createSafeError({
                statusCode: 502,
                message: 'errors.content.pageLoadFailed',
                data: { code: 'errors.content.pageLoadFailed' }
            });
        }

        setHeader(event, 'Cache-Control', `public, max-age=${PUBLIC_PAGE_MAX_AGE_SECONDS}`);

        return data;
    } catch (e: unknown) {
        if (e && typeof e === 'object' && 'statusCode' in e) {
            throw e;
        }

        console.error('[content-pages] Error:', e instanceof Error ? e.message : e);
        throw createSafeError({
            statusCode: 500,
            message: 'errors.content.pageLoadFailed',
            data: { code: 'errors.content.pageLoadFailed' }
        });
    }
});
