import type { ComputedRef } from 'vue';
import {
    localizedContentPagePath,
    localeOrDefault,
    PUBLIC_CONTENT_PAGE_KEYS
} from '~/utils/locale-routing';
import type { PublicContentFooterLink } from '~/utils/public-content-pages';
import type { PublicFormPathInput } from '~/utils/public-form-path';
import { PUBLIC_CONTENT_FALLBACKS } from '~/utils/public-content-fallbacks';

type FooterLinkCache = Record<string, PublicContentFooterLink[]>;

function cacheKey(workspace: PublicFormPathInput, locale: string): string {
    return `${workspace.jurisdictionSlug || ''}:${workspace.organisationSlug || ''}:${localeOrDefault(locale)}`;
}

/**
 * Links of the shared citizen footer.
 *
 * The page list of a municipality is loaded by the start page only, which
 * already asked for it; it hands the answer over with `remember()`. Every
 * other page reads that answer when it is there and otherwise links the five
 * standard pages by key. The accessibility statement also stays linked when
 * the page list omits it. The footer adds no request to any page load.
 * A standard page the municipality has not filled in says so itself.
 */
export function usePublicFooterLinks(workspace: ComputedRef<PublicFormPathInput>) {
    const { locale } = useI18n();
    const cache = useState<FooterLinkCache>('public-footer-links', () => ({}));
    const key = computed(() => cacheKey(workspace.value, locale.value));

    const standardLinks = computed<PublicContentFooterLink[]>(() =>
        PUBLIC_CONTENT_PAGE_KEYS.map((pageKey, index) => ({
            id: `standard-${pageKey}`,
            key: pageKey,
            // The title of the page itself ("Datenschutzerklärung"), the name
            // a municipality's own page list uses too (C5: one name per page).
            title: localeOrDefault(locale.value) === 'en'
                ? PUBLIC_CONTENT_FALLBACKS[pageKey].titleEn
                : PUBLIC_CONTENT_FALLBACKS[pageKey].titleDe,
            order: (index + 1) * 10,
            path: localizedContentPagePath(pageKey, locale.value, workspace.value)
        }))
    );

    const links = computed(() => {
        const remembered = cache.value[key.value];
        if (!remembered?.length) return standardLinks.value;
        if (remembered.some(link => link.key === 'accessibility')) return remembered;

        const accessibilityFallback = standardLinks.value.filter(link => link.key === 'accessibility');
        return [...remembered, ...accessibilityFallback]
            .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
    });

    function remember(remote: PublicContentFooterLink[]): void {
        cache.value = { ...cache.value, [key.value]: remote };
    }

    return { links, remember };
}
