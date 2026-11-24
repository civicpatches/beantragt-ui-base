/**
 * POST /api/submit
 *
 * Receives citizen form data and creates an application entity
 * in Drupal via the native public v1 API.
 */
import type { H3Event } from 'h3';
import type { FormField } from '~~/app/types/form';
import { isDeliveryRoute, type DeliveryRoute } from '~~/app/types/delivery';
import type { RawJsonApiGroupResource, RawJsonApiRelationship } from '~~/app/types/jsonapi';
import { normalizeFormAddressValue } from '~~/app/utils/form-address';
import { isSubmissionFieldVisible } from '~~/app/utils/form-condition-value';
import { canonicalCurrencyAmount, isCurrencyField } from '~~/app/utils/form-currency';
import { normalizeFormField, validateFormFieldValue } from '~~/app/utils/form-schema';
import { isFamilyNameField, isGivenNameField } from '~~/app/utils/submission-identity';
import { readSubmissionReceipt } from '#shared/submission-receipt';
import { setPrivateNoStore } from '../utils/request-security';
import { serviceProxyHeaders } from '../utils/public-status-proxy';
import { isDrupalSessionCookie } from '../utils/session';
import { emitApplicationSubmitted } from '../utils/application-submitted-hook';
import { isProfileConsentOfferId } from '../utils/profile-consent-offer';

interface SubmissionAuthPolicy {
    mode?: 'anonymous' | 'optional' | 'required'
    providers?: string[]
    collect?: {
        fullName?: 'required' | 'optional' | 'none' | boolean
        email?: 'required' | 'optional' | 'none' | boolean
    }
}

interface SchemaSubmissionContext {
    auth: SubmissionAuthPolicy
    fullNameFieldIds: string[]
    firstNameFieldIds: string[]
    lastNameFieldIds: string[]
    emailFieldIds: string[]
    sensitiveFieldIds: Set<string>
    fields: FormField[]
    hasCrmFullNameField: boolean
    hasCrmEmailField: boolean
    jurisdiction: JsonApiRelationshipData | null
    organisation: JsonApiRelationshipData | null
    group: JsonApiRelationshipData | null
    parsed: boolean
}

interface JsonApiRelationshipData {
    type: 'group--jur' | 'group--org'
    id: string
}

interface SupplementalIdentityInput {
    fullName?: string
    email?: string
}

interface AttachmentClaimInput {
    fieldId: string
    attachmentId: string
    claimToken: string
}

type SubmissionLocale = 'de' | 'en';

interface PublicApplicationV1Response {
    data?: {
        referenceNumber?: string
        statusToken?: string
        receipt?: unknown
    }
    confirmation?: {
        required?: boolean
    }
}

interface SubmissionSessionUser {
    uid?: number
    uuid?: string
    email?: string
    roles?: unknown
    auth_provider?: unknown
}

const STAFF_SUBMISSION_ROLES = new Set(['administrator', 'department_admin', 'case_worker', 'service_account', 'nuxt_service']);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const SUBMISSION_AUTH_MODES = new Set(['anonymous', 'optional', 'required']);
const SUBMISSION_AUTH_PROVIDERS = new Set(['passwordless', 'bundid']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLAIM_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,96}$/;
const MAX_ATTACHMENTS = 20;
const MAX_ATTACHMENTS_PER_FIELD = 5;
const AUTH_PROVIDER_ALIASES: Record<string, string> = {
    bundid_mock: 'bundid'
};
const RESERVED_SUBMISSION_DATA_KEYS = new Set(['applicant_full_name', 'applicant_email']);

function normalizeSubmissionLocale(value: unknown): SubmissionLocale {
    if (typeof value !== 'string') return 'de';
    const normalized = value.trim().toLowerCase();
    return normalized === 'en' ? 'en' : 'de';
}

