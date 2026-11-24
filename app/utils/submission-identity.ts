import type {
    FormField,
    FormSchema,
    FormSubmissionAuthMode,
    FormSubmissionAuthProvider,
    FormSubmissionIdentityRequirement
} from '~/types/form';

export interface SubmissionIdentityData {
    fullName: string
    email: string
}

export interface SubmissionIdentityRequirements {
    show: boolean
    fullName: FormSubmissionIdentityRequirement
    email: FormSubmissionIdentityRequirement
    authMode: FormSubmissionAuthMode
    providers: FormSubmissionAuthProvider[]
    hasFullNameField: boolean
    hasEmailField: boolean
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const SUBMISSION_AUTH_MODES = new Set<FormSubmissionAuthMode>(['anonymous', 'optional', 'required']);
const SUBMISSION_AUTH_PROVIDERS = new Set<FormSubmissionAuthProvider>(['passwordless', 'bundid']);

function normalizeRequirement(value: unknown, fallback: FormSubmissionIdentityRequirement): FormSubmissionIdentityRequirement {
    if (value === false || value === 'none') return 'none';
    if (value === true || value === 'required') return 'required';
    if (value === 'optional') return 'optional';
    return fallback;
}

function normalizeAuthMode(value: unknown): FormSubmissionAuthMode {
    if (value === undefined) return 'optional';
    return typeof value === 'string' && SUBMISSION_AUTH_MODES.has(value as FormSubmissionAuthMode)
        ? value as FormSubmissionAuthMode
        : 'required';
}

function normalizeProviders(value: unknown): FormSubmissionAuthProvider[] {
    if (!Array.isArray(value)) return ['passwordless'];

    const providers = value.filter((provider): provider is FormSubmissionAuthProvider =>
        typeof provider === 'string' && SUBMISSION_AUTH_PROVIDERS.has(provider as FormSubmissionAuthProvider)
    );

    return [...new Set(providers)];
}

function normalizeText(value: unknown): string {
    return String(value ?? '')
        .trim()
        .toLowerCase();
}

function normalizedFieldId(value: unknown): string {
    return normalizeText(value)
        .replace(/[^a-z0-9]+/gu, '_')
        .replace(/^_+|_+$/gu, '');
}

function isFullNameField(field: FormField): boolean {
    if (field.crm_key === 'person.full_name') return true;

    const id = normalizedFieldId(field.id);
    if (['full_name', 'applicant_full_name', 'antragsteller_name'].includes(id)) return true;

    const label = normalizeText(field.label);
    return label === 'name'
      || label === 'vollstaendiger name'
      || label === 'vollständiger name'
      || label === 'ihr name'
      || /^name der antragsteller/u.test(label)
      || /^antragsteller.*name/u.test(label);
}

type NameFieldCandidate = { id?: unknown, label?: unknown, crm_key?: unknown };

const GIVEN_NAME_IDS = ['given_name', 'first_name', 'firstname', 'vorname', 'applicant_given_name', 'applicant_first_name'];
const GIVEN_NAME_LABELS = ['vorname', 'given name', 'first name'];
const FAMILY_NAME_IDS = ['family_name', 'last_name', 'lastname', 'surname', 'nachname', 'familienname', 'applicant_family_name', 'applicant_last_name'];
const FAMILY_NAME_LABELS = ['familienname', 'nachname', 'family name', 'last name', 'surname'];

/**
 * Detects a given-name field. The public schema projection drops CRM keys
 * outside the profile prefill set, so the id and label count as well.
 */
export function isGivenNameField(field: NameFieldCandidate): boolean {
    return field.crm_key === 'person.first_name'
      || GIVEN_NAME_IDS.includes(normalizedFieldId(field.id))
      || GIVEN_NAME_LABELS.includes(normalizeText(field.label));
}

/**
 * Detects a family-name field, with the same fallbacks as isGivenNameField().
 */
export function isFamilyNameField(field: NameFieldCandidate): boolean {
    return field.crm_key === 'person.last_name'
      || FAMILY_NAME_IDS.includes(normalizedFieldId(field.id))
      || FAMILY_NAME_LABELS.includes(normalizeText(field.label));
}

function isEmailField(field: FormField): boolean {
    if (field.crm_key === 'person.email') return true;

    const id = normalizeText(field.id);
    const label = normalizeText(field.label);
    return id === 'email'
      || id === 'e_mail'
      || id === 'applicant_email'
      || label === 'e-mail'
      || label === 'e-mail-adresse'
      || label === 'email'
      || label === 'email address';
}

export function resolveSubmissionIdentityRequirements(schema: FormSchema): SubmissionIdentityRequirements {
    const fields = schema.sections.flatMap(section => section.fields);
    // Separate given and family name fields (e.g. FIM-aligned forms) carry the name too.
    const hasFullNameField = fields.some(isFullNameField)
      || (fields.some(isGivenNameField) && fields.some(isFamilyNameField));
    const hasEmailField = fields.some(isEmailField);
    const policy = schema.auth || {};
    const collect = policy.collect || {};
    const authMode = normalizeAuthMode(policy.mode);
    const providers = normalizeProviders(policy.providers);

    const fullName = hasFullNameField
        ? 'none'
        : normalizeRequirement(collect.fullName, 'required');
    const email = hasEmailField
        ? 'none'
        : normalizeRequirement(collect.email, 'required');

    return {
        show: authMode !== 'anonymous' || fullName !== 'none' || email !== 'none',
        fullName,
        email,
        authMode,
        providers,
        hasFullNameField,
        hasEmailField
    };
}

export function normalizeSubmissionEmail(value: unknown): string {
    return String(value ?? '').trim().toLowerCase();
}

export function isValidSubmissionEmail(value: string): boolean {
    return EMAIL_PATTERN.test(value);
}

export function submissionConfirmationRecipient(
    recipientField: string | null | undefined,
    submittedData: Record<string, unknown>,
    submittedIdentityEmail: string
): string | undefined {
    // A null field denotes the supplemental identity. Older responses give no source.
    const value = recipientField === null ? submittedIdentityEmail : recipientField && submittedData[recipientField];
    if (typeof value !== 'string') return undefined;
    const email = value.trim();
    return isValidSubmissionEmail(email) ? email : undefined;
}

export function supplementalIdentityData(
    requirements: SubmissionIdentityRequirements,
    identity: SubmissionIdentityData
): Record<string, string> {
    const data: Record<string, string> = {};
    const fullName = identity.fullName.trim();
    const email = normalizeSubmissionEmail(identity.email);

    if (requirements.fullName !== 'none' && fullName) {
        data.fullName = fullName;
    }
    if (requirements.email !== 'none' && email) {
        data.email = email;
    }

    return data;
}

export function supplementalApplicationData(
    requirements: SubmissionIdentityRequirements,
    identity: SubmissionIdentityData
): Record<string, string> {
    const data: Record<string, string> = {};
    const supplemental = supplementalIdentityData(requirements, identity);

    if (!requirements.hasFullNameField && supplemental.fullName) {
        data.applicant_full_name = supplemental.fullName;
    }
    if (!requirements.hasEmailField && supplemental.email) {
        data.applicant_email = supplemental.email;
    }

    return data;
}
