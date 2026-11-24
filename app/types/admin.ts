/**
 * Shared types for admin pages.
 *
 * These types model the JSON:API responses returned by the /api/admin/* server routes.
 * They replace inline interfaces that were duplicated across admin pages.
 */

import type { AttachmentPrecheck } from '../../shared/bulk-sichtung';
import type { StaffAttachmentAnalysis } from '../../shared/staff-attachment-analysis';
import type {
    JsonApiCollectionResponse,
    JsonApiLinks,
    JsonApiResource,
    JsonApiSingleResponse,
    FormSchemaAttributes,
    FormSchemaGroupAttributes,
    ApplicationAttributes,
    WorkflowStatusAttributes
} from './api';
import type { WorkflowAttributeDefinition } from './form';
import type { ApplicationConsents } from './application';

// ---------------------------------------------------------------------------
// Schema responses
// ---------------------------------------------------------------------------

/**
 * Collection response for form schemas (e.g. GET /api/admin/schemas).
 * Uses Partial because sparse fieldsets may omit fields.
 */
export type FormSchemaCollectionResponse = JsonApiCollectionResponse<Partial<FormSchemaAttributes>>;

/**
 * Single response for a form schema (e.g. GET /api/admin/schemas/[id]).
 */
export type FormSchemaSingleResponse = JsonApiSingleResponse<Partial<FormSchemaAttributes>> & {
    capabilities?: { canEdit: boolean, canPublish: boolean }
};

/**
 * Collection response for form schema groups (e.g. GET /api/admin/form-schema-groups).
 * Includes referenced form schemas when the server route requests relationships.
 */
export interface FormSchemaGroupCollectionResponse {
    data: JsonApiResource<Partial<FormSchemaGroupAttributes>>[]
    included?: JsonApiResource<Partial<FormSchemaAttributes>>[]
    meta?: { count?: number }
    links?: JsonApiLinks
}

// ---------------------------------------------------------------------------
// Application responses
// ---------------------------------------------------------------------------

/**
 * Application attributes as returned by admin JSON:API routes.
 * Subset of ApplicationAttributes, matching what the server routes request
 * via sparse fieldsets.
 */
export type AdminApplicationResource = JsonApiResource<Partial<ApplicationAttributes>>;
export type AdminWorkflowStatusResource = JsonApiResource<Partial<WorkflowStatusAttributes>>;

/**
 * Collection response for applications (e.g. GET /api/admin/applications).
 */
/**
 * Review code of an application whose current status is no longer part of
 * its form's published workflow.
 */
export type AdminApplicationReviewCode = 'status_not_in_workflow';

/** Review state of one application on the detail page. */
export interface AdminApplicationWorkflowReview {
    code: AdminApplicationReviewCode
    /** The signed-in person may set a status by hand. */
    canCorrect: boolean
    /** Status UUIDs that may be set; never approval or rejection statuses. */
    targetIds: string[]
}

/** Counts are positive and include only events this staff member may open. */
export type AdminApplicationEventKind = 'transfer' | 'scan' | 'release' | 'message' | 'documents' | 'reply' | 'assigned';
export type AdminApplicationEventCounts = Partial<Record<AdminApplicationEventKind, number>>;
export type AdminApplicationSinceSeenKind = Exclude<AdminApplicationEventKind, 'transfer' | 'release'>;

/** The visit snapshot retains since-seen labels; state kinds reflect the latest response. */
export interface AdminApplicationEvents {
    counts: AdminApplicationEventCounts
    previousSeenAt: Partial<Record<AdminApplicationSinceSeenKind, number | null>>
    seenAt: Partial<Record<AdminApplicationSinceSeenKind, number | null>>
    /** Exact public comment UUIDs, including messages in the same timestamp second. */
    newMessageIds: string[]
    newEventIds?: Partial<Record<AdminApplicationEventKind, string[]>>
    seenTokens?: Partial<Record<AdminApplicationSinceSeenKind, string[]>>
}

