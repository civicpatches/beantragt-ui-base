/**
 * Parse a settings-proxy error into the pieces the settings pages need:
 *  - `status`  HTTP status (401 means the session has expired).
 *  - `field`   Backend contract field key (platformName, primaryColor, ...),
 *              forwarded by the proxy only for 4xx validation responses.
 *  - `detail`  Backend-authored, already-localized validation message.
 *
 * The proxy shapes errors as `{ statusCode, data: { code, detail?, field? } }`;
 * `$fetch` surfaces that as `error.data`. We never read raw `message`.
 */
export interface SettingsErrorInfo {
    status: number | null
    field: string | null
    detail: string | null
}

export function parseSettingsError(e: unknown): SettingsErrorInfo {
    const err = (e ?? {}) as {
        statusCode?: number
        status?: number
        response?: { status?: number }
        data?: { statusCode?: number, field?: unknown, detail?: unknown }
    };
    const data = err.data;
    const status = err.statusCode
      ?? err.status
      ?? err.response?.status
      ?? data?.statusCode
      ?? null;

    return {
        status: typeof status === 'number' ? status : null,
        field: data && typeof data.field === 'string' ? data.field : null,
        detail: data && typeof data.detail === 'string' ? data.detail : null
    };
}
