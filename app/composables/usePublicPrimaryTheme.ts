import type { ComputedRef } from 'vue';
import { publicJurisdictionPrimaryColor } from '~/utils/public-jurisdiction-config';
import { generatePrimaryThemeCSS } from '~/utils/public-theme';

/** The normal and error frames use the same workspace for the header and its primary colour. */
export function usePublicPrimaryTheme(slug: ComputedRef<string | null | undefined>) {
    const { config } = usePublicJurisdictionConfig(slug);
    useHead(() => ({
        // The entry from app.head applies while loading or outside a workspace. A loaded tenant
        // replaces it with its house colour, or an empty sheet to reveal the installation theme.
        style: config.value
            ? [{
                id: 'beantragt-primary-theme',
                tagPosition: 'bodyClose',
                innerHTML: generatePrimaryThemeCSS(publicJurisdictionPrimaryColor(config.value))
            }]
            : []
    }));
}
