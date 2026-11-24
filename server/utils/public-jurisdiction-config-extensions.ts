interface PublicJurisdictionConfigContext {
    jurisdictionSlug: string
    organisationSlug: string | null
    config: object
}

type PublicJurisdictionConfigExtension = (context: PublicJurisdictionConfigContext) => Record<string, unknown>;

const extensions = new Set<PublicJurisdictionConfigExtension>();

export function registerPublicJurisdictionConfigExtension(extension: PublicJurisdictionConfigExtension): () => void {
    extensions.add(extension);
    return () => {
        extensions.delete(extension);
    };
}

export function publicJurisdictionConfigExtensions(context: PublicJurisdictionConfigContext): Record<string, unknown> {
    return Object.assign({}, ...Array.from(extensions, extend => extend(context)));
}
