/**
 * The primary colour is moved
 * within its own ramp, darker or lighter, until the label the framework puts on a solid primary surface reaches
 * 4.5:1 (WCAG AA, normal text), in light and in dark. Everything else that draws in the primary colour (focus ring,
 * primary text, borders) follows the same shade, so that shade must also reach 3:1 against the page background
 * (WCAG 1.4.11). The shade chosen is the NEAREST to the theme's own choice that passes both: a theme that passes
 * already is left exactly as it is.
 *
 * Pure: works on sRGB hex colours, no DOM, no theme engine (the client plugin imports it). The theme-document side
 * lives in `product-theme.ts`, the tenant house colour side in `app/utils/public-theme.ts`.
 */
export const RAMP_SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
export type RampShade = typeof RAMP_SHADES[number];

/** WCAG AA, normal text: the label of a solid primary button on the primary colour. */
export const MIN_LABEL_CONTRAST = 4.5;
/** WCAG 1.4.11, non-text: the primary colour as focus ring or border against the page. */
export const MIN_RING_CONTRAST = 3;

const HEX = /^#[0-9a-f]{6}$/iu;

function channel(value: number): number {
    const normalized = value / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a `#rrggbb` colour. */
export function relativeLuminance(hex: string): number {
    if (!HEX.test(hex)) throw new Error(`not a #rrggbb colour: ${hex}`);
    const [r, g, b] = [1, 3, 5].map(index => channel(Number.parseInt(hex.slice(index, index + 2), 16)));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** WCAG contrast ratio of two `#rrggbb` colours. */
export function contrastRatio(a: string, b: string): number {
    const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [number, number];
    return (light + 0.05) / (dark + 0.05);
}

export interface PrimaryRuleInput {
    /** The primary ramp as `#rrggbb` per shade; missing shades are skipped. */
    ramp: Partial<Record<RampShade, string>>
    /** The theme's own shade for solid primary surfaces in this mode. */
    preferred: RampShade
    /** The label colour on a solid primary surface (`--ui-text-inverted`). */
    label: string
    /** The page background (`--ui-bg`). */
    background: string
}

export interface PrimaryRuleResult {
    shade: RampShade
    /** Contrast of the label on that shade. */
    label: number
    /** Contrast of that shade against the background. */
    ring: number
    passes: boolean
    /** The shade differs from the theme's own choice. */
    moved: boolean
}

/**
 * The nearest shade to `preferred` on which the label reaches 4.5:1 and which reaches 3:1 against the background.
 * At equal distance, the side with the higher label contrast is tried first (towards black under a white label,
 * towards white under a dark one). When no shade passes, the one with the highest label contrast, `passes: false`.
 */
export function pickPrimaryShade(input: PrimaryRuleInput): PrimaryRuleResult {
    const measure = (shade: RampShade): PrimaryRuleResult => {
        const color = input.ramp[shade]!;
        const label = contrastRatio(input.label, color);
        const ring = contrastRatio(color, input.background);
        return { shade, label, ring, passes: label >= MIN_LABEL_CONTRAST && ring >= MIN_RING_CONTRAST, moved: shade !== input.preferred };
    };
    const available = RAMP_SHADES.filter(shade => input.ramp[shade] !== undefined);
    if (!available.length) throw new Error('empty primary ramp');
    const origin = RAMP_SHADES.indexOf(input.preferred);
    const candidates = available.map(measure).sort((a, b) => {
        const distance = Math.abs(RAMP_SHADES.indexOf(a.shade) - origin) - Math.abs(RAMP_SHADES.indexOf(b.shade) - origin);
        return distance || b.label - a.label;
    });
    return candidates.find(candidate => candidate.passes) ?? candidates.reduce((best, candidate) => candidate.label > best.label ? candidate : best);
}
