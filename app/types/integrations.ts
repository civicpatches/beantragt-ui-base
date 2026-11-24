/** Integration management API. Case dispatch projections live in case-transfers.ts. */
export type JsonScalar = string | number | boolean | null;
/**
 * One issue of an integration answer. `integration.coupling_status_missing`
 * carries what the rule's form lacks: the function, the missing
 * flags (never a status name), whether the form has an organisation (null on
 * the catalogue-wide fallback) and, on a refusal, the moment.
 */
export interface IntegrationIssue {
    pointer: string
    code: string
    feature?: string
    missing_flags?: string[]
    form_has_organisation?: boolean | null
    moment?: 'save' | 'activation'
}
export type IntegrationDetail = IntegrationIssue;
export interface IntegrationResponse<T> { data: T }
export interface IntegrationListResponse<T> extends IntegrationResponse<T[]> { meta: { total: number, truncated: boolean, pending_planning_count?: number } }
export interface AssignmentUse { assignment_uuid: string, status: 'draft' | 'active' | 'inactive' }
export interface LocalCheck { checked: 'local', valid: boolean, errors: IntegrationIssue[] }
export interface ConnectionInput {
    label: string
    adapter: 'fit_connect'
    environment: 'test'
    credential_profile: string
    destination_id: string
    service_urn: string
    service_name: string
    contract_key: string
    contract_version: string
    reply_process_standard?: string | null
}
/** Display texts (empty = product default) and when a reply closes the case. */
export interface ConnectionLabelPair { de: string, en: string }
export type ConnectionClosureRule = 'on_response' | 'on_receipt' | 'manual';
/** Follow-up status per case-system event, as semantic flags (never status ids). */
export interface ConnectionFollowUp {
    approved: 'approved' | 'decision_issued'
    rejected: 'rejected' | 'decision_issued'
    filed: 'filed' | 'closed' | 'decision_issued'
    decision: 'decision_issued' | 'closed'
    receipt: 'filed' | 'closed'
}
export type ConnectionFollowUpEvent = keyof ConnectionFollowUp;
/** Allowed flags per event, the first one is the default (mirrors the backend). */
export const CONNECTION_FOLLOW_UP_FLAGS: { [K in ConnectionFollowUpEvent]: ReadonlyArray<ConnectionFollowUp[K]> } = {
    approved: ['approved', 'decision_issued'],
    rejected: ['rejected', 'decision_issued'],
    filed: ['filed', 'closed', 'decision_issued'],
    decision: ['decision_issued', 'closed'],
    receipt: ['filed', 'closed']
};
export interface ConnectionPresentation {
    handover_label: ConnectionLabelPair
    response_label: ConnectionLabelPair
    /** Staff-facing words for the outcome of an answer; '' keeps the product word. */
    approved_label: ConnectionLabelPair
    rejected_label: ConnectionLabelPair
    filed_label: ConnectionLabelPair
    closure_rule: ConnectionClosureRule
    follow_up: ConnectionFollowUp
}
export interface Connection extends ConnectionInput {
    uuid: string
    scope_group_id: number
    status: 'draft' | 'active' | 'disabled'
    created: number
    changed: number
    reply_process_standard: string | null
    last_check_result: LocalCheck | null
    presentation: ConnectionPresentation
    used_by: AssignmentUse[]
    used_by_truncated: boolean
}
export interface MappingInput { label: string, contract_key: string, contract_version: string }
export interface MappingRule { source: string, target: string, valueMap?: Record<string, JsonScalar> }
export interface MappingOccurrence { target: string, mode: 'single' }
export interface MappingRules { version: 1, rules: MappingRule[], occurrences?: MappingOccurrence[] }
export interface MappingVersionInput { form_schema_uuid: string, compatible_revisions: number[], rules: MappingRules }
export interface MappingVersionBase extends Omit<MappingVersionInput, 'rules'> {
    mapping_uuid: string
    scope_group_id: number
    version: number
    status: 'draft' | 'active' | 'retired'
    checksum: string
    created: number
    changed: number
    used_by: AssignmentUse[]
    used_by_truncated: boolean
}
export type IntactMappingVersion = MappingVersionBase & { integrity: 'ok', rules: MappingRules };
export type MappingVersion = IntactMappingVersion | (MappingVersionBase & { integrity: 'failed', rules?: never });
export type MappingVersionSummary = Pick<MappingVersion, 'version' | 'status' | 'checksum' | 'changed' | 'integrity'>;
export interface MappingSummary extends MappingInput {
    uuid: string
    scope_group_id: number
    created: number
    changed: number
    versions: MappingVersionSummary[]
}
export interface Mapping extends Omit<MappingSummary, 'versions'> { versions: MappingVersion[] }
export interface MappingCheck { valid: boolean, errors: IntegrationIssue[], coverage: { required_total: number, required_covered: number } }
export interface AssignmentInput {
    form_schema_uuid: string
    compatible_revisions: number[]
    service_urn: string
    connection_uuid: string
    mapping_uuid: string
    mapping_version: number
    dispatch_mode: 'automatic' | 'approval'
    send_attachments?: boolean
    transfer_trigger?: TransferTrigger
    trigger_flag?: TriggerFlag
}
/** When a transfer is planned: on submission, on a status, or only by staff. */
export type TransferTrigger = 'submission' | 'status' | 'manual';
/** Semantic status flags that may trigger a transfer. */
export type TriggerFlag = 'hand_over';
export interface AssignmentCoupling { transfer_trigger: TransferTrigger, trigger_flag: TriggerFlag }
export interface Assignment extends AssignmentInput {
    send_attachments: boolean
    transfer_trigger: TransferTrigger
    trigger_flag: TriggerFlag
    uuid: string
    scope_group_id: number
    status: 'draft' | 'active' | 'inactive'
    created: number
    changed: number
    blocked: boolean
    blocked_reasons: IntegrationIssue[]
}
export interface FormSummary {
    uuid: string
    title: string
    current_revision_id: number
    revisions: Array<{ revision_id: number, changed: number }>
    revisions_truncated: boolean
    revisions_total: number
}
export interface SourceField {
    id: string
    label: string
    type: string
    required: boolean
    options: Array<{ value: string, label: string }> | null
    section_title: string
}
export interface Compatibility { compatible: boolean, revision_id: number, registered: boolean, errors: Array<IntegrationIssue & { source: string }> }
export interface CredentialProfile { key: string, label: string }
export interface ContractManifest {
    key: string
    version: string
    title: string
    sourceUri: string
    portalPage: string
    retrievedAt: string
    sha256: string
    license: null
    serviceKey: null
    note: string
}
export interface TargetPath {
    pointer: string
    type: string | string[] | null
    required: boolean
    local_required: boolean
    enum: JsonScalar[] | null
    array: boolean
    format: string | null
    pattern: string | null
    title: string | null
    title_source: 'items' | null
    description: string | null
    group_titles: string[]
    minItems: number | null
    maxItems: number | null
    unsupported: string[]
}

export type IntegrationConnectionEditableField = 'label' | 'destination_id' | 'service_urn' | 'service_name' | 'contract_key' | 'credential_profile' | 'reply_process_standard';
