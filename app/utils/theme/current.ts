/**
 * This theme defines the default appearance. The build uses it to generate the app config and CSS when
 * `NUXT_UI_THEME` is unset. The unit test compares the resolved `ui` config, CSS variables and font stack
 * with a baseline fixture.
 *
 * Not expressible in a theme document, so it stays in main.css: the selector-scoped variables of the form controls
 * (`:where(input …)`, `:where([role="switch"])`) and the plain rules (textarea). The fallback chain of the font stack
 * is a product rule of the build (`theme-output.ts`).
 */
import type { ThemeDoc } from './engine/types';

const optionHighlight = { slots: { item: 'data-highlighted:not-data-disabled:before:bg-elevated' } };
const menuHighlight = {
    variants: { active: { false: { item: 'data-highlighted:before:bg-elevated' } } },
    compoundVariants: [
        { color: 'primary', active: false, class: { item: 'data-highlighted:before:bg-primary/20' } },
        { color: 'secondary', active: false, class: { item: 'data-highlighted:before:bg-secondary/20' } },
        { color: 'success', active: false, class: { item: 'data-highlighted:before:bg-success/20' } },
        { color: 'info', active: false, class: { item: 'data-highlighted:before:bg-info/20' } },
        { color: 'warning', active: false, class: { item: 'data-highlighted:before:bg-warning/20' } },
        { color: 'error', active: false, class: { item: 'data-highlighted:before:bg-error/20' } }
    ]
};

export const currentTheme: ThemeDoc = {
    version: 1,
    // app.config.ts `ui.colors`; neutral `slate` is also the framework default, so the engine does not print it.
    colors: {
        primary: 'red',
        secondary: 'violet',
        neutral: 'slate'
    },
    // main.css `@theme --font-sans` (self-hosted by @nuxt/fonts, nuxt.config.ts `fonts.families`).
    font: { sans: 'Hanken Grotesk' },
    // Radius, font size and icon set: the framework defaults (0.25rem, 16 px, lucide), as today.
    tokens: {
        // The four state colours have explicit light-mode shades. Their dark values
        // are the library's own, so the engine restates them in `.dark` by itself.
        // Primary: the framework's own `red` ramp. Light text and controls use 600,
        // 4.8:1 on white; dark keeps the library's default.
        light: {
            '--ui-error': 'var(--ui-color-error-700)',
            '--ui-success': 'var(--ui-color-success-800)',
            '--ui-warning': 'var(--ui-color-warning-800)',
            '--ui-info': 'var(--ui-color-info-700)',
            // Mix neutral 500 and 400 for a softer outline that still meets WCAG 1.4.11.
            // It reaches 3.5:1 on white and 3.35:1 on the muted page.
            '--ui-border-control': 'color-mix(in srgb, var(--ui-color-neutral-500) 50%, var(--ui-color-neutral-400))',
            '--ui-primary': 'var(--ui-color-primary-600)'
        },
        dark: {
            // Use neutral 500 for form-control outlines in dark mode. It reaches 3.74:1 against the dark page,
            // above the 3:1 minimum in WCAG 1.4.11.
            '--ui-border-control': 'var(--ui-color-neutral-500)'
        }
    },
    // app.config.ts `ui.button`, `ui.alert`, `ui.badge`, `ui.modal`, `ui.icons`. Alert and badge go here and not into
    // `style.defaults`: the engine's groups would also set the button (`buttons`) and the card (`panels`). The one
    // icon override rides along with the components: the engine knows icon sets, not a single icon, and merges this
    // object into `ui` as written.
    components: {
        select: optionHighlight,
        selectMenu: optionHighlight,
        inputMenu: optionHighlight,
        listbox: optionHighlight,
        dropdownMenu: menuHighlight,
        contextMenu: menuHighlight,
        commandPalette: { variants: { active: { false: optionHighlight.slots } } },
        button: {
            variants: {
                size: {
                    md: { leadingIcon: 'size-4', trailingIcon: 'size-4' },
                    lg: { leadingIcon: 'size-4', trailingIcon: 'size-4' },
                    xl: { leadingIcon: 'size-5', trailingIcon: 'size-5' }
                }
            },
            compoundVariants: [
                { size: 'md', square: true, class: 'p-2' },
                { size: 'lg', square: true, class: 'p-2.5' },
                { size: 'xl', square: true, class: 'p-2.5' }
            ]
        },
        alert: {
            defaultVariants: { variant: 'subtle', color: 'neutral' }
        },
        toast: {
            defaultVariants: { color: 'neutral' }
        },
        badge: {
            defaultVariants: { variant: 'subtle' }
        },
        modal: {
            slots: { footer: 'justify-end' }
        },
        // Set staff table density in the installation theme so every `UTable` gets the same spacing.
        // Theme overrides supply their own `table` settings or use the framework defaults.
        table: {
            slots: { th: 'px-2 py-2 font-medium text-muted', td: 'px-2 py-2' }
        },
        icons: {
            external: 'i-lucide-external-link'
        }
    }
};
