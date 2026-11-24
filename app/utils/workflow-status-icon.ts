import { EDIT_ICON, LEGACY_EDIT_ICON } from './action-icons';

export const DEFAULT_WORKFLOW_STATUS_ICON = 'i-lucide-tag';

const WORKFLOW_STATUS_ICON_ALIASES: Record<string, string> = {
    'i-lucide-clipboard-search': 'i-lucide-search',
    // The option "Bearbeiten" offers the product's edit sign; a status that stored the former pencil shows it too.
    [LEGACY_EDIT_ICON]: EDIT_ICON
};

export function normalizeWorkflowStatusIcon(value: unknown): string {
    const icon = typeof value === 'string' ? value.trim() : '';
    if (!icon) return DEFAULT_WORKFLOW_STATUS_ICON;
    return WORKFLOW_STATUS_ICON_ALIASES[icon] ?? icon;
}
