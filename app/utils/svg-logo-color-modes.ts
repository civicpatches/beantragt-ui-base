/**
 * Light and dark form of an uploaded SVG logo that brings its own dark styling
 * (`@media (prefers-color-scheme: dark)` in its `<style>`), so the interface can
 * follow the app's colour mode instead of the browser's mapping of an image's
 * `color-scheme` to the SVG's media query (verified in Chrome only).
 *
 * Input is the jurisdiction's `theme.logoDataUrl` (a base64 data URL the
 * backend validated, `JurisdictionConfigValidator::validateLogoDataUrl`) or an
 * upload on the branding page that is not saved yet. Nothing is fetched.
 *
 * Output: `{ light, dark }`, two data URLs, or `null` when the logo has no dark
 * styling or anything is unexpected; the caller then keeps the white plate.
 * - dark: every exact `@media (prefers-color-scheme: dark) { X }` block is
 *   replaced by `X` at the same place (the cascade the browser would compute
 *   with the query matching), every exact `(prefers-color-scheme: light)` block
 *   is removed.
 * - light: the mirror (light blocks unwrapped, dark blocks removed), so the light
 *   picture never turns dark on a dark operating system in a light app.
 * Base rules that a dark block overrides stay in place and lose by source order,
 * exactly as in the browser; no selector is matched or deleted.
 *
 * Security invariants (the text comes from an upload):
 * 1. The result is only ever an `<img src>`: scripts in an SVG image never run.
 *    It is never inlined into the DOM and never passed to `v-html`. Every caller
 *    falls back to the original logo on its plate when a derived picture does
 *    not load.
 * 2. The length is checked before any regular expression or decoding; UTF-8 is
 *    decoded with a fatal decoder (a byte-order mark is kept).
 * 3. A `<style>` element (case-sensitive, as XML) ends at the first `</style`
 *    (the XML way, not the CSS way). Its text must not contain `<`, `&` or `\`
 *    (so no CDATA, no entity, no CSS escape), and the CSS scan must end outside
 *    every string, comment and brace. A `<!DOCTYPE` with an internal subset is
 *    not read. Otherwise: give up.
 * 4. Everything outside the `<style>` texts is copied byte for byte; inside, the
 *    rewrite only removes characters (an at-rule's head and its two braces, or
 *    a whole block). Nothing is added. A colour-scheme block must end in `}`
 *    (or be empty), so at every seam a `;`, `}` or the start of the style stands
 *    on the left and a whole rule on the right: no token forms across a seam.
 *    A rewritten style that contains `]]>` is refused.
 * 5. The output is the fixed prefix `data:image/svg+xml;base64,` plus the
 *    base64 of the rewritten text.
 * 6. Time is linear in the length of the logo and bounded: the stylesheets of
 *    one logo may hold at most `MAX_STYLE_CHARS` characters and
 *    `MAX_STYLE_BLOCKS` blocks, and the scan gives up after `MAX_SCAN_STEPS`
 *    steps. A logo beyond any bound keeps the plate.
 * Anything else that mentions `prefers-color-scheme` (combined queries, `not`,
 * comma lists, nesting in another at-rule, a `media` attribute on `<style>`),
 * an `@import`, or a parse that does not close: give up.
 */

const DATA_URL_PREFIX = 'data:image/svg+xml;base64,';
/** Same bounds as the backend validator (`MAX_LOGO_DATA_URL_LENGTH`, `MAX_LOGO_BYTES`). */
const MAX_DATA_URL_LENGTH = 700_000;
const MAX_SVG_BYTES = 512_000;
/** All `<style>` texts of one logo together; a drawn logo needs a few hundred characters. */
const MAX_STYLE_CHARS = 32_000;
/** All top-level blocks (rules and at-rules) of one logo together. */
const MAX_STYLE_BLOCKS = 1_000;
/** Hard ceiling of loop steps for one logo (markup scan plus style scan). */
const MAX_SCAN_STEPS = 2_000_000;
const BASE64_BODY = /^[A-Za-z0-9+/]+={0,2}$/u;
const MAX_CACHE_ENTRIES = 8;

export interface SvgLogoColorModes {
    light: string
    dark: string
}

type Scheme = 'dark' | 'light';

/** A top-level piece of a stylesheet: kept text, or a colour-scheme block. */
type CssPiece
    = | { kind: 'text', text: string }
      | { kind: 'scheme', scheme: Scheme, body: string };

class GiveUp extends Error {}

function giveUp(): never {
    throw new GiveUp();
}

/** Steps of the current scan. Read by the tests through `svgLogoScanSteps()`. */
let steps = 0;
let blocks = 0;

function step(count = 1): void {
    steps += count;
    if (steps > MAX_SCAN_STEPS) giveUp();
}

/** Loop steps of the last derivation that was not answered from the cache (tests). */
export function svgLogoScanSteps(): number {
    return steps;
}

const cache = new Map<string, SvgLogoColorModes | null>();

