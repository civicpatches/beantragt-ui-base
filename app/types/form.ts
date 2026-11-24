/**
 * Standard CRM keys for cross-form field reuse.
 * When a field has a crm_key, its value is stored in the citizen profile
 * and pre-filled in future forms.
 */
export type PersonCrmKey
    = | 'person.full_name'
      | 'person.first_name'
      | 'person.last_name'
      | 'person.birthdate'
      | 'person.address'
      | 'person.postal_code'
      | 'person.city'
      | 'person.street'
      | 'person.phone'
      | 'person.email'
      | 'person.iban'
      | 'person.account_holder'
      | 'person.gender'
      | 'person.nationality'
      | 'person.marital_status'
      | 'person.tax_id';

export type CompanyCrmKey
    = | 'company.name'
      | 'company.register_number'
      | 'company.vat_id'
      | 'company.contact_person'
      | 'company.legal_form';

export type CrmKey = PersonCrmKey | CompanyCrmKey;

/**
 * Field types supported by the form renderer.
 */
export const FORM_FIELD_TYPES = [
    'text',
    'textarea',
    'email',
    'tel',
    'number',
    'date',
    'select',
    'radio',
    'checkbox',
    'address',
    'file'
] as const;

export type FormFieldType = typeof FORM_FIELD_TYPES[number];

export const FORM_FIELD_FORMATS = [
    'postal_code',
    'iban',
    'bic',
    'tax_id',
    'currency',
    'reference_number',
    'url'
] as const;

export type FormFieldFormat = typeof FORM_FIELD_FORMATS[number];

export const FORM_FIELD_PRIVACY_KINDS = [
    'not_personal',
    'contact',
    'identity',
    'financial',
    'special_category',
    'criminal_offense',
    'other_personal'
] as const;

export type FormFieldPrivacyKind = typeof FORM_FIELD_PRIVACY_KINDS[number];

export interface FormFieldPrivacy {
    kind: FormFieldPrivacyKind
}

export interface FormFieldValidation {
    minLength?: number
    maxLength?: number
    pattern?: string
    min?: number
    max?: number
    step?: number
    maxFiles?: number
    maxSizeBytes?: number
    maxFileSizeBytes?: number
}

export interface NormalizedGeocodingAddress {
    street?: string
    houseNumber?: string
    postcode?: string
    city?: string
    district?: string
    state?: string
    country?: string
    countryCode?: string
}

export interface FormAddressValue extends NormalizedGeocodingAddress {
    formatted: string
    lat?: number
    lng?: number
}

export interface GeocodingResult {
    lat: number
    lng: number
    displayName: string
    address: NormalizedGeocodingAddress
}

export interface FormAddressWidget {
    autocomplete?: boolean
    map?: boolean
    boundary?: 'off' | 'advisory'
}

export interface FormAddressGroupFields {
    street: string
    houseNumber: string
    postcode: string
    city: string
}

/**
 * Presentation-only address helper. Every referenced component remains an
 * ordinary schema field and therefore keeps its own persisted submission key.
 */
export interface FormAddressGroup extends FormAddressWidget {
    id: string
    label?: string
    fields: FormAddressGroupFields
}

export interface FormFieldSemantics {
    /** Stable, integration-facing concept such as address.street. */
    concept?: string
    /** Original source path, for example a FIM JSON Schema property path. */
    sourcePath?: string
}

export const FORM_ATTACHMENT_ANALYSIS_EGRESS_POLICIES = [
    'no_ai',
    'local_only',
    'sovereign_only',
    'external_redacted',
    'external_allowed'
] as const;

export type FormAttachmentAnalysisEgressPolicy = typeof FORM_ATTACHMENT_ANALYSIS_EGRESS_POLICIES[number];

export const FORM_ATTACHMENT_ANALYSIS_MODEL_CLASSES = [
    'local_ocr',
    'local_vision',
    'ollama',
    'openai_compatible',
    'openai',
    'claude_sonnet'
] as const;

export type FormAttachmentAnalysisModelClass = typeof FORM_ATTACHMENT_ANALYSIS_MODEL_CLASSES[number];

