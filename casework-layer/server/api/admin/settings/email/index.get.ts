/**
 * GET /api/admin/settings/email
 *
 * Loads notification email templates from Drupal's config-based REST API.
 * Requires admin authentication.
 *
 * Token conversion: Drupal stores `@variable`, frontend displays `{{variable}}`.
 *
 * The jurisdiction editor reads its scoped templates from
 * /api/admin/jurisdictions/:jurisdiction/settings/notification_mail.
 */
import { createSafeError } from '~~/server/utils/error-handling';
import { setPrivateNoStore } from '~~/server/utils/request-security';

export default defineEventHandler(async (event) => {
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

    try {
        const cookieHeader = getHeader(event, 'cookie') || '';
        const response = await drupalSessionRequest(event, '/api/notification/templates', {
            headers: buildDrupalRequestHeaders(event, { accept: 'application/json', cookieHeader })
        });

        if (!response.ok) {
            if (response.status === 404) {
                console.warn('[email-settings] Notification endpoint not found, module may not be enabled');
                return [];
            }
            throw createSafeError({
                statusCode: response.status,
                message: 'errors.admin.emailTemplatesLoadFailed',
                data: { code: 'errors.admin.emailTemplatesLoadFailed' }
            });
        }

        const result = await response.json<{
            data: Record<string, {
                id: string
                subject: string
                body: string
                enabled: boolean
            }>
        }>();

        const templateMeta: Record<string, { label: string, description: string, category: 'citizen' | 'staff' }> = {
            application_confirmation: {
                label: 'Eingangsbestätigung',
                description: 'Wird nach erfolgreicher Einreichung eines Antrags an den Bürger gesendet.',
                category: 'citizen'
            },
            status_change: {
                label: 'Statusänderung',
                description: 'Wird bei jeder Statusänderung eines Antrags gesendet.',
                category: 'citizen'
            },
            approval: {
                label: 'Genehmigung',
                description: 'Wird gesendet, wenn ein Antrag genehmigt wird.',
                category: 'citizen'
            },
            rejection: {
                label: 'Ablehnung',
                description: 'Wird gesendet, wenn ein Antrag abgelehnt wird.',
                category: 'citizen'
            },
            new_application_alert: {
                label: 'Sachbearbeiter-Benachrichtigung',
                description: 'Wird an Sachbearbeiter gesendet, wenn ein neuer Antrag eingeht.',
                category: 'staff'
            },
            assignment_alert: {
                label: 'Zuweisungs-Benachrichtigung',
                description: 'Wird an Sachbearbeiter gesendet, wenn ein Antrag zugewiesen wird.',
                category: 'staff'
            },
            escalation_alert: {
                label: 'Eskalations-Warnung',
                description: 'Wird gesendet, wenn ein Antrag zu lange unbearbeitet ist.',
                category: 'staff'
            },
            deadline_alert: {
                label: 'Wiedervorlage',
                description: 'Wird an Sachbearbeiter gesendet, wenn eine Frist fällig oder überfällig ist.',
                category: 'staff'
            },
            application_comment_staff: {
                label: 'Rückfrage an Bürger',
                description: 'Wird an Bürger gesendet, wenn Sachbearbeiter eine Rückfrage stellen.',
                category: 'citizen'
            },
            application_comment_citizen: {
                label: 'Antwort vom Bürger',
                description: 'Wird an Sachbearbeiter gesendet, wenn Bürger auf eine Rückfrage antworten.',
                category: 'staff'
            }
        };

        return Object.entries(result.data).map(([key, template]) => ({
            id: key,
            label: templateMeta[key]?.label ?? key,
            description: templateMeta[key]?.description ?? '',
            subject: drupalTokensToFrontend(template.subject),
            body: drupalTokensToFrontend(template.body),
            enabled: template.enabled,
            category: templateMeta[key]?.category ?? 'citizen',
            _fromApi: true
        }));
    } catch (e: unknown) {
        if (e && typeof e === 'object' && 'statusCode' in e) {
            throw e;
        }

        console.error('[email-settings] Failed to load templates:', e instanceof Error ? e.message : e);
        throw createSafeError({
            statusCode: 500,
            message: 'errors.admin.emailTemplatesLoadFailed',
            data: { code: 'errors.admin.emailTemplatesLoadFailed' }
        });
    }
});

/**
 * Convert Drupal `@token` syntax to frontend `{{token}}` syntax.
 * Avoids matching email addresses (preceded by alphanumeric/dot chars).
 */
function drupalTokensToFrontend(text: string): string {
    if (!text) return text;
    return text.replace(/(?<![a-zA-Z0-9.])@([a-z_]+)/g, '{{$1}}');
}
