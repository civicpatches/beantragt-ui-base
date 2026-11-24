import type { H3Event } from 'h3';
import {
    assertWorkflowStatusWorkspaceWriteAccess,
    buildWorkflowStatusListResponse,
    fetchWorkflowStatusById,
    resolveRequiredWorkflowStatusWorkspace
} from '~~/casework-layer/server/utils/workflow-status-admin';
import {
    DELETE_BLOCKER_ERROR_CODES,
    parseDeleteRefusal,
    type WorkflowStatusDeleteBlocker
} from '~~/casework-layer/server/utils/workflow-status-delete-blockers';
import {
    buildDrupalRequestHeaders,
    drupalSessionRequest,
    fetchCsrfToken,
    getDrupalSessionApiBase,
    requireAuth
} from '~~/server/utils/auth';
import { setPrivateNoStore, requireSameOriginRequest } from '~~/server/utils/request-security';
import { validateUuid } from '~~/server/utils/validation';

function refusedForBlockers(blockers: WorkflowStatusDeleteBlocker[]) {
    const code = DELETE_BLOCKER_ERROR_CODES[blockers[0]!];
    return createSafeError({ statusCode: 409, message: code, data: { code, blockers } });
}

/**
 * The DELETE through the session, with the same headers `drupalSessionFetch`
 * sends. It exists so that this route, and only this route, can read why
 * Drupal refuses: the shared helper drops every 403 detail
 * (`clientDrupalErrorDetail`), and that stays so for all other routes.
 * Only the closed parse of `parseDeleteRefusal()` leaves this function, never
 * the detail text.
 */
async function deleteInDrupal(event: H3Event, id: string): Promise<void> {
    requireAuth(event);
    if (!getDrupalSessionApiBase(event)) {
        throw createSafeError({
            statusCode: 500,
            message: 'errors.server.configuration',
            data: { code: 'errors.server.configuration' }
        });
    }
    const cookieHeader = getHeader(event, 'cookie') || '';
    const headers = buildDrupalRequestHeaders(event, {
        accept: 'application/vnd.api+json',
        contentType: 'application/vnd.api+json',
        cookieHeader
    });
    headers['X-CSRF-Token'] = await fetchCsrfToken(cookieHeader, event);

    const response = await drupalSessionRequest(event, `/jsonapi/workflow_status/workflow_status/${id}`, {
        method: 'DELETE',
        headers
    });
    if (response.ok) return;

    console.error(`[admin] Drupal refused the delete of workflow status ${id} with ${response.status}`);
    if (response.status === 403) {
        const refusal = parseDeleteRefusal(await response.text().catch(() => ''));
        if (refusal && refusal !== 'protected') throw refusedForBlockers(refusal.blockers);
        if (refusal === 'protected') {
            throw createSafeError({
                statusCode: 409,
                message: 'errors.workflow.statusProtected',
                data: { code: 'errors.workflow.statusProtected' }
            });
        }
        // No permission or no group access: stays a 403, with its own sentence.
        throw createSafeError({
            statusCode: 403,
            message: 'errors.workflow.deleteForbidden',
            data: { code: 'errors.workflow.deleteForbidden' }
        });
    }
    throw createSafeError({
        statusCode: response.status,
        message: 'errors.server.drupalRequestFailed',
        data: { code: 'errors.server.drupalRequestFailed' }
    });
}

export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    requireSameOriginRequest(event);
    setPrivateNoStore(event);

    const id = validateUuid(getRouterParam(event, 'id'), 'statusId');
    const workspace = await resolveRequiredWorkflowStatusWorkspace(event);
    await assertWorkflowStatusWorkspaceWriteAccess(event, workspace);
    const status = await fetchWorkflowStatusById(event, workspace, id);
    if (!status) {
        throw createSafeError({
            statusCode: 404,
            message: 'errors.workflow.statusNotFound',
            data: { code: 'errors.workflow.statusNotFound' }
        });
    }

    // Drupal decides why a status may not be deleted (its delete access and
    // the list's `delete_blockers` call the same function). The former Nuxt
    // pre-checks for application and transition references filtered by
    // jurisdiction where Drupal does not, so the two disagreed; they are gone.
    // The start status is still refused here without a request, with the
    // same answer Drupal gives.
    if (status.isDefault) throw refusedForBlockers(['default']);

    await deleteInDrupal(event, id);

    return buildWorkflowStatusListResponse(event, workspace);
});
