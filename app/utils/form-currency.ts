import type { FormField, FormFieldValidation, FormSchema } from '../types/form';

const GROUPED_AMOUNT = /^[+-]?[1-9]\d{0,2}(?:\.\d{3})+,\d+$/u;
const PLAIN_AMOUNT = /^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:e[+-]?\d+)?$/iu;
const AMBIGUOUS_AMOUNT = /^[+-]?(?!0+[.,])\d{1,3}[.,]\d{3}$/u;
const ZERO = BigInt(0);
const TEN = BigInt(10);

export function isCurrencyField(field: Pick<FormField, 'type' | 'format'>): boolean {
    return field.type === 'number' && field.format === 'currency';
}

/** Keep the digits and decimal places that Drupal stores. A lone separator can be ambiguous. */
export function canonicalCurrencyAmount(value: unknown): string | number | null {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string' || value.length > 50000) return null;

    const trimmed = value.trim();
    const amount = trimmed.endsWith('€') ? trimmed.slice(0, -1).trimEnd() : trimmed;
    const grouped = GROUPED_AMOUNT.test(amount);
    if (!grouped && (!PLAIN_AMOUNT.test(amount) || AMBIGUOUS_AMOUNT.test(amount))) return null;

    const canonical = (grouped ? amount.replaceAll('.', '') : amount).replace(',', '.');
    const numeric = Number(canonical);
    const [mantissa = ''] = canonical.split(/e/iu);
    if (!Number.isFinite(numeric) || (numeric === 0 && /[1-9]/u.test(mantissa))) return null;
    return canonical;
}

export function withCanonicalCurrencyAmounts(schema: FormSchema, data: Record<string, unknown>): Record<string, unknown> {
    let normalized: Record<string, unknown> | undefined;
    for (const section of schema.sections) {
        for (const field of section.fields) {
            if (!isCurrencyField(field)) continue;
            const value = data[field.id];
            const canonical = canonicalCurrencyAmount(value);
            if (canonical === null || canonical === value) continue;
            normalized ??= { ...data };
            normalized[field.id] = canonical;
        }
    }
    return normalized ?? data;
}

function decimalParts(value: string | number): { coefficient: bigint, scale: number } {
    const [mantissa = '', exponent = '0'] = String(value).split(/e/iu);
    const [, fraction = ''] = mantissa.split('.');
    const coefficient = BigInt(mantissa.replace('.', ''));
    return { coefficient, scale: coefficient === ZERO ? 0 : fraction.length - Number(exponent) };
}

/** Compare in the same exact decimal units, including the offset from the declared minimum. */
export function currencyConstraintIssues(amount: string | number, { min = 0, max, step = 0.01 }: FormFieldValidation) {
    const value = decimalParts(amount);
    const minimum = decimalParts(min);
    const maximum = max === undefined ? null : decimalParts(max);
    const increment = step > 0 ? decimalParts(step) : null;
    const scale = Math.max(value.scale, minimum.scale, maximum?.scale ?? 0, increment?.scale ?? 0);
    const units = (decimal: ReturnType<typeof decimalParts>) => decimal.coefficient * TEN ** BigInt(scale - decimal.scale);
    const actual = units(value);
    const base = units(minimum);
    const issues: Array<{ code: 'min' | 'max' | 'step', value: number }> = [];
    if (actual < base) issues.push({ code: 'min', value: min });
    if (maximum && max !== undefined && actual > units(maximum)) issues.push({ code: 'max', value: max });
    if (increment && (actual - base) % units(increment) !== ZERO) issues.push({ code: 'step', value: step });
    return issues;
}
