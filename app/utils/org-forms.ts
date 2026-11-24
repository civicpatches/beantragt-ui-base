/**
 * Minimal shape of a discoverable public form (subset of the
 * `/api/schemas/published` response used by the citizen side).
 */
export interface DiscoverableForm {
    id: string
    title: string
    description: string
    status: string
    jurisdictionSlug?: string | null
    jurisdictionLabel?: string | null
    organisationSlug?: string | null
    organisationLabel?: string | null
    path?: string
}

/**
 * Filters a discoverable-form list down to a single organisation within a
 * jurisdiction.
 *
 * The `/api/schemas/published` endpoint already filters server-side when given
 * `jurisdiction` + `organisation` query params, but this pure helper makes the
 * scoping explicit and verifiable: a form belongs to the org only when both its
 * jurisdiction and organisation slugs match. Forms without an organisation
 * (jurisdiction-level forms) are excluded from an org context.
 *
 * @param forms            Discoverable forms (any scope).
 * @param jurisdictionSlug Active jurisdiction slug.
 * @param organisationSlug Active organisation slug.
 */
export function filterFormsByOrg(
    forms: readonly DiscoverableForm[],
    jurisdictionSlug: string | null,
    organisationSlug: string | null
): DiscoverableForm[] {
    if (!jurisdictionSlug || !organisationSlug) return [];

    return forms.filter(form =>
        form.jurisdictionSlug === jurisdictionSlug
        && form.organisationSlug === organisationSlug);
}
