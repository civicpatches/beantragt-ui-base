export type JsonObject = Record<string, unknown>;

const MAX_PUBLIC_I18N_TEXT_LENGTH = 5000;

export function isRecord(value: unknown): value is JsonObject {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function stringValue(value: unknown): string | undefined {
    return typeof value === 'string' && value !== '' ? value : undefined;
}

export function numberValue(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function stringArrayValue(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const items = value.filter((item): item is string => typeof item === 'string');
    return items.length > 0 ? items : undefined;
}

export function publicI18nText(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed ? trimmed.slice(0, MAX_PUBLIC_I18N_TEXT_LENGTH) : undefined;
}
