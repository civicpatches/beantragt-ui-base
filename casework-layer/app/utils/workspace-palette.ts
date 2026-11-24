import type { AdminWorkspace } from '~~/casework-layer/app/composables/useWorkspaceContext';

/**
 * Minimal, framework-agnostic shape of a single command-palette entry.
 *
 * Mirrors the relevant fields of `CommandPaletteItem` from `@nuxt/ui` without
 * coupling the pure builder to the component types, so it stays unit-testable.
 */
export interface WorkspacePaletteItem {
    /** Stable key: workspace key for switch entries, or an action id. */
    id: string
    label: string
    /** Searchable secondary text (parent/jurisdiction context). */
    suffix?: string
    icon: string
    /** Marks the entry as the active workspace (no-op on select). */
    active?: boolean
    disabled?: boolean
}

export interface WorkspacePaletteGroup {
    id: string
    label?: string
    items: WorkspacePaletteItem[]
}

/**
 * Labels resolved by the caller (so this stays decoupled from vue-i18n).
 */
export interface WorkspacePaletteLabels {
    citizenView: string
    jurisdictions: string
    /** Group label for orgs, may embed the active jurisdiction label. */
    organisations: string
    /** Suffix appended to the active workspace label, e.g. "(aktuell)". */
    current: string
}

const ICON_CITIZEN_VIEW = 'i-lucide-eye';
const ICON_JURISDICTION = 'i-lucide-landmark';
const ICON_ORGANISATION = 'i-lucide-building-2';
const ICON_CURRENT = 'i-lucide-check';

export const WORKSPACE_PALETTE_CITIZEN_VIEW_ID = 'action:citizen-view';

/**
 * Builds the grouped, jurisdiction-scoped command-palette model for the admin
 * workspace switcher.
 *
 * Scoping rule (AC): the Organisations group only ever contains orgs
 * whose `jurisdictionSlug` equals the active jurisdiction. Orgs from other
 * jurisdictions are never surfaced — neither in the default view nor via search
 * (search runs over the items returned here).
 *
 * @param workspaces        All admin workspaces (jurisdictions + organisations).
 * @param activeJurisdictionSlug Slug of the active jurisdiction to scope orgs to.
 * @param selectedKey       Key of the currently selected workspace (marked active).
 * @param labels            Caller-provided i18n strings.
 */
export function buildWorkspacePaletteGroups(
    workspaces: readonly AdminWorkspace[],
    activeJurisdictionSlug: string | null,
    selectedKey: string | null,
    labels: WorkspacePaletteLabels
): WorkspacePaletteGroup[] {
    const groups: WorkspacePaletteGroup[] = [];

    groups.push({
        id: 'actions',
        items: [
            {
                id: WORKSPACE_PALETTE_CITIZEN_VIEW_ID,
                label: labels.citizenView,
                icon: ICON_CITIZEN_VIEW
            }
        ]
    });

    const jurisdictions = workspaces.filter(workspace => workspace.type === 'jurisdiction');
    if (jurisdictions.length > 0) {
        groups.push({
            id: 'jurisdictions',
            label: labels.jurisdictions,
            items: jurisdictions.map(workspace => toItem(workspace, selectedKey, labels.current))
        });
    }

    const scopedOrganisations = activeJurisdictionSlug
        ? workspaces.filter(workspace =>
            workspace.type === 'organisation'
            && workspace.jurisdictionSlug === activeJurisdictionSlug)
        : [];

    if (scopedOrganisations.length > 0) {
        groups.push({
            id: 'organisations',
            label: labels.organisations,
            items: scopedOrganisations.map(workspace => toItem(workspace, selectedKey, labels.current))
        });
    }

    return groups;
}

function toItem(
    workspace: AdminWorkspace,
    selectedKey: string | null,
    currentSuffix: string
): WorkspacePaletteItem {
    const isCurrent = workspace.key === selectedKey;
    const contextParts = [workspace.parentLabel, workspace.slug].filter(
        (part): part is string => typeof part === 'string' && part.length > 0
    );

    return {
        id: workspace.key,
        label: isCurrent ? `${workspace.label} ${currentSuffix}` : workspace.label,
        // `suffix` is part of the palette's fuzzy-search index (label + suffix),
        // so parentLabel + slug become searchable here.
        suffix: contextParts.length > 0 ? contextParts.join(' · ') : undefined,
        icon: isCurrent
            ? ICON_CURRENT
            : workspace.type === 'organisation'
                ? ICON_ORGANISATION
                : ICON_JURISDICTION,
        active: isCurrent,
        disabled: isCurrent
    };
}