async function assertSchemaIsPublished(schemaId: string): Promise<SchemaSubmissionContext> {
    const query = new URLSearchParams({
        'fields[form_schema--form_schema]': 'field_workflow_status,field_publication_scope,field_schema,field_jurisdiction,field_organisation,field_group',
        'fields[group--jur]': 'field_slug',
        'fields[group--org]': 'field_jurisdiction',
        'include': 'field_jurisdiction,field_organisation,field_organisation.field_jurisdiction,field_group,field_group.field_jurisdiction'
    });
    const response = await drupalServiceFetch<{
        data?: {
            attributes?: {
                field_workflow_status?: string
                field_publication_scope?: string
                field_schema?: string | { value?: string }
            }
            relationships?: {
                field_jurisdiction?: RawJsonApiRelationship
                field_organisation?: RawJsonApiRelationship
                field_group?: RawJsonApiRelationship
            }
        }
        included?: RawJsonApiGroupResource[]
    }>(`/jsonapi/form_schema/form_schema/${schemaId}?${query.toString()}`);

    if (
        response.data?.attributes?.field_workflow_status !== 'published'
        || response.data?.attributes?.field_publication_scope !== 'internet'
    ) {
        throw createSafeError({
            statusCode: 404,
            message: 'errors.submit.formNotFound',
            data: { code: 'errors.submit.formNotFound' }
        });
    }

    const context = parseSchemaSubmissionContext(response.data?.attributes?.field_schema);
    if (!context.parsed) {
        throw createSafeError({
            statusCode: 404,
            message: 'errors.submit.formNotFound',
            data: { code: 'errors.submit.formNotFound' }
        });
    }

    const group = readGroupRelationship(response.data.relationships?.field_group, ['group--jur', 'group--org']);
    const organisation = readGroupRelationship(response.data.relationships?.field_organisation, 'group--org')
      ?? (group?.type === 'group--org' ? group : null);
    const jurisdiction = readGroupRelationship(response.data.relationships?.field_jurisdiction, 'group--jur')
      ?? readOrganisationJurisdiction(response.included, organisation)
      ?? (group?.type === 'group--jur' ? group : null);

    return {
        ...context,
        jurisdiction,
        organisation,
        group
    };
}

function readGroupRelationship(
    relationship: RawJsonApiRelationship | undefined,
    allowedTypes: JsonApiRelationshipData['type'] | JsonApiRelationshipData['type'][]
): JsonApiRelationshipData | null {
    const data = relationship?.data;
    const allowed = Array.isArray(allowedTypes) ? allowedTypes : [allowedTypes];
    if (!data || typeof data.id !== 'string' || typeof data.type !== 'string') {
        return null;
    }
    if (!allowed.includes(data.type as JsonApiRelationshipData['type'])) {
        return null;
    }
    return {
        type: data.type as JsonApiRelationshipData['type'],
        id: data.id
    };
}

function readOrganisationJurisdiction(
    included: RawJsonApiGroupResource[] | undefined,
    organisation: JsonApiRelationshipData | null
): JsonApiRelationshipData | null {
    if (!organisation) return null;
    const org = (included || []).find(item => item.type === 'group--org' && item.id === organisation.id);
    return readGroupRelationship(org?.relationships?.field_jurisdiction, 'group--jur');
}

/** Forward only opted-in offers with well-formed IDs. Drupal checks that each offer is current. */
function submittedProfileConsents(body: {
    profileConsent?: unknown
    bankConsent?: unknown
    profileConsentOfferId?: unknown
    bankConsentOfferId?: unknown
}) {
    const contactId = body.profileConsent === true && isProfileConsentOfferId(body.profileConsentOfferId)
        ? body.profileConsentOfferId
        : null;
    const bankId = contactId && body.bankConsent === true && isProfileConsentOfferId(body.bankConsentOfferId)
        ? body.bankConsentOfferId
        : null;
    return {
        profileConsent: contactId !== null,
        bankConsent: bankId !== null,
        ...(contactId ? { profileConsentOfferId: contactId } : {}),
        ...(bankId ? { bankConsentOfferId: bankId } : {})
    };
}

/** Forwards `deliveryRoute` only when it is one of the routes; anything else is dropped. */
function submittedDeliveryRoute(value: unknown): { deliveryRoute?: DeliveryRoute } {
    return isDeliveryRoute(value) ? { deliveryRoute: value } : {};
}

function normalizeApplicantEmail(email: unknown): string | null {
    if (typeof email !== 'string') {
        return null;
    }

    const normalized = email.trim().toLowerCase();
    return normalized || null;
}

function hasBrowserSessionCookie(event: H3Event): boolean {
    const cookieHeader = getHeader(event, 'cookie') || '';
    return cookieHeader
        .split(';')
        .map(value => value.trim())
        .some((cookie) => {
            const [name, value = ''] = cookie.split('=');
            return isDrupalSessionCookie(name || '', value);
        });
}

function fieldSchemaText(raw: unknown): string {
    if (typeof raw === 'string') return raw;
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && typeof (raw as { value?: unknown }).value === 'string') {
        return (raw as { value: string }).value;
    }
    return '';
}

