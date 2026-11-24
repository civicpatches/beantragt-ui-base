/**
 * GET /api/jurisdictions/:slug/config
 *
 * P4.4 Config-as-Content: PUBLIC (anonymous) jurisdiction config used to theme
 * and brand the citizen-facing UI. No PII; safe to cache at the edge/browser.
 *
 * Proxies to Drupal's public v1 config endpoint, unwraps the v1 envelope for
 * the existing UI contract and passes through 404 for unknown slugs. The
 * response carries a short public Cache-Control so repeat citizen page loads do
 * not re-hit Drupal on every navigation.
 */
import { createSafeError } from '../../../utils/error-handling';
import { checkRateLimit, getClientIp } from '../../../utils/rate-limit';
import {
    validatePublicJurisdictionSlug,
    validateWorkspaceSettingsSlug
} from '../../../utils/jurisdiction-settings';
import { publicJurisdictionConfigExtensions } from '../../../utils/public-jurisdiction-config-extensions';
import { loadPublicJurisdictionConfig } from '../../../utils/public-jurisdiction-config';
import { resolvePublicWorkspaceBySlugs } from '../../../utils/public-workspace';

const PUBLIC_CONFIG_MAX_AGE_SECONDS = 300;

export default defineEventHandler(async (event) => {
    const ip = getClientIp(event);
    checkRateLimit(ip, 'schema_fetch', event);

    const slug = validatePublicJurisdictionSlug(getRouterParam(event, 'slug'));
    const organisationInput = getQuery(event).organisation;
    const organisationSlug = organisationInput === undefined || organisationInput === null || organisationInput === ''
        ? null
        : validateWorkspaceSettingsSlug(organisationInput);

    const config = useRuntimeConfig();
    const apiBase = config.apiBase;
    if (!apiBase) {
        throw createSafeError({
            statusCode: 500,
            message: 'errors.server.configuration',
            data: { code: 'errors.server.configuration' }
        });
    }

    try {
        if (organisationSlug && !await resolvePublicWorkspaceBySlugs(slug, organisationSlug)) {
            throw createSafeError({
                statusCode: 404,
                message: 'workspace.not_found',
                data: { code: 'workspace.not_found' }
            });
        }

        const data = await loadPublicJurisdictionConfig(apiBase, slug);

        // Public, non-PII config: cacheable by the browser and any shared cache.
        setHeader(
            event,
            'Cache-Control',
            `public, max-age=${PUBLIC_CONFIG_MAX_AGE_SECONDS}`
        );

        return {
            ...data,
            ...publicJurisdictionConfigExtensions({
                jurisdictionSlug: slug,
                organisationSlug,
                config
            })
        };
    } catch (e: unknown) {
        if (e && typeof e === 'object' && 'statusCode' in e) {
            throw e;
        }

        console.error('[jurisdiction-config] Error:', e instanceof Error ? e.message : e);
        throw createSafeError({
            statusCode: 500,
            message: 'errors.jurisdiction.configLoadFailed',
            data: { code: 'errors.jurisdiction.configLoadFailed' }
        });
    }
});