export interface AdminUnreadApplicationsPage {
    limit: number
    hasMore: boolean
    nextCursor?: string
}

export interface AdminApplicationsResponse {
    data: AdminApplicationResource[]
    included?: Array<JsonApiResource<Partial<FormSchemaAttributes>> | AdminWorkflowStatusResource>
    meta?: {
        count?: number
        effectiveAllowedNext?: Record<string, Record<string, string[]>>
        /** Application UUID -> review code, only for applications that need review. */
        workflowReview?: Record<string, AdminApplicationReviewCode>
        /** Application UUID -> event counts visible to this staff member. */
        events?: Record<string, AdminApplicationEventCounts>
        truncated?: boolean
        page?: AdminUnreadApplicationsPage
    }
    links?: JsonApiLinks
}

export interface UnconfirmedApplicationRow {
    id: string
    referenceNumber: string
    formTitle: string | null
    submittedAt: string
    applicantName: string | null
    confirmationEmail: string | null
    emailConfirmed: false
}

export interface AdminUnconfirmedApplicationsResponse {
    data: UnconfirmedApplicationRow[]
    meta: { truncated: boolean }
}

export type ApplicationDataEditBlockedReason = 'permission' | 'protected' | 'transfer' | 'schema';

/**
 * Single response for an application with included schema
 * (e.g. GET /api/admin/applications/[id]).
 */
export interface AdminApplicationDetailResponse {
    data: AdminApplicationResource
    included?: Array<JsonApiResource<Partial<FormSchemaAttributes>> | AdminWorkflowStatusResource>
    meta?: {
        effectiveAllowedNext?: Record<string, Record<string, string[]>>
        effectiveTransitions?: Record<string, Record<string, AdminApplicationTransition[]>>
        workflowReview?: AdminApplicationWorkflowReview | null
        events?: AdminApplicationEvents
        statusRollbackTarget?: AdminApplicationRollbackTarget | null
        assignmentRevisionId?: number | null
        protectedDataRedacted?: boolean
        canEditData?: boolean
        canChangeStatus?: boolean
        canDelete?: boolean
        editDataBlockedReason?: ApplicationDataEditBlockedReason | null
        attachments?: AdminApplicationAttachment[]
        attachmentLoadFailed?: boolean
        proofCompleteness?: AdminApplicationProofCompleteness
        consents?: ApplicationConsents
    }
}

export interface AdminApplicationProof {
    fieldId: string
    label: string
    required: boolean
    personIndex: number | null
    status: 'present' | 'missing' | 'illegible' | 'needs_review'
    attachmentIds: string[]
}

export type AdminApplicationProofCompleteness = { available: false } | {
    available: true
    required: number
    present: number
    missing: number
    proofs: AdminApplicationProof[]
    unassignedAttachmentIds: string[]
};

export interface AdminApplicationDeliveryLog {
    id: number
    uuid: string
    applicationId: number
    applicationUuid: string
    adapter: string
    target: string
    status: string
    attempts: number
    externalId: string
    receipt: string
    lastError: string
    created: number
    changed: number
    processed?: number | null
}

export interface AdminApplicationDeliveriesResponse {
    data: AdminApplicationDeliveryLog[]
    meta?: {
        resource?: string
        applicationUuid?: string
    }
}

export interface AdminApplicationDeliveryDispatchResponse {
    data: {
        logId: number
        result: {
            status: string
            externalId?: string
            receipt?: string
            errorCode?: string
            errorMessage?: string
        }
    }
    meta?: {
        resource?: string
        applicationUuid?: string
    }
}

export interface AdminApplicationAssignee {
    type?: 'user' | 'team'
    id: string
    label: string
    slug?: string | null
    parent_org_uuid?: string | null
    outOfScope?: boolean
}

export interface AdminApplicationDelegationTarget {
    uuid: string
    label: string
    parent_org_uuid: string | null
    slug?: string | null
}