function isSchemaField(value: unknown): value is { id?: unknown, type?: unknown, label?: unknown, crm_key?: unknown, sensitive?: unknown } {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeFieldText(value: unknown): string {
    return String(value ?? '').trim().toLowerCase();
}

function normalizedFieldId(value: unknown): string {
    return normalizeFieldText(value)
        .replace(/[^a-z0-9]+/gu, '_')
        .replace(/^_+|_+$/gu, '');
}

function isFullNameSchemaField(field: { id?: unknown, label?: unknown, crm_key?: unknown }): boolean {
    if (field.crm_key === 'person.full_name') return true;

    const id = normalizedFieldId(field.id);
    if (['full_name', 'applicant_full_name', 'antragsteller_name'].includes(id)) return true;

    const label = normalizeFieldText(field.label);
    return label === 'name'
      || label === 'vollstaendiger name'
      || label === 'vollständiger name'
      || label === 'ihr name'
      || /^name der antragsteller/u.test(label)
      || /^antragsteller.*name/u.test(label);
}

function isApplicantEmailSchemaField(field: { id?: unknown, type?: unknown, label?: unknown, crm_key?: unknown }): boolean {
    if (field.crm_key === 'person.email') return true;

    const id = normalizedFieldId(field.id);
    return id === 'email'
      || id === 'e_mail'
      || id === 'applicant_email';
}

function isSensitiveSchemaField(field: { sensitive?: unknown }): boolean {
    const sensitive = field.sensitive;
    if (typeof sensitive === 'boolean') return sensitive;
    if (typeof sensitive === 'number') return sensitive === 1;
    if (typeof sensitive === 'string') {
        return ['1', 'true', 'yes', 'on'].includes(sensitive.trim().toLowerCase());
    }
    return false;
}

function parseSchemaSubmissionContext(raw: unknown): SchemaSubmissionContext {
    const context: SchemaSubmissionContext = {
        auth: {},
        fullNameFieldIds: [],
        firstNameFieldIds: [],
        lastNameFieldIds: [],
        emailFieldIds: [],
        sensitiveFieldIds: new Set(),
        fields: [],
        hasCrmFullNameField: false,
        hasCrmEmailField: false,
        jurisdiction: null,
        organisation: null,
        group: null,
        parsed: false
    };

    const schemaText = fieldSchemaText(raw);
    if (!schemaText) return context;

    try {
        const schema = JSON.parse(schemaText) as Record<string, unknown>;
        context.parsed = true;
        context.auth = normalizeAuthPolicy(schema.auth);

        const sections = Array.isArray(schema.sections) ? schema.sections : [];
        for (const section of sections) {
            const fields = section && typeof section === 'object' && !Array.isArray(section)
                ? (section as { fields?: unknown }).fields
                : null;
            if (!Array.isArray(fields)) continue;
            for (const field of fields) {
                if (!isSchemaField(field) || typeof field.id !== 'string') continue;
                const normalizedField = {
                    ...normalizeFormField(field as Partial<FormField>, { requireCurrencyMetadata: true }),
                    id: field.id
                };
                context.fields.push(normalizedField);
                const sensitive = isSensitiveSchemaField(field);
                if (sensitive) {
                    context.sensitiveFieldIds.add(field.id);
                }
                if (field.crm_key === 'person.full_name') {
                    context.hasCrmFullNameField = true;
                }
                if (field.crm_key === 'person.email') {
                    context.hasCrmEmailField = true;
                }
                // Same detection as the client, which sees the public projection.
                if (isGivenNameField(field)) {
                    context.firstNameFieldIds.push(field.id);
                }
                if (isFamilyNameField(field)) {
                    context.lastNameFieldIds.push(field.id);
                }
                if (isFullNameSchemaField(field)) {
                    context.fullNameFieldIds.push(field.id);
                }
                if (isApplicantEmailSchemaField(field) && !sensitive) {
                    context.emailFieldIds.push(field.id);
                }
            }
        }
    } catch {
        return context;
    }

    return normalizeSchemaSubmissionContext(context);
}

function normalizeRequirement(value: unknown): 'required' | 'optional' | 'none' | boolean | undefined {
    if (typeof value === 'boolean') return value;
    if (value === 'required' || value === 'optional' || value === 'none') return value;
    return undefined;
}

function normalizeAuthPolicy(value: unknown): SubmissionAuthPolicy {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const input = value as Record<string, unknown>;
    const auth: SubmissionAuthPolicy = {};

    if ('mode' in input) {
        auth.mode = typeof input.mode === 'string' && SUBMISSION_AUTH_MODES.has(input.mode)
            ? input.mode as SubmissionAuthPolicy['mode']
            : 'required';
    }

    if (Array.isArray(input.providers)) {
        const providers = [...new Set(
            input.providers
                .filter((provider): provider is string => typeof provider === 'string')
                .map(normalizeAuthProvider)
                .filter(provider => SUBMISSION_AUTH_PROVIDERS.has(provider))
        )];
        auth.providers = providers;
    }

    if (input.collect && typeof input.collect === 'object' && !Array.isArray(input.collect)) {
        const collectInput = input.collect as Record<string, unknown>;
        const collect: NonNullable<SubmissionAuthPolicy['collect']> = {};
        const fullName = normalizeRequirement(collectInput.fullName);
        const email = normalizeRequirement(collectInput.email);
        if (fullName !== undefined) collect.fullName = fullName;
        if (email !== undefined) collect.email = email;
        if (Object.keys(collect).length > 0) auth.collect = collect;
    }

    return auth;
}

function normalizeSchemaSubmissionContext(context: SchemaSubmissionContext): SchemaSubmissionContext {
    if (!context.parsed) return context;

    const collect = context.auth.collect && typeof context.auth.collect === 'object'
        ? { ...context.auth.collect }
        : {};
    const hasNameParts = context.firstNameFieldIds.length > 0 && context.lastNameFieldIds.length > 0;
    if (context.fullNameFieldIds.length === 0 && !hasNameParts && collect.fullName === undefined) {
        collect.fullName = 'required';
    }
    if (context.emailFieldIds.length === 0 && collect.email === undefined) {
        collect.email = 'required';
    }
    context.auth = {
        ...context.auth,
        collect
    };
    return context;
}

function isCitizenSubmissionUser(user: SubmissionSessionUser | null | undefined): user is SubmissionSessionUser & { uid: number, roles: string[] } {
    if (!Array.isArray(user?.roles)) {
        return false;
    }
    const roles = user.roles.filter((role): role is string => typeof role === 'string');
    return Number.isInteger(user?.uid)
      && Number(user?.uid) > 0
      && roles.includes('authenticated')
      && !roles.some(role => STAFF_SUBMISSION_ROLES.has(role));
}

function normalizeAuthProvider(value: unknown): string {
    if (typeof value !== 'string') return 'unknown';
    const provider = value.trim().toLowerCase();
    if (!provider) return 'unknown';
    return AUTH_PROVIDER_ALIASES[provider] || provider;
}

function allowedAuthProviders(auth: SubmissionAuthPolicy): Set<string> | null {
    if (!Array.isArray(auth.providers)) return null;
    return new Set(
        auth.providers
            .filter((provider): provider is string => typeof provider === 'string')
            .map(normalizeAuthProvider)
    );
}

function sessionMatchesSchemaProvider(auth: SubmissionAuthPolicy, sessionUser: SubmissionSessionUser): boolean {
    const allowed = allowedAuthProviders(auth);
    if (allowed === null) return true;
    return allowed.has(normalizeAuthProvider(sessionUser.auth_provider));
}

function normalizeIdentity(bodyIdentity: unknown): SupplementalIdentityInput {
    if (!bodyIdentity || typeof bodyIdentity !== 'object' || Array.isArray(bodyIdentity)) {
        return {};
    }
    const input = bodyIdentity as Record<string, unknown>;
    const fullName = typeof input.fullName === 'string'
        ? input.fullName.trim().substring(0, 200)
        : '';
    const email = normalizeApplicantEmail(input.email);
    return {
        ...(fullName ? { fullName } : {}),
        ...(email ? { email } : {})
    };
}

function submitError(statusCode: number, code: string, data: Record<string, unknown> = {}): never {
    throw createSafeError({
        statusCode,
        message: code,
        data: { code, ...data }
    });
}

function publicV1SubmitErrorCode(upstreamCode: unknown, upstreamDetails?: unknown): { code: string, data?: Record<string, unknown> } {
    const upstream = typeof upstreamCode === 'string' ? upstreamCode : '';
    switch (upstreamCode) {
        case 'form.not_found':
            return { code: 'errors.submit.formNotFound' };
        case 'consent.required':
            return { code: 'errors.consent.required' };
        case 'application.data_missing':
            return { code: 'errors.submit.dataMissing' };
        case 'application.validation_failed':
            return { code: 'errors.submit.validationFailed', data: publicV1ValidationDetails(upstreamDetails) };
        case 'identity.full_name_required':
            return { code: 'errors.submit.fullNameRequired' };
        case 'identity.email_required':
            return { code: 'errors.submit.emailRequired' };
        case 'identity.email_invalid':
            return { code: 'errors.submit.emailInvalid' };
        case 'auth.required':
            return { code: 'errors.auth.notAuthenticated' };
        case 'attachment.file_too_large':
            return { code: 'errors.attachments.fileTooLarge' };
        case 'attachment.unsupported_file_type':
        case 'attachment.mime_mismatch':
            return { code: 'errors.attachments.unsupportedType' };
        case 'attachment.claim_expired':
            return { code: 'errors.attachments.claimExpired' };
        case 'attachment.not_found':
            return { code: 'errors.attachments.notFound' };
        case 'attachment.quarantined':
            return { code: 'errors.attachments.quarantined' };
        case 'attachment.total_size_exceeded':
            return { code: 'errors.attachments.totalSizeExceeded' };
        case 'attachment.tenant_storage_quota_exceeded':
            return { code: 'errors.attachments.tenantStorageQuotaExceeded' };
        case 'attachment.invalid_claims':
        case 'attachment.invalid_claim':
        case 'attachment.claim_invalid':
        case 'attachment.claim_in_progress':
        case 'attachment.duplicate':
        case 'attachment.too_many':
        case 'attachment.too_many_for_field':
            return { code: 'errors.attachments.tooMany' };
        case 'rate_limit.exceeded':
            return { code: 'errors.rateLimit.tooManyRequests', data: { seconds: 60 } };
        default:
            return {
                code: 'errors.submit.upstreamRejected',
                data: upstream ? { upstreamCode: upstream } : undefined
            };
    }
}

function publicV1ValidationDetails(upstreamDetails: unknown): Record<string, unknown> | undefined {
    if (!upstreamDetails || typeof upstreamDetails !== 'object' || Array.isArray(upstreamDetails)) {
        return undefined;
    }
    const details = upstreamDetails as Record<string, unknown>;
    const field = typeof details.field === 'string' && /^[A-Za-z0-9_-]{1,120}$/u.test(details.field)
        ? details.field
        : undefined;
    const issue = typeof details.issue === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,64}$/u.test(details.issue)
        ? details.issue
        : undefined;
    return field || issue ? { ...(field ? { field } : {}), ...(issue ? { issue } : {}) } : undefined;
}

