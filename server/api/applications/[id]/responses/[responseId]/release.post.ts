import { resolveExternalResponseApplicationId } from '../../../../../utils/external-response-application';
import { requireSameOriginRequest, setPrivateNoStore } from '../../../../../utils/request-security';

export default defineEventHandler(async (event) => {
    setPrivateNoStore(event);
    requireSameOriginRequest(event);
    const id = getRouterParam(event, 'id');
    const responseId = getRouterParam(event, 'responseId');
    validateUuid(id, 'applicationId');
    validateUuid(responseId, 'responseId');
    await getAuthenticatedUser(event);
    const internalId = await resolveExternalResponseApplicationId(event, id);
    return drupalSessionFetch(event, `/api/applications/${internalId}/responses/${responseId}/release`, {
        method: 'POST'
    });
});
