import type {
    AdminApplicationDelegationTarget
} from '~/types';
import type { PublicOrgNode } from '~/types/org-catalog';
import {
    normalizeSearchValue,
    scoreOrg
} from '~~/casework-layer/app/utils/org-catalog-palette';

export interface DelegationTargetWithCatalog {
    target: AdminApplicationDelegationTarget
    node: PublicOrgNode | null
}

export function buildDelegationOrgPath(
    target: AdminApplicationDelegationTarget,
    targetsByUuid: ReadonlyMap<string, AdminApplicationDelegationTarget>
): string[] {
    const labels: string[] = [];
    const visited = new Set([target.uuid]);
    let parentUuid = target.parent_org_uuid;
    let depth = 0;

    while (parentUuid && depth < 10 && !visited.has(parentUuid)) {
        visited.add(parentUuid);
        const parent = targetsByUuid.get(parentUuid);
        if (!parent) break;
        labels.push(parent.label);
        parentUuid = parent.parent_org_uuid;
        depth += 1;
    }

    return labels.reverse();
}

export function joinTargetsWithCatalog(
    targets: readonly AdminApplicationDelegationTarget[],
    catalogOrgs: readonly PublicOrgNode[]
): DelegationTargetWithCatalog[] {
    const catalogBySlug = new Map(catalogOrgs.map(org => [org.slug, org]));

    return targets.map((target) => {
        const slug = typeof target.slug === 'string' ? target.slug.trim() : '';
        return {
            target,
            node: slug ? catalogBySlug.get(slug) ?? null : null
        };
    });
}

function sortDelegationTargets(
    first: DelegationTargetWithCatalog,
    second: DelegationTargetWithCatalog
): number {
    if (first.node && second.node) {
        return first.node.level - second.node.level
          || first.node.code.localeCompare(second.node.code, 'de')
          || first.target.label.localeCompare(second.target.label, 'de');
    }
    if (first.node) return -1;
    if (second.node) return 1;
    return first.target.label.localeCompare(second.target.label, 'de');
}

export function filterDelegationTargets(
    joined: readonly DelegationTargetWithCatalog[],
    rawQuery: string,
    limit = 50
): DelegationTargetWithCatalog[] {
    const query = normalizeSearchValue(rawQuery);
    const bounded = (items: DelegationTargetWithCatalog[]) => items.slice(0, limit);

    if (!query) {
        return bounded([...joined].sort(sortDelegationTargets));
    }

    const targetsByUuid = new Map(joined.map(item => [item.target.uuid, item.target]));
    return bounded(joined
        .map((item) => {
            const catalogScore = item.node ? scoreOrg(item.node, query) : 0;
            if (catalogScore > 0) {
                return { item, score: catalogScore };
            }
            const searchText = normalizeSearchValue([
                item.target.label,
                item.node?.code,
                item.node?.pathCodes.join(' '),
                item.node?.pathLabels.join(' '),
                ...buildDelegationOrgPath(item.target, targetsByUuid)
            ].join(' '));
            return { item, score: searchText.includes(query) ? 50 : 0 };
        })
        .filter(item => item.score > 0)
        .sort((first, second) =>
            second.score - first.score
            || sortDelegationTargets(first.item, second.item))
        .map(item => item.item));
}
