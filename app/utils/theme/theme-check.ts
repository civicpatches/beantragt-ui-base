/**
 * The contrast check of a theme document: resolves the semantic tokens a theme
 * sets in light and dark to sRGB and measures the pairs of the contrast rule (WCAG AA). Token resolution and the
 * contrast formula are the product's own (`product-theme.ts`, `primary-rule.ts`), so the check measures exactly what
 * the primary rule decides on. The build runs it on the installation's theme (`installation-theme.ts`); the gate
 * test (`tests/unit/theme/theme-presets.test.ts`) runs it on every preset.
 */
import { generateConfig } from './engine/serialize';
import type { ThemeDoc } from './engine/types';
import { resolveColor, themeTokens, toHex, toProductTheme, type Mode } from './product-theme';
import { contrastRatio } from './primary-rule';
import { evaluateThemeConfig } from './theme-output';

/** The pairs of the contrast rule: foreground token, background token, threshold. */
export const CONTRAST_PAIRS = [
    { id: 'text', label: 'text on background', fg: '--ui-text', bg: '--ui-bg', min: 4.5 },
    { id: 'muted', label: 'muted text on background', fg: '--ui-text-muted', bg: '--ui-bg', min: 4.5 },
    { id: 'label', label: 'primary button label on primary', fg: '--ui-text-inverted', bg: '--ui-primary', min: 4.5 },
    // The focus ring of fields (`focus-visible:ring-primary`, .nuxt/ui/input.ts). Buttons draw a translucent
    // `outline-primary/25` or `outline-inverted/25`, which depends on what lies under it and is not measured here.
    { id: 'focus', label: 'field focus ring (primary) on background', fg: '--ui-primary', bg: '--ui-bg', min: 3 },
    // State colours as text on the page (form errors, notices, badges): the app shows them as text, so they need
    // 4.5:1 like body text. Measured, not adjusted: a theme that fails one is not offered (lead's decision, 13.11.:
    // no second product rule; the owner decides on a floor separately).
    { id: 'error', label: 'error text on background', fg: '--ui-error', bg: '--ui-bg', min: 4.5 },
    { id: 'success', label: 'success text on background', fg: '--ui-success', bg: '--ui-bg', min: 4.5 },
    { id: 'warning', label: 'warning text on background', fg: '--ui-warning', bg: '--ui-bg', min: 4.5 },
    { id: 'info', label: 'info text on background', fg: '--ui-info', bg: '--ui-bg', min: 4.5 }
] as const;

export interface PairResult { pair: string, mode: Mode, ratio: number | null, min: number, pass: boolean }

/** Every pair in both modes. `overrides` stand for CSS the app adds on top of the theme (the primary plugin). */
export function measureTheme(doc: ThemeDoc, overrides: Partial<Record<Mode, Record<string, string>>> = {}): PairResult[] {
    const results: PairResult[] = [];
    for (const mode of ['light', 'dark'] as const) {
        const extra = overrides[mode] ?? {};
        const tokens = { ...themeTokens(doc, mode), ...Object.fromEntries(Object.entries(extra).filter(([key]) => !key.startsWith('--ui-color-'))) };
        for (const pair of CONTRAST_PAIRS) {
            const fg = resolveColor(doc, tokens[pair.fg] ?? '', tokens, extra);
            const bg = resolveColor(doc, tokens[pair.bg] ?? '', tokens, extra);
            const ratio = fg && bg ? contrastRatio(toHex(fg), toHex(bg)) : null;
            results.push({ pair: pair.id, mode, ratio, min: pair.min, pass: ratio !== null && ratio >= pair.min });
        }
    }
    return results;
}

/** The failing pairs of a theme as rendered with the product rules, in words (empty when it passes). */
export function contrastFailures(results: PairResult[]): string[] {
    return results.filter(result => !result.pass).map((result) => {
        const label = CONTRAST_PAIRS.find(pair => pair.id === result.pair)!.label;
        const ratio = result.ratio === null ? 'cannot be resolved' : `reaches ${result.ratio.toFixed(2)}:1`;
        return `${label} ${ratio} in ${result.mode} mode (needs ${result.min}:1)`;
    });
}