export const FORM_ATTACHMENT_ANALYSIS_ALLOWED_MODEL_CLASSES_BY_POLICY: Record<FormAttachmentAnalysisEgressPolicy, readonly FormAttachmentAnalysisModelClass[]> = {
    no_ai: [],
    local_only: ['local_ocr', 'local_vision', 'ollama'],
    sovereign_only: ['local_ocr', 'local_vision', 'ollama', 'openai_compatible'],
    external_redacted: ['ollama', 'openai_compatible', 'openai', 'claude_sonnet'],
    external_allowed: FORM_ATTACHMENT_ANALYSIS_MODEL_CLASSES
};

export function isFormAttachmentAnalysisModelClassAllowed(
    policy: FormAttachmentAnalysisEgressPolicy,
    modelClass: FormAttachmentAnalysisModelClass
): boolean {
    return FORM_ATTACHMENT_ANALYSIS_ALLOWED_MODEL_CLASSES_BY_POLICY[policy].includes(modelClass);
}

export const FORM_ATTACHMENT_ANALYSIS_REDACTION_MODES = ['none', 'when_possible'] as const;

export type FormAttachmentAnalysisRedaction = typeof FORM_ATTACHMENT_ANALYSIS_REDACTION_MODES[number];

export interface FormAttachmentAnalysisProfile {
    enabled?: boolean
    version?: number
    expectedDocumentType?: string
    /** Legacy single check instruction; ignored at runtime once citizenPrompt or staffPrompt is set. */
    promptSuggestion?: string
    /** Story A: check shown to the applicant right after the upload (yes/no hints only). */
    citizenPrompt?: string
    /** Story B: purpose-bound reading for staff after submission. */
    staffPrompt?: string
    /** Redaction before a sovereign or local run. Missing means 'none' at runtime. */
    redaction?: FormAttachmentAnalysisRedaction
    resultSchema?: Record<string, unknown>
    modelClass?: FormAttachmentAnalysisModelClass
    egressPolicy?: FormAttachmentAnalysisEgressPolicy
}

/**
 * Every key an attachment analysis profile may carry. Normalisers in TS and
 * PHP, form_schema.schema.json and the Drupal widget must know each one,
 * otherwise the key silently disappears on the next save.
 */
export const FORM_ATTACHMENT_ANALYSIS_PROFILE_KEYS = [
    'enabled',
    'version',
    'expectedDocumentType',
    'promptSuggestion',
    'citizenPrompt',
    'staffPrompt',
    'redaction',
    'resultSchema',
    'modelClass',
    'egressPolicy'
] as const satisfies ReadonlyArray<keyof FormAttachmentAnalysisProfile>;

// Compile-time parity: the key list and the profile type name the same keys.
type MissingAttachmentAnalysisProfileKeys = Exclude<keyof FormAttachmentAnalysisProfile, typeof FORM_ATTACHMENT_ANALYSIS_PROFILE_KEYS[number]>;
export const FORM_ATTACHMENT_ANALYSIS_PROFILE_KEYS_COMPLETE: [MissingAttachmentAnalysisProfileKeys] extends [never] ? true : never = true;

export interface FormFieldTranslation {
    label?: string
    placeholder?: string
    /**
     * Localized option labels. Array entries map by index, object entries map
     * from the canonical option value to the localized display label.
     */
    options?: string[] | Record<string, string>
}

export interface FormSectionTranslation {
    title?: string
    description?: string
}

export interface FormSchemaTranslation {
    title?: string
    description?: string
}

export type FormFieldTranslations = Record<string, FormFieldTranslation>;
export type FormSectionTranslations = Record<string, FormSectionTranslation>;
export type FormSchemaTranslations = Record<string, FormSchemaTranslation>;

export const FORM_CONTEXT_SOURCE_TYPES = [
    'public_document',
    'form_attachment'
] as const;

export type FormContextSourceType = typeof FORM_CONTEXT_SOURCE_TYPES[number];

