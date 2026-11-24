/**
 * What the build makes of the installation's theme: the product rules applied
 * (`toProductTheme`), then the engine's two outputs.
 *   - `css`: the theme's stylesheet, imported by `main.css` right after `tailwindcss` and `@nuxt/ui`, so Tailwind
 *     compiles its `@theme` blocks with them (`#build/beantragt-theme.css`). The engine's own two imports are left
 *     out (main.css has them).
 *   - `config`: the `ui` of the app config, placed by the build ahead of `app/app.config.ts`.
 *   - `fontFamilies`: the families the theme names, declared for `@nuxt/fonts`, which self-hosts them at build time
 *     (contract 6: a theme's font is shipped with the app, never loaded from a foreign server at runtime).
 *
 * The font fallback chain is the product's (lead's decision 13.11.): the engine writes `'<family>', sans-serif`; the
 * build writes today's chain behind any theme's family. It is the chain the browser uses while the font loads or if
 * it fails, not a font choice: it decides nothing about the look once the family has loaded.
 */
import { generateConfig, generateCSS } from './engine/serialize';
import { resolveShade, THEME_DEFAULTS, type ThemeDoc } from './engine/types';
import { primaryRamp, resolveColor, themeTokens, toHex, toProductTheme } from './product-theme';
import { pickPrimaryShade, RAMP_SHADES } from './primary-rule';

/** The fallback chain behind the sans family of any theme (today's `main.css` stack after 'Hanken Grotesk'). */
export const PRODUCT_FONT_FALLBACK = 'ui-sans-serif, system-ui, -apple-system, \'Segoe UI\', Roboto, Helvetica, Arial, sans-serif';

/** The weights the app declares for a self-hosted family (as today for Hanken Grotesk). */
export const PRODUCT_FONT_WEIGHTS = [400, 500, 600, 700];

export interface ThemeOutput {
    css: string
    config: { ui?: Record<string, unknown> }
    fontFamilies: string[]
}

/** The app config object of the engine's `export default defineAppConfig({...})` source. */
export function evaluateThemeConfig(source: string): { ui?: Record<string, unknown> } {
    if (!source.startsWith('export default defineAppConfig(')) throw new Error('theme config: unexpected source from the engine');
    // The engine prints an object literal (json5 shape); evaluated here at build time, never in the browser.
    return new Function('defineAppConfig', source.replace(/^export default /u, 'return '))((value: unknown) => value) as { ui?: Record<string, unknown> };
}

function withoutFrameworkImports(css: string): string {
    return css.replace(/^@import "tailwindcss";\n@import "@nuxt\/ui";\n*/u, '');
}

/** The theme's CSS without the engine's imports, with the product's font fallback chain. */
export function themeCSS(doc: ThemeDoc): string {
    // `explicit` writes `--font-sans` also for the framework's default family, so the chain is always the product's.
    const css = withoutFrameworkImports(generateCSS(doc, 'nuxt', { explicit: true }));
    const withChain = css.replace(/^(\s*--font-sans: '[^']+'), sans-serif;$/mu, `$1, ${PRODUCT_FONT_FALLBACK};`);
    // Never let the chain drop out silently: the engine changed its line, or a family breaks the pattern.
    if (!withChain.includes(`, ${PRODUCT_FONT_FALLBACK};`)) {
        throw new Error(`theme output: the product's font fallback chain could not be written behind --font-sans (the engine's line is now: ${css.match(/^.*--font-sans:.*$/mu)?.[0]?.trim() ?? 'missing'}).`);
    }
    return withChain;
}

/** The platform uses the neutral palette until a jurisdiction supplies its configuration. */
export function platformPrimaryCSS(installation: ThemeDoc): string {
    const platform = { version: 1, colors: { primary: 'neutral' } } as const;
    const ramp = primaryRamp(platform);
    const nativeShades = Object.fromEntries(RAMP_SHADES.map(shade => [
        `--ui-color-primary-${shade}`, resolveShade(platform, platform.colors.primary, shade)!
    ]));
    function primaryToken(mode: 'light' | 'dark') {
        const surface = themeTokens(installation, mode);
        const { shade } = pickPrimaryShade({
            ramp,
            preferred: mode === 'light' ? 900 : 100,
            label: toHex(resolveColor(installation, surface['--ui-text-inverted']!, surface)!),
            background: toHex(resolveColor(installation, surface['--ui-bg']!, surface)!)
        });
        return `var(--ui-color-primary-${shade})`;
    }
    return withoutFrameworkImports(generateCSS({
        version: 1,
        tokens: {
            light: { ...nativeShades, '--ui-primary': primaryToken('light') },
            dark: { '--ui-primary': primaryToken('dark') }
        }
    }));
}

/** Everything the build needs for a theme document, with the product rules applied. */
export function themeOutput(doc: ThemeDoc): ThemeOutput {
    const product = toProductTheme(doc);
    const fontFamilies = [product.font?.sans ?? THEME_DEFAULTS.font, product.font?.serif, product.font?.mono]
        .filter((family, index, list): family is string => Boolean(family) && list.indexOf(family) === index);
    return { css: themeCSS(product), config: evaluateThemeConfig(generateConfig(product)), fontFamilies };
}
