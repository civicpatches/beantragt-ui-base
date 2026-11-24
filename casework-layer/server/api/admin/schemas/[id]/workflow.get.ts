import { buildSchemaWorkflowResponse } from '../../../../utils/schema-workflow';
import { setPrivateNoStore } from '~~/server/utils/request-security';

export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    setPrivateNoStore(event);

    try {
        return await buildSchemaWorkflowResponse(event, getRouterParam(event, 'id'));
    } catch (error: unknown) {
        const failure = error as { statusCode?: number, data?: { code?: unknown } };
        if (failure?.statusCode === 409 && failure.data?.code === 'errors.workflow.organisationWorkspaceRequired') {
            return { organisationRequired: true } as const;
        }
        throw error;
    }
});