export function svgLogoColorModes(dataUrl: string | null | undefined): SvgLogoColorModes | null {
    if (typeof dataUrl !== 'string' || dataUrl.length > MAX_DATA_URL_LENGTH || !dataUrl.startsWith(DATA_URL_PREFIX)) {
        return null;
    }
    if (cache.has(dataUrl)) return cache.get(dataUrl) ?? null;

    let result: SvgLogoColorModes | null = null;
    steps = 0;
    blocks = 0;
    try {
        result = derive(dataUrl);
    } catch {
        result = null;
    }
    if (cache.size >= MAX_CACHE_ENTRIES) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(dataUrl, result);
    return result;
}

function derive(dataUrl: string): SvgLogoColorModes | null {
    const body = dataUrl.slice(DATA_URL_PREFIX.length);
    if (!BASE64_BODY.test(body)) return null;
    const svg = decodeUtf8(base64ToBytes(body));
    if (svg === null) return null;

    const styles = findStyleElements(svg);
    if (!styles.length) return null;
    if (styles.reduce((sum, style) => sum + style.end - style.start, 0) > MAX_STYLE_CHARS) return null;

    const parsed = styles.map(style => ({ ...style, pieces: parseStylesheet(svg.slice(style.start, style.end)) }));
    if (!parsed.some(style => style.pieces.some(piece => piece.kind === 'scheme' && piece.scheme === 'dark'))) {
        return null;
    }

    return {
        light: encode(rebuild(svg, parsed, 'light')),
        dark: encode(rebuild(svg, parsed, 'dark'))
    };
}

