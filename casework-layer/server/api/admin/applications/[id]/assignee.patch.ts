/**
 * PATCH /api/admin/applications/:id/assignee
 *
 * Updates the person or team assignment through the scoped Drupal endpoint.
 */
import { sameChangedTimestamp } from '~~/casework-layer/server/utils/application-concurrency';

import { setPrivateNoStore } from '~~/server/utils/request-security';

export default defineEventHandler(async (event) => {
    await requireStaff(event);
    requireSameOriginRequest(event);
    setPrivateNoStore(event);

    const id = getRouterParam(event, 'id');
    if (!id) {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.applications.idMissing',
            data: { code: 'errors.applications.idMissing' }
        });
    }
    validateUuid(id, 'applicationId');

    const body = await readBody<{
        note?: unknown
        assignmentType?: 'user' | 'team' | 'none'
        assigneeId?: string | null
        teamId?: string | null
        expectedChanged?: string
        expectedRevisionId?: number | string | null
    }>(event);
    const note = typeof body.note === 'string' ? body.note.trim() : '';
    if (body.note !== undefined && (typeof body.note !== 'string' || note.length > 2000)) {
        throw createSafeError({ statusCode: 400, message: 'errors.admin.assignmentUpdateFailed', data: { code: 'errors.admin.assignmentUpdateFailed' } });
    }
    const assignmentType = body.assignmentType ?? (body.teamId ? 'team' : body.assigneeId ? 'user' : 'none');
    if (!['user', 'team', 'none'].includes(assignmentType)) {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.admin.assignmentUpdateFailed',
            data: { code: 'errors.admin.assignmentUpdateFailed' }
        });
    }
    const assigneeId = assignmentType === 'user' && typeof body.assigneeId === 'string' ? body.assigneeId.trim() : null;
    const teamId = assignmentType === 'team' && typeof body.teamId === 'string' ? body.teamId.trim() : null;
    if (assignmentType === 'user') {
        if (!assigneeId) {
            throw createSafeError({
                statusCode: 400,
                message: 'errors.admin.assignmentUpdateFailed',
                data: { code: 'errors.admin.assignmentUpdateFailed' }
            });
        }
        validateUuid(assigneeId, 'assigneeId');
    }
    if (assignmentType === 'team') {
        if (!teamId) {
            throw createSafeError({
                statusCode: 400,
                message: 'errors.admin.assignmentUpdateFailed',
                data: { code: 'errors.admin.assignmentUpdateFailed' }
            });
        }
        validateUuid(teamId, 'teamId');
    }
    if (typeof body.expectedChanged !== 'string' || body.expectedChanged === '') {
        throw createSafeError({
            statusCode: 428,
            message: 'errors.admin.assignmentConflict',
            data: { code: 'errors.admin.assignmentConflict' }
        });
    }

    if (body.expectedRevisionId === undefined || body.expectedRevisionId === null || body.expectedRevisionId === '') {
        throw createSafeError({
            statusCode: 428,
            message: 'errors.admin.assignmentConflict',
            data: { code: 'errors.admin.assignmentConflict' }
        });
    }

    const expectedRevisionId = Number(body.expectedRevisionId);
    if (!Number.isInteger(expectedRevisionId) || expectedRevisionId <= 0) {
        throw createSafeError({
            statusCode: 428,
            message: 'errors.admin.assignmentConflict',
            data: { code: 'errors.admin.assignmentConflict' }
        });
    }

    const apiQuery = new URLSearchParams({
        'filter[id]': id,
        'fields[application--application]': 'drupal_internal__id,drupal_internal__revision_id,changed',
        'page[limit]': '1'
    });
    await applyAdminJurisdictionFilter(event, apiQuery, 'field_jurisdiction', { required: true });

    try {
        const scopedResponse = await drupalSessionFetch<{
            data?: Array<{ attributes?: { drupal_internal__id?: number | string, drupal_internal__revision_id?: number | string, changed?: string } }>
        }>(event, `/jsonapi/application/application?${apiQuery.toString()}`);
        const current = scopedResponse.data?.[0];
        const internalId = Number(current?.attributes?.drupal_internal__id);
        const revisionId = Number(current?.attributes?.drupal_internal__revision_id);
        if (!Number.isInteger(internalId) || internalId <= 0) {
            throw createSafeError({
                statusCode: 404,
                message: 'errors.applications.notFound',
                data: { code: 'errors.applications.notFound' }
            });
        }
        if (!sameChangedTimestamp(current?.attributes?.changed, body.expectedChanged)) {
            throw createSafeError({
                statusCode: 409,
                message: 'errors.admin.assignmentConflict',
                data: { code: 'errors.admin.assignmentConflict' }
            });
        }
        if (revisionId !== expectedRevisionId) {
            throw createSafeError({
                statusCode: 409,
                message: 'errors.admin.assignmentConflict',
                data: { code: 'errors.admin.assignmentConflict' }
            });
        }

        return await drupalSessionFetch(event, `/api/admin/applications/${internalId}/assignee`, {
            method: 'PATCH',
            body: {
                assignee_uuid: assignmentType === 'user' ? assigneeId : null,
                team_uuid: assignmentType === 'team' ? teamId : null,
                ...(note ? { note } : {}),
                expected_changed: body.expectedChanged,
                expected_revision_id: expectedRevisionId
            }
        });
    } catch (e: unknown) {
        const upstream = (e as { statusCode?: number })?.statusCode;
        const code = (e as { data?: { code?: unknown } })?.data?.code;
        const safeCode = typeof code === 'string' && code.startsWith('errors.') && code !== 'errors.server.drupalRequestFailed'
            ? code
            : null;
        // 423: a running transfer holds the case; nothing was stored.
        const message = upstream === 423 ? 'errors.applications.dataBusy' : upstream === 409 ? 'errors.admin.assignmentConflict' : safeCode ?? 'errors.admin.assignmentUpdateFailed';
        throw createSafeError({
            statusCode: upstream === 400 || upstream === 403 || upstream === 404 || upstream === 409 || upstream === 422 || upstream === 423 || upstream === 428 ? upstream : 500,
            message,
            data: { code: message }
        });
    }
});
