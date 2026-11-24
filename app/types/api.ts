/**
 * Generic JSON:API response types.
 *
 * These types model the JSON:API specification as used by Drupal's jsonapi module.
 * They provide type-safe wrappers around API responses for all beantragt.ai entities.
 *
 * @see https://jsonapi.org/format/
 * @see https://www.drupal.org/docs/core-modules-and-themes/core-modules/jsonapi-module
 */

/**
 * A single resource object in a JSON:API response.
 *
 * @typeParam T - The shape of the attributes object. Defaults to a generic record.
 */
export interface JsonApiResource<T = Record<string, unknown>> {
    /** UUID of the resource. */
    id: string
    /** JSON:API type string, e.g. "application--application". */
    type: string
    /** The resource's field values. */
    attributes: T
    /** Related resources, keyed by relationship name. */
    relationships?: Record<string, JsonApiRelationship>
    /** Links related to this resource (self, etc.). */
    links?: JsonApiLinks
}

/**
 * A JSON:API relationship field.
 * Can be a single reference or null (to-one), or an array (to-many).
 */
export interface JsonApiRelationship {
    data: JsonApiResourceIdentifier | JsonApiResourceIdentifier[] | null
    links?: JsonApiLinks
}

/**
 * Minimal resource identifier used in relationship data.
 */
export interface JsonApiResourceIdentifier {
    id: string
    type: string
    meta?: Record<string, unknown>
}

/**
 * Links object used throughout JSON:API responses.
 */
export interface JsonApiLinks {
    self?: string | { href: string }
    related?: string | { href: string }
    next?: string | { href: string }
    prev?: string | { href: string }
}

/**
 * Top-level JSON:API response for a single resource.
 *
 * @typeParam T - The shape of the resource's attributes.
 */
export interface JsonApiSingleResponse<T = Record<string, unknown>> {
    data: JsonApiResource<T>
    included?: JsonApiResource[]
    meta?: JsonApiMeta
    links?: JsonApiLinks
}

/**
 * Top-level JSON:API response for a collection of resources.
 *
 * @typeParam T - The shape of each resource's attributes.
 */
export interface JsonApiCollectionResponse<T = Record<string, unknown>> {
    data: JsonApiResource<T>[]
    included?: JsonApiResource[]
    meta?: JsonApiMeta
    links?: JsonApiLinks
}

/**
 * Union type for responses that may contain one or many resources.
 *
 * @typeParam T - The shape of the resource's attributes.
 */
export type JsonApiResponse<T = Record<string, unknown>>
    = | JsonApiSingleResponse<T>
      | JsonApiCollectionResponse<T>;

/**
 * Metadata object in JSON:API responses.
 * Drupal includes count for filtered collections.
 */
export interface JsonApiMeta {
    count?: number
    [key: string]: unknown
}

/**
 * A single error object in a JSON:API error response.
 */
export interface JsonApiError {
    /** HTTP status code as string. */
    status: string
    /** Short, human-readable summary. */
    title: string
    /** Detailed explanation. */
    detail?: string
    /** Pointer to the source of the error. */
    source?: {
        pointer?: string
        parameter?: string
    }
    /** Application-specific error code. */
    code?: string
}

/**
 * Top-level JSON:API error response.
 */
export interface JsonApiErrorResponse {
    errors: JsonApiError[]
    meta?: JsonApiMeta
}

// ---------------------------------------------------------------------------
// Workspace invitation responses
// ---------------------------------------------------------------------------

/**
 * Public invite shape returned by the anonymous verify endpoint.
 * Carries no invitee PII: no email, roles, or issuer identity.
 */
export interface WorkspaceInvitePublic {
    id: number
    purpose: 'workspace_create' | string
    target_parent_id: number
    expires: number
    target_parent_label?: string | null
}

/**
 * Claim shape returned by the authenticated claim endpoint.
 * Only an authenticated, email-matched claimant ever receives the email.
 */
export interface WorkspaceInviteClaimed extends WorkspaceInvitePublic {
    email: string
    workspace?: { jurisdictionSlug: string, organisationSlug: string | null }
}

/**
 * Discriminated by status: verify yields a public invite, claim yields the
 * matched invitee's minimal claim shape.
 */
