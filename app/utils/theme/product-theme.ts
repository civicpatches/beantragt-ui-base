/**
 * The primary shade moves within its own ramp until text on a solid primary surface reaches 4.5:1
 * and the shade reaches 3:1 against the page in both modes. The app uses Lucide icons across all themes.
 * Custom form controls use the app-specific `--ui-border-control` token. If the theme omits it,
 * `PRODUCT_TOKEN_DEFAULTS` supplies shades from the theme’s neutral palette.
 * `toProductTheme` returns the original object when it needs no changes.
 */
import { oklchToRgb, parseColor, rgbToHex } from './engine/palette';
import { LIBRARY_TOKEN_DEFAULTS, parseUiColorRef, resolveAlias, resolveShade, styleTokens } from './engine/types';
import type { ColorAlias, Shade, ThemeDoc } from './engine/types';
import { pickPrimaryShade, RAMP_SHADES, relativeLuminance, type PrimaryRuleResult, type RampShade } from './primary-rule';

export type Mode = 'light' | 'dark';

/** Rule 2: the icon set the product renders, whatever a theme names ("icons: keep product set"). */
export const PRODUCT_ICONS = { keep: 'lucide' } as const;

/**
 * In light mode, use the theme's own state palettes at readable shades when it doesn't set them explicitly or
 * through its style), light mode takes today's shade of the theme's own state palette. Dark mode needs nothing: the
 * engine restates the library's dark value in `.dark` for every key set in light (`serialize.ts`), because
 * `:root, .light` also matches `<html class="dark">`; the library's dark state colours (400) pass already.
 */
export const PRODUCT_STATE_FLOOR: Record<string, string> = {
    '--ui-error': 'var(--ui-color-error-700)',
    '--ui-success': 'var(--ui-color-success-800)',
    '--ui-warning': 'var(--ui-color-warning-800)',
    '--ui-info': 'var(--ui-color-info-700)'
};

/** The state floor a theme still needs in light mode: the keys it sets neither explicitly nor through its style. */
function missingStateFloor(doc: ThemeDoc): Record<string, string> {
    const style = styleTokens(doc.style || {}).light;
    return Object.fromEntries(Object.entries(PRODUCT_STATE_FLOOR).filter(([key]) => doc.tokens?.light?.[key] === undefined && style[key] === undefined));
}

/** The fallback uses neutral 500 in light mode and neutral 400 in dark mode. The default theme defines its own values. */
export const PRODUCT_TOKEN_DEFAULTS: Record<Mode, Record<string, string>> = {
    light: { '--ui-border-control': 'var(--ui-color-neutral-500)' },
    dark: { '--ui-border-control': 'var(--ui-color-neutral-400)' }
};

/**
 * The `--ui-*` values a theme document leaves in force in one mode, in the order `generateCSS` writes them: the
 * library defaults, `blackAsPrimary`, the style's token shades, the explicit tokens.
 */
export function themeTokens(doc: ThemeDoc, mode: Mode): Record<string, string> {
    const style = styleTokens(doc.style || {});
    return {
        ...LIBRARY_TOKEN_DEFAULTS[mode],
        ...(doc.blackAsPrimary ? { '--ui-primary': mode === 'light' ? 'black' : 'white' } : {}),
        ...style[mode],
        ...doc.tokens?.[mode]
    };
}

type Rgb = [number, number, number];

/**
 * A token value as sRGB (0 to 1), or undefined when it cannot be resolved: keywords and hex, `oklch()`,
 * `var(--ui-color-<alias>-<shade>)` through the theme's palettes and Tailwind, `var(--color-<palette>-<shade>)`, a
 * `var(--ui-…)` of the same mode, and `color-mix(in srgb, <colour> <n>%, <colour>)`. `overrides` stand for CSS
 * the app adds on top of the theme (the tenant colour's variables). Out-of-gamut colours are clipped per channel.
 */
