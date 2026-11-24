export const BULK_STATUS_KEYS = ['in_vorpruefung', 'intake_failed', 'complete', 'incomplete', 'needs_review', 'pending', 'forwarded', 'requested', 'not_pursued'] as const;
export type BulkStatus = typeof BULK_STATUS_KEYS[number];
export const BULK_DECISION_REASONS = ['duplicate', 'not_a_case', 'wrong_procedure', 'other'] as const;
/** Item codes that describe a document without changing the case status, same list as Drupal `BulkCaseValidator::INFO_CODES`. */
export const BULK_INFO_CODES = ['handwritten', 'foreign_language'] as const;
/** Tri-state answer per criterion (base rules v3), same order as Drupal `BulkAnswer::VALUES`. */
export const BULK_ANSWERS = ['met', 'not_met', 'unclear'] as const;
export type BulkAnswer = typeof BULK_ANSWERS[number];

/**
 * Nachreichung step 2: envelopes of a batch of kind `nachreichung`.
 * Closed lists shared by the proxy sanitizers and the Sichtung Nachreichung.
 */
export const BULK_BATCH_KINDS = ['antraege', 'nachreichung'] as const;
export type BulkBatchKind = typeof BULK_BATCH_KINDS[number];
/** Open statuses first, then `pending` (undo window or executing), then the done statuses and `reverted`. */
export const ENVELOPE_STATUS_KEYS = ['in_pruefung', 'bitte_ansehen', 'zugeordnet', 'es_fehlt_etwas', 'vollstaendig', 'pending', 'take_over', 'request_again', 'file_only', 'outside', 'reverted'] as const;
export type EnvelopeStatus = typeof ENVELOPE_STATUS_KEYS[number];
/** Statuses an envelope can be decided in (`in_pruefung` is still being read). */
export const ENVELOPE_OPEN_STATUSES = ['bitte_ansehen', 'zugeordnet', 'es_fehlt_etwas', 'vollstaendig'] as const satisfies readonly EnvelopeStatus[];
export const ENVELOPE_DONE_STATUSES = ['take_over', 'request_again', 'file_only', 'outside', 'reverted'] as const satisfies readonly EnvelopeStatus[];
/** W, N, A, X. */
export const ENVELOPE_DECISIONS = ['take_over', 'request_again', 'file_only', 'outside'] as const;
export type EnvelopeDecision = typeof ENVELOPE_DECISIONS[number];
/** "Außerhalb bearbeiten": the digits 1 to 7 choose in this order. */
export const ENVELOPE_OUTSIDE_REASONS = ['objection', 'change_notice', 'power_of_attorney', 'case_system', 'not_assignable', 'other_office', 'other'] as const;
export type EnvelopeOutsideReason = typeof ENVELOPE_OUTSIDE_REASONS[number];
export const ENVELOPE_PROOF_STATUSES = ['present', 'insufficient', 'missing'] as const;
export type EnvelopeProofStatus = typeof ENVELOPE_PROOF_STATUSES[number];
export const ENVELOPE_INSUFFICIENT_REASONS = ['person_unmatched', 'requirement_not_met', 'illegible'] as const;
export type EnvelopeInsufficientReason = typeof ENVELOPE_INSUFFICIENT_REASONS[number];
/** Closed notice list of 3.22 in its order; the codes reserved for steps 3 and 4 are left out until they exist. */
export const ENVELOPE_NOTICES = [
    'cover_none', 'cover_unknown', 'cover_revoked', 'cover_conflict', 'cover_only', 'target_manual', 'other_form', 'older_request',
    'request_missing', 'request_answered', 'portal_request', 'late', 'deadline_extended', 'application_decided', 'case_system',
    'already_received', 'receipt_invalid', 'receipt_divergent', 'too_many_pages', 'file_unreadable', 'split_part'
] as const;
export type EnvelopeNotice = typeof ENVELOPE_NOTICES[number];
export const ENVELOPE_COVER_STATES = ['none', 'found', 'unknown', 'revoked', 'conflict', 'cover_only'] as const;
export type EnvelopeCoverState = typeof ENVELOPE_COVER_STATES[number];
/** How the target was set: read from the cover, typed identifier, typed Aktenzeichen, step-4 proposal. */
export const ENVELOPE_TARGET_SOURCES = ['cover', 'code', 'manual', 'reference_number'] as const;
export type EnvelopeTargetSource = typeof ENVELOPE_TARGET_SOURCES[number];
export const ENVELOPE_RECEIVED_ON_SOURCES = ['batch', 'folder', 'manual'] as const;
export type EnvelopeReceivedOnSource = typeof ENVELOPE_RECEIVED_ON_SOURCES[number];
/** Why a file of the envelope was not taken over (items without a servable file). */
export const ENVELOPE_REJECTED_CODES = ['too_large', 'malware_detected', 'duplicate', 'unsupported_type', 'entry_unreadable', 'empty_or_truncated', 'other'] as const;
export type EnvelopeRejectedCode = typeof ENVELOPE_REJECTED_CODES[number];
/** The seven action slots of the case view (3.9). */
export const ENVELOPE_ACTION_KEYS = ['takeOver', 'requestAgain', 'fileOnly', 'outside', 'retarget', 'split', 'receivedOn'] as const;
export type EnvelopeActionKey = typeof ENVELOPE_ACTION_KEYS[number];
/** At most 30 pages per envelope, 2 to 30 parts, at most 60 ranges per part (3.8, 4.1). */
export const ENVELOPE_LIMITS = { pages: 30, parts: 30, rangesPerPart: 60, proofs: 50, criteria: 20 } as const;
/** A requested proof key: `<fieldId>#` or `<fieldId>#<section>#<index>`. */
export const ENVELOPE_PROOF_KEY = /^[a-z][a-z0-9_]{0,127}#(?:[a-z][a-z0-9_]{0,127}#\d{1,3})?$/u;
/** `YYYY-MM-DD` with a plausible month and day; Drupal checks the calendar. */
export const ENVELOPE_DAY = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/u;

