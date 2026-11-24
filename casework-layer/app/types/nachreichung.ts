/**
 * Staff card of the Nachreichung: requests ("Nachforderungen") and cover
 * sheets of one application (step 1), receipts ("Eingänge") with their
 * results per proof (step 2), as the Nuxt proxy forwards them
 * (casework-layer/server/utils/admin-nachreichung.ts). Never an identifier, its
 * hash, the QR hash, the key version, a file name or a name.
 */
import type {
    NachreichungCoverOrigin,
    NachreichungCoverState,
    NachreichungDeadlineReason,
    NachreichungEntryDecision,
    NachreichungPrintBlocker,
    NachreichungProofReason,
    NachreichungProofStatus,
    NachreichungReceivedOnSource,
    NachreichungRequestState,
    NachreichungRevertMode,
    NachreichungRevokeReason
} from '~~/app/utils/nachreichung-codes';

export interface NachreichungRequest {
    id: string
    state: NachreichungRequestState
    /** Unix seconds of the release of the request letter; null while it is a draft. */
    releasedAt: number | null
    /** `YYYY-MM-DD` as printed in the letter and on the cover sheet. */
    deadlinePrinted: string | null
    /** `YYYY-MM-DD`, differs from `deadlinePrinted` only after an extension (step 2). */
    deadline: string | null
    extended: boolean
    /** Why the deadline was extended (step 2); null before an extension. */
    deadlineReason: NachreichungDeadlineReason | null
    /** "Frist der Nachforderung verlängern" is offered (update access and a waiting state). */
    canExtend: boolean
}

/** Result of one requested proof as decided in the Sichtung Nachreichung. */
export interface NachreichungEntryResult {
    key: string
    label: string | null
    personLabel: string | null
    status: NachreichungProofStatus
    reason: NachreichungProofReason | null
    /** Titles of the unmet criteria (`requirement_not_met`). */
    criteria: string[]
}

/** One receipt ("Eingang", a Vermerk) at the application. */
export interface NachreichungEntry {
    id: string
    receivedOn: string | null
    receivedOnSource: NachreichungReceivedOnSource | null
    batchReceivedOn: string | null
    decision: NachreichungEntryDecision
    /** Unix seconds. */
    decidedAt: number | null
    identityConfirmed: boolean
    cover: boolean
    pageCount: number
    results: NachreichungEntryResult[]
    /** Attachment UUIDs for the existing preview proxy, with embedded cover pages. */
    attachments: Array<{ id: string, coverPages: number[] }>
    reverted: { at: number | null, mode: NachreichungRevertMode } | null
    canRemove: boolean
    canReassign: boolean
}

export interface NachreichungCover {
    id: string
    origin: NachreichungCoverOrigin
    state: NachreichungCoverState
    createdAt: number | null
    activatedAt: number | null
    revokedAt: number | null
    revokeReason: NachreichungRevokeReason | null
}

export interface NachreichungCard {
    coverSheet: boolean
    canPrint: boolean
    printBlocker: NachreichungPrintBlocker | null
    canRevoke: boolean
    activeCount: number
    activeLimit: number
    nachforderungen: NachreichungRequest[]
    /** Receipts, newest first, at most 50 (step 2). */
    eingaenge: NachreichungEntry[]
    deckblaetter: NachreichungCover[]
}

export interface NachreichungCardResponse {
    data: NachreichungCard
}
