import type { H3Event } from 'h3';
import { drupalServiceFetch, drupalSessionFetch, getAuthenticatedUser } from '~~/server/utils/auth';
import { createSafeError } from '~~/server/utils/error-handling';

export type AdminWorkspaceType = 'jurisdiction' | 'organisation';

export interface AdminWorkspace {
    type: AdminWorkspaceType
    id: string
    internalId: number | null
    label: string
    slug: string
    key: string
    path: string
    jurisdictionId: string
    jurisdictionInternalId: number | null
    jurisdictionSlug: string
    jurisdictionLabel: string
    organisationId: string | null
    organisationInternalId: number | null
    organisationSlug: string | null
    organisationLabel: string | null
    parentId: string | null
    parentLabel: string | null
    canCreateFormSchema?: boolean
}

export type AdminJurisdiction = AdminWorkspace;

interface GroupResource {
    id: string
    type?: string
    attributes?: {
        drupal_internal__id?: number | string
        label?: string
        field_slug?: string | null
    }
    relationships?: {
        field_parent_jurisdiction?: {
            data?: { id: string, type?: string } | null
        }
        field_jurisdiction?: {
            data?: { id: string, type?: string } | null
        }
    }
}

export interface GroupCollectionResponse {
    data?: GroupResource[]
    included?: GroupResource[]
    links?: {
        next?: { href: string } | null
    }
}

export interface AdminWorkspacesResponse {
    jurisdictions?: AdminWorkspace[]
    organisations?: AdminWorkspace[]
    workspaces?: AdminWorkspace[]
    count?: number
}

