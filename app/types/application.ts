/**
 * Types for the application Drupal entity.
 *
 * Drupal entity: application (beantragt_application module)
 * JSON:API type: application--application
 *
 * Key fields:
 *   field_data (string_long)         - JSON blob of submitted values
 *   field_crm_data (string_long)     - JSON blob of CRM-tagged values (auto-extracted)
 *   field_schema (entity_reference)  - Reference to form_schema entity
 *   field_schema_version (integer)   - Schema version at application time
 *   field_workflow_status (entity_reference) - Processing status entity
 *   field_applicant_email (email)    - Optional applicant email
 *   field_reference_number (string)  - Auto-generated BEA-YYYY-NNNNN
 */

/**
 * Workflow status machine name for the application entity's referenced
 * workflow_status. Values are organisation-configurable.
 */
export type ApplicationWorkflowStatus = string;

/**
 * Frontend representation of an application.
 * Field names use camelCase (mapped from Drupal's field_ prefix snake_case).
 */
export interface Application {
    /** Drupal entity ID. */
    id: string
    /** Auto-generated label: "Application #[id] - [schema title]". */
    label: string
    /** UUID of the referenced form_schema entity. */
    schemaId: string
    /** Schema version captured at application time. */
    schemaVersion: number
    /** Submitted field values keyed by field ID from the schema. */
    data: Record<string, unknown>
    /** CRM-tagged values extracted from data using schema crm_key mappings. */
    crmData: Record<string, string>
    /** Current processing status. */
    workflowStatus: ApplicationWorkflowStatus
    /** Optional email address of the applicant. */
    applicantEmail?: string
    /** Auto-generated reference number in BEA-YYYY-NNNNN format. */
    referenceNumber: string
    /** ISO 8601 timestamp of creation. */
    created: string
    /** ISO 8601 timestamp of last modification. */
    changed: string
}

/**
 * Payload for creating a new application via the server API route.
 * Only includes fields that the frontend provides; Drupal auto-generates
 * the rest (label, reference_number, crm_data, schema_version).
 */
export interface ApplicationCreatePayload {
    /** UUID of the form_schema entity. */
    schemaId: string
    /** Submitted field values keyed by field ID. */
    data: Record<string, unknown>
    /** Optional applicant email for status notifications. */
    applicantEmail?: string
}

/**
 * Payload for updating an application's workflow status.
 */
export interface ApplicationStatusUpdate {
    /** The new workflow status to transition to. */
    workflowStatus: ApplicationWorkflowStatus
}

/**
 * Profile or bank consent carried by one application (ApplicationConsentProjection).
 *
 * Text and hash stay in the backend record; the projection names only whether,
 * when, in which text version and for which organisation or jurisdiction.
 */
export interface ApplicationConsentSummary {
    given: boolean
    at: string | null
    /**
     * When the consent took effect: the confirmation of an anonymous
     * application, when later than the submission. Absent while unconfirmed.
     */
    effectiveAt?: string | null
    textVersion: string | null
    scopeLabel: string | null
}

/**
 * Profile and bank consent of one application.
 */
export interface ApplicationConsents {
    profileConsent: ApplicationConsentSummary
    bankConsent: ApplicationConsentSummary
}
