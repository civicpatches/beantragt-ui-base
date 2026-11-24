/**
 * PATCH /api/admin/applications/:id/deadline
 *
 * Sets or clears the internal back-office due date of an application.
 * Requires staff authentication, same-origin, workspace scope and CSRF.
 */
import { sameChangedTimestamp } from '../../../../utils/application-concurrency';

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
        dueDate?: string | null
        expectedChanged?: string
    }>(event);

    if (body.dueDate !== null && body.dueDate !== undefined) {
        if (typeof body.dueDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(body.dueDate)) {
            throw createSafeError({
                statusCode: 400,
                message: 'errors.validation.invalidField',
                data: { code: 'errors.validation.invalidField', field: 'dueDate' }
            });
        }
        const timestamp = Date.parse(`${body.dueDate}T00:00:00Z`);
        if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== body.dueDate) {
            throw createSafeError({
                statusCode: 400,
                message: 'errors.validation.invalidField',
                data: { code: 'errors.validation.invalidField', field: 'dueDate' }
            });
        }
    }

    if (typeof body.expectedChanged !== 'string' || body.expectedChanged === '') {
        throw createSafeError({
            statusCode: 428,
            message: 'errors.admin.deadlineConflict',
            data: { code: 'errors.admin.deadlineConflict' }
        });
    }

    try {
        const scopeQuery = new URLSearchParams({
            'filter[id]': id,
            'fields[application--application]': 'drupal_internal__id,changed,field_due_date',
            'page[limit]': '1'
        });
        await applyAdminJurisdictionFilter(event, scopeQuery, 'field_jurisdiction', { required: true });
        const scopedResponse = await drupalSessionFetch<{ data?: unknown[] }>(
            event,
            `/jsonapi/application/application?${scopeQuery.toString()}`
        );
        if (!Array.isArray(scopedResponse.data) || scopedResponse.data.length === 0) {
            throw createSafeError({
                statusCode: 404,
                message: 'errors.applications.notFound',
                data: { code: 'errors.applications.notFound' }
            });
        }

        const current = scopedResponse.data[0] as {
            attributes?: {
                drupal_internal__id?: number | string
                changed?: string
            }
        };
        const applicationInternalId = Number(current.attributes?.drupal_internal__id);
        if (!Number.isInteger(applicationInternalId) || applicationInternalId <= 0) {
            throw createSafeError({
                statusCode: 502,
                message: 'errors.server.drupalRequestFailed',
                data: { code: 'errors.server.drupalRequestFailed' }
            });
        }
        if (!sameChangedTimestamp(current.attributes?.changed, body.expectedChanged)) {
            throw createSafeError({
                statusCode: 409,
                message: 'errors.admin.deadlineConflict',
                data: { code: 'errors.admin.deadlineConflict' }
            });
        }

        return await drupalSessionFetch(
            event,
            `/api/admin/applications/${applicationInternalId}/deadline`,
            {
                method: 'PATCH',
                body: {
                    due_date: body.dueDate ?? null,
                    expected_changed: body.expectedChanged
                }
            }
        );
    } catch (e: unknown) {
        const upstream = (e as { statusCode?: number })?.statusCode;
        const code = (e as { data?: { code?: unknown } })?.data?.code;
        const safeCode = typeof code === 'string' && code.startsWith('errors.') && code !== 'errors.server.drupalRequestFailed'
            ? code
            : null;
        console.error(`[admin] Failed to update application ${id} deadline:`, e instanceof Error ? e.message : e);
        // 423: a running transfer holds the case; nothing was stored.
        const message = upstream === 403 ? 'errors.admin.accessDenied' : upstream === 423 ? 'errors.applications.dataBusy' : safeCode || 'errors.admin.deadlineUpdateFailed';
        throw createSafeError({
            statusCode: upstream && upstream >= 400 && upstream < 500 ? upstream : 502,
            message,
            data: { code: message }
        });
    }
});
