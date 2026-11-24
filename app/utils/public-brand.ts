export interface PublicWorkspaceBrand {
    jurisdictionSlug: string
    name: string
    subtitle: string
    logoSrc?: string
    /** Variant of `logoSrc` drawn for a dark background; without it dark mode puts the logo on a white plate. */
    logoDarkSrc?: string
    logoAlt?: string
    startTitle?: {
        de: string
        en: string
    }
    startSubtitle?: {
        de: string
        en: string
    }
    showOnHome?: boolean
}

interface PublicWorkspaceBrandInput {
    jurisdictionSlug?: string | null
}

/**
 * Static brands shipped with the bundle, keyed on the jurisdiction slug. Empty on purpose: product
 * code names no real municipality; a tenant's name, logo and texts come from its configuration
 * (`theme`, `jurisdiction.name`) served by the backend.
 */
const WORKSPACE_BRANDS: Record<string, PublicWorkspaceBrand> = {};

function normalizeBrandSlug(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const slug = value.trim().toLowerCase();
    return /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/.test(slug) ? slug : null;
}

export function getPublicWorkspaceBrandBySlug(slug: string | null | undefined): PublicWorkspaceBrand | null {
    const normalized = normalizeBrandSlug(slug);
    return normalized ? WORKSPACE_BRANDS[normalized] || null : null;
}

export function getPublicWorkspaceBrand(input: PublicWorkspaceBrandInput): PublicWorkspaceBrand | null {
    return getPublicWorkspaceBrandBySlug(input.jurisdictionSlug);
}

export function listFeaturedPublicWorkspaceBrands(): PublicWorkspaceBrand[] {
    return Object.values(WORKSPACE_BRANDS)
        .filter(brand => brand.showOnHome)
        .sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

export function localizedBrandText(
    value: PublicWorkspaceBrand['startTitle'] | PublicWorkspaceBrand['startSubtitle'] | undefined,
    locale: string
): string | null {
    if (!value) return null;
    return locale === 'en' ? value.en : value.de;
}
