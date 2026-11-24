/**
 * The form of a theme document read from a file: the engine's `ThemeDoc` (`engine/types.ts`), checked key by
 * key, because what passes here is written into the stylesheet (`@theme`, `:root`) or the app config as it is. The
 * operator is trusted, so this is robustness, not security: a quote in a family name closes the `@theme` block, a
 * typo in a token name has no effect, a string where an object belongs breaks the config; each is a silently broken
 * look, which the theme contract excludes. Returns the first problem in words, or undefined.
 */
import { LIBRARY_TOKEN_DEFAULTS, SHADES, type ColorAlias } from './engine/types';
import { PRODUCT_TOKEN_DEFAULTS } from './product-theme';

const COLOR_ALIASES: readonly ColorAlias[] = ['primary', 'secondary', 'success', 'info', 'warning', 'error', 'neutral'];
const SHADE_NAMES = SHADES.map(String);
/** A palette or Tailwind colour name. */
const NAME = /^[a-z][a-z0-9-]*$/u;
/** A plain font family name: letters, digits, blanks, dots and hyphens (no quote, semicolon or brace). */
const FAMILY = /^[A-Za-z0-9][A-Za-z0-9 .-]*$/u;
/** What would end a declaration or a block in the stylesheet. */
const BREAKS_CSS = /[;{}\\<>]/u;
const WEIGHT_STEPS = ['normal', 'medium', 'semibold', 'bold'];
const FONT_KEYS = ['sans', 'serif', 'mono', 'weights', 'uppercase', 'italic', 'letterSpacing', 'lineHeight'];
const TOP_LEVEL = ['version', 'palettes', 'colors', 'blackAsPrimary', 'tokens', 'radius', 'fontSize', 'font', 'icons', 'style', 'components'];

/** Ranges that keep a theme a theme: radius in rem, root font size in px, tracking in em, unitless line height. */
export const THEME_RANGES = {
    radius: [0, 2],
    fontSize: [10, 24],
    letterSpacing: [-0.1, 0.5],
    lineHeight: [0.8, 3],
    weight: [100, 900]
} as const;

