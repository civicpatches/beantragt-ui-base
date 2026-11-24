/**
 * GET /api/applications/:id
 *
 * Returns a single application by UUID.
 * Only returns data when Drupal's citizen endpoint confirms the current
 * browser session owns the application.
 */
import { setPrivateNoStore } from '../../utils/request-security';

function normalizePublicSlug(value: unknown): string | null {
    const raw = Array.isArray(value) ? value[0] : value;
    if (typeof raw !== 'string') return null;
    const slug = raw.trim().toLowerCase();
    return /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/.test(slug) ? slug : null;
}

function citizenApplicationPath(event: Parameters<typeof getQuery>[0], id: string): string {
    const query = getQuery(event);
    const params = new URLSearchParams();
    const jurisdiction = normalizePublicSlug(query.jurisdiction);
    const organisation = normalizePublicSlug(query.organisation || query.organization || query.org);
    if (jurisdiction) params.set('jurisdiction', jurisdiction);
    if (organisation) params.set('organisation', organisation);
    // Drupal sees no language prefix here; labels follow the UI locale.
    if (query.lang === 'de' || query.lang === 'en') params.set('lang', query.lang);
    const queryString = params.toString();
    return queryString
        ? `/api/citizen/applications/${id}?${queryString}`
        : `/api/citizen/applications/${id}`;
}

export default defineEventHandler(async (event) => {
    setPrivateNoStore(event);

    const id = getRouterParam(event, 'id');

    if (!id) {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.applications.idMissing',
            data: { code: 'errors.applications.idMissing' }
        });
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.applications.idInvalid',
            data: { code: 'errors.applications.idInvalid' }
        });
    }

    try {
        await getAuthenticatedUser(event);
        const cookieHeader = getHeader(event, 'cookie') || '';
        const response = await drupalSessionRequest(
            event,
            citizenApplicationPath(event, id),
            {
                headers: buildDrupalRequestHeaders(event, {
                    accept: 'application/json',
                    cookieHeader
                })
            }
        );

        if (!response.ok) {
            throw createSafeError({
                statusCode: response.status,
                message: response.status === 403 ? 'errors.applications.accessDenied' : 'errors.applications.loadFailed',
                data: { code: response.status === 403 ? 'errors.applications.accessDenied' : 'errors.applications.loadFailed' }
            });
        }

        const payload = await response.json<{
            application?: {
                id: string
                referenceNumber: string
                formTitle: string
                status: string
                statusLabel?: string
                statusColor?: string
                statusIcon?: string
                createdAt: string
                updatedAt?: string
                timeline?: Array<{
                    status: string
                    timestamp: string
                    actor?: string
                    label?: string
                    color?: string
                    icon?: string
                }>
                data: Record<string, unknown>
                fieldLabels?: Record<string, string>
            }
        }>();

        if (!payload.application) {
            throw createSafeError({
                statusCode: 404,
                message: 'errors.applications.loadFailed',
                data: { code: 'errors.applications.loadFailed' }
            });
        }

        return { application: payload.application };
    } catch (e: unknown) {
        if (e && typeof e === 'object' && 'statusCode' in e) {
            throw e;
        }

        console.error('[applications/:id] Error:', e instanceof Error ? e.message : e);
        throw createSafeError({
            statusCode: 500,
            message: 'errors.applications.loadFailed',
            data: { code: 'errors.applications.loadFailed' }
        });
    }
});
