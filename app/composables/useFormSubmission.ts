import { toValue, type MaybeRefOrGetter, type Ref } from 'vue';
import { readSubmissionReceipt, type SubmissionReceipt } from '#shared/submission-receipt';
import type {
    ApplicationAttachmentUpload,
    FormAddressValue,
    FormField,
    FormSchema,
    ProfileConsentOffers
} from '~/types/form';
import { duplicateCrmKeys, fieldUsesDefaultFormatRule, getLocalizedFormFieldLabel, getLocalizedFormSectionDescription, validateFormFieldValue } from '~/utils/form-schema';
import { isCurrencyField, withCanonicalCurrencyAmounts } from '~/utils/form-currency';
import { sectionIsShown } from '~/utils/form-section-visibility';
import { fileFieldMaxFiles, fileFieldMaxSizeBytes } from '~/utils/attachment-limits';
import { localeOrDefault } from '~/utils/locale-routing';
import { formatFileSize as formatFileSizeIn } from '~/utils/file-size';
import type { DeliveryRoute, PublicSchemaDeliveryOffer } from '~/types/delivery';
import { deliveryOfferHasChoice, UNCONFIGURED_DELIVERY_OFFER } from '~/utils/delivery-offer';
import { copyFormValueOrigins, formFieldWasEdited, isUntouchedFormDefault, restoreFormFieldOrigin } from '~/utils/form-value-origin';
import { profileDateValue, profileOptionValue, profilePropertyForPrefillField, splitStreetAndHouseNumber, type ApplicantPrefillProfile } from '~/utils/profile-prefill';
import {
    isValidSubmissionEmail,
    normalizeSubmissionEmail,
    resolveSubmissionIdentityRequirements,
    submissionConfirmationRecipient,
    supplementalApplicationData,
    supplementalIdentityData,
    type SubmissionIdentityData,
    type SubmissionIdentityRequirements
} from '~/utils/submission-identity';

const STAFF_SUBMISSION_ROLES = new Set(['administrator', 'department_admin', 'case_worker', 'service_account', 'nuxt_service']);
const AUTH_PROVIDER_ALIASES: Record<string, string> = {
    bundid_mock: 'bundid'
};
type ClaimableAttachmentUpload = ApplicationAttachmentUpload & { claimToken: string };

interface ApplicantPrefillResponse {
    profile?: ApplicantPrefillProfile | null
}

interface AppliedFormPrefill {
    previousValue: unknown
    appliedFingerprint: string
}

interface AppliedIdentityPrefill {
    previousValue: string
    appliedValue: string
}

function nonEmptyProfileValue(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return normalized || null;
}

function isEmptyPrefillTarget(value: unknown): boolean {
    if (value === undefined || value === null) return true;
    if (typeof value === 'string') return value.trim() === '';
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === 'object') {
        const formatted = (value as { formatted?: unknown }).formatted;
        return formatted === undefined || (typeof formatted === 'string' && formatted.trim() === '');
    }
    return false;
}

function prefillValueFingerprint(value: unknown): string | null {
    try {
        return JSON.stringify(value) ?? null;
    } catch {
        return null;
    }
}

function profileAddressValue(profile: ApplicantPrefillProfile): FormAddressValue | null {
    const street = nonEmptyProfileValue(profile.street);
    const postcode = nonEmptyProfileValue(profile.postalCode);
    const city = nonEmptyProfileValue(profile.city);
    const place = [postcode, city].filter(Boolean).join(' ');
    const formatted = nonEmptyProfileValue(profile.address)
      || [street, place || null].filter(Boolean).join(', ');
    if (!formatted) return null;

    return {
        formatted,
        ...(street ? { street } : {}),
        ...(postcode ? { postcode } : {}),
        ...(city ? { city } : {})
    };
}

/**
 * Profile street and house number for the fields of one form.
 *
 * The profile keeps "Marktplatz 1" in one field. A form with its own house
 * number field (FIM forms ask for street and number apart) gets the line
 * split in two; a form without one keeps the line in its street field. A
 * line that does not end with a number stays whole, the number stays empty.
 */
function profileStreetParts(profile: ApplicantPrefillProfile, splitHouseNumber: boolean): { street: string | null, houseNumber: string | null } {
    const street = nonEmptyProfileValue(profile.street);
    if (!street || !splitHouseNumber) return { street, houseNumber: null };
    const parts = splitStreetAndHouseNumber(street);
    return parts ?? { street, houseNumber: null };
}

