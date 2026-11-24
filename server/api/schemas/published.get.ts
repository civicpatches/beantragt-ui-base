/**
 * GET /api/schemas/published
 *
 * Returns all discoverable form schemas (public, no auth required).
 * In development this includes drafts to make local testing possible.
 */
import {
    fetchDiscoverableSchemas,
    fetchDiscoverableSchemasForScope,
    localizeDiscoverableSchemas,
    normalizePublicFormLocale,
    shouldIncludeDraftSchemas
} from '../../utils/schema-catalog';
import { normalizePublicWorkspaceSlug, resolvePublicWorkspaceBySlugs } from '../../utils/public-workspace';
import { checkRateLimit, getClientIp } from '../../utils/rate-limit';

export default defineEventHandler(async (event) => {
    checkRateLimit(getClientIp(event), 'schema_fetch', event);

    try {
        const query = getQuery(event);
        const organisationInput = query.organisation ?? query.organization ?? query.org;
        const hasJurisdictionInput = query.jurisdiction !== undefined;
        const hasOrganisationInput = query.organisation !== undefined || query.organization !== undefined || query.org !== undefined;
        const hasLocaleInput = query.lang !== undefined;
        const locale = hasLocaleInput ? normalizePublicFormLocale(query.lang) : 'de';
        const jurisdictionSlug = normalizePublicWorkspaceSlug(query.jurisdiction);
        const organisationSlug = normalizePublicWorkspaceSlug(organisationInput);
        if (!locale) {
            throw createSafeError({
                statusCode: 400,
                message: 'request.invalid_locale',
                data: { code: 'request.invalid_locale' }
            });
        }
        if (
            (hasJurisdictionInput && !jurisdictionSlug)
            || (hasOrganisationInput && !organisationSlug)
            || (hasOrganisationInput && !jurisdictionSlug)
        ) {
            throw createSafeError({
                statusCode: 404,
                message: 'workspace.not_found',
                data: { code: 'workspace.not_found' }
            });
        }
        if ((jurisdictionSlug || organisationSlug) && !await resolvePublicWorkspaceBySlugs(jurisdictionSlug, organisationSlug)) {
            throw createSafeError({
                statusCode: 404,
                message: 'workspace.not_found',
                data: { code: 'workspace.not_found' }
            });
        }
        const includeDrafts = shouldIncludeDraftSchemas();
        const schemas = jurisdictionSlug && !includeDrafts
            ? await fetchDiscoverableSchemasForScope(jurisdictionSlug, organisationSlug, {
                proxyRateLimitIp: getClientIp(event)
            })
            : await fetchDiscoverableSchemas();
        const data = localizeDiscoverableSchemas(schemas.filter((schema) => {
            if (jurisdictionSlug && schema.jurisdictionSlug !== jurisdictionSlug) return false;
            if (organisationSlug && schema.organisationSlug !== organisationSlug) return false;
            return true;
        }), locale);
        setHeader(event, 'Cache-Control', includeDrafts ? 'no-store' : 'public, max-age=300');
        return { data };
    } catch (e: unknown) {
        if (typeof e === 'object' && e !== null && 'statusCode' in e) {
            throw e;
        }
        console.error('[schemas/published] Failed to load:', e instanceof Error ? e.message : e);
        return { data: [] };
    }
});
