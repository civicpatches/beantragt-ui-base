/**
 * The personal theme mock in the browser (theme-je-person-plan.md; development server only). It switches
 * the administration between the installation's theme ("Standard") and the offered presets the build generated
 * (`#build/beantragt-staff-themes`, see `app/utils/theme/staff-theme-preview.ts`), and keeps the choice in this
 * browser's localStorage only: no account field, no request to the backend.
 *
 * Applying a theme does three things, all undone by `apply(null)`:
 * - the app config: every key of `appConfig.ui` is replaced or deleted (Nuxt's `updateAppConfig` never deletes a key
 *   and merges arrays per index, so a theme would keep the previous one's defaults);
 * - the tokens: one `<style>` at the end of `<head>` (after the installation's CSS: same specificity, so the order
 *   decides) and `data-staff-theme` on `<html>`, which its selectors require;
 * - the font: the theme's families as a stylesheet of the Google provider, on demand (the build self-hosts only the
 *   installation's family; a rough edge of the mock).
 */
import type { StaffPreviewTheme } from '~/utils/theme/staff-theme-preview';

/** Same value as `STAFF_THEME_ATTRIBUTE` in `app/utils/theme/staff-theme-preview.ts` (a test keeps them equal). */
export const STAFF_THEME_ATTRIBUTE = 'data-staff-theme';
export const STAFF_THEME_STORAGE_KEY = 'beantragt-staff-theme-preview';
export const STAFF_THEME_STYLE_ID = 'beantragt-staff-theme-preview';
const FONT_LINK_ATTRIBUTE = 'data-staff-theme-font';
const FONT_WEIGHTS = '400;500;600;700';

/** The provider's stylesheet of a family, in the weights the build self-hosts (`PRODUCT_FONT_WEIGHTS`). */
export function googleFontHref(family: string): string {
    return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${FONT_WEIGHTS}&display=swap`;
}

/** The stored choice, if it is still offered; null ("Standard") otherwise or when storage is not available. */
export function readStoredTheme(storage: () => Storage | undefined, offered: string[]): string | null {
    try {
        const value = storage()?.getItem(STAFF_THEME_STORAGE_KEY) ?? null;
        return value && offered.includes(value) ? value : null;
    } catch {
        return null;
    }
}

/** Stores the choice; "Standard" removes the entry. Never throws (private mode, blocked storage). */
export function storeTheme(storage: () => Storage | undefined, id: string | null): void {
    try {
        if (id) storage()?.setItem(STAFF_THEME_STORAGE_KEY, id);
        else storage()?.removeItem(STAFF_THEME_STORAGE_KEY);
    } catch {
        // The choice then lasts until the page is left; nothing else depends on it.
    }
}

function copy<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function replaceKeys(target: Record<string, unknown>, source: Record<string, unknown>): void {
    for (const key of Object.keys(target)) {
        if (!(key in source)) Reflect.deleteProperty(target, key);
    }
    for (const [key, value] of Object.entries(source)) target[key] = copy(value);
}

export interface StaffThemeSwitch {
    apply: (id: string | null) => void
    /** The installation's `appConfig.ui` as it was when the switch was created. */
    readonly snapshot: Record<string, unknown>
}

/** A switch over `ui` (the reactive `appConfig.ui`) and `doc`. Create it before the first `apply`, undo with `apply(null)`. */
export function createStaffThemeSwitch(options: {
    doc: Document
    ui: Record<string, unknown>
    themes: StaffPreviewTheme[]
    fontHref?: (family: string) => string
}): StaffThemeSwitch {
    const { doc, ui, themes, fontHref = googleFontHref } = options;
    const snapshot = copy(ui);

    function apply(id: string | null): void {
        const theme = id ? themes.find(entry => entry.id === id) : undefined;
        replaceKeys(ui, theme ? theme.ui : snapshot);

        const root = doc.documentElement;
        let style = doc.getElementById(STAFF_THEME_STYLE_ID);
        if (!theme) {
            style?.remove();
            root.removeAttribute(STAFF_THEME_ATTRIBUTE);
            for (const link of doc.querySelectorAll(`link[${FONT_LINK_ATTRIBUTE}]`)) link.remove();
            return;
        }
        if (!style) {
            style = doc.createElement('style');
            style.id = STAFF_THEME_STYLE_ID;
        }
        style.textContent = theme.css;
        // Appended anew each time, so it stays after every stylesheet loaded meanwhile.
        doc.head.appendChild(style);
        root.setAttribute(STAFF_THEME_ATTRIBUTE, theme.id);
        for (const family of theme.fontFamilies) {
            if (doc.querySelector(`link[${FONT_LINK_ATTRIBUTE}="${family}"]`)) continue;
            const link = doc.createElement('link');
            link.rel = 'stylesheet';
            link.href = fontHref(family);
            link.setAttribute(FONT_LINK_ATTRIBUTE, family);
            doc.head.appendChild(link);
        }
    }

    return { apply, snapshot };
}