function isAttachmentClaimInput(value: unknown): value is AttachmentClaimInput {
    return Boolean(
        value
        && typeof value === 'object'
        && !Array.isArray(value)
        && typeof (value as AttachmentClaimInput).fieldId === 'string'
        && typeof (value as AttachmentClaimInput).attachmentId === 'string'
        && typeof (value as AttachmentClaimInput).claimToken === 'string'
    );
}

function fileFieldIds(schemaContext: SchemaSubmissionContext): Set<string> {
    return new Set(
        schemaContext.fields
            .filter(field => field.type === 'file')
            .map(field => field.id)
    );
}

function normalizeAttachmentClaims(input: unknown, schemaContext: SchemaSubmissionContext): AttachmentClaimInput[] {
    if (input === undefined || input === null) return [];
    if (!Array.isArray(input)) {
        submitError(400, 'errors.attachments.invalidRequest');
    }
    if (input.length > MAX_ATTACHMENTS) {
        submitError(413, 'errors.attachments.tooMany');
    }

    const fileFields = fileFieldIds(schemaContext);
    const claims: AttachmentClaimInput[] = [];
    const seen = new Set<string>();
    const countByField = new Map<string, number>();
    for (const item of input) {
        if (!isAttachmentClaimInput(item)) {
            submitError(400, 'errors.attachments.invalidRequest');
        }
        const fieldId = item.fieldId.trim();
        const attachmentId = item.attachmentId.trim().toLowerCase();
        const claimToken = item.claimToken.trim();
        if (!fileFields.has(fieldId) || !UUID_PATTERN.test(attachmentId) || !CLAIM_TOKEN_PATTERN.test(claimToken)) {
            submitError(400, 'errors.attachments.invalidRequest');
        }
        if (seen.has(attachmentId)) {
            submitError(400, 'errors.attachments.invalidRequest');
        }
        seen.add(attachmentId);
        const nextCount = (countByField.get(fieldId) || 0) + 1;
        if (nextCount > MAX_ATTACHMENTS_PER_FIELD) {
            submitError(413, 'errors.attachments.tooMany');
        }
        countByField.set(fieldId, nextCount);
        claims.push({ fieldId, attachmentId, claimToken });
    }
    return claims;
}

