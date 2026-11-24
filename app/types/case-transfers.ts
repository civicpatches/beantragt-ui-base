/** Safe staff projection. Contains no snapshot, credential or payload internals. */
export type CaseTransferStatus = 'awaiting_approval' | 'queued' | 'processing' | 'blocked' | 'accepted' | 'failed';
export interface CaseTransferIssue {
    pointer: string
    code: string
    keyword?: string | null
    source?: string
}
export interface CaseTransferResponseLink {
    uuid: string
    title: string
    received: number
    released: number | null
    available: number | null
    retrieved: number | null
}
/** Why an accepted transfer did not move the case from its start status (closed list). */
export type CaseTransferStatusUnchangedReason = 'no_target_status' | 'no_transition' | 'transition_attributes_required';

export interface CaseTransfer {
    uuid: string
    status: CaseTransferStatus
    adapter: 'fit_connect' | 'mock' | 'webhook'
    connection: { uuid: string, label: string, destination_id: string, environment: 'test', destination_verification: { name: string, service_urn: string, schema_uri: string, checked_at: number } | null } | null
    mapping: { uuid: string, label: string, version: number } | null
    contract: { key: string, version: string } | null
    send_attachments: boolean
    attachments: Array<{
        id: string
        size: number
        name?: string
        sha256?: string
        mime_type?: 'application/pdf' | 'image/jpeg' | 'image/png'
        field_id?: string
        form_revision_id?: number
        submission_revision_id?: number
    }>
    dispatch_mode: 'automatic' | 'approval'
    approval: { status: 'pending' | 'approved' | 'not_required', uid: number | null, display_name: string | null, at: number | null }
    attempts: number
    created: number
    changed: number
    processed: number | null
    receipts: { submission_id: string, case_id: string }
    transport_status: CaseTransferStatus | 'mock_test_only' | 'technically_accepted_by_fit_connect'
    recipient_approval: 'not_inferred_from_transport'
    validation_errors: CaseTransferIssue[]
    last_error_code: string | null
    is_mock: boolean
    external_responses: CaseTransferResponseLink[]
    /** replanRestricted: replanning is possible, but only for staff with dispatch permission. */
    meta: {
        canApproveDispatch: boolean
        canRetry: boolean
        canResume: boolean
        canReplan: boolean
        replanRestricted: boolean
        approvalRefusal?: string | null
        /** On an accepted transfer whose acceptance could not move the case; `null` otherwise. */
        statusUnchanged?: { code: 'integration.accepted_status_unchanged', reason: CaseTransferStatusUnchangedReason } | null
    }
}
export interface CaseTransferHistory {
    uuid: string
    status: CaseTransferStatus
    created: number
    changed: number
    processed: number | null
    foreign_scope?: true
    anonymised?: true
    transport_status?: 'transferred_by_another_tenant'
    last_error_code?: 'integration.application_anonymised'
    meta: { canApproveDispatch: false, canRetry: false, canResume: false, canReplan: false }
}
export interface CasePendingTransfer {
    uuid: string
    connection: string
    status: 'queued' | 'awaiting_approval'
}
export interface CaseTransfersResponse {
    data: Array<CaseTransfer | CaseTransferHistory>
    meta: {
        resource: 'applicationTransfers'
        applicationUuid: string
        canCreateTransfer: boolean
        /** The dispatch right alone; canCreateTransfer also needs a usable rule. */
        canApproveDispatch: boolean
        /** Unsent transfers with frozen data that a data edit would stop. */
        pendingTransfers: CasePendingTransfer[]
        delivery: {
            reason: 'no_assignment' | 'assigned' | 'assignment_blocked' | 'revision_not_covered' | 'assignment_ambiguous' | 'scope_unresolved' | 'form_missing' | 'planning_failed' | 'application_anonymised' | 'trigger_deferred' | 'trigger_status_missing'
            reasons: Array<{ pointer?: string, code: string }>
            assignment_uuid?: string
            applicability?: 'current_configuration'
            trigger?: { mode: CaseTransferTriggerMode, flag: 'hand_over' }
        }
        /** When the transfer starts; NULL without exactly one active rule. */
        trigger?: CaseTransferTrigger | null
    }
}
export interface CaseTransferResponse { data: CaseTransfer }

export type CaseTransferTriggerMode = 'submission' | 'status' | 'manual';
/** pending: the rule still waits for its trigger; statusMissing: no status carries the flag. */
export interface CaseTransferTrigger {
    mode: CaseTransferTriggerMode
    flag: 'hand_over'
    /** automatic sends without dispatch authorization; approval waits for it. */
    dispatchMode: 'automatic' | 'approval'
    pending: boolean
    statusMissing: boolean
    /** False for bulk cases: setting the status never approves dispatch. */
    autoApprove?: boolean
    blockedBy?: string | null
}

export type CaseTransferAction = 'approve-dispatch' | 'retry' | 'resume' | 'replan' | 'create';
