/**
 * Central type exports for beantragt.ai frontend.
 *
 * Usage:
 *   import type { FormSchema, Application, ApplicantProfile } from '~/types'
 *   import type { JsonApiResponse, FormSchemaAttributes } from '~/types'
 */

export type {
    // CRM keys
    PersonCrmKey,
    CompanyCrmKey,
    CrmKey,
    // Form field types
    FormFieldType,
    FormFieldFormat,
    FormFieldValidation,
    FormAddressValue,
    FormAddressWidget,
    GeocodingResult,
    FormField,
    FormSection,
    // Workflow
    WorkflowStatus,
    WorkflowTransition,
    WorkflowConfig,
    // Semantics
    FormAttachment,
    FormSemantics,
    // Schema
    FormSchema,
    SchemaWorkflowStatus
} from './form';

export type {
    ApplicationWorkflowStatus,
    Application,
    ApplicationCreatePayload,
    ApplicationStatusUpdate
} from './application';

export type {
    ProfileType,
    ApplicantProfile
} from './profile';

export { CRM_KEY_TO_PROFILE_FIELD } from './profile';

export type {
    // Core JSON:API types
    JsonApiResource,
    JsonApiRelationship,
    JsonApiResourceIdentifier,
    JsonApiLinks,
    JsonApiSingleResponse,
    JsonApiCollectionResponse,
    JsonApiResponse,
    JsonApiMeta,
    JsonApiError,
    JsonApiErrorResponse,
    WorkspaceInvitePublic,
    WorkspaceInviteClaimed,
    WorkspaceInviteResponse,
    // Entity-specific attribute types
    FormSchemaAttributes,
    FormSchemaGroupAttributes,
    ApplicationAttributes,
    ApplicantProfileAttributes,
    // Convenience resource types
    FormSchemaResource,
    FormSchemaGroupResource,
    ApplicationResource,
    ApplicantProfileResource
} from './api';

export type {
    // Admin page response types
    FormSchemaCollectionResponse,
    FormSchemaSingleResponse,
    FormSchemaGroupCollectionResponse,
    AdminApplicationResource,
    AdminApplicationsResponse,
    AdminApplicationDetailResponse,
    AdminApplicationProof,
    AdminApplicationProofCompleteness,
    AdminApplicationDeliveryLog,
    AdminApplicationDeliveriesResponse,
    AdminApplicationDeliveryDispatchResponse,
    AdminApplicationAssignee,
    AdminApplicationDelegationTarget,
    AdminApplicationAssigneesResponse,
    AdminApplicationAttachment,
    AdminAttachmentGuardStatus,
    AdminAttachmentGuardReport,
    AdminApplicationRollbackTarget,
    AdminApplicationRollbackStatus,
    AdminApplicationRollbackRevision,
    AdminApplicationTransition,
    AdminApplicationReviewCode,
    AdminApplicationWorkflowReview,
    AdminApplicationEvents,
    AdminApplicationEventKind,
    AdminApplicationEventCounts,
    AdminApplicationSinceSeenKind,
    ApplicationRow,
    ApplicationCountsResponse
} from './admin';

export type {
    AdminApplicantApplicationSummary,
    AdminApplicantProfileRow,
    AdminApplicantsResponse
} from './admin-applicant';

export type {
    RawJsonApiRelationship,
    RawJsonApiResource,
    RawJsonApiGroupResource
} from './jsonapi';

export type * from './integrations';
export type * from './integration-mapping-editor';
export type * from './case-transfers';
