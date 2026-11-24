import type { H3Event } from 'h3';
import { createSafeError } from './error-handling';

const MAINTENANCE_PROXY_ERROR = 'errors.maintenance.proxyFailed';
export const MAINTENANCE_PROXY_TIMEOUT_MS = 4_000;

export interface MaintenanceStatusResponse {
    maintenance: boolean
}

export async function readMaintenanceJsonPayload(response: Response): Promise<unknown> {
    try {
        return await response.json();
    } catch {
        return null;
    }
}

export function maintenanceApiBase(): string {
    const base = useRuntimeConfig().apiBase;
    if (typeof base === 'string' && base.trim() !== '') return base;

    throw createSafeError({
        statusCode: 500,
        message: 'errors.server.configuration',
        data: { code: 'errors.server.configuration' }
    });
}

function isMaintenanceStatus(value: unknown): value is MaintenanceStatusResponse {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    return Object.keys(record).length === 1 && typeof record.maintenance === 'boolean';
}

export function maintenanceProxyFailure(): Error {
    return createSafeError({
        statusCode: 502,
        message: MAINTENANCE_PROXY_ERROR,
        data: { code: MAINTENANCE_PROXY_ERROR }
    });
}

export async function proxyMaintenanceStatus(event: H3Event): Promise<MaintenanceStatusResponse> {
    let response: Response;
    try {
        response = await fetch(`${maintenanceApiBase()}/api/platform/maintenance`, {
            method: 'GET',
            headers: { Accept: 'application/json' },
            cache: 'no-store',
            redirect: 'error',
            signal: AbortSignal.timeout(MAINTENANCE_PROXY_TIMEOUT_MS)
        });
    } catch {
        throw maintenanceProxyFailure();
    }
    const payload = await readMaintenanceJsonPayload(response);

    if (!response.ok || !isMaintenanceStatus(payload)) {
        throw maintenanceProxyFailure();
    }

    setResponseStatus(event, response.status);
    return payload;
}