export function resolveColor(doc: ThemeDoc, value: string, tokens: Record<string, string>, overrides: Record<string, string> = {}, depth = 0): Rgb | undefined {
    if (depth > 8) return undefined;
    const input = value.trim();
    const colorMix = input.match(/^color-mix\(in srgb,\s*(.+?)\s+([\d.]+)%,\s*(.+)\)$/u);
    if (colorMix) {
        const base = resolveColor(doc, colorMix[1]!, tokens, overrides, depth + 1);
        const weight = Number(colorMix[2]) / 100;
        const other = resolveColor(doc, colorMix[3]!, tokens, overrides, depth + 1);
        return base && other && weight >= 0 && weight <= 1
            ? base.map((channel, index) => channel * weight + other[index]! * (1 - weight)) as Rgb
            : undefined;
    }
    const variable = input.match(/^var\((--[\w-]+)\)$/u)?.[1];
    if (variable) {
        if (overrides[variable] !== undefined) return resolveColor(doc, overrides[variable]!, tokens, overrides, depth + 1);
        if (variable.startsWith('--ui-') && tokens[variable] !== undefined) {
            // A `--ui-color-*` the document sets itself (today's primary ramp in `currentTheme`) wins over its palette.
            return resolveColor(doc, tokens[variable]!, tokens, overrides, depth + 1);
        }
        const ref = parseUiColorRef(input);
        if (ref) {
            const shade = resolveShade(doc, resolveAlias(doc, ref.alias as ColorAlias), ref.shade as Shade);
            return shade ? resolveColor(doc, shade, tokens, overrides, depth + 1) : undefined;
        }
        const tailwind = variable.match(/^--color-([a-z-]+)-(\d{2,3})$/u);
        if (tailwind) {
            const shade = resolveShade(doc, tailwind[1]!, Number(tailwind[2]) as Shade);
            return shade ? resolveColor(doc, shade, tokens, overrides, depth + 1) : undefined;
        }
        return undefined;
    }
    const color = parseColor(/^#[0-9a-f]{3}$/iu.test(input) ? `#${[...input.slice(1)].map(char => char + char).join('')}` : input);
    return color ? oklchToRgb(color) : undefined;
}

export function toHex(rgb: Rgb): string {
    return rgbToHex(rgb).toLowerCase();
}

/**
 * The primary ramp of a theme document as `#rrggbb` per shade: its own `--ui-color-primary-<shade>` tokens where it
 * sets them (the same value in both modes), else its palette or Tailwind's.
 */
export function primaryRamp(doc: ThemeDoc): Partial<Record<RampShade, string>> {
    const palette = resolveAlias(doc, 'primary');
    const own = doc.tokens?.light ?? {};
    const ramp: Partial<Record<RampShade, string>> = {};
    for (const shade of RAMP_SHADES) {
        const value = own[`--ui-color-primary-${shade}`] ?? resolveShade(doc, palette, shade as Shade);
        const rgb = value ? resolveColor(doc, value, {}) : undefined;
        if (rgb) ramp[shade] = toHex(rgb);
    }
    return ramp;
}

/** The ramp shade whose colour is nearest in luminance to a colour off the ramp (a literal `black`, `white`). */
function nearestOnRamp(ramp: Partial<Record<RampShade, string>>, hex: string): RampShade {
    const target = relativeLuminance(hex);
    return (Object.keys(ramp).map(Number) as RampShade[])
        .reduce((best, shade) => Math.abs(relativeLuminance(ramp[shade]!) - target) < Math.abs(relativeLuminance(ramp[best]!) - target) ? shade : best);
}

export interface ModeRule extends PrimaryRuleResult {
    /** The token value the rule writes for `--ui-primary`, or undefined when the theme's own value stays. */
    token?: string
}

/** Rule 1 on a theme document, per mode. */
export function primaryRuleForTheme(doc: ThemeDoc): Record<Mode, ModeRule> {
    const ramp = primaryRamp(doc);
    const result = {} as Record<Mode, ModeRule>;
    for (const mode of ['light', 'dark'] as const) {
        const tokens = themeTokens(doc, mode);
        const label = toHex(resolveColor(doc, tokens['--ui-text-inverted']!, tokens)!);
        const background = toHex(resolveColor(doc, tokens['--ui-bg']!, tokens)!);
        const own = tokens['--ui-primary']!;
        const ref = parseUiColorRef(own);
        let preferred: RampShade;
        if (ref && ref.alias === 'primary' && (RAMP_SHADES as readonly number[]).includes(ref.shade)) {
            preferred = ref.shade as RampShade;
        } else {
            // The theme's primary is off the ramp (`blackAsPrimary`, another alias): it stays when it passes.
            const ownHex = toHex(resolveColor(doc, own, tokens)!);
            const kept = pickPrimaryShade({ ramp: { 500: ownHex }, preferred: 500, label, background });
            if (kept.passes) {
                result[mode] = { ...kept, moved: false };
                continue;
            }
            preferred = nearestOnRamp(ramp, ownHex);
        }
        const picked = pickPrimaryShade({ ramp, preferred, label, background });
        result[mode] = { ...picked, token: picked.moved || !ref ? `var(--ui-color-primary-${picked.shade})` : undefined };
    }
    return result;
}

/**
 * The document the app renders for a theme: rule 1 written into its `tokens` where it moves the primary, rule 2 by
 * leaving out the icon set, rule 3 (pending the owner) the state floor in light mode, and the product token defaults
 * where the theme does not set them. A theme that needs none of it comes back as the same object.
 */
export function toProductTheme(doc: ThemeDoc): ThemeDoc {
    const rule = primaryRuleForTheme(doc);
    const moved = (['light', 'dark'] as const).filter(mode => rule[mode].token);
    const missing = (['light', 'dark'] as const).filter(mode => Object.keys(PRODUCT_TOKEN_DEFAULTS[mode]).some(key => doc.tokens?.[mode]?.[key] === undefined));
    const floor = missingStateFloor(doc);
    if (!moved.length && !missing.length && !Object.keys(floor).length && !doc.icons) return doc;
    const { icons: _themeIcons, ...rest } = doc;
    if (!moved.length && !missing.length && !Object.keys(floor).length) return rest;
    const tokens = {
        light: { ...floor, ...PRODUCT_TOKEN_DEFAULTS.light, ...doc.tokens?.light },
        dark: { ...PRODUCT_TOKEN_DEFAULTS.dark, ...doc.tokens?.dark }
    };
    for (const mode of moved) tokens[mode]['--ui-primary'] = rule[mode].token!;
    return { ...rest, tokens };
}
