/**
 * Shared validation helpers for the P4.4 "Config-as-Content" jurisdiction
 * settings proxy routes.
 *
 * The Drupal admin endpoints live under:
 *   GET   /api/admin/jurisdictions/{slugOrId}/settings/{section}
 *   PATCH /api/admin/jurisdictions/{slugOrId}/settings/{section}
 *
 * The {jurisdiction} param accepts either a workspace slug (same shape as
 * useWorkspaceContext.WORKSPACE_SLUG_PATTERN) or a numeric internal id. The
 * {section} param is restricted to the known config sections so the
 * proxy never forwards an arbitrary path segment to Drupal.
 */
import { createSafeError } from './error-handling';

/** The config sections exposed by the Drupal admin settings endpoint. */
export const SETTINGS_SECTIONS = ['general', 'branding', 'languages', 'embed', 'retention', 'uploads', 'notification_mail', 'delegation', 'applicant_profile', 'assistant'] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

/**
 * Workspace slug shape. Mirrors WORKSPACE_SLUG_PATTERN in
 * app/composables/useWorkspaceContext.ts so the proxy rejects the same set of
 * slugs the client would never produce.
 */
const WORKSPACE_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/;
const NUMERIC_ID_PATTERN = /^[0-9]{1,12}$/;
const WORKSPACE_ORGANISATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CONTENT_PAGE_IDENTIFIER_PATTERN = /^[a-z0-9](?:[a-z0-9_-]{0,126}[a-z0-9])?$/;

/**
 * Validate the `{section}` router param against the known section allowlist.
 * Throws a safe 400 when the section is unknown.
 */
export function validateSettingsSection(value: unknown): SettingsSection {
    const raw = Array.isArray(value) ? value[0] : value;
    if (typeof raw === 'string' && (SETTINGS_SECTIONS as readonly string[]).includes(raw)) {
        return raw as SettingsSection;
    }
    throw createSafeError({
        statusCode: 400,
        message: 'errors.admin.settingsSectionInvalid',
        data: { code: 'errors.admin.settingsSectionInvalid' }
    });
}

/**
 * Validate the `{jurisdiction}` router param. Accepts a lowercase workspace
 * slug or a numeric internal id. Returns the normalized identifier for use in
 * the upstream Drupal path. Throws a safe 400 on anything else.
 */
export function validateJurisdictionIdentifier(value: unknown): string {
    const raw = Array.isArray(value) ? value[0] : value;
    if (typeof raw === 'string') {
        const candidate = raw.trim();
        if (NUMERIC_ID_PATTERN.test(candidate)) {
            return candidate;
        }
        const slug = candidate.toLowerCase();
        if (WORKSPACE_SLUG_PATTERN.test(slug)) {
            return slug;
        }
    }
    throw createSafeError({
        statusCode: 400,
        message: 'errors.admin.jurisdictionInvalid',
        data: { code: 'errors.admin.jurisdictionInvalid' }
    });
}

/**
 * Validate the public `{slug}` router param for the anonymous config endpoint.
 * Public config is keyed by workspace slug only (never numeric id).
 */
export function validatePublicJurisdictionSlug(value: unknown): string {
    const raw = Array.isArray(value) ? value[0] : value;
    if (typeof raw === 'string') {
        const slug = raw.trim().toLowerCase();
        if (!NUMERIC_ID_PATTERN.test(slug) && WORKSPACE_SLUG_PATTERN.test(slug)) {
            return slug;
        }
    }
    throw createSafeError({
        statusCode: 404,
        message: 'errors.jurisdiction.notFound',
        data: { code: 'errors.jurisdiction.notFound' }
    });
}

/**
 * Validate a workspace-settings query slug. Unlike anonymous public config,
 * organisation workspace slugs may be numeric, for example `01`.
 */
export function validateWorkspaceSettingsSlug(value: unknown): string {
    const raw = Array.isArray(value) ? value[0] : value;
    if (typeof raw === 'string') {
        const slug = raw.trim().toLowerCase();
        if (WORKSPACE_SLUG_PATTERN.test(slug)) {
            return slug;
        }
    }
    throw createSafeError({
        statusCode: 404,
        message: 'errors.jurisdiction.notFound',
        data: { code: 'errors.jurisdiction.notFound' }
    });
}

/**
 * Validate a public content page key.
 */
