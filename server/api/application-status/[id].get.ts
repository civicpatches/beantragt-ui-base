/**
 * GET /api/application-status/:id
 *
 * Public endpoint for status tracking. No authentication required.
 * A random public status token serves as the bearer secret.
 *
 * Only returns minimal data: reference number, status, form title,
 * and timestamps. Never exposes submitted form data or PII.
 *
 * Rate-limited to prevent enumeration attempts.
 */
import { checkRateLimit, getClientIp } from '../../utils/rate-limit';
import { publicStatusProxyHeaders } from '../../utils/public-status-proxy';
import { setPrivateNoStore } from '../../utils/request-security';

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/;

function readString(data: Record<string, unknown>, camelKey: string, snakeKey: string): string | null {
    const value = data[camelKey] ?? data[snakeKey];
    return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function readSlug(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const slug = value.trim().toLowerCase();
    return SLUG_PATTERN.test(slug) ? slug : null;
}

export default defineEventHandler(async (event) => {
    setPrivateNoStore(event);

    const ip = getClientIp(event);
    checkRateLimit(ip, 'status_check');

    const statusToken = getRouterParam(event, 'id');
    if (!statusToken) {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.applicationStatus.idMissing',
            data: { code: 'errors.applicationStatus.idMissing' }
        });
    }

    const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,96}$/;
    if (!TOKEN_PATTERN.test(statusToken)) {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.applicationStatus.idMissing',
            data: { code: 'errors.applicationStatus.idMissing' }
        });
    }

    const query = getQuery(event);
    const schemaIdInput = typeof query.schemaId === 'string' ? query.schemaId : '';
    const schemaId = validateUuid(schemaIdInput, 'schemaId');
    const hasJurisdictionInput = query.jurisdiction !== undefined;
    const hasOrganisationInput = query.organisation !== undefined;
    const jurisdiction = readSlug(query.jurisdiction);
    const organisation = readSlug(query.organisation);
    if (
        (hasJurisdictionInput && !jurisdiction)
        || (hasOrganisationInput && !organisation)
        || (hasOrganisationInput && !jurisdiction)
    ) {
        throw createSafeError({
            statusCode: 404,
            message: 'workspace.not_found',
            data: { code: 'workspace.not_found' }
        });
    }
    const params = new URLSearchParams({ schemaId });
    if (jurisdiction) params.set('jurisdiction', jurisdiction);
    if (organisation) params.set('organisation', organisation);

    try {
        const config = useRuntimeConfig();
        const apiBase = config.apiBase;
        if (!apiBase) {
            throw createSafeError({
                statusCode: 500,
                message: 'errors.server.configuration',
                data: { code: 'errors.server.configuration' }
            });
        }

        const response = await fetch(`${apiBase}/api/application-status/${statusToken}?${params.toString()}`, {
            method: 'GET',
            headers: {
                Accept: 'application/json',
                ...publicStatusProxyHeaders(ip)
            }
        });

        if (!response.ok) {
            if (response.status === 404) {
                throw createSafeError({
                    statusCode: 404,
                    message: 'errors.applicationStatus.notFound',
                    data: { code: 'errors.applicationStatus.notFound' }
                });
            }
            throw createSafeError({
                statusCode: response.status,
                message: 'errors.applicationStatus.loadFailed',
                data: { code: 'errors.applicationStatus.loadFailed' }
            });
        }

        const data = await response.json();

        if (!data || typeof data !== 'object' || Array.isArray(data)) {
            throw createSafeError({
                statusCode: 502,
                message: 'errors.applicationStatus.loadFailed',
                data: { code: 'errors.applicationStatus.loadFailed' }
            });
        }

        const record = data as Record<string, unknown>;
        const referenceNumber = readString(record, 'referenceNumber', 'reference_number');
        const formTitle = readString(record, 'formTitle', 'form_title');
        const status = readString(record, 'status', 'status');
        const statusLabel = readString(record, 'statusLabel', 'status_label');
        const statusColor = readString(record, 'statusColor', 'status_color');
        const statusIcon = readString(record, 'statusIcon', 'status_icon');
        const createdAt = readString(record, 'createdAt', 'submitted_at');
        const updatedAt = readString(record, 'updatedAt', 'updated_at');
        if (!referenceNumber || !formTitle || !status || !createdAt || !updatedAt) {
            throw createSafeError({
                statusCode: 502,
                message: 'errors.applicationStatus.loadFailed',
                data: { code: 'errors.applicationStatus.loadFailed' }
            });
        }

        return {
            application: {
                referenceNumber,
                formTitle,
                status,
                statusLabel: statusLabel ?? '',
                statusColor: statusColor ?? '',
                statusIcon: statusIcon ?? '',
                createdAt,
                updatedAt
            }
        };
    } catch (e: unknown) {
        // Re-throw our own safe errors
        if (e && typeof e === 'object' && 'statusCode' in e) {
            const statusCode = (e as { statusCode: number }).statusCode;
            if (statusCode === 404) {
                throw createSafeError({
                    statusCode: 404,
                    message: 'errors.applicationStatus.notFound',
                    data: { code: 'errors.applicationStatus.notFound' }
                });
            }
            throw e;
        }

        console.error('[application-status] Error:', e instanceof Error ? e.message : e);
        throw createSafeError({
            statusCode: 500,
            message: 'errors.applicationStatus.loadFailed',
            data: { code: 'errors.applicationStatus.loadFailed' }
        });
    }
});
