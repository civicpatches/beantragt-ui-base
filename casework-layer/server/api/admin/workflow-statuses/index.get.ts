import {
    assertWorkflowStatusWorkspaceAccess,
    buildWorkflowStatusListResponse,
    resolveRequiredWorkflowStatusWorkspace
} from '~~/casework-layer/server/utils/workflow-status-admin';
import { setPrivateNoStore } from '~~/server/utils/request-security';

export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    setPrivateNoStore(event);

    const workspace = await resolveRequiredWorkflowStatusWorkspace(event);
    await assertWorkflowStatusWorkspaceAccess(event, workspace);
    return buildWorkflowStatusListResponse(event, workspace);
});
