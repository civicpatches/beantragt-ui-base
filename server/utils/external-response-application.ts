import type { H3Event } from 'h3';

/** Resolve the public UUID under the browser user's Drupal permissions. */
export async function resolveExternalResponseApplicationId(event: H3Event, uuid: string | undefined): Promise<number> {
    validateUuid(uuid, 'applicationId');
    const query = new URLSearchParams({
        'fields[application--application]': 'drupal_internal__id'
    });
    let application;
    try {
        application = await drupalSessionFetch<{
            data?: { attributes?: { drupal_internal__id?: number | string } }
        }>(event, `/jsonapi/application/application/${uuid}?${query.toString()}`);
    } catch (error: unknown) {
        const status = error && typeof error === 'object' && 'statusCode' in error ? Number(error.statusCode) : 0;
        if (status !== 403 && status !== 404) throw error;
        throw createSafeError({ statusCode: 404, message: 'errors.applications.notFound' });
    }
    const id = Number(application.data?.attributes?.drupal_internal__id);
    if (!Number.isSafeInteger(id) || id <= 0) {
        throw createSafeError({
            statusCode: 404,
            message: 'errors.applications.notFound',
            data: { code: 'errors.applications.notFound' }
        });
    }
    return id;
}
