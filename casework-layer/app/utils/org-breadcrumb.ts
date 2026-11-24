/**
 * A single, individually-navigable segment of the org-scope breadcrumb.
 */
export interface OrgBreadcrumbItem {
    /** Terse display code, e.g. "IX", "12", "120". */
    code: string
    /** Full human-readable label for the segment (tooltip text). */
    label: string
    /** Slug used to re-scope to this ancestor org (navigation target). */
    slug: string
    /** True for the trailing segment (the currently selected org). */
    isCurrent: boolean
}

/**
 * Minimal shape of the ancestor-path data carried by a catalog org node.
 * Indices are aligned: `pathCodes[i]`, `pathLabels[i]`, `pathSlugs[i]` describe
 * the same ancestor.
 */
export interface OrgPathSource {
    pathCodes: string[]
    pathLabels: string[]
    pathSlugs: string[]
}

/**
 * Builds the mini-breadcrumb model from an org node's ancestor path.
 *
 * Each item is individually navigable via its `slug`; the last item is flagged
 * `isCurrent` (rendered as plain text with `aria-current="page"`, not a link).
 *
 * When no org is selected (`org` is null), a single non-navigable fallback
 * segment is returned so the breadcrumb still renders a meaningful label (e.g.
 * an unresolved slug, or an "All" placeholder).
 *
 * @param org      The currently selected org node, or null when unscoped.
 * @param fallback Label/code/slug for the single fallback segment.
 */
export function buildOrgBreadcrumbItems(
    org: OrgPathSource | null,
    fallback: { code: string, label: string, slug: string | null }
): OrgBreadcrumbItem[] {
    if (!org) {
        return [{
            code: fallback.code,
            label: fallback.label,
            slug: fallback.slug ?? '',
            isCurrent: true
        }];
    }

    const lastIndex = org.pathCodes.length - 1;
    return org.pathCodes.map((code, index) => ({
        code,
        label: org.pathLabels[index] ?? code,
        slug: org.pathSlugs[index] ?? '',
        isCurrent: index === lastIndex
    }));
}