const WORKSPACE_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/;
const WORKSPACE_KEY_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?(?:\/[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?)?$/;

export function normalizeWorkspaceSlug(value: unknown): string | null {
    const raw = Array.isArray(value) ? value[0] : value;
    if (typeof raw !== 'string') return null;
    const slug = raw.trim().toLowerCase();
    return WORKSPACE_SLUG_PATTERN.test(slug) ? slug : null;
}

export function normalizeWorkspaceKey(value: unknown): string | null {
    const raw = Array.isArray(value) ? value[0] : value;
    if (typeof raw !== 'string') return null;
    const key = raw.trim().toLowerCase().replace(/^\/+|\/+$/gu, '');
    return WORKSPACE_KEY_PATTERN.test(key) ? key : null;
}

function workspacePartsFromKey(value: unknown): { jurisdictionSlug: string | null, organisationSlug: string | null } {
    const key = normalizeWorkspaceKey(value);
    if (!key) return { jurisdictionSlug: null, organisationSlug: null };

    const [jurisdictionSlug, organisationSlug] = key.split('/');
    return {
        jurisdictionSlug: normalizeWorkspaceSlug(jurisdictionSlug),
        organisationSlug: normalizeWorkspaceSlug(organisationSlug)
    };
}

export function getWorkspaceSlugFromQuery(event: H3Event): string | null {
    return normalizeWorkspaceSlug(getQuery(event).jurisdiction);
}

function getOrganisationSlugFromQuery(event: H3Event): string | null {
    const query = getQuery(event);
    return normalizeWorkspaceSlug(query.organisation || query.organization || query.org);
}

function getWorkspacePartsFromCookie(event: H3Event): { jurisdictionSlug: string | null, organisationSlug: string | null } {
    return workspacePartsFromKey(getCookie(event, 'beantragt-admin-workspace'));
}

function getInternalId(item: GroupResource): number | null {
    const internalId = Number(item.attributes?.drupal_internal__id);
    return Number.isInteger(internalId) ? internalId : null;
}

function normalizeJurisdiction(
    item: GroupResource,
    includedById: Map<string, GroupResource> = new Map()
): AdminWorkspace | null {
    const slug = normalizeWorkspaceSlug(item.attributes?.field_slug);
    if (!slug) return null;

    const parentId = item.relationships?.field_parent_jurisdiction?.data?.id ?? null;
    const parent = parentId ? includedById.get(parentId) : undefined;
    const label = item.attributes?.label || slug;

    return {
        type: 'jurisdiction',
        id: item.id,
        internalId: getInternalId(item),
        label,
        slug,
        key: slug,
        path: `/${slug}`,
        jurisdictionId: item.id,
        jurisdictionInternalId: getInternalId(item),
        jurisdictionSlug: slug,
        jurisdictionLabel: label,
        organisationId: null,
        organisationInternalId: null,
        organisationSlug: null,
        organisationLabel: null,
        parentId,
        parentLabel: parent?.attributes?.label || null
    };
}

function normalizeOrganisation(
    item: GroupResource,
    includedById: Map<string, GroupResource> = new Map()
): AdminWorkspace | null {
    const slug = normalizeWorkspaceSlug(item.attributes?.field_slug);
    const jurisdictionId = item.relationships?.field_jurisdiction?.data?.id ?? null;
    const jurisdiction = jurisdictionId ? includedById.get(jurisdictionId) : undefined;
    const jurisdictionSlug = normalizeWorkspaceSlug(jurisdiction?.attributes?.field_slug);
    if (!slug || !jurisdictionId || !jurisdictionSlug) return null;

    const label = item.attributes?.label || slug;
    const jurisdictionLabel = jurisdiction?.attributes?.label || jurisdictionSlug;
    const key = `${jurisdictionSlug}/${slug}`;

    return {
        type: 'organisation',
        id: item.id,
        internalId: getInternalId(item),
        label,
        slug,
        key,
        path: `/${key}`,
        jurisdictionId,
        jurisdictionInternalId: jurisdiction ? getInternalId(jurisdiction) : null,
        jurisdictionSlug,
        jurisdictionLabel,
        organisationId: item.id,
        organisationInternalId: getInternalId(item),
        organisationSlug: slug,
        organisationLabel: label,
        parentId: jurisdictionId,
        parentLabel: jurisdictionLabel
    };
}

// Drupal JSON:API caps the page size at 50 and silently ignores larger
// `page[limit]` values, so the loop must not assume the server honors the
// requested limit. Pagination is driven by `links.next` (absent on the last
// page) and the offset advances by the actual returned `data.length`.
const GROUP_PAGE_SIZE = 50;
const GROUP_PAGE_CAP = 50;

/**
 * Merges a sequence of paged JSON:API group collection responses into one,
 * concatenating `data` and deduplicating `included` by resource id (the same
 * jurisdiction is `included` on every org page, so it would otherwise repeat).
 *
 * Pure helper, separated from the network loop for unit testing.
 */
export function mergeGroupCollectionPages(pages: GroupCollectionResponse[]): GroupCollectionResponse {
    const data: GroupResource[] = [];
    const includedById = new Map<string, GroupResource>();

    for (const page of pages) {
        for (const item of page.data || []) {
            data.push(item);
        }
        for (const item of page.included || []) {
            if (!includedById.has(item.id)) {
                includedById.set(item.id, item);
            }
        }
    }

    return { data, included: [...includedById.values()] };
}

/**
 * Decides whether another page should be fetched after the given response.
 *
 * Primary signal: JSON:API sets `links.next` on every page except the last, so
 * its presence is the page-size-cap-agnostic continuation flag. As a fallback
 * (some configs omit `links`), continue when a full {@link GROUP_PAGE_SIZE}
 * batch was returned. Pure helper for unit testing.
 */
export function hasMoreGroupPages(page: GroupCollectionResponse): boolean {
    // When the response carries a `links` object, it is authoritative: a `next`
    // href means more pages, its absence means this was the last page.
    if (page.links) {
        return Boolean(page.links.next?.href);
    }
    // No `links` at all (some configs strip them): fall back to assuming more
    // pages exist while a full batch was returned.
    return (page.data?.length ?? 0) >= GROUP_PAGE_SIZE;
}

/**
 * Fetches every page of a JSON:API group collection, following `links.next`
 * until it is absent. The offset advances by the number of items actually
 * returned (not the requested limit), so it stays correct under Drupal's
 * 50-item page cap. A {@link GROUP_PAGE_CAP} guards against infinite loops.
 *
 * Interim full-load: with hundreds of orgs across jurisdictions, a single
 * capped request truncated most jurisdictions' orgs. A Drupal-backed,
 * server-scoped + paginated catalog still needs to be provided — a single jurisdiction
 * with >50 orgs (a large city) will still need that server-side scoping.
 */
async function fetchAllGroupPages(
    path: string,
    query: URLSearchParams
): Promise<GroupCollectionResponse> {
    const pages: GroupCollectionResponse[] = [];
    let offset = 0;

    for (let pageIndex = 0; pageIndex < GROUP_PAGE_CAP; pageIndex++) {
        const pageQuery = new URLSearchParams(query);
        pageQuery.set('page[limit]', String(GROUP_PAGE_SIZE));
        pageQuery.set('page[offset]', String(offset));

        const page = await drupalServiceFetch<GroupCollectionResponse>(
            `${path}?${pageQuery.toString()}`
        );
        pages.push(page);

        const returned = page.data?.length ?? 0;
        // A page that returns nothing means we have walked past the end.
        if (returned === 0 || !hasMoreGroupPages(page)) {
            break;
        }

        offset += returned;
    }

    return mergeGroupCollectionPages(pages);
}

/**
 * Loads the full, paginated list of organisation workspaces across all
 * jurisdictions for the admin workspace switcher.
 */
export async function fetchAllAdminOrganisations(): Promise<AdminWorkspace[]> {
    const query = new URLSearchParams({
        'sort': 'label',
        'fields[group--org]': 'drupal_internal__id,label,field_slug,field_jurisdiction',
        'fields[group--jur]': 'drupal_internal__id,label,field_slug',
        'include': 'field_jurisdiction'
    });

    const response = await fetchAllGroupPages('/jsonapi/group/org', query);
    return normalizeAdminOrganisationList(response);
}

export async function fetchVisibleAdminWorkspaces(event: H3Event): Promise<AdminWorkspace[]> {
    const response = await drupalSessionFetch<AdminWorkspacesResponse>(event, '/api/admin/workspaces');
    return response.workspaces || [
        ...(response.jurisdictions || []),
        ...(response.organisations || [])
    ];
}

export function normalizeAdminJurisdictionList(response: GroupCollectionResponse): AdminWorkspace[] {
    const includedById = new Map((response.included || []).map(item => [item.id, item]));

    return (response.data || [])
        .map(item => normalizeJurisdiction(item, includedById))
        .filter((item): item is AdminWorkspace => Boolean(item))
        .sort((a, b) => a.label.localeCompare(b.label, 'de'));
}

export function normalizeAdminOrganisationList(response: GroupCollectionResponse): AdminWorkspace[] {
    const includedById = new Map((response.included || []).map(item => [item.id, item]));

    return (response.data || [])
        .map(item => normalizeOrganisation(item, includedById))
        .filter((item): item is AdminWorkspace => Boolean(item))
        .sort((a, b) =>
            a.jurisdictionLabel.localeCompare(b.jurisdictionLabel, 'de')
            || a.label.localeCompare(b.label, 'de')
        );
}

async function fetchAdminJurisdictions(slug?: string | null): Promise<AdminWorkspace[]> {
    const query = new URLSearchParams({
        'fields[group--jur]': 'drupal_internal__id,label,field_slug,field_parent_jurisdiction',
        'include': 'field_parent_jurisdiction',
        'page[limit]': slug ? '1' : '100',
        'sort': 'label'
    });

    if (slug) {
        query.set('filter[field_slug]', slug);
    }

    const response = await drupalServiceFetch<GroupCollectionResponse>(
        `/jsonapi/group/jur?${query.toString()}`
    );
    return normalizeAdminJurisdictionList(response);
}

async function fetchAdminOrganisations(slug?: string | null): Promise<AdminWorkspace[]> {
    const query = new URLSearchParams({
        'fields[group--org]': 'drupal_internal__id,label,field_slug,field_jurisdiction',
        'fields[group--jur]': 'drupal_internal__id,label,field_slug',
        'include': 'field_jurisdiction',
        'page[limit]': slug ? '50' : '100',
        'sort': 'label'
    });

    if (slug) {
        query.set('filter[field_slug]', slug);
    }

    const response = await drupalServiceFetch<GroupCollectionResponse>(
        `/jsonapi/group/org?${query.toString()}`
    );
    return normalizeAdminOrganisationList(response);
}

export async function resolveAdminWorkspace(event: H3Event): Promise<AdminWorkspace | null> {
    if ('adminWorkspace' in event.context) {
        return event.context.adminWorkspace as AdminWorkspace | null;
    }

    const queryJurisdictionSlug = getWorkspaceSlugFromQuery(event);
    const queryOrganisationSlug = getOrganisationSlugFromQuery(event);
    const hasExplicitQueryScope = Boolean(queryJurisdictionSlug || queryOrganisationSlug);
    const cookieParts = getWorkspacePartsFromCookie(event);
    const jurisdictionSlug = queryJurisdictionSlug ?? (hasExplicitQueryScope ? null : cookieParts.jurisdictionSlug);
    const organisationSlug = queryOrganisationSlug ?? (hasExplicitQueryScope ? null : cookieParts.organisationSlug);
    const workspaces = await fetchVisibleAdminWorkspaces(event);

    if (workspaces.length === 0) {
        throw createSafeError({
            statusCode: 403,
            message: 'workspace.access_denied',
            data: { code: 'workspace.access_denied' }
        });
    }

    const workspace = resolveVisibleWorkspace(workspaces, jurisdictionSlug, organisationSlug);

    if (!workspace && (jurisdictionSlug || organisationSlug)) {
        throw createSafeError({
            statusCode: 403,
            message: 'workspace.access_denied',
            data: { code: 'workspace.access_denied' }
        });
    }

    event.context.adminWorkspace = workspace;
    event.context.adminWorkspaceJurisdiction = workspace;
    return workspace;
}

export function resolveVisibleWorkspace(
    workspaces: readonly AdminWorkspace[],
    jurisdictionSlug: string | null,
    organisationSlug?: string | null
): AdminWorkspace | null {
    if (organisationSlug) {
        if (!jurisdictionSlug) return null;
        return workspaces.find(item =>
            item.type === 'organisation'
            && item.organisationSlug === organisationSlug
            && item.jurisdictionSlug === jurisdictionSlug
        ) ?? null;
    }

    if (jurisdictionSlug) {
        return workspaces.find(item =>
            item.type === 'jurisdiction'
            && item.jurisdictionSlug === jurisdictionSlug
        ) ?? null;
    }

    return workspaces[0] ?? null;
}

export async function resolveAdminWorkspaceBySlugs(
    jurisdictionSlug: string | null,
    organisationSlug?: string | null
): Promise<AdminWorkspace | null> {
    if (organisationSlug) {
        const organisations = await fetchAdminOrganisations(organisationSlug);
        const workspace = organisations.find(item =>
            !jurisdictionSlug || item.jurisdictionSlug === jurisdictionSlug
        ) ?? null;

        if (!workspace) {
            throw createSafeError({
                statusCode: 404,
                message: 'workspace.organisation_not_found',
                data: { code: 'workspace.organisation_not_found' }
            });
        }

        return workspace;
    }

    const jurisdictions = await fetchAdminJurisdictions(jurisdictionSlug);
    const workspace = jurisdictions[0] ?? null;
    if (!workspace) {
        if (!jurisdictionSlug) {
            return null;
        }

        throw createSafeError({
            statusCode: 404,
            message: 'workspace.jurisdiction_not_found',
            data: { code: 'workspace.jurisdiction_not_found' }
        });
    }

    return workspace;
}

export async function resolveAdminJurisdiction(event: H3Event): Promise<AdminWorkspace | null> {
    return resolveAdminWorkspace(event);
}

export async function resolveRequiredAdminWorkspace(event: H3Event): Promise<AdminWorkspace> {
    const workspace = await resolveAdminWorkspace(event);
    if (!workspace) {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.workspace.required',
            data: { code: 'errors.workspace.required' }
        });
    }
    return workspace;
}

