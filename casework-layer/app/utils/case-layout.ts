export const CASE_SECTION_IDS = [
    'attachments', 'data', 'messages', 'docgen', 'delivery', 'transfers', 'supplements', 'responses',
    'deadline', 'assignment', 'status_history', 'crm'
] as const;

export type CaseSectionId = typeof CASE_SECTION_IDS[number];
export type CaseColumn = 'left' | 'right';
export interface CaseLayout {
    version: 1
    left: CaseSectionId[]
    right: CaseSectionId[]
}

export function defaultCaseLayout(): CaseLayout {
    return { version: 1, left: ['attachments', 'data', 'messages', 'docgen', 'delivery', 'transfers', 'supplements', 'responses'], right: ['deadline', 'assignment', 'status_history', 'crm'] };
}

/** Stored layouts include optional layer IDs; rendering skips absent outlets. */
export function isCaseLayout(value: unknown): value is CaseLayout {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const candidate = value as Record<string, unknown>;
    if (Object.keys(candidate).length !== 3 || candidate.version !== 1 || !Array.isArray(candidate.left) || !Array.isArray(candidate.right)) return false;
    const ids = [...candidate.left, ...candidate.right];
    return ids.length === CASE_SECTION_IDS.length && new Set(ids).size === ids.length
      && ids.every(id => CASE_SECTION_IDS.includes(id));
}

export function copyCaseLayout(layout: CaseLayout): CaseLayout {
    return { version: 1, left: [...layout.left], right: [...layout.right] };
}

export function resolveCaseLayout(personal: CaseLayout | null, workspace: CaseLayout | null): CaseLayout {
    return copyCaseLayout(personal ?? workspace ?? defaultCaseLayout());
}

export function moveCaseSection(layout: CaseLayout, id: CaseSectionId, column: CaseColumn, index: number): CaseLayout {
    const next = copyCaseLayout(layout);
    next.left = next.left.filter(item => item !== id);
    next.right = next.right.filter(item => item !== id);
    next[column].splice(Math.max(0, Math.min(index, next[column].length)), 0, id);
    return next;
}

export const PRO_CASE_OUTLETS = {
    docgen: 'case-docgen', delivery: 'case-delivery', transfers: 'case-transfers', supplements: 'case-supplements'
} as const;
