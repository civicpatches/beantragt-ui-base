import { normalizeApplicationEventSnapshot } from '~/utils/application-events';

/** Internal Nuxt proxy: one section seen; Drupal validates the owner-module access and CSRF token. */
export default defineEventHandler(async (event) => {
    await requireStaff(event);
    requireSameOriginRequest(event);
    setPrivateNoStore(event);
    const id = getRouterParam(event, 'id');
    const kind = getRouterParam(event, 'kind');
    if (!id) throw createSafeError({ statusCode: 400, message: 'errors.applications.idMissing' });
    validateUuid(id, 'applicationId');
    if (!kind || !['message', 'documents', 'reply', 'assigned', 'scan'].includes(kind)) {
        throw createSafeError({ statusCode: 400, message: 'errors.validation.invalidField' });
    }
    const body = await readBody<{ tokens?: unknown }>(event);
    if (!Array.isArray(body?.tokens) || body.tokens.length > 10000 || body.tokens.some(token => typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token))) {
        throw createSafeError({ statusCode: 400, message: 'errors.validation.invalidField' });
    }
    const scope = await resolveRequiredAdminWorkspace(event);
    const params = new URLSearchParams({ jurisdiction: scope.jurisdictionSlug });
    if (scope.organisationSlug) params.set('organisation', scope.organisationSlug);
    const response = await drupalSessionFetch<{ data?: { id?: string, kind?: string }, meta?: { events?: unknown } }>(event, `/api/v1/staff/applications/${id}/events/${kind}/seen?${params}`, { method: 'POST', body: { tokens: body.tokens } });
    if (response.data?.id !== id || response.data?.kind !== kind) {
        throw createSafeError({ statusCode: 502, message: 'errors.server.drupalRequestFailed' });
    }
    return { data: { id, kind }, meta: { events: normalizeApplicationEventSnapshot(response.meta?.events) } };
});
