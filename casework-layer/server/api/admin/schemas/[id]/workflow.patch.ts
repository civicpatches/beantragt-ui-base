import { saveSchemaWorkflowDefinition } from '../../../../utils/schema-workflow';
import { requireSameOriginRequest, setPrivateNoStore } from '~~/server/utils/request-security';

export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    requireSameOriginRequest(event);
    setPrivateNoStore(event);

    const body = await readBody<{ workflow?: unknown, expectedChanged?: unknown }>(event);
    return saveSchemaWorkflowDefinition(
        event,
        getRouterParam(event, 'id'),
        body?.workflow ?? body,
        body?.expectedChanged
    );
});
