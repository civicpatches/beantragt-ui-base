import type { JurisdictionBoundary } from '~~/app/types/jurisdiction-boundary';
import { normalizeJurisdictionBoundary } from '~~/app/utils/jurisdiction-boundary';
import { createSafeError } from '../../../utils/error-handling';
import { validatePublicJurisdictionSlug } from '../../../utils/jurisdiction-settings';
import { checkRateLimit, getClientIp } from '../../../utils/rate-limit';

const PUBLIC_BOUNDARY_MAX_AGE_SECONDS = 300;

export default defineEventHandler(async (event): Promise<{ boundary: JurisdictionBoundary | null }> => {
    checkRateLimit(getClientIp(event), 'schema_fetch', event);
    const slug = validatePublicJurisdictionSlug(getRouterParam(event, 'slug'));
    const config = useRuntimeConfig();
    if (!config.apiBase) {
        throw createSafeError({
            statusCode: 500,
            message: 'errors.server.configuration',
            data: { code: 'errors.server.configuration' }
        });
    }

    try {
        const response = await fetch(
            `${config.apiBase}/api/v1/jurisdictions/${encodeURIComponent(slug)}/boundary`,
            { method: 'GET', headers: { Accept: 'application/json' } }
        );
        if (!response.ok) {
            throw createSafeError({
                statusCode: response.status === 404 ? 404 : 502,
                message: response.status === 404
                    ? 'errors.jurisdiction.notFound'
                    : 'errors.jurisdiction.configLoadFailed',
                data: {
                    code: response.status === 404
                        ? 'errors.jurisdiction.notFound'
                        : 'errors.jurisdiction.configLoadFailed'
                }
            });
        }

        const payload = await response.json() as { data?: { boundary?: unknown } };
        const rawBoundary = payload?.data?.boundary;
        const boundary = rawBoundary === null || rawBoundary === undefined
            ? null
            : normalizeJurisdictionBoundary(rawBoundary);
        if (rawBoundary !== null && rawBoundary !== undefined && !boundary) {
            throw createSafeError({
                statusCode: 502,
                message: 'errors.jurisdiction.configLoadFailed',
                data: { code: 'errors.jurisdiction.configLoadFailed' }
            });
        }

        setHeader(event, 'Cache-Control', `public, max-age=${PUBLIC_BOUNDARY_MAX_AGE_SECONDS}`);
        return { boundary };
    } catch (error: unknown) {
        if (error && typeof error === 'object' && 'statusCode' in error) throw error;
        throw createSafeError({
            statusCode: 502,
            message: 'errors.jurisdiction.configLoadFailed',
            data: { code: 'errors.jurisdiction.configLoadFailed' }
        });
    }
});
