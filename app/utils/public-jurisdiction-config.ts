export interface PublicJurisdictionConfig {
    jurisdiction?: {
        uuid?: string | null
        slug?: string | null
        name?: string | null
    } | null
    theme?: {
        primary?: string | null
        secondary?: string | null
        neutral?: string | null
        logoDataUrl?: string | null
        /** Optional logo for the dark view of the screen pages; mails, letterhead and print use `logoDataUrl` only. */
        logoDarkDataUrl?: string | null
        logoAlt?: string | null
    } | null
    languages?: {
        default?: string | null
        available?: string[] | null
    } | null
    general?: {
        contactEmail?: string | null
        website?: string | null
        phone?: string | null
    } | null
    legal?: {
        legalNotice?: string | null
        privacyPolicy?: string | null
    } | null
    customCss?: string | null
    /**
     * Applicant profile switch and backend consent templates. Templates are
     * keyed by locale and carry the {stelle} placeholder.
     */
    applicantProfile?: {
        enabled?: boolean
        scope?: 'organisation' | 'jurisdiction'
        /** Separate switch for the bank consent checkbox, default off. */
        bankConsent?: boolean
        consentTextVersion?: string
        consentText?: Record<string, string> | null
        bankConsentTextVersion?: string
        bankConsentText?: Record<string, string> | null
    } | null
}

const PUBLIC_JURISDICTION_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/;
const NUMERIC_ID_PATTERN = /^[0-9]{1,12}$/;

function trimmedString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function normalizePublicJurisdictionSlug(value: unknown): string | null {
    const slug = trimmedString(value)?.toLowerCase() || null;
    return slug && !NUMERIC_ID_PATTERN.test(slug) && PUBLIC_JURISDICTION_SLUG_PATTERN.test(slug) ? slug : null;
}

export function normalizePublicOrganisationSlug(value: unknown): string | null {
    const slug = trimmedString(value)?.toLowerCase() || null;
    return slug && PUBLIC_JURISDICTION_SLUG_PATTERN.test(slug) ? slug : null;
}

export function publicJurisdictionConfigEndpoint(value: unknown, organisation?: unknown): string | null {
    const slug = normalizePublicJurisdictionSlug(value);
    if (!slug) return null;

    if (organisation === undefined || organisation === null || organisation === '') {
        return `/api/jurisdictions/${encodeURIComponent(slug)}/config`;
    }
    const organisationSlug = normalizePublicOrganisationSlug(organisation);
    return organisationSlug
        ? `/api/jurisdictions/${encodeURIComponent(slug)}/config?organisation=${encodeURIComponent(organisationSlug)}`
        : null;
}

export function publicJurisdictionName(config: PublicJurisdictionConfig | null | undefined): string | null {
    return trimmedString(config?.jurisdiction?.name);
}

export function publicJurisdictionPrimaryColor(config: PublicJurisdictionConfig | null | undefined): string | null {
    return trimmedString(config?.theme?.primary);
}

export function publicJurisdictionLogoSrc(config: PublicJurisdictionConfig | null | undefined): string | null {
    return trimmedString(config?.theme?.logoDataUrl);
}

/** The uploaded logo for the dark view, or null (absent until the backend serves the key). */
export function publicJurisdictionLogoDarkSrc(config: PublicJurisdictionConfig | null | undefined): string | null {
    return trimmedString(config?.theme?.logoDarkDataUrl);
}

export function publicJurisdictionLogoAlt(config: PublicJurisdictionConfig | null | undefined): string | null {
    return trimmedString(config?.theme?.logoAlt);
}