/**
 * What the default text field draws as its boundary, per input variant of @nuxt/ui 4.11.3 (`.nuxt/ui/input.ts`
 * `variants.variant`, pinned by `tests/unit/theme/field-boundary.test.ts`): an inset ring in `ring-accented`, which
 * `main.css` remaps to `--ui-border-control` inside form controls, and a fill.
 */
export const INPUT_VARIANT_EDGE: Record<string, { ring: boolean, fill: { token: string, alpha: number } | null }> = {
    outline: { ring: true, fill: { token: '--ui-bg', alpha: 1 } },
    soft: { ring: false, fill: { token: '--ui-bg-elevated', alpha: 0.5 } },
    subtle: { ring: true, fill: { token: '--ui-bg-elevated', alpha: 1 } },
    ghost: { ring: false, fill: null },
    none: { ring: false, fill: null }
};

/** The 3:1 of WCAG 1.4.11 for the boundary of a control against what is next to it. */
export const MIN_FIELD_BOUNDARY = 3;

export interface FieldBoundary {
    mode: Mode
    /** The input variant the theme makes the default (`outline` unless its style says otherwise). */
    variant: string
    /** Ring against the page, or null when the variant draws none. */
    ring: number | null
    /** Fill against the page, or null when the variant has no fill of its own. */
    fill: number | null
    /** The stronger of the two edges: what tells the field from the page. */
    ratio: number
    pass: boolean
}

/**
 * The boundary of a text field with the theme's default input variant against the page, per mode (WCAG 1.4.11).
 * Part of the offer since the lead's decision of 13.11. (T5: a theme that fails is not offered; no product rule).
 * Measured on the document as rendered (`toProductTheme`), so the product's `--ui-border-control` is in it.
 */
export function measureFieldBoundary(doc: ThemeDoc): FieldBoundary[] {
    const product = toProductTheme(doc);
    const config = evaluateThemeConfig(generateConfig(product));
    const input = (config.ui?.input as { defaultVariants?: { variant?: string } } | undefined)?.defaultVariants?.variant ?? 'outline';
    const edge = INPUT_VARIANT_EDGE[input] ?? { ring: false, fill: null };
    return (['light', 'dark'] as const).map((mode) => {
        const tokens = themeTokens(product, mode);
        const hex = (token: string) => {
            const rgb = resolveColor(product, tokens[token] ?? '', tokens);
            return rgb ? toHex(rgb) : undefined;
        };
        const page = hex('--ui-bg')!;
        const ringHex = edge.ring ? hex('--ui-border-control') : undefined;
        const fillHex = edge.fill ? hex(edge.fill.token) : undefined;
        const ring = ringHex ? contrastRatio(ringHex, page) : null;
        const fill = fillHex && edge.fill ? contrastRatio(mixHex(fillHex, page, edge.fill.alpha), page) : null;
        const ratio = Math.max(ring ?? 1, fill ?? 1);
        return { mode, variant: input, ring, fill, ratio, pass: ratio >= MIN_FIELD_BOUNDARY };
    });
}

/** `alpha` of `fg` over `bg`, both `#rrggbb` (what `bg-elevated/50` paints on the page). */
function mixHex(fg: string, bg: string, alpha: number): string {
    const [a, b] = [fg, bg].map(value => [1, 3, 5].map(at => Number.parseInt(value.slice(at, at + 2), 16)));
    return `#${a!.map((channel, i) => Math.round(channel * alpha + b![i]! * (1 - alpha)).toString(16).padStart(2, '0')).join('')}`;
}

/** The failing field boundaries in words, as a refused theme gets them at build (empty when it passes). */
export function fieldBoundaryFailures(results: FieldBoundary[]): string[] {
    return results.filter(result => !result.pass)
        .map(result => `the default text field has no visible boundary: ${result.ratio.toFixed(2)}:1 in ${result.mode} mode, ${MIN_FIELD_BOUNDARY}:1 is required`);
}
