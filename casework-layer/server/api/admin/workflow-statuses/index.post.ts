import {
    assertWorkflowStatusWorkspaceWriteAccess,
    buildWorkflowStatusListResponse,
    fetchWorkflowStatuses,
    normalizeWorkflowStatusInput,
    resolveRequiredWorkflowStatusWorkspace,
    workflowStatusAttributes,
    workflowStatusRelationships,
    mapWorkflowStatusWriteError
} from '~~/casework-layer/server/utils/workflow-status-admin';
import { drupalSessionFetch } from '~~/server/utils/auth';
import { setPrivateNoStore, requireSameOriginRequest } from '~~/server/utils/request-security';

export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    requireSameOriginRequest(event);
    setPrivateNoStore(event);

    const workspace = await resolveRequiredWorkflowStatusWorkspace(event);
    await assertWorkflowStatusWorkspaceWriteAccess(event, workspace);

    const input = normalizeWorkflowStatusInput(await readBody<Record<string, unknown>>(event), 'create');
    const existingStatuses = await fetchWorkflowStatuses(event, workspace);
    if (input.isDefault) {
        const existingDefault = existingStatuses.some(status => status.isDefault);
        if (existingDefault) {
            throw createSafeError({
                statusCode: 409,
                message: 'errors.workflow.defaultExists',
                data: { code: 'errors.workflow.defaultExists' }
            });
        }
    }
    if (input.allowedNextIds !== undefined) {
        const targetIds = new Set(existingStatuses.map(status => status.id));
        if (input.allowedNextIds.some(id => !targetIds.has(id))) {
            throw createSafeError({
                statusCode: 400,
                message: 'errors.workflow.allowedNextOutOfScope',
                data: { code: 'errors.workflow.allowedNextOutOfScope' }
            });
        }
    }

    try {
        await drupalSessionFetch(
            event,
            '/jsonapi/workflow_status/workflow_status',
            {
                method: 'POST',
                body: {
                    data: {
                        type: 'workflow_status--workflow_status',
                        attributes: workflowStatusAttributes({
                            ...input,
                            isDefault: input.isDefault ?? false,
                            isTerminal: input.isTerminal ?? false,
                            weight: input.weight ?? 0
                        }),
                        relationships: {
                            field_group: {
                                data: {
                                    type: 'group--org',
                                    id: workspace.id
                                }
                            },
                            ...workflowStatusRelationships(input)
                        }
                    }
                }
            }
        );
    } catch (error: unknown) {
        throw mapWorkflowStatusWriteError(error);
    }

    return buildWorkflowStatusListResponse(event, workspace);
});