function profileValueForField(field: FormField, profile: ApplicantPrefillProfile, splitHouseNumber: boolean): string | FormAddressValue | null {
    const profileProperty = profilePropertyForPrefillField(field);
    if (!profileProperty) return null;
    if (profileProperty === 'address') {
        const address = profileAddressValue(profile);
        if (field.type === 'address') return address;
        return address?.formatted || null;
    }
    if (profileProperty === 'street' || profileProperty === 'houseNumber') {
        return profileStreetParts(profile, splitHouseNumber)[profileProperty];
    }
    const value = nonEmptyProfileValue(profile[profileProperty]);
    if (value === null) return null;
    // A choice prefills only with one of this form's options, a date only
    // as a valid YYYY-MM-DD; unknown values stay unset.
    if (field.type === 'select' || field.type === 'radio') return profileOptionValue(field, value);
    if (field.type === 'date') return profileDateValue(value);
    return value;
}

/**
 * Shared citizen form submission flow.
 *
 * Owns form state, conditional visibility, validation and the call to the
 * native `/api/submit` pipeline (reference number, mails, CRM, applicant
 * profile). Used by both the public form page (`/form/[id]`) and the
 * assistant's self-fill slideover so the two surfaces submit identically.
 *
 * Self-fill values go straight from the widget to `/api/submit`; they never
 * pass through the assistant's LLM context (ADR-6 §4).
 */
export interface ApplicationResult {
    referenceNumber: string
    statusToken: string
    receipt: SubmissionReceipt | null
    confirmation?: {
        required: boolean
        recipientEmail?: string
    }
}

/** One entry of the error summary: what is wrong and which element to move to. */
export interface FormValidationSummaryItem {
    key: string
    targetId: string
    message: string
}

/** Length of a form as the citizen sees it before typing. */
export interface FormLength {
    sections: number
    /** Required fields shown without any condition, including required applicant data. */
    requiredFields: number
    /** Whether answers can add further fields. */
    hasConditionalFields: boolean
}

/** Ids the error summary links to; the form page renders these targets. */
export const FORM_FIELD_ANCHOR_PREFIX = 'form-field-';
export const SUBMISSION_IDENTITY_ANCHOR_ID = 'submission-identity';
/** SubmissionIdentity gives its fields the ids `${section id}-full-name` and `${section id}-email`. */
const IDENTITY_FIELD_ANCHOR_SUFFIX: Record<string, string> = {
    fullName: 'full-name',
    email: 'email'
};
export const PRIVACY_CONSENT_ANCHOR_ID = 'form-privacy-consent';

/**
 * Formats whose error names the rule, for example "5 Ziffern". Only used
 * while the field keeps the product's own rule for that format.
 */
const FORMAT_RULE_MESSAGE_KEYS: Partial<Record<NonNullable<FormField['format']>, string>> = {
    postal_code: 'form.formatRule.postalCode'
};
const FORMAT_RULE_ISSUE_CODES = new Set(['minLength', 'maxLength', 'format', 'pattern']);

const DEFAULT_IDENTITY_REQUIREMENTS: SubmissionIdentityRequirements = {
    show: false,
    fullName: 'none',
    email: 'none',
    authMode: 'optional',
    providers: ['passwordless'],
    hasFullNameField: false,
    hasEmailField: false
};

export interface FormSubmissionWorkspace {
    jurisdictionSlug?: string | null
    organisationSlug?: string | null
}