/** Creates must target a selected workspace, even when the catalogue has a default. */
export async function resolveExplicitAdminWorkspace(event: H3Event): Promise<AdminWorkspace> {
    const query = getQuery(event);
    const organisation = query.organisation ?? query.organization ?? query.org;
    const hasQueryScope = query.jurisdiction !== undefined || organisation !== undefined;
    const selection = hasQueryScope
        ? { jurisdictionSlug: normalizeWorkspaceSlug(query.jurisdiction), organisationSlug: normalizeWorkspaceSlug(organisation) }
        : getWorkspacePartsFromCookie(event);
    if (!selection.jurisdictionSlug && !hasQueryScope) {
        throw createSafeError({ statusCode: 400, message: 'errors.workspace.required', data: { code: 'errors.workspace.required' } });
    }

    let workspace: AdminWorkspace | null = null;
    if (selection.jurisdictionSlug && (organisation === undefined || selection.organisationSlug)) {
        const workspaces = await fetchVisibleAdminWorkspaces(event).catch(async (error: unknown) => {
            const status = (error as { statusCode?: number } | null)?.statusCode;
            if (status === 401) {
                throw createSafeError({ statusCode: 401, message: 'errors.auth.notAuthenticated', data: { code: 'errors.auth.notAuthenticated' } });
            }
            if (status === 403) {
                // The request may have lost its session after the route's initial check.
                await getAuthenticatedUser(event, getHeader(event, 'cookie') || '');
            }
            throw error;
        });
        workspace = resolveVisibleWorkspace(workspaces, selection.jurisdictionSlug, selection.organisationSlug);
    }
    if (!workspace) {
        throw createSafeError({ statusCode: 404, message: 'errors.workspace.notFound', data: { code: 'errors.workspace.notFound' } });
    }
    return workspace;
}