export type WorkspaceInviteResponse
    = | { status: 'pending', invite: WorkspaceInvitePublic }
      | { status: 'claimed', invite: WorkspaceInviteClaimed };

// ---------------------------------------------------------------------------
// Typed attribute interfaces for beantragt.ai entities
// ---------------------------------------------------------------------------

/**
 * JSON:API attributes for form_schema--form_schema.
 * Field names match Drupal's JSON:API output (field_ prefix preserved).
 */
export interface FormSchemaAttributes {
    label: string
    drupal_internal__revision_id?: number | string
    /** Drupal string_long: may return as `{ value: string }` object or plain string. */
    field_description: { value: string } | string | null
    /** JSON string containing the FormSchema definition. Drupal string_long format. */
    field_schema: { value: string } | string
    /** JSON string containing the non-public application workflow extension. */
    field_workflow_definition?: { value: string } | string | null
    field_source_filename: string | null
    field_workflow_status: string
    /** Read-only marker for authorized admin responses. */
    readonly field_ai_review_pending?: boolean
    field_publication_scope: 'internet' | 'intranet'
    /** Per-form reference-number pattern override (Aktenzeichen). Empty = org fallback. */
    field_reference_pattern: string | null
    field_version: number
    status: boolean
    created: string
    changed: string
}

export type FormSchemaLifecycleStatus = 'draft' | 'published' | 'archived';

export interface FormSchemaStatusResponse {
    success: true
    status: FormSchemaLifecycleStatus
}

/**
 * JSON:API attributes for form_schema_group--form_schema_group.
 * Groups remain backend-generic and reference form_schema entities.
 */
export interface FormSchemaGroupAttributes {
    label: string
    field_description: { value: string } | string | null
    field_workflow_status: string
    status: boolean
    created: string
    changed: string
}

/**
 * JSON:API attributes for application--application.
 * Field names match Drupal's JSON:API output (field_ prefix preserved).
 */
export interface ApplicationAttributes {
    field_origin?: string | null
    label: string
    /** JSON string containing submitted field values. */
    field_data: string
    /** JSON string containing CRM-tagged values (auto-extracted). */
    field_crm_data: string | null
    /** JSON object string containing workflow attributes captured on the current status revision. */
    field_workflow_attributes?: string | null
    field_schema_version: number | null
    /** Application workflow status is an entity_reference; use relationships.field_workflow_status. */
    field_workflow_status?: string | null
    field_applicant_email: string | null
    field_reference_number: string | null
    field_due_date?: string | null
    /** Effective quick-transition UUIDs calculated for this application. */
    field_effective_allowed_next?: string[]
    can_change_status?: boolean
    can_delete?: boolean
    status: boolean
    created: string
    changed: string
}

/**
 * JSON:API attributes for workflow_status--workflow_status.
 */
export interface WorkflowStatusAttributes {
    label: string
    field_machine_name: string
    field_color: string | null
    field_icon: string | null
    field_weight: number
    field_is_default?: boolean
    field_is_terminal?: boolean
    field_semantic_flags?: string[] | Array<{ value?: string }>
}

/**
 * JSON:API attributes for applicant--applicant.
 * Field names match Drupal's JSON:API output (field_ prefix preserved).
 */
export interface ApplicantProfileAttributes {
    label: string
    field_full_name: string | null
    field_first_name: string | null
    field_last_name: string | null
    field_birthdate: string | null
    field_address: string | null
    field_street: string | null
    field_postal_code: string | null
    field_city: string | null
    field_phone: string | null
    field_email: string | null
    field_iban: string | null
    field_gender: string | null
    field_nationality: string | null
    field_marital_status: string | null
    field_tax_id: string | null
    field_session_token: string | null
    status: boolean
    created: string
    changed: string
}

// ---------------------------------------------------------------------------
// Convenience type aliases for typed API responses
// ---------------------------------------------------------------------------

export type FormSchemaResource = JsonApiResource<FormSchemaAttributes>;
export type FormSchemaGroupResource = JsonApiResource<FormSchemaGroupAttributes>;
export type ApplicationResource = JsonApiResource<ApplicationAttributes>;
export type WorkflowStatusResource = JsonApiResource<WorkflowStatusAttributes>;
export type ApplicantProfileResource = JsonApiResource<ApplicantProfileAttributes>;
