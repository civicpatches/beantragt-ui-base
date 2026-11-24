/**
 * Finite vocabulary of the Nachreichung staff API (beantragt_nachreichung,
 * step 1: cover sheet card, print, revoke; step 2: receipts, deadline
 * extension, remove and reassign).
 *
 * The Nuxt proxy forwards only these codes (and docgen codes); anything else
 * becomes nachreichung.internal_error. Every code has a translation under
 * `nachreichung.*` in both locales (tests/unit/utils/nachreichung.test.ts).
 */
export const NACHREICHUNG_ERROR_CODES = [
    'nachreichung.access_denied',
    'nachreichung.csrf_invalid',
    'nachreichung.input_invalid',
    'nachreichung.workspace_required',
    'nachreichung.application_not_found',
    'nachreichung.cover_not_found',
    'nachreichung.cover_sheet_disabled',
    'nachreichung.holiday_region_required',
    'nachreichung.cover_limit_reached',
    'nachreichung.cover_not_active',
    'nachreichung.cover_already_revoked',
    'nachreichung.application_anonymized',
    'nachreichung.letterhead_missing',
    'nachreichung.locked',
    'nachreichung.rate_limited',
    'nachreichung.busy',
    'nachreichung.cover_sheet_unavailable',
    'nachreichung.audit_unavailable',
    // Step 2: deadline extension, unassign.
    'nachreichung.request_not_found',
    'nachreichung.request_closed',
    'nachreichung.deadline_invalid',
    'nachreichung.entry_not_found',
    'nachreichung.entry_reverted',
    'nachreichung.reassign_window_closed',
    'nachreichung.internal_error'
] as const;

/** Why "Deckblatt drucken" is not possible right now (card `printBlocker`). */
export const NACHREICHUNG_PRINT_BLOCKERS = [
    'nachreichung.cover_sheet_disabled',
    'nachreichung.holiday_region_required',
    'nachreichung.cover_limit_reached',
    'nachreichung.application_anonymized'
] as const;

/** Closed list of revoke reasons ("Deckblatt sperren"). */
export const NACHREICHUNG_REVOKE_REASONS = ['lost', 'copied', 'other'] as const;

export const NACHREICHUNG_REQUEST_STATES = ['draft', 'open', 'partly_answered', 'answered', 'superseded'] as const;
/** Request records that still wait for documents ("Frist verlängern" is possible only for these). */
export const NACHREICHUNG_WAITING_STATES = ['open', 'partly_answered'] as const;
/** Why the deadline of a request was extended ("Frist der Nachforderung verlängern"). */
export const NACHREICHUNG_DEADLINE_REASONS = ['applicant_request', 'third_party_delay', 'other'] as const;
/** Decision of a receipt ("Eingang") at the application: W, N, A; X never reaches the application. */
export const NACHREICHUNG_ENTRY_DECISIONS = ['take_over', 'request_again', 'file_only'] as const;
/** How a receipt left the application: "Vom Antrag entfernen" or "Neu zuordnen". */
export const NACHREICHUNG_REVERT_MODES = ['remove', 'reassign'] as const;
export const NACHREICHUNG_RECEIVED_ON_SOURCES = ['batch', 'folder', 'manual'] as const;
export const NACHREICHUNG_PROOF_STATUSES = ['present', 'insufficient', 'missing'] as const;
export const NACHREICHUNG_PROOF_REASONS = ['person_unmatched', 'requirement_not_met', 'illegible'] as const;
export const NACHREICHUNG_COVER_ORIGINS = ['letter', 'staff', 'portal'] as const;
export const NACHREICHUNG_COVER_STATES = ['draft', 'active', 'revoked'] as const;

export type NachreichungErrorCode = typeof NACHREICHUNG_ERROR_CODES[number];
export type NachreichungPrintBlocker = typeof NACHREICHUNG_PRINT_BLOCKERS[number];
export type NachreichungRevokeReason = typeof NACHREICHUNG_REVOKE_REASONS[number];
export type NachreichungRequestState = typeof NACHREICHUNG_REQUEST_STATES[number];
export type NachreichungCoverOrigin = typeof NACHREICHUNG_COVER_ORIGINS[number];
export type NachreichungCoverState = typeof NACHREICHUNG_COVER_STATES[number];
export type NachreichungDeadlineReason = typeof NACHREICHUNG_DEADLINE_REASONS[number];
export type NachreichungEntryDecision = typeof NACHREICHUNG_ENTRY_DECISIONS[number];
export type NachreichungRevertMode = typeof NACHREICHUNG_REVERT_MODES[number];
export type NachreichungReceivedOnSource = typeof NACHREICHUNG_RECEIVED_ON_SOURCES[number];
export type NachreichungProofStatus = typeof NACHREICHUNG_PROOF_STATUSES[number];
export type NachreichungProofReason = typeof NACHREICHUNG_PROOF_REASONS[number];

const ERROR_SET = new Set<string>(NACHREICHUNG_ERROR_CODES);

export function isNachreichungErrorCode(value: unknown): value is NachreichungErrorCode {
    return typeof value === 'string' && ERROR_SET.has(value);
}

export function isNachreichungRevokeReason(value: unknown): value is NachreichungRevokeReason {
    return typeof value === 'string' && (NACHREICHUNG_REVOKE_REASONS as readonly string[]).includes(value);
}

export function isNachreichungDeadlineReason(value: unknown): value is NachreichungDeadlineReason {
    return typeof value === 'string' && (NACHREICHUNG_DEADLINE_REASONS as readonly string[]).includes(value);
}

/** The code itself when known, otherwise nachreichung.internal_error. */
export function nachreichungCode(value: unknown): NachreichungErrorCode {
    return isNachreichungErrorCode(value) ? value : 'nachreichung.internal_error';
}
