/**
 * The theme of the installation: the operator names ONE theme at build
 * time, a preset of the Nuxt UI theme engine (`engine/presets.ts`) or a theme document in a file. Without a setting
 * the installation renders today's look (`currentTheme`, "bleibt der Ausgangswert").
 *
 * Only a theme that passes the contrast rule as rendered with the product rules (`toProductTheme`, `theme-check.ts`)
 * is offered. A preset that fails, a name that is no preset, or a file that cannot be read or is no theme document
 * fails the build with a sentence that says which and why; it never falls back to another look.
 *
 * Pure: no Nuxt, no file system of its own (the caller passes `readFile`), so `nuxt.config.ts` and the tests use it
 * the same way.
 */
import { currentTheme } from './current';
import { presets } from './engine/presets';
import { resolveShade, type Shade, type ThemeDoc } from './engine/types';
import { primaryRamp, resolveColor, themeTokens, toProductTheme } from './product-theme';
import { contrastFailures, fieldBoundaryFailures, measureFieldBoundary, measureTheme } from './theme-check';
import { themeDocumentProblem } from './theme-document';

/** The build setting (environment variable, read by `nuxt.config.ts` at build time). */
export const THEME_SETTING = 'NUXT_UI_THEME';

/**
 * The file format, said in every sentence about a theme file. The export of ui.nuxt.com/theme is a `main.css` plus
 * `app.config.ts` pair (`engine/serialize.ts`), not a document; reading that pair back is not built (T1 limit).
 */
export const THEME_FILE_FORMAT = 'Expected: a theme document of the Nuxt UI theme engine as JSON ("version": 1, the shape of the presets in app/utils/theme/engine/presets.ts). The export of ui.nuxt.com/theme (main.css plus app.config.ts) cannot be read directly yet.';

export interface InstallationTheme {
    /** Where the theme came from: no setting, a preset, a file. */
    source: 'current' | 'preset' | 'file'
    /** `current`, the preset id, or the file path as given. */
    name: string
    /** The theme document as named, before the product rules. */
    doc: ThemeDoc
}

export class InstallationThemeError extends Error {
    override name = 'InstallationThemeError';
}

/**
 * Why a theme is not offered, in words; empty when it passes. As rendered with the product rules: the contrast pairs
 * and the boundary of its default text field (lead's decision 13.11.).
 */
export function themeRefusal(doc: ThemeDoc): string[] {
    return [...contrastFailures(measureTheme(toProductTheme(doc))), ...fieldBoundaryFailures(measureFieldBoundary(doc))];
}

/** The preset ids the installation may name: every preset that passes the contrast rule as rendered. */
export function offeredPresets(): string[] {
    return presets.filter(preset => themeRefusal(preset.doc).length === 0).map(preset => preset.id);
}

/** A theme document read from a file: the engine's format (`version: 1`), checked key by key (`theme-document.ts`). */
function parseThemeDocument(text: string): { doc?: ThemeDoc, problem?: string } {
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch (error) {
        return { problem: `it is not JSON (${(error as Error).message})` };
    }
    const problem = themeDocumentProblem(value);
    return problem ? { problem } : { doc: value as ThemeDoc };
}

/**
 * A document that parses but does not resolve: every colour alias names a Tailwind colour or a palette of
 * the document, the primary ramp resolves, every token value resolves to a colour in its mode. The first problem, in
 * words, or undefined.
 */
function unresolvable(doc: ThemeDoc): string | undefined {
    for (const [alias, name] of Object.entries(doc.colors ?? {})) {
        if (!resolveShade(doc, name, 500 as Shade)) {
            return `the colour "${alias}" names "${name}", which is neither a Tailwind colour nor a palette of this file`;
        }
    }
    if (!Object.keys(primaryRamp(doc)).length) {
        return `the palette "${doc.colors?.primary ?? 'primary'}" (colour "primary") has no shade that resolves to a colour`;
    }
    for (const mode of ['light', 'dark'] as const) {
        const tokens = themeTokens(doc, mode);
        for (const [name, value] of Object.entries(doc.tokens?.[mode] ?? {})) {
            if (!resolveColor(doc, value, tokens)) return `the token ${name} in ${mode} mode is "${value}", which does not resolve to a colour`;
        }
    }
    return undefined;
}

function looksLikePath(setting: string): boolean {
    return setting.toLowerCase().endsWith('.json') || setting.includes('/') || setting.includes('\\');
}

/** The name of today's look, the product's default; "default" is the framework's preset of that name. */
export const CURRENT_THEME_NAME = 'current';

/**
 * The installation's theme for a setting. `readFile` reads a file path as given (the caller resolves it against
 * the project root). Throws `InstallationThemeError` with the reason; never falls back.
 */
export function resolveInstallationTheme(setting: string | undefined, readFile: (path: string) => string): InstallationTheme {
    const value = (setting ?? '').trim();
    if (!value || value.toLowerCase() === CURRENT_THEME_NAME) return { source: 'current', name: CURRENT_THEME_NAME, doc: currentTheme };

    const offered = offeredPresets();
    const offer = `${offered.length ? `Offered presets: ${offered.join(', ')}` : 'No preset is offered (none passes the contrast rule as rendered)'}; "${CURRENT_THEME_NAME}" for today's look; or a path to a theme document (.json).`;

    if (looksLikePath(value)) {
        let text: string;
        try {
            text = readFile(value);
        } catch (error) {
            throw new InstallationThemeError(`${THEME_SETTING}=${value}: the theme file cannot be read (${(error as { code?: string }).code ?? (error as Error).message}).`);
        }
        const { doc, problem } = parseThemeDocument(text);
        if (!doc) throw new InstallationThemeError(`${THEME_SETTING}=${value}: the file is not a theme document: ${problem}. ${THEME_FILE_FORMAT}`);
        const broken = unresolvable(doc);
        if (broken) throw new InstallationThemeError(`${THEME_SETTING}=${value}: ${broken}.`);
        let refusal: string[];
        try {
            refusal = themeRefusal(doc);
        } catch (error) {
            // Anything the checks above did not foresee still ends in a sentence, never a bare error.
            throw new InstallationThemeError(`${THEME_SETTING}=${value}: the theme in this file cannot be measured (${(error as Error).message}).`);
        }
        if (refusal.length) {
            throw new InstallationThemeError(`${THEME_SETTING}=${value}: the theme in this file fails the contrast rule as rendered: ${refusal.join('; ')}.`);
        }
        return { source: 'file', name: value, doc };
    }

    const preset = presets.find(entry => entry.id === value.toLowerCase() || entry.name.toLowerCase() === value.toLowerCase());
    if (!preset) throw new InstallationThemeError(`${THEME_SETTING}=${value}: there is no preset of this name. ${offer}`);
    const refusal = themeRefusal(preset.doc);
    if (refusal.length) {
        throw new InstallationThemeError(`${THEME_SETTING}=${value}: the preset "${preset.name}" is not offered, it fails the contrast rule as rendered: ${refusal.join('; ')}. ${offer}`);
    }
    return { source: 'preset', name: preset.id, doc: preset.doc };
}
