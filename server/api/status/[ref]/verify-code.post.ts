/**
 * POST /api/status/:ref/verify-code
 *
 * Verifies a one-time email code and returns non-PII status data.
 */
import { requireSameOriginRequest, setPrivateNoStore } from '../../../utils/request-security';
import { publicStatusProxyHeaders } from '../../../utils/public-status-proxy';

const REF_PATTERN = /^[A-Z0-9][A-Z0-9-]{2,63}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_PATTERN = /^\d{6}$/;

function readString(data: Record<string, unknown>, camelKey: string, snakeKey: string): string | null {
    const value = data[camelKey] ?? data[snakeKey];
    return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function readTimelineEntry(value: unknown): Record<string, string> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const entry = value as Record<string, unknown>;
    const status = readString(entry, 'status', 'status');
    const timestamp = readString(entry, 'timestamp', 'timestamp');
    if (!status || !timestamp) return null;

    const result: Record<string, string> = { status, timestamp };
    for (const key of ['label', 'color', 'icon']) {
        const text = readString(entry, key, key);
        if (text !== null) result[key] = text;
    }
    if (entry.actor === 'staff') result.actor = 'staff';
    return result;
}

export default defineEventHandler(async (event) => {
    requireSameOriginRequest(event);
    setPrivateNoStore(event);

    const ip = getRequestClientIp(event);
    checkRateLimit(ip, 'status_otp_verify');

    const ref = getRouterParam(event, 'ref');
    if (!ref || !REF_PATTERN.test(ref)) {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.status.referenceFormatInvalid',
            data: { code: 'errors.status.referenceFormatInvalid' }
        });
    }

    const body = await readBody<{ email?: unknown, code?: unknown }>(event);
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const code = typeof body.code === 'string' ? body.code.trim() : '';

    if (!EMAIL_PATTERN.test(email)) {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.status.emailInvalid',
            data: { code: 'errors.status.emailInvalid' }
        });
    }

    if (!CODE_PATTERN.test(code)) {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.status.codeInvalid',
            data: { code: 'errors.status.codeInvalid' }
        });
    }

    const config = useRuntimeConfig();
    const apiBase = config.apiBase;
    if (!apiBase) {
        throw createSafeError({
            statusCode: 500,
            message: 'errors.server.configuration',
            data: { code: 'errors.server.configuration' }
        });
    }

    const response = await fetch(`${apiBase}/api/status/${ref}/verify-code`, {
        method: 'POST',
        headers: {
            'Accept': 'application/json',
            ...publicStatusProxyHeaders(ip),
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email, code })
    });

    if (!response.ok) {
        const codeKey = response.status === 401 ? 'errors.status.codeInvalid' : 'errors.status.loadFailed';
        throw createSafeError({
            statusCode: response.status,
            message: codeKey,
            data: { code: codeKey }
        });
    }

    const data = await response.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw createSafeError({
            statusCode: 502,
            message: 'errors.status.loadFailed',
            data: { code: 'errors.status.loadFailed' }
        });
    }

    const record = data as Record<string, unknown>;
    const referenceNumber = readString(record, 'referenceNumber', 'reference_number');
    const status = readString(record, 'status', 'status');
    if (!referenceNumber || !status) {
        throw createSafeError({
            statusCode: 502,
            message: 'errors.status.loadFailed',
            data: { code: 'errors.status.loadFailed' }
        });
    }

    return {
        referenceNumber,
        formTitle: readString(record, 'formTitle', 'form_title'),
        orgName: readString(record, 'orgName', 'org_name'),
        status,
        // Per-workspace label; without it the badge guesses from the machine name.
        statusLabel: readString(record, 'statusLabel', 'status_label'),
        statusColor: readString(record, 'statusColor', 'status_color'),
        statusIcon: readString(record, 'statusIcon', 'status_icon'),
        createdAt: readString(record, 'createdAt', 'submitted_at') ?? '',
        updatedAt: readString(record, 'updatedAt', 'updated_at') ?? '',
        timeline: Array.isArray(record.timeline)
            ? record.timeline.map(readTimelineEntry).filter(entry => entry !== null)
            : []
    };
});
