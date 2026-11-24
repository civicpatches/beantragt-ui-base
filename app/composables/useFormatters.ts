/**
 * Shared formatting utilities for beantragt.ai.
 *
 * Provides date, value, and status formatting functions
 * used across admin pages, components, and print views.
 * Eliminates duplicated formatDate/formatValue/statusMaps.
 */
import { displayFormAddressValue } from '~/utils/form-address';

/** Workflow status color mapping for UBadge components. */
export const STATUS_COLORS: Record<string, 'info' | 'warning' | 'success' | 'error' | 'neutral'> = {
    new: 'info',
    in_review: 'warning',
    approved: 'success',
    rejected: 'error',
    completed: 'neutral',
    returned: 'warning',
    archived: 'neutral'
};

/** Workflow status label mapping (German). */
export const STATUS_LABELS: Record<string, string> = {
    new: 'Neu',
    in_review: 'In Pruefung',
    approved: 'Genehmigt',
    rejected: 'Abgelehnt',
    completed: 'Abgeschlossen',
    returned: 'Zurueckgestellt',
    archived: 'Archiviert'
};

/** Schema workflow status labels (German). */
export const SCHEMA_STATUS_LABELS: Record<string, string> = {
    draft: 'Entwurf',
    published: 'Veroeffentlicht',
    active: 'Aktiv',
    archived: 'Archiviert'
};

export function getStatusColor(status: string): 'info' | 'warning' | 'success' | 'error' | 'neutral' {
    return STATUS_COLORS[status] ?? 'neutral';
}

export function getStatusLabel(status: string): string {
    return STATUS_LABELS[status] ?? status;
}

const numericDate = { day: '2-digit', month: '2-digit', year: 'numeric' } as const;

export function formatDate(dateStr: string, locale?: string): string {
    return dateStr ? new Date(dateStr).toLocaleDateString(normalizeFormatterLocale(locale), numericDate) : '-';
}

export function formatDateTime(dateStr: string, locale?: string): string {
    return dateStr
        ? new Date(dateStr).toLocaleDateString(normalizeFormatterLocale(locale), {
            ...numericDate, hour: '2-digit', minute: '2-digit'
        })
        : '-';
}

/**
 * Localized labels for boolean values.
 *
 * Callers pass their i18n `t('common.yes')` / `t('common.no')` so booleans
 * render in the active UI language instead of a hardcoded locale.
 */
export interface BooleanLabels {
    yes: string
    no: string
}

const DEFAULT_BOOLEAN_LABELS: BooleanLabels = { yes: 'Ja', no: 'Nein' };

/**
 * Format a field value for display.
 * Handles null, undefined, booleans, arrays, and strings.
 *
 * @param value
 *   The raw value to format.
 * @param booleanLabels
 *   Localized yes/no labels for boolean values. Defaults to German for
 *   backward compatibility; pass `{ yes: t('common.yes'), no: t('common.no') }`
 *   from a component to render in the active UI language.
 */
export function formatValue(value: unknown, booleanLabels: BooleanLabels = DEFAULT_BOOLEAN_LABELS): string {
    if (value === null || value === undefined || value === '') return '-';
    if (typeof value === 'boolean') return value ? booleanLabels.yes : booleanLabels.no;
    if (Array.isArray(value)) return value.join(', ');
    const address = displayFormAddressValue(value);
    if (address) return address;
    return String(value);
}

/** Schema facts the value formatter needs; every key is optional. */
export interface FieldValueFormatOptions {
    /** The value holds one entry per repetition of a repeatable section. */
    perEntry?: boolean
    /** Field type from the form schema (`date`, `number`, ...). */
    type?: string
    /** Normalized field format (`currency`, `postal_code`, ...). */
    format?: string
    /** `validation.step` of a number field; decides the fraction digits. */
    step?: number
    /** UI locale (`de`, `en`, `de-DE`, ...). Unknown or empty: German. */
    locale?: string
    booleanLabels?: BooleanLabels
}