function setReferenceFilter(
    searchParams: URLSearchParams,
    fieldName: string,
    uuid: string,
    internalId: number | null
): void {
    if (internalId) {
        searchParams.set(`filter[${fieldName}.meta.drupal_internal__target_id]`, String(internalId));
        return;
    }

    searchParams.set(`filter[${fieldName}.id]`, uuid);
}

export async function applyAdminJurisdictionFilter(
    event: H3Event,
    searchParams: URLSearchParams,
    fieldName = 'field_jurisdiction',
    options: { required?: boolean } = {}
): Promise<void> {
    const workspace = await resolveAdminWorkspace(event);
    if (!workspace) {
        throw createSafeError({
            statusCode: options.required ? 400 : 403,
            message: options.required ? 'errors.workspace.required' : 'workspace.access_denied',
            data: { code: options.required ? 'errors.workspace.required' : 'workspace.access_denied' }
        });
    }

    if (workspace.type === 'organisation' && fieldName === 'field_jurisdiction') {
        setReferenceFilter(searchParams, 'field_jurisdiction', workspace.jurisdictionId, workspace.jurisdictionInternalId);
        setReferenceFilter(searchParams, 'field_organisation', workspace.id, workspace.internalId);
        return;
    }

    setReferenceFilter(searchParams, fieldName, workspace.jurisdictionId, workspace.jurisdictionInternalId);
}

