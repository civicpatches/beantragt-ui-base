import type { H3Event } from 'h3';
import { createSafeError } from '~~/server/utils/error-handling';
import { requireSameOriginRequest, setPrivateNoStore } from '~~/server/utils/request-security';
import {
    extractSettingsData,
    safeErrorFromDrupal,
    validateJurisdictionIdentifier,
    validateSettingsSection,
    type SettingsSection
} from '~~/server/utils/jurisdiction-settings';

interface SettingsResponse {
    section: string
    data: Record<string, unknown>
    jurisdiction?: { id?: unknown, slug?: unknown }
}

export async function readJurisdictionSettings(event: H3Event, fixedSection?: SettingsSection) {
    setPrivateNoStore(event);

    await requireAdmin(event);

    const ip = getClientIp(event);
    checkRateLimit(ip, 'admin', event);

    const jurisdiction = validateJurisdictionIdentifier(getRouterParam(event, 'jurisdiction'));
    const section = fixedSection ?? validateSettingsSection(getRouterParam(event, 'section'));

    try {
        const cookieHeader = getHeader(event, 'cookie') || '';
        const response = await drupalSessionRequest(
            event,
            `/api/admin/jurisdictions/${encodeURIComponent(jurisdiction)}/settings/${section}`,
            {
                headers: buildDrupalRequestHeaders(event, { accept: 'application/json', cookieHeader })
            }
        );

        if (!response.ok) {
            const errorBody = await response.text().catch(() => '');
            console.error(
                `[jurisdiction-settings] GET ${section} failed (${response.status})`
            );
            throw safeErrorFromDrupal(
                response.status,
                errorBody,
                'errors.admin.settingsLoadFailed'
            );
        }

        return await response.json<{ section: string, data: Record<string, unknown> }>();
    } catch (e: unknown) {
        if (e && typeof e === 'object' && 'statusCode' in e) {
            throw e;
        }

        console.error(
            '[jurisdiction-settings] Failed to load section:',
            e instanceof Error ? e.message : e
        );
        throw createSafeError({
            statusCode: 500,
            message: 'errors.admin.settingsLoadFailed',
            data: { code: 'errors.admin.settingsLoadFailed' }
        });
    }
}

export async function saveJurisdictionSettings(event: H3Event, fixedSection?: SettingsSection, onSaved?: (section: SettingsSection, jurisdiction: string, result: SettingsResponse) => void) {
    requireSameOriginRequest(event);
    setPrivateNoStore(event);

    await requireAdmin(event);

    const ip = getClientIp(event);
    checkRateLimit(ip, 'admin', event);

    const jurisdiction = validateJurisdictionIdentifier(getRouterParam(event, 'jurisdiction'));
    const section = fixedSection ?? validateSettingsSection(getRouterParam(event, 'section'));

    const body = await readBody<unknown>(event);
    const data = extractSettingsData(body);

    try {
        const cookieHeader = getHeader(event, 'cookie') || '';
        const headers = buildDrupalRequestHeaders(event, {
            accept: 'application/json',
            contentType: 'application/json',
            cookieHeader
        });
        headers['X-CSRF-Token'] = await fetchCsrfToken(cookieHeader, event);

        const response = await drupalSessionRequest(
            event,
            `/api/admin/jurisdictions/${encodeURIComponent(jurisdiction)}/settings/${section}`,
            {
                method: 'PATCH',
                headers,
                body: JSON.stringify({ data })
            }
        );

        if (!response.ok) {
            const errorBody = await response.text().catch(() => '');
            console.error(
                `[jurisdiction-settings] PATCH ${section} failed (${response.status})`
            );
            throw safeErrorFromDrupal(
                response.status,
                errorBody,
                'errors.admin.settingsSaveFailed'
            );
        }

        const result = await response.json<SettingsResponse>();
        onSaved?.(section, jurisdiction, result);
        return result;
    } catch (e: unknown) {
        if (e && typeof e === 'object' && 'statusCode' in e) {
            throw e;
        }

        console.error(
            '[jurisdiction-settings] Failed to save section:',
            e instanceof Error ? e.message : e
        );
        throw createSafeError({
            statusCode: 500,
            message: 'errors.admin.settingsSaveFailed',
            data: { code: 'errors.admin.settingsSaveFailed' }
        });
    }
}
