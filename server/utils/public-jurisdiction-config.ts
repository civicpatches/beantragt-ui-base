import { createSafeError } from './error-handling';

/** Load and unwrap Drupal's public jurisdiction config. */
export async function loadPublicJurisdictionConfig(
    apiBase: string,
    slug: string,
    signal?: AbortSignal
): Promise<Record<string, unknown>> {
    const response = await fetch(`${apiBase}/api/v1/jurisdictions/${encodeURIComponent(slug)}/config`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal
    });

    if (!response.ok) {
        const code = response.status === 404 ? 'errors.jurisdiction.notFound' : 'errors.jurisdiction.configLoadFailed';
        throw createSafeError({ statusCode: response.status, message: code, data: { code } });
    }

    const payload: unknown = await response.json();
    const data = payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as { data?: unknown }).data
        : null;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        const code = 'errors.jurisdiction.configLoadFailed';
        throw createSafeError({ statusCode: 502, message: code, data: { code } });
    }

    return data as Record<string, unknown>;
}
