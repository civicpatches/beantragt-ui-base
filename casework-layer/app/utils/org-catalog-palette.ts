import type { PublicOrgNode } from '~/types/org-catalog';

/**
 * Pure, framework-agnostic helpers for rendering a public org catalog inside the
 * admin command palette (`DashboardWorkspaceSwitcher`): code/label/path search,
 * the catalog-vs-fallback decision, and selection→workspace-scope mapping.
 */

export const ORG_CATALOG_RESET_ID = 'org-catalog:reset';

/** Stable command-palette item id for a catalog org (jur-scoped). */
export function orgCatalogItemId(jurisdictionSlug: string, orgSlug: string): string {
    return `org-catalog:${jurisdictionSlug}/${orgSlug}`;
}

/**
 * Diacritic-insensitive, lower-cased search normalization (NFD fold).
 */
export function normalizeSearchValue(value: string): string {
    return value
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .trim();
}

function orgSearchText(org: PublicOrgNode): string {
    return normalizeSearchValue([
        org.code,
        org.label,
        org.type,
        org.pathCodes.join(' '),
        org.pathLabels.join(' ')
    ].join(' '));
}

/**
 * Relevance score for an org against a normalized query. Mirrors the public
 * switcher: exact/prefix code match ranks highest, then label, then full path.
 */
export function scoreOrg(org: PublicOrgNode, query: string): number {
    const code = normalizeSearchValue(org.code);
    const label = normalizeSearchValue(org.label);
    const text = orgSearchText(org);

    if (code === query) return 100;
    if (code.startsWith(query)) return 90;
    if (label.startsWith(query)) return 80;
    if (label.includes(query)) return 70;
    if (text.includes(query)) return 60;
    return 0;
}

/** Size of the default (no-query) shortlist. */
export const FEATURED_ORG_COUNT = 8;

/**
 * The default (no-query) org shortlist, derived from the catalogue at hand: the shallowest units,
 * in catalogue order within a level. No code of any municipality is named here.
 */
export function featuredOrgs(orgs: readonly PublicOrgNode[]): PublicOrgNode[] {
    return orgs
        .map((org, index) => ({ org, index }))
        .sort((a, b) => a.org.level - b.org.level || a.index - b.index)
        .slice(0, FEATURED_ORG_COUNT)
        .map(item => item.org);
}

/**
 * Filters + ranks the catalog by a raw search string. Empty query returns the
 * featured shortlist; otherwise the top scored matches (code + label + path).
 */
export function filterOrgs(
    orgs: readonly PublicOrgNode[],
    rawQuery: string,
    limit = 12
): PublicOrgNode[] {
    const query = normalizeSearchValue(rawQuery);
    if (!query) return featuredOrgs(orgs);

    return orgs
        .map(org => ({ org, score: scoreOrg(org, query) }))
        .filter(item => item.score > 0)
        .sort((a, b) =>
            b.score - a.score
            || a.org.level - b.org.level
            || a.org.code.localeCompare(b.org.code, 'de'))
        .slice(0, limit)
        .map(item => item.org);
}

/**
 * Decides whether the rich catalog view is available for a jurisdiction.
 * Treats a non-empty `data` array as "has catalog". When false, callers fall
 * back to the flat workspace org list. (The Drupal-backed catalog for ALL
 * jurisdictions still needs to be provided; the bundle ships none.)
 */
export function hasCatalog(orgs: readonly PublicOrgNode[]): boolean {
    return orgs.length > 0;
}

/**
 * Where a catalog selection should scope the admin workspace.
 *
 * - reset → the active jurisdiction (org cleared).
 * - org   → prefer the exact `<jur>/<slug>` workspace key when it exists in the
 *   admin workspace set (jur-scoped, unambiguous), so `switchWorkspace` matches
 *   by `key`. If the workspace is missing, fall back to constructing the admin
 *   route from jur + org slugs directly.
 */
export interface OrgWorkspaceTarget {
    /** Pass to `switchWorkspace`; null when only a route fallback is possible. */
    workspaceKey: string | null
    /** Admin route path built from slugs, used when no workspace key matched. */
    routePath: string | null
}

export function resolveOrgWorkspaceTarget(
    activeJurisdictionSlug: string,
    orgSlug: string | null,
    knownWorkspaceKeys: ReadonlySet<string>,
    adminSubPath = '/admin'
): OrgWorkspaceTarget {
    if (!orgSlug) {
        // Reset to jurisdiction level.
        return knownWorkspaceKeys.has(activeJurisdictionSlug)
            ? { workspaceKey: activeJurisdictionSlug, routePath: null }
            : { workspaceKey: null, routePath: `/${activeJurisdictionSlug}${adminSubPath}` };
    }

    const key = `${activeJurisdictionSlug}/${orgSlug}`;
    return knownWorkspaceKeys.has(key)
        ? { workspaceKey: key, routePath: null }
        : { workspaceKey: null, routePath: `/${key}${adminSubPath}` };
}
