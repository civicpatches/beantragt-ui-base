import type { H3Event } from 'h3';
import {
    MAINTENANCE_PROXY_TIMEOUT_MS,
    maintenanceApiBase,
    maintenanceProxyFailure,
    readMaintenanceJsonPayload
} from '~~/server/utils/maintenance-proxy';
import { serviceProxyHeaders } from '~~/server/utils/public-status-proxy';
import { getClientIp, getTrustedProxyClientIp } from '~~/server/utils/rate-limit';

const RECOVERY_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function hasExactKeys(value: unknown, keys: string[]): value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    return Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}

function isPositiveInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

type MaintenanceMutationResponse = 'request-code' | 'verify-code' | 'disable';

function isExpectedMutationSuccess(value: unknown, response: MaintenanceMutationResponse): boolean {
    if (response === 'request-code') {
        return hasExactKeys(value, ['success', 'message', 'expiresIn', 'codeLength'])
          && value.success === true
          && typeof value.message === 'string'
          && isPositiveInteger(value.expiresIn)
          && value.codeLength === 6;
    }
    if (response === 'verify-code') {
        return hasExactKeys(value, ['success', 'recoveryToken', 'expiresIn'])
          && value.success === true
          && typeof value.recoveryToken === 'string'
          && RECOVERY_TOKEN_PATTERN.test(value.recoveryToken)
          && isPositiveInteger(value.expiresIn);
    }
    return hasExactKeys(value, ['maintenance']) && value.maintenance === false;
}

function maintenanceErrorPayload(value: unknown): { error: string } | null {
    if (!hasExactKeys(value, ['error']) || typeof value.error !== 'string') return null;
    return { error: value.error };
}

interface MaintenanceMutationOptions {
    path: string
    method: 'POST' | 'PATCH'
    scope: string
    body: Record<string, string | boolean>
    response: MaintenanceMutationResponse
    clientIp: string
    bearerToken?: string
    locale?: 'de' | 'en'
}

export function getMaintenanceClientIp(event: H3Event): string {
    return useRuntimeConfig().trustProxyIpHeaders === true
        ? getTrustedProxyClientIp(event)
        : getClientIp(event);
}

export async function proxyMaintenanceMutation(
    event: H3Event,
    options: MaintenanceMutationOptions
): Promise<unknown> {
    let response: Response;
    try {
        response = await fetch(`${maintenanceApiBase()}${options.path}`, {
            method: options.method,
            headers: {
                'Accept': 'application/json',
                ...serviceProxyHeaders(options.scope, options.clientIp),
                'Content-Type': 'application/json',
                ...(options.bearerToken ? { Authorization: `Bearer ${options.bearerToken}` } : {}),
                ...(options.locale ? { 'Accept-Language': options.locale } : {})
            },
            body: JSON.stringify(options.body),
            cache: 'no-store',
            redirect: 'error',
            signal: AbortSignal.timeout(MAINTENANCE_PROXY_TIMEOUT_MS)
        });
    } catch {
        throw maintenanceProxyFailure();
    }
    const payload = await readMaintenanceJsonPayload(response);

    if (response.ok) {
        if (!isExpectedMutationSuccess(payload, options.response)) throw maintenanceProxyFailure();
        setResponseStatus(event, response.status);
        return payload;
    }

    const errorPayload = maintenanceErrorPayload(payload);
    if (!errorPayload || response.status < 400 || response.status >= 500) {
        throw maintenanceProxyFailure();
    }

    setResponseStatus(event, response.status);
    return errorPayload;
}
