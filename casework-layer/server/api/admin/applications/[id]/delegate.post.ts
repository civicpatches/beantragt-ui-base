/**
 * POST /api/admin/applications/:id/delegate
 *
 * Delegates application responsibility through the scoped Drupal endpoint.
 */
import { sameChangedTimestamp } from '~~/casework-layer/server/utils/application-concurrency';

import { setPrivateNoStore } from '~~/server/utils/request-security';

const DELEGATION_ERROR_MESSAGE_CODES = {
    'Delegation note is required.': 'errors.admin.delegationNoteRequired'
};

function safeDelegationErrorCode(code: unknown): string | null {
    if (code === 'delegation_note_required') return 'errors.admin.delegationNoteRequired';
    if (typeof code === 'string' && code.startsWith('errors.') && code !== 'errors.server.drupalRequestFailed') {
        return code;
    }
    return null;
}

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

    const body = await readBody<unknown>(event);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.admin.delegationInvalidRequest',
            data: { code: 'errors.admin.delegationInvalidRequest' }
        });
    }
    const delegationBody = body as {
        targetOrgUuid?: string
        note?: string
        expectedChanged?: string
        expectedRevisionId?: number | string | null
    };
    const targetOrgUuid = typeof delegationBody.targetOrgUuid === 'string' ? delegationBody.targetOrgUuid.trim() : '';
    if (!targetOrgUuid) {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.admin.delegationInvalidRequest',
            data: { code: 'errors.admin.delegationInvalidRequest' }
        });
    }
    validateUuid(targetOrgUuid, 'targetOrgUuid');

    let note: string | null = null;
    if (delegationBody.note !== undefined) {
        if (typeof delegationBody.note !== 'string') {
            throw createSafeError({
                statusCode: 400,
                message: 'errors.admin.delegationInvalidRequest',
                data: { code: 'errors.admin.delegationInvalidRequest' }
            });
        }
        note = delegationBody.note.trim();
        if (note.length > 2000) {
            throw createSafeError({
                statusCode: 400,
                message: 'errors.admin.delegationInvalidRequest',
                data: { code: 'errors.admin.delegationInvalidRequest' }
            });
        }
        if (!note) {
            note = null;
        }
    }

    if (typeof delegationBody.expectedChanged !== 'string' || delegationBody.expectedChanged === '') {
        throw createSafeError({
            statusCode: 428,
            message: 'errors.admin.delegationConflict',
            data: { code: 'errors.admin.delegationConflict' }
        });
    }

    const expectedRevisionId = delegationBody.expectedRevisionId === undefined || delegationBody.expectedRevisionId === null || delegationBody.expectedRevisionId === ''
        ? null
        : Number(delegationBody.expectedRevisionId);
    if (expectedRevisionId !== null && (!Number.isInteger(expectedRevisionId) || expectedRevisionId <= 0)) {
        throw createSafeError({
            statusCode: 428,
            message: 'errors.admin.delegationConflict',
            data: { code: 'errors.admin.delegationConflict' }
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
        if (!sameChangedTimestamp(current?.attributes?.changed, delegationBody.expectedChanged)) {
            throw createSafeError({
                statusCode: 409,
                message: 'errors.admin.delegationConflict',
                data: { code: 'errors.admin.delegationConflict' }
            });
        }
        if (expectedRevisionId !== null && revisionId !== expectedRevisionId) {
            throw createSafeError({
                statusCode: 409,
                message: 'errors.admin.delegationConflict',
                data: { code: 'errors.admin.delegationConflict' }
            });
        }

        return await drupalSessionFetch(event, `/api/admin/applications/${internalId}/delegate`, {
            method: 'POST',
            errorMessageCodes: DELEGATION_ERROR_MESSAGE_CODES,
            body: {
                target_org_uuid: targetOrgUuid,
                ...(note !== null ? { note } : {}),
                expected_changed: delegationBody.expectedChanged,
                ...(expectedRevisionId !== null ? { expected_revision_id: expectedRevisionId } : {})
            }
        });
    } catch (e: unknown) {
        const upstream = (e as { statusCode?: number })?.statusCode;
        const data = (e as { data?: { code?: unknown, upstreamCode?: unknown } })?.data;
        const safeCode = [data?.code, data?.upstreamCode]
            .map(safeDelegationErrorCode)
            .find((code): code is string => Boolean(code));
        // 423: a running transfer holds the case; nothing was stored.
        const message = upstream === 423 ? 'errors.applications.dataBusy' : upstream === 409 || upstream === 428 ? 'errors.admin.delegationConflict' : safeCode ?? 'errors.admin.delegationFailed';
        throw createSafeError({
            statusCode: upstream === 400 || upstream === 403 || upstream === 404 || upstream === 409 || upstream === 422 || upstream === 423 || upstream === 428 ? upstream : 500,
            message,
            data: { code: message }
        });
    }
});