/**
 * Builds the applicant name from separate given and family name fields.
 * The family name field stands in for sensitivity checks of the pair.
 */
function composedNameMatch(data: Record<string, unknown>, context: SchemaSubmissionContext): { value: string, fieldId: string } | null {
    const first = firstStringValueMatch(data, context.firstNameFieldIds);
    const last = firstStringValueMatch(data, context.lastNameFieldIds);
    if (!first || !last) return null;
    const sensitive = context.sensitiveFieldIds.has(first.fieldId) ? first.fieldId : last.fieldId;
    return { value: `${first.value} ${last.value}`, fieldId: sensitive };
}

function firstStringValueMatch(data: Record<string, unknown>, fieldIds: string[]): { value: string, fieldId: string } | null {
    for (const fieldId of fieldIds) {
        const value = data[fieldId];
        if (typeof value === 'string' && value.trim() !== '') {
            return {
                value: value.trim(),
                fieldId
            };
        }
    }
    return null;
}

function isRequiredRequirement(value: unknown): boolean {
    return value === true || value === 'required';
}

/**
 * Visibility of a submitted field: the citizen page's rule (`isConditionMet`) on the condition as the page
 * receives it, so this check, the page and Drupal agree (security re-read of the data edit).
 */
function isSchemaFieldVisible(field: FormField, data: Record<string, unknown>): boolean {
    return isSubmissionFieldVisible(field, data);
}

