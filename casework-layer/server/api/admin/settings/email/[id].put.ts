/**
 * PUT /api/admin/settings/email/:id
 *
 * Updates a notification email template in Drupal's config-based REST API.
 * The :id parameter is the template key (e.g., 'application_confirmation').
 * Requires admin authentication.
 *
 * Token conversion: Frontend sends `{{variable}}`, Drupal stores `@variable`.
 *
 * The jurisdiction editor uses /api/admin/jurisdictions/:jurisdiction/settings/notification_mail
 * to keep its updates scoped to a jurisdiction.
 */
import { createSafeError } from '~~/server/utils/error-handling';
import { requireSameOriginRequest, setPrivateNoStore } from '~~/server/utils/request-security';

export default defineEventHandler(async (event) => {
    requireSameOriginRequest(event);
    setPrivateNoStore(event);

    const user = await requireAdmin(event);
    if (!user.roles?.includes('administrator')) {
        throw createSafeError({
            statusCode: 403,
            message: 'errors.admin.emailTemplatesForbidden',
            data: { code: 'errors.admin.emailTemplatesForbidden' }
        });
    }

    const ip = getClientIp(event);
    checkRateLimit(ip, 'admin', event);

    const templateId = getRouterParam(event, 'id');
    if (!templateId || !/^[a-z_]+$/.test(templateId)) {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.admin.emailTemplateIdInvalid',
            data: { code: 'errors.admin.emailTemplateIdInvalid' }
        });
    }

    const body = await readBody<{
        subject?: string
        body?: string
        enabled?: boolean
    }>(event);

    const payload: Record<string, unknown> = {};

    if (typeof body.subject === 'string') {
        payload.subject = frontendTokensToDrupal(body.subject);
    }
    if (typeof body.body === 'string') {
        payload.body = frontendTokensToDrupal(body.body);
    }
    if (typeof body.enabled === 'boolean') {
        payload.enabled = body.enabled;
    }

    if (Object.keys(payload).length === 0) {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.admin.noChanges',
            data: { code: 'errors.admin.noChanges' }
        });
    }

    try {
        const cookieHeader = getHeader(event, 'cookie') || '';
        const headers = buildDrupalRequestHeaders(event, {
            accept: 'application/json',
            contentType: 'application/json',
            cookieHeader
        });
        headers['X-CSRF-Token'] = await fetchCsrfToken(cookieHeader, event);

        const response = await drupalSessionRequest(event, `/api/notification/templates/${templateId}`, {
            method: 'PUT',
            headers,
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorBody = await response.text().catch(() => '');
            console.error(`[email-settings] PUT failed for ${templateId}:`, errorBody.substring(0, 300));
            throw createSafeError({
                statusCode: response.status,
                message: 'errors.admin.emailTemplateSaveFailed',
                data: { code: 'errors.admin.emailTemplateSaveFailed' }
            });
        }

        return { success: true };
    } catch (e: unknown) {
        if (e && typeof e === 'object' && 'statusCode' in e) {
            throw e;
        }

        console.error(`[email-settings] Failed to update template ${templateId}:`, e instanceof Error ? e.message : e);
        throw createSafeError({
            statusCode: 500,
            message: 'errors.admin.emailTemplateSaveFailed',
            data: { code: 'errors.admin.emailTemplateSaveFailed' }
        });
    }
});

/**
 * Convert frontend `{{token}}` syntax to Drupal `@token` syntax.
 */
function frontendTokensToDrupal(text: string): string {
    if (!text) return text;
    return text.replace(/\{\{([a-z_]+)\}\}/g, '@$1');
}