export const FORM_CONTEXT_SOURCE_USAGES = [
    'editor',
    'citizen_assistant'
] as const;

export type FormContextSourceUsage = typeof FORM_CONTEXT_SOURCE_USAGES[number];

export interface FormContextSource {
    type: FormContextSourceType
    id: string
    title: string
    placement?: string
    version?: string
    changed?: number
    enabledFor?: FormContextSourceUsage[]
    requiredCitation?: boolean
}

export const FORM_PRECHECK_FACT_TYPES = [
    'boolean',
    'number',
    'text',
    'enum'
] as const;

export type FormPrecheckFactType = typeof FORM_PRECHECK_FACT_TYPES[number];

export const FORM_PRECHECK_REVIEW_STATUSES = [
    'suggested',
    'approved',
    'rejected'
] as const;

export type FormPrecheckReviewStatus = typeof FORM_PRECHECK_REVIEW_STATUSES[number];

export type FormPrecheckAffects = 'procedure_fit' | 'obligation' | 'both';

export interface FormPrecheckLocalizedText {
    de: string
    en?: string
}

export interface FormPrecheckEvidence {
    sourceType: 'form_source' | 'context_source'
    sourceId?: string
    sourceTitle?: string
    quote: string
    page?: number
}

/**
 * One reviewed fact required for a non-binding citizen precheck.
 *
 * This is not a question-and-answer script. The schema describes the fact,
 * its safe localized prompt and the exact source passage that makes it
 * relevant. Citizen answers remain runtime facts and are never stored here.
 */
export interface FormPrecheckCriterion {
    id: string
    factKey: string
    /**
     * Optional canonical form field that also represents this fact. Source
     * analysis may leave this empty. Without a binding, the answer exists only
     * in the current precheck dialogue and is not copied into application data.
     */
    fieldId?: string
    /**
     * Explicit admin classification for a criterion without a canonical form
     * field. The marker permits a dialogue-only fact but never turns it into
     * application data.
     */
    privacy?: {
        kind: 'not_personal'
    }
    factType: FormPrecheckFactType
    label: FormPrecheckLocalizedText
    question: FormPrecheckLocalizedText
    affects: FormPrecheckAffects
    order: number
    reviewStatus: FormPrecheckReviewStatus
    evidence: FormPrecheckEvidence
    unit?: string
    options?: string[]
}

export interface FormPrecheckSchema {
    version: 1
    criteria: FormPrecheckCriterion[]
}

export interface FormField {
    id: string
    type: FormFieldType
    label: string
    placeholder?: string
    i18n?: FormFieldTranslations
    required?: boolean
    options?: string[]
    defaultValue?: string | number | boolean
    format?: FormFieldFormat
    validation?: FormFieldValidation
    widget?: FormAddressWidget
    semantics?: FormFieldSemantics
    analysis?: FormAttachmentAnalysisProfile
    crm_key?: CrmKey | string
    /**
     * Marks a field as sensitive (ADR-3). In the assisted assistant flow such
     * values are kept client-side and never mirrored into the LLM context
     * (ADR-6 §4). See app/utils/field-sensitivity.ts for the resolver.
     */
    sensitive?: boolean
    /**
     * Explicit privacy classification used by authoring checks and public
     * schema consumers. PII-like fields must carry a kind before publishing.
     */
    privacy?: FormFieldPrivacy
    conditionalOn?: {
        fieldId: string
        value: string | boolean
    }
    /**
     * Server-side computation spec. The canonical computation runs in the
     * Drupal beantragt_compute module and is always authoritative. The frontend
     * only uses this for a live preview while the citizen fills the form; the
     * previewed value must never be submitted as user input or treated as final.
     *
     * `fn` is a plain string matching the backend plugin registry ID (not a
     * closed TS enum -- the catalog lives server-side and coupling the FE type
     * to it would cause drift on every new plugin).
     * `args` is an ordered list of field IDs whose current values are passed to
     * the compute function.
     */
    computed?: {
        fn: string
        args: string[]
    }
    maxFiles?: number
    maxSizeBytes?: number
    maxFileSizeBytes?: number
}