function sanitizeAndValidateSchemaData(
    data: Record<string, unknown>,
    schemaContext: SchemaSubmissionContext,
    attachmentClaims: AttachmentClaimInput[] = []
): { data: Record<string, unknown>, visibilityData: Record<string, unknown> } {
    const sanitizedData: Record<string, unknown> = {};

    for (const field of schemaContext.fields) {
        if (field.type === 'file') continue;
        if (!Object.prototype.hasOwnProperty.call(data, field.id)) continue;
        const value = data[field.id];
        if (isCurrencyField(field)) {
            sanitizedData[field.id] = canonicalCurrencyAmount(value) ?? value;
        } else if (field.type === 'address') {
            sanitizedData[field.id] = normalizeFormAddressValue(value) ?? value;
        } else {
            sanitizedData[field.id] = typeof value === 'string' ? value.substring(0, 50000) : value;
        }
    }

    const visibilityData = attachmentVisibilityData(sanitizedData, schemaContext, attachmentClaims);
    for (const field of schemaContext.fields) {
        if (!isSchemaFieldVisible(field, visibilityData)) {
            Reflect.deleteProperty(sanitizedData, field.id);
            Reflect.deleteProperty(visibilityData, field.id);
            continue;
        }
        if (field.type === 'file') continue;
        const issues = validateFormFieldValue(field, sanitizedData[field.id], { localizedCurrency: true });
        if (issues.length > 0) {
            throw createSafeError({
                statusCode: 400,
                message: 'errors.submit.validationFailed',
                data: {
                    code: 'errors.submit.validationFailed',
                    field: field.id,
                    issue: issues[0]?.code
                }
            });
        }
        visibilityData[field.id] = sanitizedData[field.id];
    }

    return {
        data: sanitizedData,
        visibilityData
    };
}

function attachmentVisibilityData(
    data: Record<string, unknown>,
    schemaContext: SchemaSubmissionContext,
    attachmentClaims: AttachmentClaimInput[]
): Record<string, unknown> {
    const visibilityData = { ...data };
    const claimsByField = new Map<string, Array<{ attachmentId: string }>>();
    for (const claim of attachmentClaims) {
        const items = claimsByField.get(claim.fieldId) || [];
        items.push({ attachmentId: claim.attachmentId });
        claimsByField.set(claim.fieldId, items);
    }

    for (const field of schemaContext.fields) {
        if (field.type === 'file' && claimsByField.has(field.id)) {
            visibilityData[field.id] = claimsByField.get(field.id);
        }
    }
    return visibilityData;
}

function visibleAttachmentClaims(
    claims: AttachmentClaimInput[],
    schemaContext: SchemaSubmissionContext,
    sanitizedData: Record<string, unknown>
): AttachmentClaimInput[] {
    const visibleFileFields = new Set(
        schemaContext.fields
            .filter(field => field.type === 'file' && isSchemaFieldVisible(field, sanitizedData))
            .map(field => field.id)
    );

    return claims.filter(claim => visibleFileFields.has(claim.fieldId));
}

function validateFileFieldRequirements(
    schemaContext: SchemaSubmissionContext,
    sanitizedData: Record<string, unknown>,
    attachmentClaims: AttachmentClaimInput[]
): void {
    const claimsByField = new Map<string, number>();
    for (const claim of attachmentClaims) {
        claimsByField.set(claim.fieldId, (claimsByField.get(claim.fieldId) || 0) + 1);
    }

    for (const field of schemaContext.fields) {
        if (field.type !== 'file') continue;
        if (!isSchemaFieldVisible(field, sanitizedData)) continue;
        if (field.required && (claimsByField.get(field.id) || 0) === 0) {
            submitError(400, 'errors.submit.validationFailed', {
                field: field.id,
                issue: 'required'
            });
        }
    }
}

