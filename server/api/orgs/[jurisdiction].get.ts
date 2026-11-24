import { getPublicOrgCatalog } from '../../utils/public-org-catalog';

export default defineEventHandler(async (event) => {
    const jurisdiction = getRouterParam(event, 'jurisdiction');

    try {
        return await getPublicOrgCatalog(jurisdiction);
    } catch (error) {
        console.error('[orgs] Failed to load public org catalog:', error instanceof Error ? error.message : error);
        return {
            jurisdiction: { code: jurisdiction || '', label: jurisdiction || '', slug: jurisdiction || '' },
            source: { label: '', url: '', stand: '', extractedAt: '' },
            data: []
        };
    }
});
