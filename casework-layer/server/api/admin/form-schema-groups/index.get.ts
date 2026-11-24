/**
 * GET /api/admin/form-schema-groups
 *
 * Proxies form_schema_group list from Drupal JSON:API.
 * Requires admin authentication.
 */
export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    setPrivateNoStore(event);

    const query = getQuery(event);
    const searchParams = new URLSearchParams();
    searchParams.set('sort', String(query.sort || '-created'));
    searchParams.set(
        'fields[form_schema_group--form_schema_group]',
        String(query.fields || 'label,field_description,field_workflow_status,status,created,changed,field_schemas')
    );
    searchParams.set(
        'fields[form_schema--form_schema]',
        'label,field_workflow_status,created,changed'
    );
    searchParams.set('include', 'field_schemas');

    if (query.filter) {
        searchParams.set('filter[field_workflow_status]', String(query.filter));
    }
    await applyAdminJurisdictionFilter(event, searchParams);

    try {
        const data: unknown[] = [];
        const included = new Map<string, unknown>();
        let offset = 0;
        let lastResponse: Record<string, unknown> = {};

        while (true) {
            searchParams.set('page[limit]', '100');
            searchParams.set('page[offset]', String(offset));

            const response = await drupalSessionFetch<{
                data?: unknown[]
                included?: Array<{ id?: string, type?: string }>
                [key: string]: unknown
            }>(
                event,
                `/jsonapi/form_schema_group/form_schema_group?${searchParams.toString()}`
            );

            const items = response.data || [];
            data.push(...items);
            for (const item of response.included || []) {
                if (item.id && item.type) {
                    included.set(`${item.type}:${item.id}`, item);
                }
            }
            lastResponse = response;

            if (items.length < 100) break;
            offset += 100;
        }

        return {
            ...lastResponse,
            data,
            included: Array.from(included.values())
        };
    } catch (e: unknown) {
        const status = (e as { statusCode?: number })?.statusCode || 500;
        throw createSafeError({
            statusCode: status,
            message: 'errors.admin.formGroupsLoadFailed',
            data: { code: 'errors.admin.formGroupsLoadFailed' }
        });
    }
});
