export interface RawOrgSeed {
    jurisdiction?: {
        code?: string
        label?: string
        slug?: string
    }
    source?: {
        label?: string
        url?: string
        stand?: string
        extracted_at?: string
    }
    orgs?: RawOrgNode[]
}

export interface RawOrgNode {
    code?: string
    label?: string
    type?: string
    level?: number
    parent_code?: string | null
    slug?: string
}

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

export interface PublicOrgCatalog {
    jurisdiction: {
        code: string
        label: string
        slug: string
    }
    source: {
        label: string
        url: string
        stand: string
        extractedAt: string
    }
    data: PublicOrgNode[]
}

/**
 * Catalogues shipped with the bundle, keyed on the jurisdiction slug. Empty on purpose: the bundle
 * carries no municipality's organisational plan. Every slug answers with an empty list, and every
 * consumer falls back to the flat organisation list of the workspace. A catalogue for all
 * jurisdictions comes from the backend.
 */
const PUBLIC_ORG_SEEDS: Record<string, RawOrgSeed> = {};

const catalogCache = new Map<string, Promise<PublicOrgCatalog>>();

function normalizeSlug(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const slug = value.trim().toLowerCase();
    return /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/.test(slug) ? slug : null;
}

function buildPath(node: PublicOrgNode, byCode: Map<string, PublicOrgNode>): PublicOrgNode {
    const pathCodes: string[] = [];
    const pathLabels: string[] = [];
    const pathSlugs: string[] = [];
    const seen = new Set<string>();
    let current: PublicOrgNode | undefined = node;

    while (current && !seen.has(current.code)) {
        seen.add(current.code);
        pathCodes.unshift(current.code);
        pathLabels.unshift(current.label);
        pathSlugs.unshift(current.slug);
        current = current.parentCode ? byCode.get(current.parentCode) : undefined;
    }

    return {
        ...node,
        pathCodes,
        pathLabels,
        pathSlugs
    };
}

export function normalizePublicOrgCatalog(seed: RawOrgSeed): PublicOrgCatalog {
    const nodes = (seed.orgs || [])
        .map((item): PublicOrgNode | null => {
            const slug = normalizeSlug(item.slug);
            if (!item.code || !item.label || !item.type || typeof item.level !== 'number' || !slug) {
                return null;
            }

            return {
                code: item.code,
                label: item.label,
                type: item.type,
                level: item.level,
                parentCode: item.parent_code || null,
                slug,
                pathCodes: [],
                pathLabels: [],
                pathSlugs: [],
                childCount: 0
            };
        })
        .filter((item): item is PublicOrgNode => Boolean(item));

    const byCode = new Map(nodes.map(node => [node.code, node]));
    const childCounts = new Map<string, number>();

    for (const node of nodes) {
        if (!node.parentCode) continue;
        childCounts.set(node.parentCode, (childCounts.get(node.parentCode) || 0) + 1);
    }

    const data = nodes
        .map(node => ({
            ...node,
            childCount: childCounts.get(node.code) || 0
        }))
        .map(node => buildPath(node, byCode));

    return {
        jurisdiction: {
            code: seed.jurisdiction?.code || '',
            label: seed.jurisdiction?.label || '',
            slug: seed.jurisdiction?.slug || ''
        },
        source: {
            label: seed.source?.label || '',
            url: seed.source?.url || '',
            stand: seed.source?.stand || '',
            extractedAt: seed.source?.extracted_at || ''
        },
        data
    };
}

async function loadPublicOrgCatalog(jurisdictionSlug: string): Promise<PublicOrgCatalog> {
    const seed = Object.hasOwn(PUBLIC_ORG_SEEDS, jurisdictionSlug) ? PUBLIC_ORG_SEEDS[jurisdictionSlug] : undefined;
    if (!seed) {
        return {
            jurisdiction: { code: jurisdictionSlug, label: jurisdictionSlug, slug: jurisdictionSlug },
            source: { label: '', url: '', stand: '', extractedAt: '' },
            data: []
        };
    }

    return normalizePublicOrgCatalog(seed);
}

export async function getPublicOrgCatalog(jurisdiction: unknown): Promise<PublicOrgCatalog> {
    const jurisdictionSlug = normalizeSlug(jurisdiction);
    if (!jurisdictionSlug) {
        return {
            jurisdiction: { code: '', label: '', slug: '' },
            source: { label: '', url: '', stand: '', extractedAt: '' },
            data: []
        };
    }

    if (!catalogCache.has(jurisdictionSlug)) {
        catalogCache.set(jurisdictionSlug, loadPublicOrgCatalog(jurisdictionSlug));
    }

    return catalogCache.get(jurisdictionSlug)!;
}
