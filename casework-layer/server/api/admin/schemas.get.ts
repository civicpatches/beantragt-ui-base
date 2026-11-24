/**
 * GET /api/admin/schemas
 *
 * Proxies form_schema list from Drupal JSON:API.
 * Requires admin authentication.
 */
const SCHEMA_PAGE_SIZE = 50;
const SCHEMA_PAGE_CAP = 200;

export default defineEventHandler(async (event) => {
    setPrivateNoStore(event);
    await requireAdmin(event);

    const query = getQuery(event);
    const searchParams = new URLSearchParams();
    searchParams.set('sort', String(query.sort || '-created'));
    searchParams.set(
        'fields[form_schema--form_schema]',
        String(query.fields || 'label,field_workflow_status,field_publication_scope,field_schema,created,changed')
    );

    if (query.schemaId !== undefined) {
        searchParams.set('filter[id]', validateUuid(query.schemaId, 'schemaId'));
    }
    if (query.filter) {
        searchParams.set('filter[field_workflow_status]', String(query.filter));
    }
    if (query.publicationScope) {
        searchParams.set('filter[field_publication_scope]', String(query.publicationScope));
    }
    await applyAdminJurisdictionFilter(event, searchParams);

    try {
        if (query.all === 'true') {
            const data: unknown[] = [];
            let offset = 0;
            let lastResponse: Record<string, unknown> = {};

            for (let pageIndex = 0; pageIndex < SCHEMA_PAGE_CAP; pageIndex++) {
                searchParams.set('page[limit]', String(SCHEMA_PAGE_SIZE));
                searchParams.set('page[offset]', String(offset));

                const response = await drupalSessionFetch<{
                    data?: unknown[]
                    links?: { next?: { href?: string } }
                    [key: string]: unknown
                }>(
                    event,
                    `/jsonapi/form_schema/form_schema?${searchParams.toString()}`
                );

                const items = response.data || [];
                data.push(...items);
                lastResponse = response;

                if (items.length === 0) break;
                if (response.links && !response.links.next?.href) break;
                if (!response.links && items.length < SCHEMA_PAGE_SIZE) break;
                offset += items.length;
            }

            return {
                ...lastResponse,
                data
            };
        }

        const response = await drupalSessionFetch<Record<string, unknown>>(
            event,
            `/jsonapi/form_schema/form_schema?${searchParams.toString()}`
        );

        return response;
    } catch (e: unknown) {
        const status = (e as { statusCode?: number })?.statusCode || 500;
        throw createSafeError({
            statusCode: status,
            message: 'errors.admin.schemasLoadFailed',
            data: { code: 'errors.admin.schemasLoadFailed' }
        });
    }
});