export function validateContentPageKey(value: unknown): string {
    const raw = Array.isArray(value) ? value[0] : value;
    if (typeof raw === 'string') {
        const key = raw.trim().toLowerCase();
        if (CONTENT_PAGE_IDENTIFIER_PATTERN.test(key)) {
            return key;
        }
    }
    throw createSafeError({
        statusCode: 404,
        message: 'errors.content.pageNotFound',
        data: { code: 'errors.content.pageNotFound' }
    });
}

/**
 * Validate the admin workspace-settings query. The endpoint edits a concrete
 * workspace, addressed by jurisdiction slug and optional organisation slug.
 */
export function validateWorkspaceSettingsQuery(query: Record<string, unknown>): URLSearchParams {
    const jurisdiction = validateWorkspaceSettingsSlug(query.jurisdiction);
    const params = new URLSearchParams({ jurisdiction });
    const organisationInput = query.organisation ?? query.organization ?? query.org;
    if (organisationInput !== undefined && organisationInput !== null && organisationInput !== '') {
        params.set('organisation', validateWorkspaceSettingsSlug(organisationInput));
    }
    return params;
}

/**
 * Validate the admin workspace-organisation query. Organisation tree management
 * is scoped by jurisdiction only, even when the current UI route is inside an
 * organisation workspace.
 */
export function validateWorkspaceOrganisationsQuery(query: Record<string, unknown>): URLSearchParams {
    return new URLSearchParams({
        jurisdiction: validateWorkspaceSettingsSlug(query.jurisdiction)
    });
}

/**
 * Validate a workspace organisation identifier for path forwarding.
 */
export function validateWorkspaceOrganisationIdentifier(value: unknown): string {
    const raw = Array.isArray(value) ? value[0] : value;
    if (typeof raw === 'string') {
        const identifier = raw.trim().toLowerCase();
        if (WORKSPACE_ORGANISATION_ID_PATTERN.test(identifier)) {
            return identifier;
        }
    }
    throw createSafeError({
        statusCode: 400,
        message: 'errors.admin.workspaceOrganisationIdInvalid',
        data: { code: 'errors.admin.workspaceOrganisationIdInvalid' }
    });
}

/**
 * Narrow an unknown PATCH body to the `{ data: object }` contract. The Drupal
 * endpoint owns per-field validation; the proxy only guarantees the envelope
 * is a plain object so a malformed/array/primitive body never reaches Drupal.
 */
export function extractSettingsData(body: unknown): Record<string, unknown> {
    if (
        body
        && typeof body === 'object'
        && !Array.isArray(body)
        && 'data' in body
        && (body as { data: unknown }).data
        && typeof (body as { data: unknown }).data === 'object'
        && !Array.isArray((body as { data: unknown }).data)
    ) {
        return (body as { data: Record<string, unknown> }).data;
    }
    throw createSafeError({
        statusCode: 400,
        message: 'errors.admin.settingsDataInvalid',
        data: { code: 'errors.admin.settingsDataInvalid' }
    });
}

/**
 * HTTP statuses for which a Drupal-supplied validation message is safe and
 * useful to surface to the client. 5xx (and other non-validation statuses)
 * are mapped to the i18n fallback key with no detail, so an internal error
 * string never leaks to the browser.
 */
const VALIDATION_STATUSES = new Set([400, 422]);

/**
 * Parse a Drupal `{error:{message,field?}}` body into a safe i18n-shaped error.
 *
 * For 4xx validation responses (400/422) the backend-authored `message`/`field`
 * are forwarded in the `data.detail`/`data.field` channel so the client can
 * render an inline field error. For every other status (incl. 5xx) only the
 * i18n fallback key is returned, so internal error text is never exposed.
 *
 * The top-level `message` always stays an i18n key so the client has a stable
 * fallback regardless of the upstream body.
 */
export function safeErrorFromDrupal(
    status: number,
    rawBody: string,
    fallbackKey: string
): ReturnType<typeof createSafeError> {
    let detail: string | undefined;
    let field: string | undefined;

    if (VALIDATION_STATUSES.has(status)) {
        try {
            const parsed = JSON.parse(rawBody) as { error?: { message?: unknown, field?: unknown } };
            if (parsed?.error && typeof parsed.error === 'object') {
                if (typeof parsed.error.message === 'string') {
                    detail = parsed.error.message;
                }
                if (typeof parsed.error.field === 'string') {
                    field = parsed.error.field;
                }
            }
        } catch {
            // Non-JSON upstream body: keep only the i18n fallback key.
        }
    }

    return createSafeError({
        statusCode: status,
        message: fallbackKey,
        data: {
            code: fallbackKey,
            ...(detail ? { detail } : {}),
            ...(field ? { field } : {})
        }
    });
}
