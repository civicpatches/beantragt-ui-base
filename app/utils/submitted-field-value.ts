import { formatFieldValue, type BooleanLabels } from '~/composables/useFormatters';

/**
 * Citizen-readable submitted value for the application detail page.
 *
 * File fields arrive as [{ filename, attachmentId }] and show their file
 * names, ISO dates (YYYY-MM-DD) use the UI locale, booleans the yes/no labels.
 * The citizen API sends no field types, so numbers stay as entered: an
 * untyped "12345" may be a postal code.
 */
export function formatSubmittedFieldValue(value: unknown, locale: string, booleanLabels: BooleanLabels): string {
    if (Array.isArray(value)) {
        const items = value.map(item => item && typeof item === 'object' && typeof (item as { filename?: unknown }).filename === 'string'
            ? (item as { filename: string }).filename
            : formatSubmittedFieldValue(item, locale, booleanLabels));
        return items.filter(item => item !== '' && item !== '-').join(', ') || '-';
    }
    return formatFieldValue(value, { locale, booleanLabels });
}
