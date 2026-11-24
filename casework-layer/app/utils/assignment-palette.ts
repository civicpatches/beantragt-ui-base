import type {
    AdminApplicationAssignee,
    AdminApplicationDelegationTarget
} from '~/types';
import { normalizeSearchValue } from '~~/casework-layer/app/utils/org-catalog-palette';

export function teamCandidateToDelegationTarget(candidate: AdminApplicationAssignee): AdminApplicationDelegationTarget {
    return {
        uuid: candidate.id,
        label: candidate.label,
        slug: candidate.slug ?? null,
        parent_org_uuid: candidate.parent_org_uuid ?? null
    };
}

export function filterPersonCandidates(
    candidates: readonly AdminApplicationAssignee[],
    rawQuery: string,
    limit = 50
): AdminApplicationAssignee[] {
    const query = normalizeSearchValue(rawQuery);
    const matches = query
        ? candidates.filter(candidate => normalizeSearchValue(candidate.label).includes(query))
        : [...candidates];

    return matches.slice(0, limit);
}
