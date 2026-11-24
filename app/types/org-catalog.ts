/**
 * Client-side shape of a public org catalog node, as returned by
 * `GET /api/orgs/[jurisdiction]` (`server/utils/public-org-catalog.ts`).
 *
 * Shared by the admin command palette / breadcrumb pill
 * ({@link DashboardWorkspaceSwitcher}) and the citizen org-context sidebar
 * ({@link OrgContextSidebar}).
 */
export interface PublicOrgNode {
    code: string
    label: string
    type: string
    level: number
    parentCode: string | null
    slug: string
    pathCodes: string[]
    pathLabels: string[]
    pathSlugs: string[]
    childCount: number
}

export interface PublicOrgCatalogResponse {
    data: PublicOrgNode[]
}
