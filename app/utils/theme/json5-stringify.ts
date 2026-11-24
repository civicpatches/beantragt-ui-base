/**
 * The one piece of `json5` the theme engine uses (`engine/serialize.ts`, `toObjectSource`): `stringify(value,
 * { space, quote })`, printing a config object as JavaScript object-literal source for `app.config.ts`.
 *
 * `json5` is in the lockfile only as a transitive dependency and does not resolve from `app/`; instead of adding
 * a dependency, `serialize.ts` imports this (its only changed line). Same output shape as json5 2.x pretty
 * printing: keys that are identifiers stay bare, other keys and all strings use the given quote, objects and
 * arrays print one entry per line with a trailing comma (serialize.ts trims those), empty ones as `{}` and `[]`.
 * `undefined` and functions are left out of objects and become `null` in arrays, as in JSON.
 */
interface StringifyOptions {
    space?: number | string
    quote?: string
}

const IDENTIFIER = /^[$A-Z_a-z][$\w]*$/u;
const ESCAPES: Record<string, string> = {
    '\\': '\\\\',
    '\b': '\\b',
    '\f': '\\f',
    '\n': '\\n',
    '\r': '\\r',
    '\t': '\\t',
    '\v': '\\v',
    '\0': '\\0',
    ' ': '\\u2028',
    ' ': '\\u2029'
};

function quoteString(value: string, quote: string): string {
    let result = '';
    for (const char of value) {
        if (char === quote) result += `\\${quote}`;
        else if (ESCAPES[char] !== undefined) result += ESCAPES[char];
        else if (char < ' ') result += `\\x${char.charCodeAt(0).toString(16).padStart(2, '0')}`;
        else result += char;
    }
    return `${quote}${result}${quote}`;
}

function serialize(value: unknown, indent: string, gap: string, quote: string): string | undefined {
    if (value === null) return 'null';
    if (typeof value === 'boolean') return String(value);
    if (typeof value === 'number') return String(value);
    if (typeof value === 'string') return quoteString(value, quote);
    if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return undefined;
    if (typeof (value as { toJSON?: unknown }).toJSON === 'function') return serialize((value as { toJSON: () => unknown }).toJSON(), indent, gap, quote);
    const inner = indent + gap;
    if (Array.isArray(value)) {
        if (!value.length) return '[]';
        const items = value.map(item => serialize(item, inner, gap, quote) ?? 'null');
        return gap ? `[\n${inner}${items.join(`,\n${inner}`)},\n${indent}]` : `[${items.join(',')}]`;
    }
    const entries: string[] = [];
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        const printed = serialize(item, inner, gap, quote);
        if (printed === undefined) continue;
        entries.push(`${IDENTIFIER.test(key) ? key : quoteString(key, quote)}:${gap ? ' ' : ''}${printed}`);
    }
    if (!entries.length) return '{}';
    return gap ? `{\n${inner}${entries.join(`,\n${inner}`)},\n${indent}}` : `{${entries.join(',')}}`;
}

export function stringify(value: unknown, options: StringifyOptions = {}): string {
    const gap = typeof options.space === 'number' ? ' '.repeat(Math.min(10, Math.max(0, options.space))) : (options.space ?? '').slice(0, 10);
    return serialize(value, '', gap, options.quote ?? '"') ?? 'undefined';
}

export default { stringify };