/**
 * Pre-check block of a batch attachment in the staff attachment list. Closed lists of Drupal
 * `AttachmentPrecheckProviderInterface` and `BulkAttachmentPrecheck`; the shared fixture
 * `beantragt_bulk/tests/fixtures/precheck-cross-stack.json` keeps both sides equal.
 */
export const PRECHECK_STATES = ['finding', 'clean', 'unavailable'] as const;
export type PrecheckState = typeof PRECHECK_STATES[number];
/** Document-level codes of the batch review, in Drupal's order; operational codes of the batch list are not part of it. */
export const PRECHECK_DOCUMENT_CODES = [
    'person_unmatched', 'multiple_documents', 'not_a_document', 'unreadable', 'handwritten', 'foreign_language',
    'rules_version_mismatch', 'requirement_not_met', 'requirement_unclear', 'low_confidence', 'truncated', 'document_unassigned'
] as const;
export type PrecheckDocumentCode = typeof PRECHECK_DOCUMENT_CODES[number];
/** Codes that only describe a document (fixture `vocabulary.informationalCodes`): neutral chips, never a reason of a finding. */
export const PRECHECK_INFORMATIONAL_CODES = BULK_INFO_CODES;
export const PRECHECK_PROOF_STATUSES = ['present', 'missing', 'illegible', 'needs_review'] as const;
export type PrecheckProofStatus = typeof PRECHECK_PROOF_STATUSES[number];
export const PRECHECK_CONFIDENCES = ['low', 'medium', 'high'] as const;
export type PrecheckConfidence = typeof PRECHECK_CONFIDENCES[number];
/** Upper bound of a document's page count, as the batch review bounds it. */
export const PRECHECK_MAX_PAGE_COUNT = 9999;

export interface PrecheckCriterion {
    key: string
    /** Null for `legible`, which the UI names itself, and for a criterion without a text in the form. */
    title: string | null
    explanation: string | null
    answer: BulkAnswer
}
export interface PrecheckNotice {
    code: PrecheckDocumentCode
    params: { fact?: string, pagesChecked?: number, pagesTotal?: number }
}
export interface AttachmentPrecheckUnavailable {
    state: 'unavailable'
    fieldId: string
    label: string | null
}
export interface AttachmentPrecheckResult {
    state: 'finding' | 'clean'
    fieldId: string
    label: string | null
    proofStatus: PrecheckProofStatus | null
    confidence: PrecheckConfidence | null
    page: number | null
    pagesChecked: number | null
    pageCount: number | null
    truncated: boolean
    codes: PrecheckDocumentCode[]
    criteria: PrecheckCriterion[]
    notices: PrecheckNotice[]
}
export type AttachmentPrecheck = AttachmentPrecheckUnavailable | AttachmentPrecheckResult;
