import { pickPrimaryShade, type RampShade } from './theme/primary-rule';

type TailwindShade = '50' | '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900' | '950';

const HEX_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
/**
 * Text on solid primary controls in dark mode: Nuxt UI sets `--ui-text-inverted` to neutral-900 there (neutral is
 * slate in today's theme, app/utils/theme/current.ts); it is also the dark page background (`--ui-bg`), so the focus
 * ring check of the rule measures the same pair here. Under another installation theme this pair is not re-measured
 * (pre-existing P2 of the T1 review).
 */
const DARK_MODE_INVERTED_TEXT = '#0f172a';
/** Label of solid primary controls in light mode (Nuxt UI `--ui-text-inverted`), also the light page background. */
const LIGHT_MODE_INVERTED_TEXT = '#ffffff';

/** Named tenant house colours and the base hex values used to mix their ramps. */
const TAILWIND_BASE_COLORS: Record<string, string> = {
    slate: '#64748b',
    gray: '#6b7280',
    zinc: '#71717a',
    neutral: '#737373',
    stone: '#78716c',
    mauve: '#8b7f8d',
    olive: '#708238',
    mist: '#6b8f99',
    taupe: '#8b8580',
    red: '#ef4444',
    orange: '#f97316',
    amber: '#f59e0b',
    yellow: '#eab308',
    lime: '#84cc16',
    green: '#22c55e',
    emerald: '#10b981',
    teal: '#14b8a6',
    cyan: '#06b6d4',
    sky: '#0ea5e9',
    blue: '#3b82f6',
    indigo: '#6366f1',
    violet: '#8b5cf6',
    purple: '#a855f7',
    fuchsia: '#d946ef',
    pink: '#ec4899',
    rose: '#f43f5e'
};

const SHADE_MIXES: Record<TailwindShade, string> = {
    50: '8%, white',
    100: '14%, white',
    200: '24%, white',
    300: '38%, white',
    400: '62%, white',
    500: '',
    600: '88%, black',
    700: '76%, black',
    800: '62%, black',
    900: '48%, black',
    950: '34%, black'
};

function expandHex(value: string): string {
    if (value.length !== 4) return value.toLowerCase();
    return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`.toLowerCase();
}

function hexToRgb(value: string): { r: number, g: number, b: number } | null {
    const hex = expandHex(value).slice(1);
    if (hex.length !== 6) return null;
    return {
        r: Number.parseInt(hex.slice(0, 2), 16),
        g: Number.parseInt(hex.slice(2, 4), 16),
        b: Number.parseInt(hex.slice(4, 6), 16)
    };
}

/** A `#rrggbb` colour from a hex value or a name of the table above; anything else is no colour. */
export function normalizeThemeColor(value: unknown): string | null {
    if (typeof value !== 'string') return null;

    const color = value.trim().toLowerCase();
    if (!color) return null;

    return HEX_PATTERN.test(color)
        ? expandHex(color)
        // Own keys only: "constructor" or "__proto__" are no colour names.
        : (Object.hasOwn(TAILWIND_BASE_COLORS, color) ? TAILWIND_BASE_COLORS[color] : null) || null;
}

function toHex(channel: number): string {
    return Math.round(Math.min(255, Math.max(0, channel))).toString(16).padStart(2, '0');
}

/** The sRGB colour a shade resolves to (same arithmetic as `color-mix(in srgb, ...)`). */
function shadeHex(baseColor: string, shade: TailwindShade): string | null {
    const rgb = hexToRgb(baseColor);
    if (!rgb) return null;
    const mix = SHADE_MIXES[shade];
    if (!mix) return expandHex(baseColor);
    const [percent, target] = mix.split(',').map(part => part.trim());
    const weight = Number.parseFloat(percent || '100') / 100;
    const other = target === 'white' ? 255 : 0;
    return `#${toHex(rgb.r * weight + other * (1 - weight))}${toHex(rgb.g * weight + other * (1 - weight))}${toHex(rgb.b * weight + other * (1 - weight))}`;
}

/** The ramp a house colour is mixed into, as `#rrggbb` per shade (the same arithmetic as `color-mix(in srgb, ...)`). */
function houseRamp(baseColor: string): Partial<Record<RampShade, string>> {
    return Object.fromEntries((Object.keys(SHADE_MIXES) as TailwindShade[]).map(shade => [Number(shade), shadeHex(baseColor, shade)]).filter(([, hex]) => hex)) as Partial<Record<RampShade, string>>;
}

/**
 * Shade used as `--ui-primary` in dark mode: the product rule (`theme/primary-rule.ts`) on the house colour's ramp,
 * from shade 500 under the dark label. A medium colour carried dark text below AA in dark mode.
 */
export function darkModePrimaryShade(baseColor: string): TailwindShade {
    return String(pickPrimaryShade({ ramp: houseRamp(baseColor), preferred: 500, label: DARK_MODE_INVERTED_TEXT, background: DARK_MODE_INVERTED_TEXT }).shade) as TailwindShade;
}

/**
 * Shade used as `--ui-primary` in light mode: the product rule on the house colour's ramp, from shade 500 under the
 * white label. The hue stays the municipality's; a colour that already passes is used as
 * entered.
 */
export function lightModePrimaryShade(baseColor: string): TailwindShade {
    return String(pickPrimaryShade({ ramp: houseRamp(baseColor), preferred: 500, label: LIGHT_MODE_INVERTED_TEXT, background: LIGHT_MODE_INVERTED_TEXT }).shade) as TailwindShade;
}

function shadeValue(baseColor: string, shade: TailwindShade): string {
    const mix = SHADE_MIXES[shade];
    return mix ? `color-mix(in srgb, ${baseColor} ${mix})` : baseColor;
}

/**
 * Generate primary variables from the tenant's colour or the fallback. Adjust the shade in each mode
 * until the label reaches 4.5:1 contrast. If neither input is a valid colour, keep the theme's primary.
 */
export function generatePrimaryThemeCSS(primary: unknown, fallback: unknown = null): string {
    const baseColor = normalizeThemeColor(primary) || normalizeThemeColor(fallback);
    if (!baseColor) return '';
    const shadeVars = (Object.keys(SHADE_MIXES) as TailwindShade[])
        .map((shade) => {
            const value = shadeValue(baseColor, shade);
            return `--ui-color-primary-${shade}: ${value};\n--color-primary-${shade}: ${value};`;
        })
        .join('\n');

    const lightShade = lightModePrimaryShade(baseColor);
    const lightPrimary = lightShade === '500' ? baseColor : `var(--ui-color-primary-${lightShade})`;
    const darkShade = darkModePrimaryShade(baseColor);
    const darkPrimary = darkShade === '500' ? baseColor : `var(--ui-color-primary-${darkShade})`;

    return `
html:root {
${shadeVars}
--ui-primary: ${lightPrimary};
}
html.dark:root {
--ui-primary: ${darkPrimary};
}
`.trim();
}