/** The tokens a document may set: Nuxt UI's semantic tokens, the app's own, and the colour ramps of the aliases. */
export function isKnownToken(name: string): boolean {
    if (name in LIBRARY_TOKEN_DEFAULTS.light || name in LIBRARY_TOKEN_DEFAULTS.dark) return true;
    if (name in PRODUCT_TOKEN_DEFAULTS.light || name in PRODUCT_TOKEN_DEFAULTS.dark) return true;
    const ramp = /^--ui-color-([a-z]+)-(\d+)$/u.exec(name);
    return Boolean(ramp && (COLOR_ALIASES as readonly string[]).includes(ramp[1]!) && SHADE_NAMES.includes(ramp[2]!));
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function inRange(value: unknown, [min, max]: readonly [number, number]): boolean {
    return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function colorsProblem(colors: unknown): string | undefined {
    if (!isRecord(colors)) return '"colors" is not an object';
    for (const [alias, name] of Object.entries(colors)) {
        if (!(COLOR_ALIASES as readonly string[]).includes(alias)) return `"colors.${alias}" is no colour alias (${COLOR_ALIASES.join(', ')})`;
        if (typeof name !== 'string' || !NAME.test(name)) return `"colors.${alias}" is not a colour name (lower case letters, digits, hyphens): ${JSON.stringify(name)}`;
    }
    return undefined;
}

function palettesProblem(palettes: unknown): string | undefined {
    if (!isRecord(palettes)) return '"palettes" is not an object';
    for (const [name, palette] of Object.entries(palettes)) {
        if (!NAME.test(name)) return `the palette name ${JSON.stringify(name)} is not a colour name (lower case letters, digits, hyphens)`;
        if (!isRecord(palette) || Object.keys(palette).some(key => key !== 'shades') || !isRecord(palette.shades)) return `the palette "${name}" is not { "shades": { … } }`;
        for (const [shade, color] of Object.entries(palette.shades)) {
            if (!SHADE_NAMES.includes(shade)) return `the palette "${name}" has the shade "${shade}", which is none of ${SHADE_NAMES.join(', ')}`;
            if (typeof color !== 'string' || !color.trim() || BREAKS_CSS.test(color)) return `the palette "${name}" shade ${shade} is not a colour value: ${JSON.stringify(color)}`;
        }
    }
    return undefined;
}

function tokensProblem(tokens: unknown): string | undefined {
    if (!isRecord(tokens)) return '"tokens" is not an object';
    for (const [mode, values] of Object.entries(tokens)) {
        if (mode !== 'light' && mode !== 'dark') return `"tokens.${mode}" is no mode (light, dark)`;
        if (!isRecord(values)) return `"tokens.${mode}" is not an object`;
        for (const [name, value] of Object.entries(values)) {
            if (!/^--[\w-]+$/u.test(name)) return `the token name ${JSON.stringify(name)} in ${mode} mode is not a custom property`;
            if (!isKnownToken(name)) return `the token ${name} in ${mode} mode is not a token of Nuxt UI or of the app (a typo?)`;
            if (typeof value !== 'string' || !value.trim() || BREAKS_CSS.test(value)) return `the token ${name} in ${mode} mode has no plain value: ${JSON.stringify(value)}`;
        }
    }
    return undefined;
}

function fontProblem(font: unknown): string | undefined {
    if (!isRecord(font)) return '"font" is not an object';
    for (const [key, value] of Object.entries(font)) {
        if (!FONT_KEYS.includes(key)) return `"font.${key}" is unknown (${FONT_KEYS.join(', ')})`;
        if (['sans', 'serif', 'mono'].includes(key) && (typeof value !== 'string' || !FAMILY.test(value))) {
            return `"font.${key}" is not a plain family name (letters, digits, blanks, dots, hyphens): ${JSON.stringify(value)}`;
        }
        if (key === 'weights') {
            if (!isRecord(value)) return '"font.weights" is not an object';
            for (const [step, weight] of Object.entries(value)) {
                if (!WEIGHT_STEPS.includes(step)) return `"font.weights.${step}" is unknown (${WEIGHT_STEPS.join(', ')})`;
                if (!inRange(weight, THEME_RANGES.weight) || !Number.isInteger(weight)) return `"font.weights.${step}" is not a weight from 100 to 900: ${JSON.stringify(weight)}`;
            }
        }
        if ((key === 'uppercase' || key === 'italic') && typeof value !== 'boolean') return `"font.${key}" is not true or false`;
        if (key === 'letterSpacing' && !inRange(value, THEME_RANGES.letterSpacing)) return `"font.letterSpacing" is not a number from -0.1 to 0.5 (em): ${JSON.stringify(value)}`;
        if (key === 'lineHeight' && !inRange(value, THEME_RANGES.lineHeight)) return `"font.lineHeight" is not a number from 0.8 to 3: ${JSON.stringify(value)}`;
    }
    return undefined;
}

function styleProblem(style: unknown): string | undefined {
    if (!isRecord(style)) return '"style" is not an object';
    for (const [key, value] of Object.entries(style)) {
        if (key !== 'defaults' && key !== 'tokenShades') return `"style.${key}" is unknown (defaults, tokenShades)`;
        if (!isRecord(value)) return `"style.${key}" is not an object`;
        if (key === 'tokenShades') {
            for (const [name, shades] of Object.entries(value)) {
                if (!isKnownToken(name)) return `"style.tokenShades" names ${JSON.stringify(name)}, which is not a token of Nuxt UI or of the app`;
                if (!isRecord(shades) || Object.entries(shades).some(([mode, stop]) => !['light', 'dark'].includes(mode) || ![...SHADES, 'white', 'black'].includes(stop as never))) {
                    return `"style.tokenShades.${name}" is not { "light"?: <shade>, "dark"?: <shade> }`;
                }
            }
        }
    }
    return undefined;
}

/** The first problem of a parsed theme document, or undefined when it has the engine's form. */
export function themeDocumentProblem(value: unknown): string | undefined {
    if (!isRecord(value)) return 'it is not a JSON object';
    if (value.version !== 1) return 'it has no "version": 1, the format of the Nuxt UI theme engine';
    const unknown = Object.keys(value).filter(key => !TOP_LEVEL.includes(key));
    if (unknown.length) return `it has keys a theme document does not know: ${unknown.join(', ')}`;
    const sections: Array<[string, (section: unknown) => string | undefined]> = [
        ['colors', colorsProblem],
        ['palettes', palettesProblem],
        ['tokens', tokensProblem],
        ['font', fontProblem],
        ['style', styleProblem]
    ];
    for (const [key, check] of sections) {
        const problem = key in value ? check(value[key]) : undefined;
        if (problem) return problem;
    }
    if ('blackAsPrimary' in value && typeof value.blackAsPrimary !== 'boolean') return '"blackAsPrimary" is not true or false';
    if ('radius' in value && !inRange(value.radius, THEME_RANGES.radius)) return `"radius" is not a number from 0 to 2 (rem): ${JSON.stringify(value.radius)}`;
    if ('fontSize' in value && !inRange(value.fontSize, THEME_RANGES.fontSize)) return `"fontSize" is not a number from 10 to 24 (px): ${JSON.stringify(value.fontSize)}`;
    if ('icons' in value && (typeof value.icons !== 'string' || !NAME.test(value.icons))) return `"icons" is not an icon set name: ${JSON.stringify(value.icons)}`;
    if ('components' in value) {
        if (!isRecord(value.components)) return '"components" is not an object';
        const wrong = Object.entries(value.components).find(([, entry]) => !isRecord(entry));
        if (wrong) return `"components.${wrong[0]}" is not an object of the component's theme (slots, variants, …): ${JSON.stringify(wrong[1])}`;
    }
    return undefined;
}
