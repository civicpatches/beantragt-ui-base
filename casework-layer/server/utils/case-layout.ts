import type { H3Event } from 'h3';
import { isCaseLayout } from '../../app/utils/case-layout';

/** Internal staff preference surface. Drupal remains the workspace access authority. */
export async function caseLayoutRequest(event: H3Event, workspaceDefault = false) {
    await requireStaff(event);
    setPrivateNoStore(event);
    if (event.method !== 'GET') requireSameOriginRequest(event);
    const scope = await resolveRequiredAdminWorkspace(event);
    if (!scope.internalId) throw createSafeError({ statusCode: 400, message: 'errors.validation.invalidField' });
    const path = `/api/staff/case-layout/${scope.internalId}${workspaceDefault ? '/workspace' : ''}`;
    if (event.method === 'GET') return drupalSessionFetch(event, path);
    const body = await readBody<unknown>(event);
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || !('layout' in body)
      || (body.layout !== null && !isCaseLayout(body.layout))) {
        throw createSafeError({ statusCode: 400, message: 'errors.validation.invalidField' });
    }
    return drupalSessionFetch(event, path, { method: 'PATCH', body: { layout: body.layout } });
}