export function useFormSubmission(options: {
    schema: Ref<FormSchema | null>
    schemaId: Ref<string> | string
    /** Workspace of the form; its public config carries the applicant profile switch. */
    workspace?: MaybeRefOrGetter<FormSubmissionWorkspace | null | undefined>
    /** Consent offers of the form from GET /api/schema/:id. */
    consentOffers?: MaybeRefOrGetter<ProfileConsentOffers | null | undefined>
    /** Delivery offer of the form from GET /api/schema/:id. */
    deliveryOffer?: MaybeRefOrGetter<PublicSchemaDeliveryOffer | null | undefined>
    /** The caller renders the privacy error at the checkbox. */
    inlinePrivacyConsentError?: boolean
}) {
    const { t, locale } = useI18n();
    const { resolveApiErrorMessage } = useApiErrorMessage();
    const auth = useAuth();

    const schemaIdRef = computed(() => (typeof options.schemaId === 'string' ? options.schemaId : options.schemaId.value));

    const formData = ref<Record<string, unknown>>({});
    const isSubmitting = ref(false);
    const submitError = ref<string | null>(null);
    const fieldErrors = ref<Record<string, string>>({});
    const identityData = ref<SubmissionIdentityData>({ fullName: '', email: '' });
    const identityErrors = ref<Record<string, string>>({});
    const validationSummary = ref<FormValidationSummaryItem[]>([]);
    const privacyConsentError = ref<string | null>(null);
    const privacyConsent = ref(false);
    const applicationResult = ref<ApplicationResult | null>(null);

    const { config: publicConfig } = usePublicJurisdictionConfig(
        () => toValue(options.workspace)?.jurisdictionSlug,
        () => toValue(options.workspace)?.organisationSlug
    );
    const applicantProfileEnabled = computed(() => publicConfig.value?.applicantProfile?.enabled === true);
    const submissionLocale = computed(() => localeOrDefault(locale.value));
    const offers = computed(() => toValue(options.consentOffers)?.[submissionLocale.value]);
    const contactOffer = computed(() => offers.value?.contact ?? null);
    const bankOffer = computed(() => contactOffer.value ? offers.value?.bank ?? null : null);

    // Store the offer ID at opt-in time. Drafts and later offers never grant consent.
    const acceptedContactId = ref<string | null>(null);
    const acceptedBankId = ref<string | null>(null);
    const profileConsent = computed({
        get: () => acceptedContactId.value !== null && acceptedContactId.value === contactOffer.value?.id,
        set: (given: boolean) => {
            acceptedContactId.value = given === true ? contactOffer.value?.id ?? null : null;
            if (!acceptedContactId.value) acceptedBankId.value = null;
        }
    });
    const bankConsent = computed({
        get: () => profileConsent.value && acceptedBankId.value !== null && acceptedBankId.value === bankOffer.value?.id,
        set: (given: boolean) => {
            acceptedBankId.value = given === true && profileConsent.value ? bankOffer.value?.id ?? null : null;
        }
    });
    watch([schemaIdRef, locale, () => contactOffer.value?.id], () => {
        profileConsent.value = false;
    }, { flush: 'sync' });
    watch(() => bankOffer.value?.id, () => {
        bankConsent.value = false;
    }, { flush: 'sync' });
    watch(privacyConsent, (given) => {
        if (!given || !privacyConsentError.value) return;
        privacyConsentError.value = null;
        updateValidationSummary(validationSummary.value.filter(item => item.targetId !== PRIVACY_CONSENT_ANCHOR_ID));
    });

    // FormRenderer seeds formData defaults from the schema, so visibility just
    // needs a non-null schema shape to evaluate against.
    const visibilitySchema = computed<FormSchema>(() => options.schema.value ?? { title: '', sections: [] });
    const submissionData = computed(() => withCanonicalCurrencyAmounts(visibilitySchema.value, formData.value));
    const { isFieldVisible } = useConditionalFields(visibilitySchema, submissionData);
    const identityRequirements = computed(() => options.schema.value
        ? resolveSubmissionIdentityRequirements(options.schema.value)
        : DEFAULT_IDENTITY_REQUIREMENTS
    );
    const authRoles = computed(() => auth.user.value?.roles || []);
    const isStaffSession = computed(() => auth.authenticated.value && authRoles.value.some(role => STAFF_SUBMISSION_ROLES.has(role)));
    const isCitizenSession = computed(() => auth.authenticated.value && !isStaffSession.value);

    // Delivery route. The citizen is asked only when the form
    // offers more than one route and the session is no staff session; the
    // offer's default is preselected. A route outside the offer (a restored
    // draft of an older offer) falls back to the default. Only a route the
    // citizen could see and that is offered is sent; otherwise nothing, and
    // the backend applies the form default.
    const deliveryOffer = computed<PublicSchemaDeliveryOffer>(() => toValue(options.deliveryOffer) ?? UNCONFIGURED_DELIVERY_OFFER);
    const deliveryRoutes = computed<DeliveryRoute[]>(() => deliveryOffer.value.configured ? deliveryOffer.value.routes : []);
    const deliveryRoute = ref<DeliveryRoute | null>(null);
    const deliveryChoiceVisible = computed(() => !isStaffSession.value && deliveryOfferHasChoice(deliveryOffer.value));
    watch([deliveryRoutes, deliveryRoute], ([routes, route]) => {
        if (!routes.length) {
            if (route !== null) deliveryRoute.value = null;
            return;
        }
        if (!route || !routes.includes(route)) deliveryRoute.value = deliveryOffer.value.default ?? routes[0] ?? null;
    }, { immediate: true, flush: 'sync' });
    const authenticatedProvider = computed(() => normalizeAuthProvider(auth.user.value?.auth_provider));
    const submitBlockedByAuth = computed(() => {
        const requirements = identityRequirements.value;
        if (requirements.authMode !== 'required') return false;
        if (!isCitizenSession.value) return true;

        const allowed = new Set(requirements.providers.map(normalizeAuthProvider));
        return allowed.size === 0 || !allowed.has(authenticatedProvider.value);
    });
    let prefetchedProfileOwnerId: string | null = null;
    // Profiles are kept per Stelle: the prefill comes from the profile of the
    // Stelle this form belongs to, so a cached profile is valid for one form.
    let prefetchedProfileSchemaId: string | null = null;
    let prefetchedProfile: ApplicantPrefillProfile | null = null;
    let appliedPrefillOwnerId: string | null = null;
    let profileRequestId = 0;
    const appliedFormPrefills = new Map<string, AppliedFormPrefill>();
    const appliedIdentityPrefills = new Map<keyof SubmissionIdentityData, AppliedIdentityPrefill>();

    function clearApplicantProfilePrefill(force = false): void {
        profileRequestId++;
        prefetchedProfileOwnerId = null;
        prefetchedProfileSchemaId = null;
        prefetchedProfile = null;

        if (appliedFormPrefills.size > 0) {
            const nextFormData = copyFormValueOrigins(formData.value, { ...formData.value });
            let changed = false;
            for (const [fieldId, appliedPrefill] of appliedFormPrefills) {
                if (!force && prefillValueFingerprint(nextFormData[fieldId]) !== appliedPrefill.appliedFingerprint) {
                    continue;
                }
                if (appliedPrefill.previousValue === undefined) {
                    Reflect.deleteProperty(nextFormData, fieldId);
                } else {
                    nextFormData[fieldId] = appliedPrefill.previousValue;
                }
                restoreFormFieldOrigin(nextFormData, fieldId, appliedPrefill.previousValue);
                appliedFormPrefills.delete(fieldId);
                changed = true;
            }
            if (changed) formData.value = nextFormData;
        }

        if (appliedIdentityPrefills.size > 0) {
            const nextIdentity = { ...identityData.value };
            let changed = false;
            for (const [key, appliedPrefill] of appliedIdentityPrefills) {
                if (!force && nextIdentity[key] !== appliedPrefill.appliedValue) continue;
                nextIdentity[key] = appliedPrefill.previousValue;
                appliedIdentityPrefills.delete(key);
                changed = true;
            }
            if (changed) identityData.value = nextIdentity;
        }

        if (appliedFormPrefills.size === 0 && appliedIdentityPrefills.size === 0) {
            appliedPrefillOwnerId = null;
        }
    }

    function applyApplicantProfile(profile: ApplicantPrefillProfile, ownerId: string): void {
        const formSchema = options.schema.value;
        if (!formSchema) return;

        const nextFormData = copyFormValueOrigins(formData.value, { ...formData.value });
        let formDataChanged = false;
        const splitHouseNumber = formSchema.sections.some(section => section.fields.some(
            field => profilePropertyForPrefillField(field) === 'houseNumber'
        ));
        // A CRM key on several fields belongs to several persons; the own
        // profile must not land in the representative's or payee's fields.
        const sharedCrmKeys = duplicateCrmKeys(formSchema);
        for (const section of formSchema.sections) {
            for (const field of section.fields) {
                if (formFieldWasEdited(nextFormData, field.id)) continue;
                if (!isEmptyPrefillTarget(nextFormData[field.id]) && !isUntouchedFormDefault(nextFormData, field.id)) continue;
                if (typeof field.crm_key === 'string' && sharedCrmKeys.has(field.crm_key.trim())) continue;
                const profileValue = profileValueForField(field, profile, splitHouseNumber);
                if (profileValue === null) continue;
                const appliedFingerprint = prefillValueFingerprint(profileValue);
                if (appliedFingerprint === null) continue;
                appliedFormPrefills.set(field.id, {
                    previousValue: nextFormData[field.id],
                    appliedFingerprint
                });
                appliedPrefillOwnerId = ownerId;
                nextFormData[field.id] = profileValue;
                formDataChanged = true;
            }
        }
        if (formDataChanged) {
            formData.value = nextFormData;
        }

        const nextIdentity = { ...identityData.value };
        let identityChanged = false;
        if (identityRequirements.value.fullName !== 'none' && !nextIdentity.fullName.trim()) {
            const fullName = nonEmptyProfileValue(profile.fullName);
            if (fullName) {
                appliedIdentityPrefills.set('fullName', {
                    previousValue: nextIdentity.fullName,
                    appliedValue: fullName
                });
                appliedPrefillOwnerId = ownerId;
                nextIdentity.fullName = fullName;
                identityChanged = true;
            }
        }
        if (identityRequirements.value.email !== 'none' && !nextIdentity.email.trim()) {
            const email = nonEmptyProfileValue(profile.email);
            if (email) {
                appliedIdentityPrefills.set('email', {
                    previousValue: nextIdentity.email,
                    appliedValue: email
                });
                appliedPrefillOwnerId = ownerId;
                nextIdentity.email = email;
                identityChanged = true;
            }
        }
        if (identityChanged) {
            identityData.value = nextIdentity;
        }
    }

    async function loadApplicantProfile(ownerId: string): Promise<void> {
        const requestId = ++profileRequestId;
        const schemaId = schemaIdRef.value;
        prefetchedProfileOwnerId = ownerId;
        prefetchedProfileSchemaId = schemaId;
        try {
            // The form names its Stelle; Drupal answers with that Stelle's
            // profile only, never with a profile kept for another Stelle.
            const response = await $fetch<ApplicantPrefillResponse>('/api/applicant/my-data', {
                query: { form: schemaId }
            });
            if (requestId !== profileRequestId || String(auth.user.value?.uid ?? '') !== ownerId || schemaIdRef.value !== schemaId) return;
            prefetchedProfile = response.profile || null;
            if (prefetchedProfile) {
                applyApplicantProfile(prefetchedProfile, ownerId);
            }
        } catch {
            if (requestId === profileRequestId && prefetchedProfileOwnerId === ownerId) {
                prefetchedProfileOwnerId = null;
                prefetchedProfileSchemaId = null;
                prefetchedProfile = null;
            }
        }
    }

    watch(
        [() => options.schema.value, () => auth.authenticated.value, () => auth.user.value?.uid, isStaffSession, applicantProfileEnabled, schemaIdRef],
        ([formSchema, authenticated, ownerId, staffSession, profileEnabled]) => {
            if (!formSchema || !authenticated || staffSession || !profileEnabled || identityRequirements.value.authMode === 'anonymous' || !ownerId) {
                if (prefetchedProfileOwnerId !== null || appliedFormPrefills.size > 0 || appliedIdentityPrefills.size > 0) {
                    clearApplicantProfilePrefill();
                }
                return;
            }

            const normalizedOwnerId = String(ownerId);
            if (appliedPrefillOwnerId !== null && appliedPrefillOwnerId !== normalizedOwnerId) {
                clearApplicantProfilePrefill(true);
            }
            if (prefetchedProfileOwnerId !== null && prefetchedProfileOwnerId !== normalizedOwnerId) {
                clearApplicantProfilePrefill(true);
            }
            if (prefetchedProfileOwnerId !== normalizedOwnerId || prefetchedProfileSchemaId !== schemaIdRef.value) {
                void loadApplicantProfile(normalizedOwnerId);
            } else if (prefetchedProfile) {
                applyApplicantProfile(prefetchedProfile, normalizedOwnerId);
            }
        },
        { immediate: true }
    );

    function normalizeAuthProvider(value: unknown): string {
        if (typeof value !== 'string') return 'unknown';
        const provider = value.trim().toLowerCase();
        if (!provider) return 'unknown';
        return AUTH_PROVIDER_ALIASES[provider] || provider;
    }

    function buildVisibleFormData(formSchema: FormSchema): Record<string, unknown> {
        const visibleData: Record<string, unknown> = {};
        for (const section of formSchema.sections) {
            for (const field of section.fields) {
                if (!isFieldVisible(field.id)) continue;
                if (field.type === 'file') continue;
                visibleData[field.id] = submissionData.value[field.id];
            }
        }
        return visibleData;
    }

    function isAttachmentUpload(value: unknown): value is ClaimableAttachmentUpload {
        return Boolean(
            value
            && typeof value === 'object'
            && !Array.isArray(value)
            && typeof (value as ApplicationAttachmentUpload).attachmentId === 'string'
            && typeof (value as ApplicationAttachmentUpload).claimToken === 'string'
            && typeof (value as ApplicationAttachmentUpload).fieldId === 'string'
        );
    }

    function attachmentUploadsForField(fieldId: string): ClaimableAttachmentUpload[] {
        const value = formData.value[fieldId];
        return Array.isArray(value) ? value.filter(isAttachmentUpload) : [];
    }

    function collectAttachmentClaims(formSchema: FormSchema): Array<{ fieldId: string, attachmentId: string, claimToken: string }> {
        const claims: Array<{ fieldId: string, attachmentId: string, claimToken: string }> = [];
        for (const section of formSchema.sections) {
            for (const field of section.fields) {
                if (field.type !== 'file') continue;
                if (!isFieldVisible(field.id)) continue;
                for (const attachment of attachmentUploadsForField(field.id)) {
                    claims.push({
                        fieldId: field.id,
                        attachmentId: attachment.attachmentId,
                        claimToken: attachment.claimToken
                    });
                }
            }
        }
        return claims;
    }

    function identityMessage(key: 'fullName' | 'email'): string | null {
        const requirements = identityRequirements.value;
        if (key === 'fullName') {
            return requirements.fullName === 'required' && !identityData.value.fullName.trim() ? t('form.identityFullNameRequired') : null;
        }
        const email = normalizeSubmissionEmail(identityData.value.email);
        if (requirements.email === 'required' && !email) return t('form.identityEmailRequired');
        if (email && !isValidSubmissionEmail(email)) return t('form.identityEmailInvalid');
        return null;
    }

    function validateIdentity(): string[] {
        const errors: string[] = [];
        const nextIdentityErrors: Record<string, string> = {};
        for (const key of ['fullName', 'email'] as const) {
            const message = identityMessage(key);
            if (!message) continue;
            errors.push(message);
            nextIdentityErrors[key] = message;
        }
        identityErrors.value = nextIdentityErrors;
        return errors;
    }

    function formatRuleMessage(field: FormField, label: string): string | null {
        const key = field.format ? FORMAT_RULE_MESSAGE_KEYS[field.format] : undefined;
        if (!key || !fieldUsesDefaultFormatRule(field)) return null;
        return t(key, { label });
    }

    function formatValidationError(field: FormField, issue: ReturnType<typeof validateFormFieldValue>[number]): string {
        const label = getLocalizedFormFieldLabel(field, locale.value);
        if (FORMAT_RULE_ISSUE_CODES.has(issue.code)) {
            const ruleMessage = formatRuleMessage(field, label);
            if (ruleMessage) return ruleMessage;
        }
        switch (issue.code) {
            case 'required':
                return t('form.requiredField', { label });
            case 'minLength':
                return t('form.minLengthField', { label, value: issue.value });
            case 'maxLength':
                return t('form.maxLengthField', { label, value: issue.value });
            case 'min':
                return t('form.minValueField', { label, value: issue.value });
            case 'max':
                return t('form.maxValueField', { label, value: issue.value });
            case 'step':
                return t('form.stepValueField', { label, value: issue.value });
            case 'number_format':
                return t('form.currencyFormatField', { label });
            case 'fileMaxCount':
                return t('form.fileTooManyWithLimit', { count: issue.value });
            case 'fileMaxSize':
                return t('form.fileTooLargeWithLimit', { max: formatFileSize(issue.value ?? 0) });
            case 'format':
                return t('form.invalidFormatField', { label });
            case 'pattern':
            default:
                return t('form.invalidField', { label });
        }
    }

    function fieldIssues(field: FormField): ReturnType<typeof validateFormFieldValue> {
        const rawValue = formData.value[field.id];
        return field.type === 'file' ? validateFileField(field, rawValue) : validateFormFieldValue(field, rawValue, { localizedCurrency: true });
    }

    function validateForm(): { messages: string[], fieldErrors: Record<string, string> } {
        if (!options.schema.value) {
            return { messages: [t('form.noSchemaLoaded')], fieldErrors: {} };
        }

        const errors: string[] = [];
        const nextFieldErrors: Record<string, string> = {};
        for (const section of options.schema.value.sections) {
            for (const field of section.fields) {
                if (!isFieldVisible(field.id)) continue;

                for (const issue of fieldIssues(field)) {
                    const message = formatValidationError(field, issue);
                    errors.push(message);
                    nextFieldErrors[field.id] ??= message;
                }
            }
        }
        return { messages: errors, fieldErrors: nextFieldErrors };
    }

    function fieldById(fieldId: string): FormField | null {
        for (const section of options.schema.value?.sections || []) {
            const field = section.fields.find(candidate => candidate.id === fieldId);
            if (field) return field;
        }
        return null;
    }

    function apiErrorData(e: unknown): Record<string, unknown> | null {
        const envelope = (e as { data?: unknown })?.data;
        if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return null;
        const nested = (envelope as { data?: unknown }).data;
        if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
            return nested as Record<string, unknown>;
        }
        return envelope as Record<string, unknown>;
    }

    function applyServerValidationError(e: unknown): boolean {
        const data = apiErrorData(e);
        if (data?.code !== 'errors.submit.validationFailed' || typeof data.field !== 'string') {
            return false;
        }
        const field = fieldById(data.field);
        if (!field) return false;

        const label = getLocalizedFormFieldLabel(field, locale.value);
        const issue = typeof data.issue === 'string' ? data.issue : '';
        let message = t('form.invalidField', { label });
        if (issue === 'required') {
            message = t('form.requiredField', { label });
        } else if (issue === 'option') {
            message = t('form.invalidOptionField', { label });
        } else if (issue === 'number_format' || issue === 'number_ambiguous') {
            const key = isCurrencyField(field)
                ? 'form.currencyFormatField'
                : (issue === 'number_format' ? 'form.numberFormatField' : 'form.numberAmbiguousField');
            message = t(key, { label });
        }
        fieldErrors.value = { ...fieldErrors.value, [field.id]: message };
        submitError.value = message;
        return true;
    }

    function validateFileField(field: FormField, value: unknown): ReturnType<typeof validateFormFieldValue> {
        const uploads = Array.isArray(value) ? value.filter(isAttachmentUpload) : [];
        if (uploads.length === 0) {
            return field.required ? [{ code: 'required' }] : [];
        }
        const maxFiles = fileFieldMaxFiles(field);
        if (!Array.isArray(value) || uploads.length !== value.length || uploads.length > maxFiles) {
            return [{ code: 'fileMaxCount', value: maxFiles }];
        }
        const maxSizeBytes = fileFieldMaxSizeBytes(field);
        if (uploads.some(upload => upload.size > maxSizeBytes)) {
            return [{ code: 'fileMaxSize', value: maxSizeBytes }];
        }
        return [];
    }

    function formatFileSize(size: number): string {
        return formatFileSizeIn(size, locale.value);
    }

    function buildValidationSummary(): FormValidationSummaryItem[] {
        return [
            ...Object.entries(identityErrors.value).map(([key, message]) => ({
                key: `identity:${key}`,
                targetId: IDENTITY_FIELD_ANCHOR_SUFFIX[key]
                    ? `${SUBMISSION_IDENTITY_ANCHOR_ID}-${IDENTITY_FIELD_ANCHOR_SUFFIX[key]}`
                    : SUBMISSION_IDENTITY_ANCHOR_ID,
                message
            })),
            ...Object.entries(fieldErrors.value).map(([fieldId, message]) => ({
                key: `field:${fieldId}`,
                targetId: `${FORM_FIELD_ANCHOR_PREFIX}${fieldId}`,
                message
            })),
            ...(privacyConsentError.value
                ? [{ key: 'privacyConsent', targetId: PRIVACY_CONSENT_ANCHOR_ID, message: privacyConsentError.value }]
                : [])
        ];
    }

    function updateValidationSummary(summary: FormValidationSummaryItem[]): void {
        validationSummary.value = summary;
        submitError.value = summary
            .filter(item => !options.inlinePrivacyConsentError || item.targetId !== PRIVACY_CONSENT_ANCHOR_ID)
            .map(item => item.message)
            .join(' ') || null;
    }

    function withMessage(errors: Record<string, string>, key: string, message: string | null): Record<string, string> {
        if (message) return { ...errors, [key]: message };
        const { [key]: _removed, ...rest } = errors;
        return rest;
    }

    /**
     * After a failed submit, a field that shows an error is checked again when the person leaves it (focus moves out
     * of the field's anchor), with the same rules as the submit; its message and the summary follow. Fields without
     * an error stay quiet, so the form does not turn red before the first submit and nothing is checked while typing.
     */
    function revalidateOnLeave(event: FocusEvent): void {
        const target = event.target instanceof Element ? event.target : null;
        const anchor = target?.closest(`[id^="${FORM_FIELD_ANCHOR_PREFIX}"], [id^="${SUBMISSION_IDENTITY_ANCHOR_ID}-"]`);
        if (!anchor || (event.relatedTarget instanceof Node && anchor.contains(event.relatedTarget))) return;
        if (anchor.id.startsWith(FORM_FIELD_ANCHOR_PREFIX)) {
            const fieldId = anchor.id.slice(FORM_FIELD_ANCHOR_PREFIX.length);
            const field = fieldById(fieldId);
            if (!field || !(fieldId in fieldErrors.value)) return;
            const issue = isFieldVisible(field.id) ? fieldIssues(field)[0] : undefined;
            fieldErrors.value = withMessage(fieldErrors.value, fieldId, issue ? formatValidationError(field, issue) : null);
        } else {
            const key = (Object.keys(IDENTITY_FIELD_ANCHOR_SUFFIX) as ('fullName' | 'email')[])
                .find(candidate => anchor.id === `${SUBMISSION_IDENTITY_ANCHOR_ID}-${IDENTITY_FIELD_ANCHOR_SUFFIX[candidate]}`);
            if (!key || !(key in identityErrors.value)) return;
            identityErrors.value = withMessage(identityErrors.value, key, identityMessage(key));
        }
        if (validationSummary.value.length === 0) return;
        updateValidationSummary(buildValidationSummary());
    }

    async function onSubmit(): Promise<void> {
        if (!options.schema.value) return;
        if (isSubmitting.value) return;

        if (submitBlockedByAuth.value) {
            validationSummary.value = [];
            submitError.value = t('form.identityLoginRequired');
            return;
        }

        // Every check runs at once, so the citizen sees all missing entries
        // in one summary, in page order: applicant data, fields, consent.
        validateIdentity();
        const validation = validateForm();
        fieldErrors.value = validation.fieldErrors;
        privacyConsentError.value = privacyConsent.value ? null : t('form.privacyConsentRequired');
        const summary = buildValidationSummary();
        updateValidationSummary(summary);
        if (summary.length > 0) return;

        isSubmitting.value = true;

        try {
            const visibleData = {
                ...buildVisibleFormData(options.schema.value),
                ...supplementalApplicationData(identityRequirements.value, identityData.value)
            };
            const identity = supplementalIdentityData(identityRequirements.value, identityData.value);
            // Capture the local display spelling with the request, before a field can change.
            const submittedIdentityEmail = identity.email ? identityData.value.email : '';
            const attachments = collectAttachmentClaims(options.schema.value);
            const result = await $fetch('/api/submit', {
                method: 'POST',
                body: {
                    schemaId: schemaIdRef.value,
                    data: visibleData,
                    attachments,
                    identity: Object.keys(identity).length > 0 ? identity : undefined,
                    consentAccepted: privacyConsent.value,
                    ...(profileConsent.value ? { profileConsent: true, profileConsentOfferId: acceptedContactId.value } : {}),
                    ...(bankConsent.value ? { bankConsent: true, bankConsentOfferId: acceptedBankId.value } : {}),
                    ...(deliveryChoiceVisible.value && deliveryRoute.value && deliveryRoutes.value.includes(deliveryRoute.value)
                        ? { deliveryRoute: deliveryRoute.value }
                        : {}),
                    locale: submissionLocale.value
                }
            });
            const application: ApplicationResult = {
                referenceNumber: result.referenceNumber,
                statusToken: result.statusToken,
                receipt: readSubmissionReceipt(result.receipt, result.referenceNumber)
            };
            const confirmation = result.confirmation;
            if (confirmation) {
                application.confirmation = { required: confirmation.required };
                if (confirmation.required && 'recipientField' in confirmation) {
                    application.confirmation.recipientEmail = submissionConfirmationRecipient(
                        confirmation.recipientField, visibleData, submittedIdentityEmail
                    );
                }
            }
            applicationResult.value = application;
        } catch (e: unknown) {
            if (applyServerValidationError(e)) return;
            submitError.value = resolveApiErrorMessage(e);
        } finally {
            isSubmitting.value = false;
        }
    }

    /**
     * Whether the citizen typed or uploaded something a page change would
     * lose. Defaults, values the profile filled in and the e-mail address
     * of the session do not count; after submitting nothing is at stake.
     */
    const hasEnteredValues = computed(() => {
        if (applicationResult.value) return false;
        for (const section of options.schema.value?.sections || []) {
            for (const field of section.fields) {
                const value = formData.value[field.id];
                if (isEmptyPrefillTarget(value) || value === false) continue;
                const fingerprint = prefillValueFingerprint(value);
                if (field.defaultValue !== undefined && fingerprint === prefillValueFingerprint(field.defaultValue)) continue;
                if (appliedFormPrefills.get(field.id)?.appliedFingerprint === fingerprint) continue;
                return true;
            }
        }
        const sessionEmail = normalizeSubmissionEmail(auth.user.value?.email ?? '');
        for (const key of ['fullName', 'email'] as const) {
            const value = identityData.value[key].trim();
            if (!value) continue;
            if (appliedIdentityPrefills.get(key)?.appliedValue === identityData.value[key]) continue;
            if (key === 'email' && sessionEmail && normalizeSubmissionEmail(value) === sessionEmail) continue;
            return true;
        }
        return false;
    });

    /**
     * Mirrors the server rule: an application gets a confirmation mail
     * unless a citizen session with an allowed login owns it
     * (PublicApplicationApiController, submit proxy ownerUuid).
     */
    const emailConfirmationExpected = computed(() => {
        const requirements = identityRequirements.value;
        if (requirements.authMode === 'anonymous' || !isCitizenSession.value) return true;
        const allowed = new Set(requirements.providers.map(normalizeAuthProvider));
        return !allowed.has(authenticatedProvider.value);
    });

    const formLength = computed<FormLength>(() => {
        let sections = 0;
        let requiredFields = 0;
        let hasConditionalFields = false;
        for (const section of options.schema.value?.sections || []) {
            // The count agrees with what the page shows before any answer: a section counts
            // when it has a field without a condition or a description (an information block).
            // Sections that only conditions open are covered by "Je nach Ihren Antworten …".
            if (sectionIsShown(section, field => !field.conditionalOn, getLocalizedFormSectionDescription(section, locale.value))) sections++;
            for (const field of section.fields) {
                if (field.conditionalOn) {
                    hasConditionalFields = true;
                    continue;
                }
                if (field.required && !field.computed) requiredFields++;
            }
        }
        const requirements = identityRequirements.value;
        if (requirements.show) {
            if (requirements.fullName === 'required') requiredFields++;
            if (requirements.email === 'required') requiredFields++;
        }
        return { sections, requiredFields, hasConditionalFields };
    });

    return {
        formData,
        isSubmitting,
        submitError,
        fieldErrors,
        validationSummary,
        privacyConsentError,
        hasEnteredValues,
        emailConfirmationExpected,
        formLength,
        identityData,
        identityErrors,
        identityRequirements,
        submitBlockedByAuth,
        privacyConsent,
        profileConsent,
        bankConsent,
        profileConsentText: computed(() => contactOffer.value?.text ?? null),
        bankConsentText: computed(() => bankOffer.value?.text ?? null),
        deliveryRoute,
        deliveryRoutes,
        deliveryChoiceVisible,
        applicationResult,
        isFieldVisible,
        validateForm,
        validateIdentity,
        revalidateOnLeave,
        onSubmit
    };
}
