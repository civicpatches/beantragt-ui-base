/**
 * Why a workflow status cannot be deleted ( and 31775aa).
 *
 * Pure module: the settings page imports it as well as the server routes, so
 * it uses neither h3 nor node APIs.
 *
 * Drupal computes the JSON:API attribute `delete_blockers` on
 * `workflow_status` with the same function its delete access uses. The list
 * is closed and comes in this order; `[]` means deletable. The attribute is
 * ABSENT for a caller without "administer workflow_status entities": absent
 * is not empty and never means deletable.
 */
export const WORKFLOW_STATUS_DELETE_BLOCKERS = [
    'default',
    'application_reference',
    'application_revision_reference',
    'transition_reference',
    'form_workflow_reference'
] as const;

export type WorkflowStatusDeleteBlocker = typeof WORKFLOW_STATUS_DELETE_BLOCKERS[number];

/** The JSON:API attribute; named only in the request of the settings list. */
export const DELETE_BLOCKERS_FIELD = 'delete_blockers';

/**
 * Closed parse of the attribute.
 * - Not an array: `undefined` (absent stays absent).
 * - An array: the known codes in the fixed order, unknown ones dropped.
 * - A non-empty array without any known code: `undefined`. Drupal blocks the
 *   status for a reason this build does not know, so it must not read as
 *   deletable; the page then behaves as for an absent attribute.
 */
export function parseDeleteBlockers(value: unknown): WorkflowStatusDeleteBlocker[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const given = new Set(value.filter((code): code is string => typeof code === 'string'));
    const known = WORKFLOW_STATUS_DELETE_BLOCKERS.filter(code => given.has(code));
    if (value.length > 0 && known.length === 0) return undefined;
    return known;
}

/** The token Drupal appends to the 403 detail of a protected status. */
const REFUSAL_TOKEN = /\[delete_blockers=([a-z_]+(?:,[a-z_]+)*)\]/;
/** The sentence of that refusal; without a token it means "protected, reason not told". */
const PROTECTED_SENTENCE = 'Workflow status is protected from deletion.';

/**
 * What a 403 of the DELETE says, read from `errors[0].detail` only.
 * - `{ blockers }`: protected, with the known codes of the token.
 * - `'protected'`: protected, no known reason (sentence without token, or a
 *   token without a known code).
 * - `null`: another refusal (no permission, no group access) or a body that is
 *   not this JSON:API answer. Nothing of the detail is passed on.
 */
export function parseDeleteRefusal(body: string): { blockers: WorkflowStatusDeleteBlocker[] } | 'protected' | null {
    let detail: unknown;
    try {
        detail = (JSON.parse(body) as { errors?: Array<{ detail?: unknown }> } | null)?.errors?.[0]?.detail;
    } catch {
        return null;
    }
    if (typeof detail !== 'string') return null;
    const token = REFUSAL_TOKEN.exec(detail);
    if (token) {
        const blockers = parseDeleteBlockers(token[1]!.split(','));
        return blockers?.length ? { blockers } : 'protected';
    }
    return detail.trim() === PROTECTED_SENTENCE ? 'protected' : null;
}

/** One error code per blocker, the codes the page and its texts already know. */
export const DELETE_BLOCKER_ERROR_CODES: Record<WorkflowStatusDeleteBlocker, string> = {
    default: 'errors.workflow.defaultCannotDelete',
    application_reference: 'errors.workflow.statusInUse',
    application_revision_reference: 'errors.workflow.statusInUse',
    transition_reference: 'errors.workflow.statusInTransitions',
    form_workflow_reference: 'errors.workflow.statusStillListed'
};
