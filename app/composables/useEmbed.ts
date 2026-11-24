/**
 * Embed mode composable for beantragt.ai
 *
 * Detects embed query parameters and applies appropriate styling:
 * - `?embed=true` - strips header/footer/navigation chrome
 * - `?theme=light|dark` - forces color scheme
 * - `?org={slug}` - applies organization branding (future)
 *
 * Based on Mark-a-Spot useEmbed pattern.
 */

export interface EmbedConfig {
    /** Whether the page is rendered in embed (iframe) mode. */
    isEmbed: ComputedRef<boolean>
    /** Forced theme: 'light', 'dark', or null (system default). */
    forcedTheme: ComputedRef<'light' | 'dark' | null>
    /** Organization slug for branding (future). */
    orgSlug: ComputedRef<string | null>
    /** Apply the forced theme to the document root. Call in onMounted. */
    applyTheme: () => void
    /** Clean up theme overrides. Call in onBeforeUnmount. */
    cleanupTheme: () => void
}

export function useEmbed(): EmbedConfig {
    const route = useRoute();

    const isEmbed = computed(() => route.query.embed === 'true');

    const forcedTheme = computed<'light' | 'dark' | null>(() => {
        const theme = route.query.theme as string | undefined;
        if (theme === 'light' || theme === 'dark') return theme;
        return null;
    });

    // Sanitize org slug: only lowercase alphanumeric + hyphens, max 64 chars
    const orgSlug = computed<string | null>(() => {
        const org = route.query.org as string | undefined;
        if (!org || typeof org !== 'string') return null;
        const sanitized = org.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 64);
        return sanitized.length > 0 ? sanitized : null;
    });

    // Track which theme was applied so cleanup is reliable even if route changes
    let appliedTheme: 'light' | 'dark' | null = null;

    /**
   * Apply the forced theme class to the document root element.
   * This overrides Nuxt UI's color mode detection when a theme
   * query parameter is provided.
   */
    function applyTheme() {
        if (!import.meta.client) return;

        const theme = forcedTheme.value;
        if (!theme) return;

        appliedTheme = theme;
        const root = document.documentElement;
        root.classList.remove('light', 'dark');
        // Apply forced theme
        root.classList.add(theme);
        // Set color-scheme for native elements (scrollbars, form controls)
        root.style.colorScheme = theme;
    }

    /**
   * Clean up: remove forced theme class and inline style.
   * Uses the captured appliedTheme to avoid issues when route
   * query has already changed by the time cleanup runs.
   */
    function cleanupTheme() {
        if (!import.meta.client) return;
        if (!appliedTheme) return;

        const root = document.documentElement;
        root.classList.remove(appliedTheme);
        root.style.removeProperty('color-scheme');
        appliedTheme = null;
    }

    return {
        isEmbed,
        forcedTheme,
        orgSlug,
        applyTheme,
        cleanupTheme
    };
}
