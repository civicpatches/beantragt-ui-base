import {
    applyWorkflowStatusTerminalInvariant,
    assertAllowedNextTargets,
    assertWorkflowStatusPatchPrecondition,
    assertWorkflowStatusWorkspaceWriteAccess,
    buildWorkflowStatusListResponse,
    fetchWorkflowStatuses,
    fetchWorkflowStatusById,
    normalizeWorkflowStatusInput,
    resolveRequiredWorkflowStatusWorkspace,
    withWorkflowStatusMutationLock,
    workflowStatusAttributes,
    workflowStatusRelationships,
    mapWorkflowStatusWriteError
} from '~~/casework-layer/server/utils/workflow-status-admin';
import { drupalSessionFetch } from '~~/server/utils/auth';
import { setPrivateNoStore, requireSameOriginRequest } from '~~/server/utils/request-security';
import { validateUuid } from '~~/server/utils/validation';

export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    requireSameOriginRequest(event);
    setPrivateNoStore(event);

    const id = validateUuid(getRouterParam(event, 'id'), 'statusId');
    const workspace = await resolveRequiredWorkflowStatusWorkspace(event);
    await assertWorkflowStatusWorkspaceWriteAccess(event, workspace);
    return withWorkflowStatusMutationLock(`${workspace.id}:${id}`, async () => {
        const status = await fetchWorkflowStatusById(event, workspace, id);
        if (!status) {
            throw createSafeError({
                statusCode: 404,
                message: 'errors.workflow.statusNotFound',
                data: { code: 'errors.workflow.statusNotFound' }
            });
        }

        const input = applyWorkflowStatusTerminalInvariant(
            normalizeWorkflowStatusInput(await readBody<Record<string, unknown>>(event), 'patch'),
            status
        );
        assertWorkflowStatusPatchPrecondition(status, input);
        await assertAllowedNextTargets(event, workspace, status, input.allowedNextIds);

        if (input.isDefault === false && status.isDefault) {
            throw createSafeError({
                statusCode: 409,
                message: 'errors.workflow.defaultCannotUnset',
                data: { code: 'errors.workflow.defaultCannotUnset' }
            });
        }

        if (input.isDefault === true && !status.isDefault) {
            const existingDefault = (await fetchWorkflowStatuses(event, workspace))
                .find(item => item.groupId === status.groupId && item.isDefault);
            if (existingDefault) {
                throw createSafeError({
                    statusCode: 409,
                    message: 'errors.workflow.defaultExists',
                    data: { code: 'errors.workflow.defaultExists' }
                });
            }
        }

        try {
            await drupalSessionFetch(
                event,
                `/jsonapi/workflow_status/workflow_status/${id}`,
                {
                    method: 'PATCH',
                    body: {
                        data: {
                            type: 'workflow_status--workflow_status',
                            id,
                            attributes: workflowStatusAttributes(input),
                            relationships: workflowStatusRelationships(input)
                        }
                    }
                }
            );
        } catch (error: unknown) {
            throw mapWorkflowStatusWriteError(error);
        }

        return buildWorkflowStatusListResponse(event, workspace);
    });
});