export default defineEventHandler(async (event) => {
    requireSameOriginRequest(event);
    setPrivateNoStore(event);

    // Rate limiting: prevent application creation spam
    const ip = getRequestClientIp(event);
    checkRateLimit(ip, 'application', event);

    const body = await readBody<{
        schemaId: string
        data: Record<string, unknown>
        attachments?: unknown
        identity?: SupplementalIdentityInput
        consentAccepted?: boolean
        profileConsent?: unknown
        bankConsent?: unknown
        profileConsentOfferId?: unknown
        bankConsentOfferId?: unknown
        deliveryRoute?: unknown
        locale?: unknown
    }>(event);

    const schemaId = validateUuid(body.schemaId, 'schemaId');
    requireConsentAccepted(body.consentAccepted);

    if (!body.data || typeof body.data !== 'object') {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.submit.dataMissing',
            data: { code: 'errors.submit.dataMissing' }
        });
    }

    const schemaContext = await assertSchemaIsPublished(schemaId);
    const identity = normalizeIdentity(body.identity);
    const submissionLocale = normalizeSubmissionLocale(body.locale);

    // Limit application data size before validating against the loaded schema.
    const MAX_FIELDS = 200;
    const rawData: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body.data).slice(0, MAX_FIELDS)) {
        if (!RESERVED_SUBMISSION_DATA_KEYS.has(key)) {
            rawData[key] = value;
        }
    }
    const submittedAttachmentClaims = normalizeAttachmentClaims(body.attachments, schemaContext);
    const validationResult = sanitizeAndValidateSchemaData(rawData, schemaContext, submittedAttachmentClaims);
    const sanitizedData = validationResult.data;
    const attachmentClaims = visibleAttachmentClaims(submittedAttachmentClaims, schemaContext, validationResult.visibilityData);
    validateFileFieldRequirements(schemaContext, validationResult.visibilityData, attachmentClaims);

    const directNameMatch = firstStringValueMatch(sanitizedData, schemaContext.fullNameFieldIds);
    const composedName = directNameMatch ? null : composedNameMatch(sanitizedData, schemaContext);
    const fullNameMatch = directNameMatch ?? composedName;
    const emailMatch = firstStringValueMatch(sanitizedData, schemaContext.emailFieldIds);
    const submittedFullName = fullNameMatch?.value || identity.fullName || null;
    let applicantEmail = normalizeApplicantEmail(emailMatch?.value)
      || identity.email
      || null;
    let ownerUuid: string | null = null;
    let authenticatedEmail: string | null = null;
    const hasBrowserSession = schemaContext.auth.mode !== 'anonymous' && hasBrowserSessionCookie(event);
    if (hasBrowserSession) {
        let sessionUser: SubmissionSessionUser | null = null;
        try {
            sessionUser = await getAuthenticatedUser(event) as SubmissionSessionUser;
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : e;
            if (schemaContext.auth.mode === 'required') {
                console.error('[submit] Required browser session could not be verified:', message);
                throw createSafeError({
                    statusCode: 401,
                    message: 'errors.auth.notAuthenticated',
                    data: { code: 'errors.auth.notAuthenticated' }
                });
            }
            console.info('[submit] Ignoring unverified optional browser session for public citizen submission:', message);
        }

        const citizenSessionUser = isCitizenSubmissionUser(sessionUser) ? sessionUser : null;
        const sessionCanOwnSubmission = citizenSessionUser !== null
          && sessionMatchesSchemaProvider(schemaContext.auth, citizenSessionUser);

        if (citizenSessionUser && !sessionCanOwnSubmission) {
            if (schemaContext.auth.mode === 'required') {
                throw createSafeError({
                    statusCode: 403,
                    message: 'errors.auth.accessDenied',
                    data: { code: 'errors.auth.accessDenied' }
                });
            }
            console.info('[submit] Ignoring citizen session with disallowed provider for optional public submission.');
        }

        if (citizenSessionUser && sessionCanOwnSubmission && normalizeAuthProvider(citizenSessionUser.auth_provider) === 'passwordless') {
            authenticatedEmail = normalizeApplicantEmail(citizenSessionUser.email);
            applicantEmail = authenticatedEmail || applicantEmail;
        }
        if (
            citizenSessionUser
            && sessionCanOwnSubmission
            && citizenSessionUser.uuid
            && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(citizenSessionUser.uuid)
        ) {
            ownerUuid = citizenSessionUser.uuid;
        } else if (sessionUser && !isCitizenSubmissionUser(sessionUser)) {
            console.info('[submit] Ignoring privileged browser session for public citizen submission.');
        }
    }

    if (schemaContext.auth.mode === 'required' && !ownerUuid) {
        throw createSafeError({
            statusCode: 401,
            message: 'errors.auth.notAuthenticated',
            data: { code: 'errors.auth.notAuthenticated' }
        });
    }

    if (isRequiredRequirement(schemaContext.auth.collect?.fullName) && !submittedFullName) {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.submit.fullNameRequired',
            data: { code: 'errors.submit.fullNameRequired' }
        });
    }
    if (isRequiredRequirement(schemaContext.auth.collect?.email) && !applicantEmail) {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.submit.emailRequired',
            data: { code: 'errors.submit.emailRequired' }
        });
    }
    if (applicantEmail && !EMAIL_PATTERN.test(applicantEmail)) {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.submit.emailInvalid',
            data: { code: 'errors.submit.emailInvalid' }
        });
    }

    const fullNameSourceSensitive = Boolean(fullNameMatch?.fieldId && schemaContext.sensitiveFieldIds.has(fullNameMatch.fieldId));
    const emailSourceSensitive = Boolean(emailMatch?.fieldId && schemaContext.sensitiveFieldIds.has(emailMatch.fieldId));

    if (submittedFullName && !schemaContext.hasCrmFullNameField && !fullNameSourceSensitive && !sanitizedData.applicant_full_name) {
        sanitizedData.applicant_full_name = submittedFullName;
    }
    if (applicantEmail && !schemaContext.hasCrmEmailField && !emailSourceSensitive && !sanitizedData.applicant_email) {
        sanitizedData.applicant_email = applicantEmail;
    }

    const backendIdentity = { ...identity };
    // Drupal knows only full-name fields; hand it the name composed from parts.
    if (composedName && !backendIdentity.fullName && !fullNameSourceSensitive) {
        backendIdentity.fullName = composedName.value;
    }
    if (!backendIdentity.email && authenticatedEmail && !emailMatch) {
        backendIdentity.email = authenticatedEmail;
    }
    const backendData = { ...sanitizedData };
    Reflect.deleteProperty(backendData, 'applicant_full_name');
    Reflect.deleteProperty(backendData, 'applicant_email');

    const v1Payload = {
        data: {
            type: 'application',
            attributes: {
                formId: schemaId,
                consentAccepted: true,
                data: backendData,
                attachments: attachmentClaims,
                identity: Object.keys(backendIdentity).length > 0 ? backendIdentity : undefined,
                ownerUuid: ownerUuid || undefined,
                ...submittedProfileConsents(body),
                // Delivery route the citizen chose: only a known
                // route; the backend falls back to the form default when it
                // is absent or not offered and never answers 400 for it.
                ...submittedDeliveryRoute(body.deliveryRoute),
                locale: submissionLocale
            }
        }
    };

    try {
        const config = useRuntimeConfig();
        const apiBase = config.apiBase;
        if (!apiBase) {
            throw createSafeError({
                statusCode: 500,
                message: 'errors.server.configuration',
                data: { code: 'errors.server.configuration' }
            });
        }

        const drupalResponse = await fetch(`${apiBase}/api/v1/applications`, {
            method: 'POST',
            headers: {
                ...serviceProxyHeaders('application-submit', ip),
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(v1Payload)
        });
        const response = await drupalResponse.json().catch(() => null) as PublicApplicationV1Response & {
            error?: { code?: unknown, details?: unknown }
        } | null;
        if (!drupalResponse.ok) {
            const mapped = publicV1SubmitErrorCode(response?.error?.code, response?.error?.details);
            throw createSafeError({
                statusCode: drupalResponse.status,
                message: mapped.code,
                data: { code: mapped.code, ...(mapped.data || {}) }
            });
        }

        const referenceNumber = response?.data?.referenceNumber;
        const statusToken = response?.data?.statusToken;
        if (!referenceNumber || !statusToken) {
            throw createSafeError({
                statusCode: 502,
                message: 'errors.submit.saveFailed',
                data: { code: 'errors.submit.saveFailed' }
            });
        }

        await emitApplicationSubmitted(event, { schemaId, referenceNumber });

        // Identify the submitted field for the pending receipt without returning its contents.
        const confirmation = response?.confirmation;
        const receiptConfirmation = confirmation?.required === true
            ? { required: true, recipientField: emailMatch?.fieldId ?? null }
            : { required: false };
        return {
            referenceNumber,
            statusToken,
            receipt: readSubmissionReceipt(response?.data?.receipt, referenceNumber),
            ...(confirmation && typeof confirmation === 'object' ? { confirmation: receiptConfirmation } : {})
        };
    } catch (e: unknown) {
        const upstreamCode = (e as { data?: { upstreamCode?: unknown } })?.data?.upstreamCode;
        if (upstreamCode) {
            const mapped = publicV1SubmitErrorCode(upstreamCode);
            throw createSafeError({
                statusCode: (e as { statusCode?: number })?.statusCode || 500,
                message: mapped.code,
                data: { code: mapped.code, ...(mapped.data || {}) }
            });
        }

        if (typeof e === 'object' && e !== null && 'statusCode' in e) {
            throw e;
        }

        console.error('[submit] Failed to create application:', e instanceof Error ? e.message : e);

        // Log Drupal error details server-side only, never expose to client
        if (typeof e === 'object' && e !== null && 'data' in e) {
            const errorData = (e as { data?: { errors?: Array<{ detail?: string }> } }).data;
            const detail = errorData?.errors?.[0]?.detail;
            if (detail) {
                console.error('[submit] Drupal validation detail:', detail);
                throw createSafeError({
                    statusCode: 422,
                    message: 'errors.submit.upstreamRejected',
                    data: {
                        code: 'errors.submit.upstreamRejected',
                        upstreamCode: 'drupal.validation_failed'
                    }
                });
            }
        }

        throw createSafeError({
            statusCode: 500,
            message: 'errors.submit.saveFailed',
            data: { code: 'errors.submit.saveFailed' }
        });
    }
});
