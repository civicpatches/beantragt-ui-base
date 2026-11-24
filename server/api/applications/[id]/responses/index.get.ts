import { resolveExternalResponseApplicationId } from '../../../../utils/external-response-application';
import { setPrivateNoStore } from '../../../../utils/request-security';

export default defineEventHandler(async (event) => {
    setPrivateNoStore(event);
    const id = getRouterParam(event, 'id');
    validateUuid(id, 'applicationId');
    await getAuthenticatedUser(event);
    const internalId = await resolveExternalResponseApplicationId(event, id);
    return drupalSessionFetch(event, `/api/applications/${internalId}/responses`);
});
