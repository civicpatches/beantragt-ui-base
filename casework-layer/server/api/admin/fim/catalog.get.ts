/**
 * GET /api/admin/fim/catalog
 *
 * Searches the official FITKO/FIM JSON Schema catalog.
 * Requires admin authentication.
 */
export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    setPrivateNoStore(event);
    // Each search may read the workspace's forms (import marks): bounded per person.
    checkRateLimit(getClientIp(event), 'admin', event);

    const query = getQuery(event);

    try {
        return await searchFimCatalog(query.q, query.limit, event);
    } catch (e: unknown) {
        if (e && typeof e === 'object' && 'statusCode' in e) {
            throw e;
        }

        console.error('[admin/fim] Catalog search failed:', e instanceof Error ? e.message : e);
        throw createSafeError({
            statusCode: 500,
            message: 'errors.fim.catalogSearchFailed',
            data: { code: 'errors.fim.catalogSearchFailed' }
        });
    }
});