function base64ToBytes(body: string): Uint8Array {
    const binary = atob(body);
    if (binary.length > MAX_SVG_BYTES) giveUp();
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

function decodeUtf8(bytes: Uint8Array): string | null {
    try {
        // ignoreBOM: a byte-order mark stays in the text, so the copy is exact.
        return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
        return null;
    }
}

function encode(svg: string): string {
    const bytes = new TextEncoder().encode(svg);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return `${DATA_URL_PREFIX}${btoa(binary)}`;
}

interface StyleText { start: number, end: number }

/**
 * Text ranges of every `<style>` element, scanning the markup: comments,
 * CDATA sections and processing instructions outside a style element are
 * skipped whole, so a `<style` inside them is not taken for an element.
 * Element names are case-sensitive (XML): `<STYLE>` is no style element.
 */
function findStyleElements(svg: string): StyleText[] {
    const found: StyleText[] = [];
    let i = 0;
    while (i < svg.length) {
        step();
        const lt = svg.indexOf('<', i);
        if (lt === -1) break;
        if (svg.startsWith('<!--', lt)) {
            const close = svg.indexOf('-->', lt + 4);
            if (close === -1) giveUp();
            i = close + 3;
            continue;
        }
        if (svg.startsWith('<![CDATA[', lt)) {
            const close = svg.indexOf(']]>', lt + 9);
            if (close === -1) giveUp();
            i = close + 3;
            continue;
        }
        if (svg.startsWith('<?', lt)) {
            const close = svg.indexOf('?>', lt + 2);
            if (close === -1) giveUp();
            i = close + 2;
            continue;
        }
        if (svg.startsWith('<!DOCTYPE', lt)) {
            const close = svg.indexOf('>', lt);
            // An internal subset can declare entities that hold markup: not read.
            if (close === -1 || svg.slice(lt, close).includes('[')) giveUp();
            i = close + 1;
            continue;
        }
        if (svg.startsWith('<style', lt) && /[\s>/]/u.test(svg[lt + 6] ?? '')) {
            const tagEnd = openingTagEnd(svg, lt + 6);
            const attributes = svg.slice(lt + 6, tagEnd);
            // A style element for one colour scheme only: not this parser's shape.
            if (/(?:^|\s)media\s*=/iu.test(attributes)) giveUp();
            if (svg[tagEnd - 1] === '/') {
                i = tagEnd + 1;
                continue;
            }
            const close = svg.indexOf('</style', tagEnd + 1);
            if (close === -1) giveUp();
            found.push({ start: tagEnd + 1, end: close });
            i = close + 7;
            continue;
        }
        i = lt + 1;
    }
    return found;
}

/** Index of the `>` that ends an opening tag, outside quoted attribute values. */
function openingTagEnd(svg: string, from: number): number {
    let quote: string | null = null;
    for (let i = from; i < svg.length; i++) {
        step();
        const char = svg[i]!;
        if (quote) {
            if (char === quote) quote = null;
        } else if (char === '"' || char === '\'') {
            quote = char;
        } else if (char === '<') {
            giveUp();
        } else if (char === '>') {
            return i;
        }
    }
    return giveUp();
}

/**
 * Splits a stylesheet into top-level pieces in ONE pass: the start of the next
 * block's prelude (after the last top-level `;` or closed block) is carried in
 * the loop. Only the shape of the text is read (strings, comments, braces);
 * declarations are copied as they are.
 */
function parseStylesheet(css: string): CssPiece[] {
    if (/[<&\\]/u.test(css)) giveUp();
    if (/@import/iu.test(css)) giveUp();

    const pieces: CssPiece[] = [];
    let textStart = 0;
    let boundary = 0;
    let i = 0;
    while (i < css.length) {
        step();
        const char = css[i]!;
        if (char === '/' && css[i + 1] === '*') {
            i = skipComment(css, i);
            continue;
        }
        if (char === '"' || char === '\'') {
            i = skipString(css, i);
            continue;
        }
        if (char === '}') giveUp();
        if (char === ';') {
            boundary = i + 1;
            i++;
            continue;
        }
        if (char === '{') {
            blocks++;
            if (blocks > MAX_STYLE_BLOCKS) giveUp();
            const preludeStart = boundary;
            const prelude = css.slice(preludeStart, i);
            const blockEnd = matchingBrace(css, i);
            const scheme = schemeOf(prelude);
            const blockBody = css.slice(i + 1, blockEnd);
            if (scheme) {
                const bodyWithoutComments = stripComments(blockBody);
                if (/prefers-color-scheme/iu.test(bodyWithoutComments)) giveUp();
                if (/@/u.test(bodyWithoutComments)) giveUp();
                // The body must end a rule, so nothing joins across the seam it leaves.
                // CSS white space only: U+00A0 or U+FEFF after the last `}` would stand at the seam.
                const trimmed = bodyWithoutComments.replace(/^[ \t\n\r\f]+|[ \t\n\r\f]+$/gu, '');
                if (trimmed !== '' && !trimmed.endsWith('}')) giveUp();
                pieces.push({ kind: 'text', text: css.slice(textStart, preludeStart) });
                pieces.push({ kind: 'scheme', scheme, body: blockBody });
                textStart = blockEnd + 1;
            }
            // Every other block stays text and is checked below with the rest of the text.
            i = blockEnd + 1;
            boundary = i;
            continue;
        }
        i++;
    }
    pieces.push({ kind: 'text', text: css.slice(textStart) });
    // The one check for every mention outside an exact block: a combined query, `not`, a comma list,
    // nesting in another at-rule, a selector, a statement. Every block that is not an exact scheme
    // block is part of a text piece, so nothing escapes it.
    if (pieces.some(piece => piece.kind === 'text' && /prefers-color-scheme/iu.test(piece.text))) giveUp();
    return pieces;
}

function matchingBrace(css: string, open: number): number {
    let depth = 0;
    let i = open;
    while (i < css.length) {
        step();
        const char = css[i]!;
        if (char === '/' && css[i + 1] === '*') {
            i = skipComment(css, i);
            continue;
        }
        if (char === '"' || char === '\'') {
            i = skipString(css, i);
            continue;
        }
        if (char === '{') depth++;
        if (char === '}') {
            depth--;
            if (depth === 0) return i;
        }
        i++;
    }
    return giveUp();
}

function skipComment(css: string, at: number): number {
    const close = css.indexOf('*/', at + 2);
    if (close === -1) giveUp();
    step(close - at);
    return close + 2;
}

function skipString(css: string, at: number): number {
    const quote = css[at];
    for (let i = at + 1; i < css.length; i++) {
        step();
        const char = css[i];
        if (char === '\n' || char === '\r') giveUp();
        if (char === quote) return i + 1;
    }
    return giveUp();
}

function stripComments(css: string): string {
    let out = '';
    let i = 0;
    while (i < css.length) {
        step();
        if (css[i] === '/' && css[i + 1] === '*') {
            i = skipComment(css, i);
            continue;
        }
        out += css[i];
        i++;
    }
    return out;
}

const SCHEME_PRELUDES = new Map<string, Scheme>([
    ['@media(prefers-color-scheme:dark)', 'dark'],
    ['@mediascreenand(prefers-color-scheme:dark)', 'dark'],
    ['@mediaalland(prefers-color-scheme:dark)', 'dark'],
    ['@media(prefers-color-scheme:light)', 'light'],
    ['@mediascreenand(prefers-color-scheme:light)', 'light'],
    ['@mediaalland(prefers-color-scheme:light)', 'light']
]);

/** The colour scheme of an exact `@media` prelude, or null for every other prelude (also `constructor`). */
function schemeOf(prelude: string): Scheme | null {
    const compact = stripComments(prelude).replace(/\s+/gu, '').toLowerCase();
    return SCHEME_PRELUDES.get(compact) ?? null;
}

function rebuild(svg: string, styles: Array<StyleText & { pieces: CssPiece[] }>, mode: Scheme): string {
    let out = '';
    let cursor = 0;
    for (const style of styles) {
        out += svg.slice(cursor, style.start);
        let css = '';
        for (const piece of style.pieces) {
            if (piece.kind === 'text') css += piece.text;
            else if (piece.scheme === mode) css += piece.body;
        }
        // Not allowed in XML character data; a seam must never produce it.
        if (css.includes(']]>')) giveUp();
        out += css;
        cursor = style.end;
    }
    return out + svg.slice(cursor);
}
