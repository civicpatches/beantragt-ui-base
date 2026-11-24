import { isIP } from 'node:net';
import { validationPatternRefusal } from '../../app/utils/form-schema';

/** A published default is a field value, never an arbitrary schema property. */
export function publicFieldDefault(field: Record<string, unknown>, value: unknown): string | number | boolean | undefined {
    const type = field.type;
    const validation = field.validation && typeof field.validation === 'object' && !Array.isArray(field.validation)
        ? field.validation as Record<string, unknown>
        : {};
    const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
    if (type === 'checkbox') {
        return (!Array.isArray(field.options) || !field.options.length) && typeof value === 'boolean' ? value : undefined;
    }
    if (type === 'number') {
        if (typeof value !== 'number' && typeof value !== 'string') return undefined;
        let number: number;
        let integer = false;
        if (typeof value === 'number') {
            if (Number.isInteger(value) && !Number.isSafeInteger(value)) return undefined;
            number = value;
            integer = Number.isInteger(value);
        } else {
            if (value.length > 10000) return undefined;
            const text = phpTrim(value);
            if (text.length > 10000 || !/^[+-]?(?:[0-9]+(?:[.,][0-9]*)?|[.,][0-9]+)(?:[eE][+-]?[0-9]+)?$/u.test(text)) return undefined;
            const group = /^[+-]?([0-9]{1,3})[.,][0-9]{3}$/u.exec(text);
            if (group && group[1]!.replace(/0/gu, '')) return undefined;
            number = Number(text.replace(',', '.'));
            const [mantissa, exponent = '0'] = text.replace(',', '.').split(/[eE]/u);
            const digits = mantissa!.replace(/[.+-]/gu, '');
            if (number === 0 && digits.replace(/0/gu, '')) return undefined;
            const scale = (mantissa!.split('.')[1]?.length ?? 0) - Number(exponent);
            integer = scale <= 0 || !digits.slice(-Math.min(scale, digits.length)).replace(/0/gu, '');
        }
        if (!Number.isFinite(number)) return undefined;
        const min = finite(validation.min) ? validation.min : field.format === 'currency' ? 0 : undefined;
        if (min !== undefined && number < min) return undefined;
        if (finite(validation.max) && number > validation.max) return undefined;
        const step = validation.step;
        const base = validation.min ?? 0;
        if (finite(step) && step > 0 && Number.isInteger(step) && finite(base) && Number.isInteger(base) && !integer) return undefined;
        const effectiveStep = finite(step) ? step : field.format === 'currency' ? 0.01 : undefined;
        if (effectiveStep !== undefined && effectiveStep > 0) {
            const remainder = Math.abs((number - (finite(validation.min) ? validation.min : 0)) / effectiveStep);
            if (!Number.isFinite(remainder) || Math.abs(remainder - Math.round(remainder)) > 0.0000001) return undefined;
        }
        return value;
    }
    if (!['text', 'textarea', 'email', 'tel', 'date', 'select', 'radio'].includes(String(type)) || typeof value !== 'string' || value.length > 40000) return undefined;
    if (Array.from(value).length > 10000) return undefined;
    const trimmed = phpTrim(value);
    // PHP PCRE Unicode whitespace includes NEL, but not a BOM.
    // eslint-disable-next-line no-control-regex
    if (field.required === true && /^[\p{Z}\x09-\x0d\x85]*$/u.test(value)) return undefined;
    const length = Array.from(trimmed).length;
    if (trimmed && !validFormat(field, trimmed)) return undefined;
    if (trimmed && typeof validation.pattern === 'string' && phpTrim(validation.pattern) && (validationPatternRefusal(validation.pattern) !== null || !new RegExp(validation.pattern, 'u').test(trimmed))) return undefined;
    if (length > 10000) return undefined;
    if (finite(validation.minLength) && length < validation.minLength) return undefined;
    if (finite(validation.maxLength) && length > validation.maxLength) return undefined;
    if ((type === 'select' || type === 'radio') && (!Array.isArray(field.options) || !field.options.includes(value))) return undefined;
    if (type === 'date') {
        if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u.test(value) || Number(value.slice(0, 4)) < 1) return undefined;
        const date = new Date(`${value}T00:00:00Z`);
        if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return undefined;
    }
    return value;
}

/** Keep built-in formats aligned with PublicApplicationSubmissionValidator. */
function validFormat(field: Record<string, unknown>, value: string): boolean {
    if (field.type === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value);
    if (field.type === 'tel') return /^[+0-9()\-/\s]{6,20}$/u.test(value);
    switch (field.format) {
        case 'postal_code': return /^[0-9]{5}$/u.test(value);
        case 'iban': return /^[A-Za-z]{2}[0-9]{2}[A-Za-z0-9 ]{11,30}$/u.test(value);
        case 'bic': return /^[A-Za-z]{6}[A-Za-z0-9]{2}([A-Za-z0-9]{3})?$/u.test(value);
        case 'tax_id': return /^[0-9]{11}$/u.test(value);
        case 'url': return validPhpHttpUrl(value);
        default: return true;
    }
}

/** PHP trim() removes only these six ASCII characters, not Unicode spaces. */
function phpTrim(value: string): string {
    // These control characters are exactly PHP's trim() character list.
    // eslint-disable-next-line no-control-regex
    return value.replace(/^[\x00\x09\x0a\x0b\x0d\x20]+|[\x00\x09\x0a\x0b\x0d\x20]+$/gu, '');
}

/** Validate the original URL without WHATWG URL's host/port normalization. */
function validPhpHttpUrl(value: string): boolean {
    if (!/^[\x21-\x7e]+$/u.test(value)) return false;
    const match = /^https?:\/\/([^/?#]*)(?:[/?#].*)?$/u.exec(value);
    if (!match) return false;
    let authority = match[1]!;
    const credentials = authority.split('@');
    if (credentials.length > 2) return false;
    if (credentials.length === 2) {
        if (!/^[a-zA-Z0-9._~!$&'()*+,;=:%-]*$/u.test(credentials[0]!)) return false;
        authority = credentials[1]!;
    }
    const hostPort = /^(\[[^\]]+\]|[^:]*)(?::([0-9]*))?$/u.exec(authority);
    if (!hostPort || (hostPort[2] && Number(hostPort[2]) > 65535)) return false;
    const host = hostPort[1]!;
    if (host.startsWith('[')) return isIP(host.slice(1, -1)) === 6;
    const domain = host.replace(/\.$/u, '');
    if (!domain || domain.length > 253) return false;
    const labels = domain.split('.');
    return labels.every(label => /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/u.test(label));
}