export interface ApplicationAttachmentUpload {
    attachmentId: string
    claimToken?: string
    filename: string
    size: number
    mimeType: string
    fieldId: string
    formId: string
    analysisStatus?: 'not_requested' | 'pending' | 'complete' | 'failed' | string
    analysis?: ApplicationAttachmentAnalysisFeedback
}

/**
 * Sanitized pre-submission feedback returned after an attachment check.
 * It is informational only. The server-side attachment claim remains the
 * authoritative submission record.
 */
export interface ApplicationAttachmentAnalysisFeedback {
    language?: 'de' | 'en'
    status: 'not_requested' | 'pending' | 'complete' | 'failed' | 'skipped' | 'not_checked_redaction_impossible'
    code?: string
    result?: {
        outcome?: 'pass' | 'needs_review' | 'fail' | 'unknown'
        /** Configured expected type. Single-language German labels remain German in the English UI. */
        documentType?: string
        documentTypeLanguage?: 'de' | 'en'
        criteria?: Array<{
            label: string
            status: 'confirmed' | 'missing' | 'unclear'
        }>
        /** Only part of a long PDF was checked, or a scan went unredacted. */
        notices?: Array<'pages_truncated' | 'unredacted_scan'>
        pagesChecked?: number
    }
}

export interface FormSection {
    id: string
    title: string
    description?: string
    i18n?: FormSectionTranslations
    repeatable?: boolean
    maxInstances?: number
    fields: FormField[]
    addressGroups?: FormAddressGroup[]
}

/**
 * Workflow configuration for form schemas.
 * Defines custom statuses and transitions for applications against this schema.
 */
export interface WorkflowStatus {
    machineName: string
    description?: string
    attributes?: WorkflowAttributeDefinition[]
}

export interface WorkflowAttributeValue {
    key: string
    name: string
}

export type WorkflowAttributeDatatype = 'string' | 'number' | 'text' | 'datetime' | 'singlevaluelist' | 'multivaluelist' | 'imagelist';

export interface WorkflowAttributeDefinition {
    code: string
    variable: boolean
    datatype: WorkflowAttributeDatatype
    required: boolean
    description: string
    order: number
    values?: WorkflowAttributeValue[]
    media_type?: string
    media_group?: string
    datatype_description?: string
    default_value?: string | number
    validation?: {
        pattern?: string
        pattern_message?: string
        min?: number
        max?: number
    }
    conditions?: {
        show_when?: Array<{
            attribute_code: string
            operator: 'equals' | 'not_equals' | 'contains' | 'not_empty'
            value?: string
        }>
    }
}

export interface WorkflowTransition {
    from: string
    to: string
    condition?: string
    attributes?: WorkflowAttributeDefinition[]
}

export interface WorkflowConfig {
    mode?: 'catalog' | 'inherit'
    defaultStatus?: string
    statuses: WorkflowStatus[]
    transitions: WorkflowTransition[]
}

/**
 * Semantic extraction metadata for a form schema.
 * Used for AI-powered categorization and attachment detection.
 */
export interface FormAttachment {
    key: string
    label: string
    required: boolean
}

export interface FormSemantics {
    category?: string
    entities?: string[]
    attachments?: FormAttachment[]
    legal_references?: string[]
}

export interface FormSchemaSource {
    type: 'fim-json-schema' | 'pdf' | 'image' | 'text' | 'manual' | 'unknown'
    file?: string
    fileName?: string
    mediaType?: string
    url?: string
    schemaId?: string
    version?: string
    importedAt?: string
    textStatistics?: {
        bytes: number
        lines: number
        parts: number
        count?: { unit: 'controls' | 'elements' | 'keys', total: number }
    }
}

export type FormSubmissionAuthMode = 'anonymous' | 'optional' | 'required';

export type FormSubmissionAuthProvider = 'passwordless' | 'bundid';

export type FormSubmissionIdentityRequirement = 'required' | 'optional' | 'none';

