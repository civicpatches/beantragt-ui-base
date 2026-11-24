import { createSafeError } from './error-handling';
import { normalizePublicWorkspaceSlug } from './public-workspace';

export function normalizeOrganisationQuery(query: Record<string, unknown>, notFoundCode: string): string | null {
    if (query.organisation === undefined && query.organization === undefined && query.org === undefined) {
        return null;
    }

    const organisation = normalizePublicWorkspaceSlug(query.organisation ?? query.organization ?? query.org);
    if (organisation) {
        return organisation;
    }

    throw createSafeError({
        statusCode: 404,
        message: notFoundCode,
        data: { code: notFoundCode }
    });
}
