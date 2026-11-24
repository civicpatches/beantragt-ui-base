import type { H3Event } from 'h3';
import { createSafeError } from './error-handling';
import { serviceProxyHeaders } from './public-status-proxy';
import { getRequestClientIp } from './rate-limit';

const CONFIRMATION_PROXY_ERROR = 'errors.confirmation.proxyFailed';

async function readJsonPayload(response: Response): Promise<unknown> {
    try {
        return await response.json();
    } catch {
        return null;
    }
}

export async function proxyPublicConfirmationRequest(
    event: H3Event,
    path: string,
    body: Record<string, string>,
    allowedStatuses: number[],
    rateLimitScope: string,
    projectSuccess?: (payload: unknown) => unknown
): Promise<unknown> {
    const config = useRuntimeConfig();
    const apiBase = config.apiBase;
    if (!apiBase) {
        throw createSafeError({
            statusCode: 500,
            message: 'errors.server.configuration',
            data: { code: 'errors.server.configuration' }
        });
    }

    const ip = getRequestClientIp(event);
    const response = await fetch(`${apiBase}${path}`, {
        method: 'POST',
        headers: {
            'Accept': 'application/json',
            ...serviceProxyHeaders(rateLimitScope, ip),
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });
    const payload = await readJsonPayload(response);

    if (allowedStatuses.includes(response.status) && payload !== null) {
        setResponseStatus(event, response.status);
        return response.ok && projectSuccess ? projectSuccess(payload) : payload;
    }

    throw createSafeError({
        statusCode: 502,
        message: CONFIRMATION_PROXY_ERROR,
        data: { code: CONFIRMATION_PROXY_ERROR }
    });
}