export interface FormSubmissionIdentityCollectPolicy {
    fullName?: FormSubmissionIdentityRequirement | boolean
    email?: FormSubmissionIdentityRequirement | boolean
}

export interface FormSubmissionAuthPolicy {
    /**
     * Controls whether a citizen account is required for the final application save.
     */
    mode?: FormSubmissionAuthMode
    /**
     * Publicly enabled login providers for this schema. BundID is only offered
     * when the runtime SSO/BundID switch is enabled as well.
     */
    providers?: FormSubmissionAuthProvider[]
    /**
     * Supplemental identity fields to collect when the actual form schema does
     * not already contain CRM-tagged applicant fields.
     */
    collect?: FormSubmissionIdentityCollectPolicy
}

/**
 * The JSON structure stored in field_schema on the FormSchema entity.
 * This is the schema definition that drives the form renderer.
 */
export interface FormSchema {
    id?: string
    title: string
    description?: string
    i18n?: FormSchemaTranslations
    sections: FormSection[]
    version?: number
    workflow?: WorkflowConfig
    semantics?: FormSemantics
    source?: FormSchemaSource
    auth?: FormSubmissionAuthPolicy
    retention?: {
        dataRetentionDays?: number
    }
    contextSources?: FormContextSource[]
    precheckSchema?: FormPrecheckSchema
}

/**
 * Workflow status values for the form_schema entity's field_workflow_status.
 * Maps to Drupal list_string allowed_values: draft, published, archived.
 */
export type SchemaWorkflowStatus = 'draft' | 'published' | 'archived';

/** Backend wording and field scope for one form revision, language and consent kind. */
export interface ProfileConsentOffer {
    id: string
    textVersion: string
    text: string
    fields: string[]
}

export type ProfileConsentOffers = Record<'de' | 'en', {
    contact: ProfileConsentOffer | null
    bank: ProfileConsentOffer | null
}>;

/**
 * Where the file of an upload field goes for the AI pre-check, computed by
 * the server from operator configuration at request time (never stored in
 * the form JSON). Labels only: no model class ids, prompts or schema.
 *
 * - provider: the file goes to the named service.
 * - stays: nothing leaves the system (no AI, local processing, nothing to check).
 * - unavailable: the chosen service is not set up or not allowed, so nothing
 *   leaves either; staff should ask operations.
 */
export type AttachmentAnalysisDisclosureState = 'provider' | 'stays' | 'unavailable';

export type AttachmentAnalysisDisclosureReason
    = | 'disabled'
      | 'ai_off'
      | 'local_processing'
      | 'not_selected'
      | 'nothing_to_check'
      | 'not_configured'
      | 'blocked';

/** Staff view of the disclosure (form editor). */
export interface AttachmentAnalysisDisclosure {
    state: AttachmentAnalysisDisclosureState
    /** Why nothing leaves (state stays or unavailable). */
    reason?: AttachmentAnalysisDisclosureReason
    /** Operator label of the service. */
    provider?: string
    /** Operator model label, else the model the run resolves. */
    model?: string
    /** Operator label of where the service runs. */
    location?: string
    /** The pre-check (story A or the single legacy check) runs. */
    precheck: boolean
    /** Story B reads purpose-bound values for staff after submission. */
    staffEvaluation: boolean
    /** A legacy single check reads purpose-bound values already at upload. */
    staffValuesAtUpload: boolean
    /** Scanned pages can be sent unredacted only for the separate staff evaluation. */
    scanFallback: boolean
    /** Only a safely redacted copy may leave for the citizen pre-check. */
    redactedPrecheckOnly?: boolean
    /** Provider and location labels are both configured. */
    complete: boolean
}

/** Citizen view: only what the upload field shows, keyed by field id. */
export interface PublicAttachmentAnalysisDisclosure {
    state: 'provider' | 'stays'
    provider?: string
    model?: string
    location?: string
    precheck: boolean
    staffEvaluation: boolean
    staffValuesAtUpload: boolean
    scanFallback: boolean
    /** Only a safely redacted copy may leave for the citizen pre-check. */
    redactedPrecheckOnly?: boolean
}