const FALLBACK_FORMATTER_LOCALE = 'de-DE';
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
// One optional decimal separator, comma or point, as the form validation
// accepts it.
const PLAIN_NUMBER_PATTERN = /^-?\d+([.,]\d+)?$/;
// Exactly three digits after the separator may be a thousands group ("1.234"
// typed as 1234 euro): ambiguous, so the value stays as entered.
const AMBIGUOUS_GROUP_PATTERN = /^-?\d{1,3}[.,]\d{3}$/;

/**
 * Returns a locale Intl accepts, German when the locale is empty or invalid.
 */
export function normalizeFormatterLocale(locale: unknown): string {
    if (typeof locale !== 'string' || !locale.trim()) return FALLBACK_FORMATTER_LOCALE;
    try {
        return Intl.DateTimeFormat.supportedLocalesOf([locale.trim()]).length > 0
            ? locale.trim()
            : FALLBACK_FORMATTER_LOCALE;
    } catch {
        return FALLBACK_FORMATTER_LOCALE;
    }
}

/**
 * Formats an ISO calendar date (YYYY-MM-DD) in the locale.
 *
 * The date is read and printed in UTC, so a browser west of UTC does not
 * show the previous day. Returns null for anything that is not a real date.
 */
export function formatIsoDate(value: string, locale?: string, addDays = 0): string | null {
    const match = ISO_DATE_PATTERN.exec(value.trim());
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
        return null;
    }
    date.setUTCDate(date.getUTCDate() + addDays);
    return new Intl.DateTimeFormat(normalizeFormatterLocale(locale), {
        ...numericDate,
        timeZone: 'UTC'
    }).format(date);
}

function parsePlainNumber(value: unknown): number | null {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!PLAIN_NUMBER_PATTERN.test(trimmed) || AMBIGUOUS_GROUP_PATTERN.test(trimmed)) return null;
    const parsed = Number(trimmed.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
}

function fractionDigitsForStep(step: number | undefined): number {
    if (typeof step !== 'number' || !Number.isFinite(step) || step <= 0) return 2;
    const [, decimals = ''] = String(step).split('.');
    if (!decimals) return 2;
    return Math.min(decimals.length, 20);
}

/**
 * Formats a submitted application value with the field's schema facts.
 *
 * - Date fields (or, without a type, an ISO string YYYY-MM-DD): localized
 *   calendar date without a day shift. Impossible dates stay raw.
 * - Currency format: euro amount in the locale ("3.180,00 €").
 * - Number fields: locale decimal separator; grouping only from five digits
 *   on, so a year such as 1985 stays "1985".
 * - Numbers are only formatted when the schema says so: an untyped "12345"
 *   may be a postal code and stays as entered.
 * - Everything else (booleans, lists, addresses, text) as `formatValue`.
 */
export function formatFieldValue(value: unknown, options: FieldValueFormatOptions = {}): string {
    if (options.perEntry && Array.isArray(value)) {
        if (value.length === 0) return '-';
        return value.map(entry => formatFieldValue(entry, { ...options, perEntry: false })).join(', ');
    }
    const locale = normalizeFormatterLocale(options.locale);
    const booleanLabels = options.booleanLabels ?? DEFAULT_BOOLEAN_LABELS;

    if (typeof value === 'string' && (options.type === 'date' || !options.type)) {
        const date = formatIsoDate(value, locale);
        if (date) return date;
    }

    if (options.format === 'currency' || options.type === 'number') {
        const amount = parsePlainNumber(value);
        if (amount !== null) {
            if (options.format === 'currency') {
                return new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' }).format(amount);
            }
            return new Intl.NumberFormat(locale, {
                maximumFractionDigits: fractionDigitsForStep(options.step),
                useGrouping: 'min2'
            }).format(amount);
        }
    }

    return formatValue(value, booleanLabels);
}

/**
 * Safely parse a JSON string, returning an empty object on failure.
 */
export function safeJsonParse(value: string | undefined | null): Record<string, unknown> {
    if (!value) return {};
    try {
        return JSON.parse(value) as Record<string, unknown>;
    } catch {
        return {};
    }
}

/**
 * Convert snake_case/camelCase field keys to readable labels.
 */
export function formatFieldLabel(key: string): string {
    return key
        .replace(/([A-Z])/g, ' $1')
        .replace(/[_-]/g, ' ')
        .replace(/^\w/, c => c.toUpperCase())
        .trim();
}
