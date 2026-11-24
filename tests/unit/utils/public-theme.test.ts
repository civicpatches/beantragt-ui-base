import { describe, expect, it } from 'vitest';
import { darkModePrimaryShade, generatePrimaryThemeCSS, lightModePrimaryShade, normalizeThemeColor } from '~/utils/public-theme';

// WCAG relative luminance and contrast, independent of the module under test.
function luminance(hex: string): number {
    const channels = [1, 3, 5].map(index => Number.parseInt(hex.slice(index, index + 2), 16) / 255)
        .map(value => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
    return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}
function contrast(a: string, b: string): number {
    const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (light! + 0.05) / (dark! + 0.05);
}
const WEIGHT_TOWARDS_WHITE: Record<string, number> = { 500: 1, 400: 0.62, 300: 0.38, 200: 0.24, 100: 0.14, 50: 0.08 };
function towardsWhite(hex: string, shade: string): string {
    const weight = WEIGHT_TOWARDS_WHITE[shade]!;
    return `#${[1, 3, 5].map(index => Math.round(Number.parseInt(hex.slice(index, index + 2), 16) * weight + 255 * (1 - weight)).toString(16).padStart(2, '0')).join('')}`;
}
/** Label colour of solid primary buttons in dark mode (Nuxt UI `--ui-text-inverted`, slate-900). */
const DARK_LABEL = '#0f172a';
const WEIGHT_TOWARDS_BLACK: Record<string, number> = { 500: 1, 600: 0.88, 700: 0.76, 800: 0.62, 900: 0.48, 950: 0.34 };
function towardsBlack(hex: string, shade: string): string {
    const weight = WEIGHT_TOWARDS_BLACK[shade]!;
    return `#${[1, 3, 5].map(index => Math.round(Number.parseInt(hex.slice(index, index + 2), 16) * weight).toString(16).padStart(2, '0')).join('')}`;
}
const WHITE_LABEL = '#ffffff';

describe('public theme utils', () => {
    it('normalizes hex shorthand and Tailwind palette names', () => {
        expect(normalizeThemeColor('#abc')).toBe('#aabbcc');
        expect(normalizeThemeColor('rose')).toBe('#f43f5e');
    });

    // Owner's rule (13.11.2026, gt1c): any house colour is taken and its shade moved until the label reads; the
    // old 3:1 acceptance check is gone.
    it('takes a very light house colour and moves its shade until the label reaches 4.5:1', () => {
        expect(normalizeThemeColor('#ffffff')).toBe('#ffffff');
        const shade = lightModePrimaryShade('#ffffff');
        expect(contrast(towardsBlack('#ffffff', shade), WHITE_LABEL)).toBeGreaterThanOrEqual(4.5);
        expect(generatePrimaryThemeCSS('#ffffff', 'red')).toContain('--ui-color-primary-500: #ffffff;');
    });

    it('generates Nuxt UI primary variables from a runtime color', () => {
        const css = generatePrimaryThemeCSS('#2563eb');

        expect(css).toContain('--ui-color-primary-500: #2563eb;');
        expect(css).toContain('--color-primary-950: color-mix(in srgb, #2563eb 34%, black);');
        expect(css).toContain('--ui-primary: #2563eb;');
    });

    it('falls back when the runtime color is invalid', () => {
        // The base colour is the default red (shade 500); `--ui-primary` in light mode is its readable shade.
        expect(generatePrimaryThemeCSS('not-a-color', 'red')).toContain('--ui-color-primary-500: #ef4444;');
    });

    it('never falls back to red: without any colour it writes nothing, so the theme\'s own primary stays', () => {
        expect(generatePrimaryThemeCSS('not-a-color', 'cobalt')).toBe('');
        expect(generatePrimaryThemeCSS(null, null)).toBe('');
        // A light house colour keeps its own hue instead of turning red.
        expect(generatePrimaryThemeCSS('#eab308', 'red')).toContain('--ui-color-primary-500: #eab308;');
    });

    // In dark mode the label of a solid primary button is dark; the tenant
    // colour itself (demo green) gave 3.68:1. Dark mode uses the first shade
    // towards white that reaches 4.5:1; light mode keeps a colour that already passes there.
    it('lightens a medium tenant colour in dark mode until the dark label reaches 4.5:1', () => {
        expect(contrast('#3d7f4a', DARK_LABEL)).toBeLessThan(4.5);
        expect(darkModePrimaryShade('#3d7f4a')).toBe('400');

        const css = generatePrimaryThemeCSS('#3d7f4a');
        expect(css).toContain('html.dark:root {\n--ui-primary: var(--ui-color-primary-400);\n}');
        // Light mode keeps this colour: its white label already reaches 4.5:1 (4.85:1).
        expect(css).toContain('html:root {');
        expect(css).toContain('--ui-primary: #3d7f4a;');
        expect(contrast(towardsWhite('#3d7f4a', '400'), DARK_LABEL)).toBeGreaterThanOrEqual(4.5);
    });

    it('keeps the default colour in dark mode, it already reaches 4.5:1', () => {
        expect(darkModePrimaryShade('#ef4444')).toBe('500');
        expect(generatePrimaryThemeCSS('not-a-color', 'red')).toContain('html.dark:root {\n--ui-primary: #ef4444;\n}');
    });

    it('reaches 4.5:1 in dark mode for every colour', () => {
        let checked = 0;
        for (let r = 0; r <= 255; r += 17) {
            for (let g = 0; g <= 255; g += 17) {
                for (let b = 0; b <= 255; b += 17) {
                    const hex = `#${[r, g, b].map(value => value.toString(16).padStart(2, '0')).join('')}`;
                    checked++;
                    const shade = darkModePrimaryShade(hex);
                    expect.soft(contrast(towardsWhite(hex, shade), DARK_LABEL), `${hex} shade ${shade}`).toBeGreaterThanOrEqual(4.5);
                }
            }
        }
        expect(checked).toBe(4096);
    });

    // Only own keys of the colour table are colour names.
    it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty'])('treats %s as no colour', (name) => {
        expect(normalizeThemeColor(name)).toBeNull();
        expect(() => generatePrimaryThemeCSS(name, 'red')).not.toThrow();
        expect(generatePrimaryThemeCSS(name, 'red')).toContain('--ui-color-primary-500: #ef4444;');
    });

    // In light mode the label of a solid primary button
    // is white; the default red gave 3.76:1. Light mode uses the first shade
    // towards black that reaches 4.5:1, the mirror of the dark mode rule.
    it('darkens the default red to shade 600 in light mode, white label 4.72:1', () => {
        expect(contrast('#ef4444', WHITE_LABEL)).toBeLessThan(4.5);
        expect(lightModePrimaryShade('#ef4444')).toBe('600');
        expect(towardsBlack('#ef4444', '600')).toBe('#d23c3c');
        expect(contrast('#d23c3c', WHITE_LABEL)).toBeGreaterThanOrEqual(4.5);
        const css = generatePrimaryThemeCSS('not-a-color', 'red');
        expect(css).toContain('html:root {');
        expect(css).toMatch(/html:root \{[^}]*--ui-primary: var\(--ui-color-primary-600\);\n\}/);
        // Dark mode keeps the colour as entered.
        expect(css).toContain('html.dark:root {\n--ui-primary: #ef4444;\n}');
    });

    it.each(['#16a34a', '#3b82f6'])('darkens the accepted hue %s in light mode only as far as needed', (hex) => {
        // Its white label fails 4.5:1 as entered.
        expect(normalizeThemeColor(hex)).toBe(hex);
        expect(contrast(hex, WHITE_LABEL)).toBeLessThan(4.5);
        const shade = lightModePrimaryShade(hex);
        expect(shade).not.toBe('500');
        expect(contrast(towardsBlack(hex, shade), WHITE_LABEL)).toBeGreaterThanOrEqual(4.5);
        // One shade lighter would not pass: it stops at the first readable shade.
        expect(contrast(towardsBlack(hex, String(Number(shade) - 100)), WHITE_LABEL)).toBeLessThan(4.5);
        const css = generatePrimaryThemeCSS(hex);
        const lightBlock = css.slice(0, css.indexOf('html.dark:root'));
        expect(lightBlock).toContain(`--ui-color-primary-500: ${hex};`);
        expect(lightBlock).toContain(`--ui-primary: var(--ui-color-primary-${shade});`);
    });

    it('keeps a tenant colour that already reaches 4.5:1 in light mode as entered', () => {
        expect(lightModePrimaryShade('#3d7f4a')).toBe('500');
        expect(lightModePrimaryShade('#2563eb')).toBe('500');
        expect(generatePrimaryThemeCSS('#3d7f4a')).toMatch(/html:root \{[^}]*--ui-primary: #3d7f4a;\n\}/);
    });

    it('reaches 4.5:1 in light mode for every colour', () => {
        let checked = 0;
        for (let r = 0; r <= 255; r += 17) {
            for (let g = 0; g <= 255; g += 17) {
                for (let b = 0; b <= 255; b += 17) {
                    const hex = `#${[r, g, b].map(value => value.toString(16).padStart(2, '0')).join('')}`;
                    checked++;
                    const shade = lightModePrimaryShade(hex);
                    expect.soft(contrast(towardsBlack(hex, shade), WHITE_LABEL), `${hex} shade ${shade}`).toBeGreaterThanOrEqual(4.5);
                }
            }
        }
        expect(checked).toBe(4096);
    });
});
