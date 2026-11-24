/**
 * Resolves per-group workflow_status data from a JSON:API `included` block.
 *
 * The applications endpoint includes each application's field_workflow_status
 * plus that status' field_allowed_next graph. These helpers turn the raw
 * included resources into render-ready status objects (label, hex colour, lucide
 * icon) and expose the allowed transition targets so the dashboard can offer
 * only valid inline status changes.
 */

import { normalizeWorkflowStatusIcon } from './workflow-status-icon';

export interface ResolvedStatusRef {
    id: string
    machineName: string
    label: string
    color: string
    icon: string
    semanticFlags: string[]
    /** Texts applicants see instead of the label; empty strings use the label. */
    citizenLabel?: { de: string, en: string }
}

export interface ResolvedStatus extends ResolvedStatusRef {
    weight: number
    allowedNext: ResolvedStatusRef[]
}

interface IncludedResource {
    id: string
    type: string
    attributes?: Record<string, unknown>
    relationships?: Record<string, { data?: Array<{ id: string }> | { id: string } | null }>
}

const STATUS_TYPE = 'workflow_status--workflow_status';

export function humanizeWorkflowStatusMachineName(machineName: string): string {
    return machineName
        .trim()
        .split('_')
        .filter(Boolean)
        .map(part => part.charAt(0).toLocaleUpperCase('de') + part.slice(1))
        .join(' ');
}

/**
 * The text applicants see for a status in a language, like the backend's
 * WorkflowStatus::getCitizenLabel(): en falls back to de, de to the label.
 */
export function workflowStatusCitizenLabel(
    status: { label?: string | null, citizenLabel?: { de?: string | null, en?: string | null } | null },
    langcode: string
): string {
    const de = status.citizenLabel?.de?.trim() ?? '';
    const en = status.citizenLabel?.en?.trim() ?? '';
    const label = status.label?.trim() ?? '';
    if (langcode === 'en') return en || de || label;
    return de || label;
}

/**
 * Plain-text grammar of a citizen text (backend WorkflowStatusCitizenLabel):
 * after trimming at most 120 characters, no control characters, no markup.
 */
export function isValidCitizenLabel(value: string): boolean {
    const trimmed = value.trim();
    // eslint-disable-next-line no-control-regex
    return Array.from(trimmed).length <= 120 && !/[\u0000-\u001f\u007f<>]/u.test(trimmed);
}

/**
 * The citizen text when it differs from the internal label, else ''.
 * Staff views use it for the hint "Applicants see: ...".
 */
export function workflowStatusCitizenHint(
    status: { label?: string | null, citizenLabel?: { de?: string | null, en?: string | null } | null },
    langcode: string
): string {
    const citizen = workflowStatusCitizenLabel(status, langcode);
    return citizen && citizen !== (status.label?.trim() ?? '') ? citizen : '';
}

/** i18n key of a semantic status flag (admin.settings.workflow.semanticOptions.*). */
export function semanticFlagLabelKey(flag: string): string {
    return `admin.settings.workflow.semanticOptions.${flag.replace(/_([a-z])/gu, (_, char: string) => char.toUpperCase())}`;
}

export function workflowStatusDisplayLabel(status: { label?: string | null, machineName?: string | null }): string {
    const label = status.label?.trim();
    if (label) return label;

    const machineName = status.machineName?.trim();
    return machineName ? humanizeWorkflowStatusMachineName(machineName) : '';
}

function statusWeight(resource: IncludedResource): number {
    return Number(resource.attributes?.field_weight ?? 0);
}

function semanticFlags(resource: IncludedResource): string[] {
    const raw = resource.attributes?.field_semantic_flags;
    if (!Array.isArray(raw)) return [];
    return [...new Set(raw.map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object' && 'value' in item) {
            const nested = (item as { value?: unknown }).value;
            return typeof nested === 'string' ? nested : '';
        }
        return '';
    }).filter(Boolean))];
}

function toRef(resource: IncludedResource): ResolvedStatusRef {
    const machineName = String(resource.attributes?.field_machine_name ?? '');
    const label = workflowStatusDisplayLabel({
        label: String(resource.attributes?.label ?? ''),
        machineName
    });

    return {
        id: resource.id,
        machineName,
        label,
        color: String(resource.attributes?.field_color ?? ''),
        icon: normalizeWorkflowStatusIcon(resource.attributes?.field_icon),
        semanticFlags: semanticFlags(resource),
        citizenLabel: {
            de: typeof resource.attributes?.field_citizen_label_de === 'string' ? resource.attributes.field_citizen_label_de : '',
            en: typeof resource.attributes?.field_citizen_label_en === 'string' ? resource.attributes.field_citizen_label_en : ''
        }
    };
}

/**
 * Builds a map of workflow_status id -> resolved status from `included`.
 */
export function buildStatusMap(included: IncludedResource[] | undefined): Map<string, ResolvedStatus> {
    const byId = new Map<string, IncludedResource>();
    for (const resource of included ?? []) {
        if (resource.type === STATUS_TYPE) {
            byId.set(resource.id, resource);
        }
    }

    const map = new Map<string, ResolvedStatus>();
    for (const resource of byId.values()) {
        const rel = resource.relationships?.field_allowed_next?.data;
        const nextRefs = Array.isArray(rel) ? rel : [];
        const allowedNext = nextRefs
            .map(ref => byId.get(ref.id))
            .filter((entry): entry is IncludedResource => Boolean(entry))
            .sort((a, b) => {
                const weightDiff = statusWeight(a) - statusWeight(b);
                return weightDiff !== 0 ? weightDiff : toRef(a).label.localeCompare(toRef(b).label, 'de');
            })
            .map(toRef);

        map.set(resource.id, {
            ...toRef(resource),
            weight: statusWeight(resource),
            allowedNext
        });
    }

    return map;
}

/**
 * Returns the unique statuses present in a status map, sorted by weight.
 *
 * Used to build the toolbar status filter options. Deduplicated by machine name
 * because each organisation owns its own (identically named) status entities.
 */
export function uniqueStatusesByMachineName(map: Map<string, ResolvedStatus>): ResolvedStatus[] {
    const byMachineName = new Map<string, ResolvedStatus>();
    for (const status of map.values()) {
        if (!byMachineName.has(status.machineName)) {
            byMachineName.set(status.machineName, status);
        }
    }
    return [...byMachineName.values()].sort((a, b) => a.weight - b.weight);
}