export async function getAdminWorkspaceScopeRelationships(event: H3Event): Promise<Record<string, unknown>> {
    const workspace = await resolveAdminWorkspace(event);
    return buildAdminWorkspaceScopeRelationships(workspace);
}

export async function getAdminWorkspaceScopeRelationshipsBySlugs(
    jurisdictionSlug: string | null,
    organisationSlug?: string | null
): Promise<Record<string, unknown>> {
    const workspace = await resolveAdminWorkspaceBySlugs(jurisdictionSlug, organisationSlug);
    return buildAdminWorkspaceScopeRelationships(workspace);
}

export function buildAdminWorkspaceScopeRelationships(workspace: AdminWorkspace | null): Record<string, unknown> {
    if (!workspace) return {};

    const relationships: Record<string, unknown> = {
        field_jurisdiction: {
            data: {
                type: 'group--jur',
                id: workspace.jurisdictionId
            }
        },
        field_group: {
            data: {
                type: workspace.type === 'organisation' ? 'group--org' : 'group--jur',
                id: workspace.type === 'organisation' ? workspace.id : workspace.jurisdictionId
            }
        }
    };

    if (workspace.type === 'organisation') {
        relationships.field_organisation = {
            data: {
                type: 'group--org',
                id: workspace.id
            }
        };
    }

    return relationships;
}
