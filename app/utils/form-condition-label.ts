import type { FormField } from '../types/form';
import { getLocalizedFormFieldOptionLabel } from './form-schema';

/**
 * A condition stores the option value. Select, radio and checkbox
 * options may carry a localized display label in `i18n`. A value that is not
 * one of the source's options is shown as stored.
 */
export function conditionAnswerLabel(source: FormField | null | undefined, value: string, locale: string): string {
    const options = source?.options ?? [];
    const index = options.indexOf(value);
    if (!source || index === -1) return value;
    return getLocalizedFormFieldOptionLabel(source, value, index, locale);
}
