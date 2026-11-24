import type {
    PublicOrgCatalogResponse,
    PublicOrgNode
} from '~/types/org-catalog';

const orgCatalogCache = new Map<string, PublicOrgNode[]>();
const orgCatalogRequests = new Map<string, Promise<PublicOrgNode[]>>();

function fetchOrgCatalog(slug: string): Promise<PublicOrgNode[]> {
    const activeRequest = orgCatalogRequests.get(slug);
    if (activeRequest) return activeRequest;

    const request = $fetch<PublicOrgCatalogResponse>(`/api/orgs/${slug}`)
        .then((response) => {
            const orgs = response.data || [];
            orgCatalogCache.set(slug, orgs);
            return orgs;
        })
        .finally(() => {
            if (orgCatalogRequests.get(slug) === request) {
                orgCatalogRequests.delete(slug);
            }
        });

    orgCatalogRequests.set(slug, request);
    return request;
}

export function useOrgCatalog(logContext = 'org-catalog') {
    const catalogOrgs = ref<PublicOrgNode[]>([]);
    const catalogLoadedJurisdiction = ref<string | null>(null);
    const isCatalogLoading = ref(false);
    let requestToken = 0;

    async function loadCatalog(jurisdictionSlug?: string | null) {
        const slug = typeof jurisdictionSlug === 'string' ? jurisdictionSlug.trim() : '';
        const token = ++requestToken;
        if (!slug) {
            catalogOrgs.value = [];
            catalogLoadedJurisdiction.value = null;
            isCatalogLoading.value = false;
            return;
        }
        if (catalogLoadedJurisdiction.value === slug) {
            isCatalogLoading.value = false;
            return;
        }

        if (orgCatalogCache.has(slug)) {
            catalogOrgs.value = orgCatalogCache.get(slug) ?? [];
            catalogLoadedJurisdiction.value = slug;
            isCatalogLoading.value = false;
            return;
        }

        isCatalogLoading.value = true;
        try {
            const orgs = await fetchOrgCatalog(slug);
            if (requestToken !== token) return;
            catalogOrgs.value = orgs;
            catalogLoadedJurisdiction.value = slug;
        } catch (error) {
            console.error(`[${logContext}] Failed to load org catalog:`, error);
            if (requestToken === token) {
                catalogOrgs.value = [];
                catalogLoadedJurisdiction.value = null;
            }
        } finally {
            if (requestToken === token) {
                isCatalogLoading.value = false;
            }
        }
    }

    return {
        catalogOrgs,
        catalogLoadedJurisdiction,
        isCatalogLoading,
        loadCatalog
    };
}