export interface AdminApplicationAssigneesResponse {
    current: AdminApplicationAssignee | null
    candidates: AdminApplicationAssignee[]
    personal_assignment_enabled?: boolean
    teams?: AdminApplicationAssignee[]
    delegation_targets?: AdminApplicationDelegationTarget[]
    can_assign?: boolean
    can_delegate?: boolean
    note_required?: boolean
    responsibility?: {
        label: string
        kind: 'org' | 'jur'
    } | null
}

export interface AdminApplicationAttachment {
    fileId?: string
    comment?: {
        id: string
        authorRole: 'citizen' | 'staff'
        visibility: 'public' | 'internal'
        createdAt: string
    }
    id: string
    type: 'application_attachment'
    fieldId: string
    filename: string
    url: string
    mimeType: string
    size: number
    analysisStatus?: string
    externalAnalysisConsent?: boolean
    analysisMetadata?: Record<string, unknown>
    /** Present only when Drupal authorizes the online staff projection. */
    staffAnalysis?: StaffAttachmentAnalysis
    guardStatus?: AdminAttachmentGuardStatus
    guardReport?: AdminAttachmentGuardReport | null
    guardDerivativeUrl?: string | null
    scanStatus?: 'clean' | 'quarantined' | string
    scanMessage?: string
    canResolveQuarantine?: boolean
    createdAt?: string
    /** Batch pre-check of an attachment that came in through a scanned batch; the backend decides the state. */
    precheck?: AttachmentPrecheck
}

export type AdminAttachmentGuardStatus = '' | 'pending' | 'clean' | 'redacted' | 'needs_review' | 'rejected' | 'failed';

export interface AdminAttachmentGuardReport {
    guardVersion: string
    status: Exclude<AdminAttachmentGuardStatus, '' | 'pending' | 'failed'>
    reasons: string[]
    advisories: string[]
    redactionDensity?: number
    source: {
        mediaType: string
        size: number
        pages: number
    }
    extraction: {
        textChars: number
        hasTextLayer: boolean
    }
    derivative: {
        mediaType: string
        size: number
        sha256: string
    } | null
    findings: Array<{
        category: string
        count: number
        pages: number[]
    }>
}

export interface AdminApplicationRollbackTarget {
    currentStatus?: AdminApplicationRollbackStatus
    targetStatus: AdminApplicationRollbackStatus
    currentStatusRevision?: AdminApplicationRollbackRevision
    /**
     * Set when "Rückgängig" is not possible because the previous status is
     * outside the workflow that governs the form.
     */
    unavailableReason?: 'target_not_in_workflow'
}

export interface AdminApplicationRollbackStatus {
    id?: string
    internalId?: number
    label?: string
    machineName?: string
    color?: string
    icon?: string
}

export interface AdminApplicationRollbackRevision {
    id?: number
    created?: number
    authorName?: string
    /** Automatic change without a person (revision user uid 0). */
    authorSystem?: boolean
}

export interface AdminApplicationTransition {
    targetStatusId: string
    from: string
    to: string
    targetDescription?: string
    condition?: string
    attributes: WorkflowAttributeDefinition[]
    requiresAttributes: boolean
}

export interface ApplicationRow {
    id: string
    referenceNumber: string
    statusId: string | null
    email: string | null
    schemaId: string | null
    assignedToId?: string | null
    assignedTeamId?: string | null
    dueDate?: string | null
    created: string
    changed?: string
    revisionId?: number | null
    data?: Record<string, unknown>
    allowedNextIds?: string[]
    canChangeStatus?: boolean
    canDelete?: boolean
    reviewCode?: AdminApplicationReviewCode
    events?: AdminApplicationEventCounts
}

// ---------------------------------------------------------------------------
// Application counts
// ---------------------------------------------------------------------------

export interface ApplicationCountsResponse {
    counts: Record<string, number>
}
