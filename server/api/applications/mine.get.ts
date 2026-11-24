/**
 * GET /api/applications/mine
 *
 * Returns all applications belonging to the authenticated user.
 * Uses the authenticated Drupal user owner relation. Drupal's citizen endpoint
 * returns only applications owned by the current browser session.
 */
import { setPrivateNoStore } from '../../utils/request-security';

interface CitizenApplication {
    id: string
    referenceNumber: string
    formTitle: string
    status: string
    statusLabel?: string
    statusColor?: string
    statusIcon?: string
    createdAt: string
    updatedAt: string
}

function normalizePublicSlug(value: unknown): string | null {
    const raw = Array.isArray(value) ? value[0] : value;
    if (typeof raw !== 'string') return null;
    const slug = raw.trim().toLowerCase();
    return /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/.test(slug) ? slug : null;
}

function citizenApplicationsPath(event: Parameters<typeof getQuery>[0]): string {
    const query = getQuery(event);
    const params = new URLSearchParams();
    const jurisdiction = normalizePublicSlug(query.jurisdiction);
    const organisation = normalizePublicSlug(query.organisation || query.organization || query.org);
    if (jurisdiction) params.set('jurisdiction', jurisdiction);
    if (organisation) params.set('organisation', organisation);
    const queryString = params.toString();
    return queryString ? `/api/citizen/applications?${queryString}` : '/api/citizen/applications';
}

export default defineEventHandler(async (event) => {
    setPrivateNoStore(event);

    try {
        await getAuthenticatedUser(event);
        const cookieHeader = getHeader(event, 'cookie') || '';

        const response = await drupalSessionRequest(event, citizenApplicationsPath(event), {
            headers: buildDrupalRequestHeaders(event, {
                accept: 'application/json',
                cookieHeader
            })
        });

        if (!response.ok) {
            throw createSafeError({
                statusCode: response.status,
                message: 'errors.applications.loadFailed',
                data: { code: 'errors.applications.loadFailed' }
            });
        }

        const payload = await response.json<{
            applications?: CitizenApplication[]
        }>();

        const applications = Array.isArray(payload.applications) ? payload.applications : [];

        return { applications };
    } catch (e: unknown) {
        if (e && typeof e === 'object' && 'statusCode' in e) {
            throw e;
        }

        console.error('[applications/mine] Error:', e instanceof Error ? e.message : e);
        throw createSafeError({
            statusCode: 500,
            message: 'errors.applications.loadFailed',
            data: { code: 'errors.applications.loadFailed' }
        });
    }
});
