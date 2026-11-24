import type { FormAddressGroup, FormAddressWidget, FormAttachmentAnalysisEgressPolicy, FormAttachmentAnalysisModelClass, FormAttachmentAnalysisProfile, FormAttachmentAnalysisRedaction, FormContextSource, FormContextSourceType, FormContextSourceUsage, FormField, FormFieldFormat, FormFieldPrivacy, FormFieldPrivacyKind, FormFieldSemantics, FormFieldType, FormFieldValidation, FormPrecheckAffects, FormPrecheckCriterion, FormPrecheckEvidence, FormPrecheckFactType, FormPrecheckLocalizedText, FormPrecheckReviewStatus, FormPrecheckSchema, FormSchema, FormSection } from '../types/form';
import { FORM_ATTACHMENT_ANALYSIS_EGRESS_POLICIES, FORM_ATTACHMENT_ANALYSIS_MODEL_CLASSES, FORM_ATTACHMENT_ANALYSIS_REDACTION_MODES, FORM_CONTEXT_SOURCE_TYPES, FORM_CONTEXT_SOURCE_USAGES, FORM_FIELD_FORMATS, FORM_FIELD_PRIVACY_KINDS, FORM_FIELD_TYPES, FORM_PRECHECK_FACT_TYPES, FORM_PRECHECK_REVIEW_STATUSES, isFormAttachmentAnalysisModelClassAllowed } from '../types/form';
import { normalizeFormAddressValue } from './form-address';
import { numberFieldIds } from './attachment-result-schema';
import { attachmentAnalysisPrompts } from './attachment-analysis-prompts';
import { canonicalCurrencyAmount, currencyConstraintIssues, isCurrencyField } from './form-currency';

const FORM_FIELD_TYPE_SET = new Set<string>(FORM_FIELD_TYPES);
const FORM_FIELD_FORMAT_SET = new Set<string>(FORM_FIELD_FORMATS);
const FORM_FIELD_PRIVACY_KIND_SET = new Set<string>(FORM_FIELD_PRIVACY_KINDS);
const FORM_ATTACHMENT_ANALYSIS_EGRESS_POLICY_SET = new Set<string>(FORM_ATTACHMENT_ANALYSIS_EGRESS_POLICIES);
const FORM_ATTACHMENT_ANALYSIS_MODEL_CLASS_SET = new Set<string>(FORM_ATTACHMENT_ANALYSIS_MODEL_CLASSES);
const FORM_ATTACHMENT_ANALYSIS_REDACTION_SET = new Set<string>(FORM_ATTACHMENT_ANALYSIS_REDACTION_MODES);
const FORM_CONTEXT_SOURCE_TYPE_SET = new Set<string>(FORM_CONTEXT_SOURCE_TYPES);
const FORM_CONTEXT_SOURCE_USAGE_SET = new Set<string>(FORM_CONTEXT_SOURCE_USAGES);
const FORM_PRECHECK_FACT_TYPE_SET = new Set<string>(FORM_PRECHECK_FACT_TYPES);
const FORM_PRECHECK_REVIEW_STATUS_SET = new Set<string>(FORM_PRECHECK_REVIEW_STATUSES);
const UNSAFE_FORM_FIELD_IDS = new Set([
    '__proto__',
    'constructor',
    'prototype',
    '_anonymized',
    '__beantragt_encrypted',
    '__beantragt_redacted'
]);
const STRING_VALUE_FIELD_TYPES = new Set<FormFieldType>(['text', 'textarea', 'email', 'tel', 'date', 'select', 'radio']);
const URL_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//iu;
const HOST_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu;
const MAX_VALIDATION_PATTERN_QUANTIFIER_BOUND = 256;

const FIELD_TYPE_ALIASES: Record<string, FormFieldType> = {
    textinput: 'text',
    textfield: 'text',
    string: 'text',
    input: 'text',
    shorttext: 'text',
    longtext: 'textarea',
    multiline: 'textarea',
    paragraph: 'textarea',
    emailaddress: 'email',
    e_mail: 'email',
    mail: 'email',
    telephone: 'tel',
    phone: 'tel',
    phonenumber: 'tel',
    mobile: 'tel',
    mobilenumber: 'tel',
    numeric: 'number',
    integer: 'number',
    decimal: 'number',
    datepicker: 'date',
    datetime: 'date',
    dropdown: 'select',
    selectbox: 'select',
    combobox: 'select',
    radiogroup: 'radio',
    singlechoice: 'radio',
    checkboxgroup: 'checkbox',
    multiselect: 'checkbox',
    adresse: 'address',
    anschrift: 'address',
    streetaddress: 'address',
    postaladdress: 'address',
    url: 'text',
    uri: 'text',
    website: 'text',
    webseite: 'text',
    homepage: 'text',
    link: 'text',
    webaddress: 'text',
    internetadresse: 'text',
    upload: 'file',
    attachment: 'file',
    documentupload: 'file'
};

const FIELD_FORMAT_ALIASES: Record<string, FormFieldFormat> = {
    postalcode: 'postal_code',
    zipcode: 'postal_code',
    zip: 'postal_code',
    plz: 'postal_code',
    iban: 'iban',
    bic: 'bic',
    swift: 'bic',
    taxid: 'tax_id',
    steuerid: 'tax_id',
    steueridentifikationsnummer: 'tax_id',
    currency: 'currency',
    amount: 'currency',
    betrag: 'currency',
    referencenumber: 'reference_number',
    referenznummer: 'reference_number',
    referenz: 'reference_number',
    aktenzeichen: 'reference_number',
    kassenzeichen: 'reference_number',
    vorgangsnummer: 'reference_number',
    url: 'url',
    uri: 'url',
    website: 'url',
    webseite: 'url',
    homepage: 'url',
    link: 'url',
    webaddress: 'url',
    internetadresse: 'url'
};

const FIELD_TYPE_VALIDATION_DEFAULTS: Partial<Record<FormFieldType, FormFieldValidation>> = {
    email: {
        pattern: '^[^\\s@]{1,64}@[^\\s@]{1,190}\\.[^\\s@]{2,63}$',
        maxLength: 254
    },
    tel: {
        pattern: '^[+0-9()\\-/\\s]{6,20}$',
        minLength: 6,
        maxLength: 20
    },
    date: {
        pattern: '^\\d{4}-\\d{2}-\\d{2}$'
    }
};

const FIELD_FORMAT_DEFAULTS: Record<FormFieldFormat, { type: FormFieldType, validation: FormFieldValidation }> = {
    postal_code: {
        type: 'text',
        validation: {
            pattern: '^[0-9]{5}$',
            minLength: 5,
            maxLength: 5
        }
    },
    iban: {
        type: 'text',
        validation: {
            pattern: '^[A-Za-z]{2}[0-9]{2}[A-Za-z0-9 ]{11,30}$',
            minLength: 15,
            maxLength: 34
        }
    },
    bic: {
        type: 'text',
        validation: {
            pattern: '^[A-Za-z]{6}[A-Za-z0-9]{2}[A-Za-z0-9]{0,3}$',
            minLength: 8,
            maxLength: 11
        }
    },
    tax_id: {
        type: 'text',
        validation: {
            pattern: '^[0-9]{11}$',
            minLength: 11,
            maxLength: 11
        }
    },
    currency: {
        type: 'number',
        validation: {
            min: 0,
            step: 0.01
        }
    },
    reference_number: {
        type: 'text',
        validation: {
            maxLength: 64
        }
    },
    url: {
        type: 'text',
        validation: {
            maxLength: 2048
        }
    }
};

const EXECUTABLE_VALIDATION_PATTERNS = new Set<string>([
    FIELD_TYPE_VALIDATION_DEFAULTS.email!.pattern!,
    FIELD_TYPE_VALIDATION_DEFAULTS.tel!.pattern!,
    FIELD_TYPE_VALIDATION_DEFAULTS.date!.pattern!,
    FIELD_FORMAT_DEFAULTS.postal_code.validation.pattern!,
    FIELD_FORMAT_DEFAULTS.iban.validation.pattern!,
    FIELD_FORMAT_DEFAULTS.bic.validation.pattern!,
    FIELD_FORMAT_DEFAULTS.tax_id.validation.pattern!
]);

const MAX_VALIDATION_PATTERN_LENGTH = 160;
/** Storage cap for the texts of an attachment analysis profile. */
export const MAX_ANALYSIS_TEXT_LENGTH = 5000;
const MAX_ANALYSIS_RESULT_SCHEMA_JSON_LENGTH = 10000;
const MAX_ANALYSIS_RESULT_SCHEMA_DEPTH = 6;
const MAX_CONTEXT_SOURCES = 24;
const MAX_CONTEXT_SOURCE_TEXT_LENGTH = 1000;
const MAX_PRECHECK_CRITERIA = 32;
const MAX_PRECHECK_TEXT_LENGTH = 1000;
const MAX_PRECHECK_OPTIONS = 50;
const MAX_I18N_LOCALES = 16;
const MAX_I18N_TEXT_LENGTH = 5000;
const MAX_I18N_OPTIONS = 100;
const LOCALE_KEY_PATTERN = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/iu;
const CONTEXT_SOURCE_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,120}$/u;
const PRECHECK_CONTEXT_SOURCE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const PRECHECK_MACHINE_ID_PATTERN = /^[a-z][a-z0-9_]{0,99}$/u;

export interface FormFieldValidationIssue {
    code: 'required' | 'format' | 'pattern' | 'option' | 'minLength' | 'maxLength' | 'min' | 'max' | 'step' | 'number_format' | 'fileMaxCount' | 'fileMaxSize'
    value?: number
    format?: FormFieldFormat
}

export type SchemaAuthoringIssueCode = 'high_risk_unmarked' | 'personal_data_classification_missing' | 'risky_crm_key' | 'duplicate_crm_key' | 'purpose_bound_needs_sovereign' | 'purpose_bound_compare_invalid' | 'staff_prompt_inactive';
export type SchemaAuthoringIssueSeverity = 'blocking' | 'warning';

export interface SchemaAuthoringIssue {
    code: SchemaAuthoringIssueCode
    severity: SchemaAuthoringIssueSeverity
    sectionId?: string
    sectionTitle?: string
    fieldId: string
    fieldLabel: string
}

interface LocatedSchemaAuthoringIssue extends SchemaAuthoringIssue {
    sectionIndex: number
    fieldIndex: number
}

export interface SchemaAuthoringIssueSummary {
    severity: SchemaAuthoringIssueSeverity
    count: number
    fields: string
}

const MAX_SCHEMA_AUTHORING_SUMMARY_FIELDS = 4;

interface SchemaAuthoringSectionContext {
    sectionId?: string
    sectionTitle?: string
    sectionDescription?: string
    sectionI18n?: unknown
    /** Number fields outside repeatable sections; enables the compareWith check. */
    numberFieldIds?: ReadonlySet<string>
    /** CRM keys set on more than one field of the form; see duplicateCrmKeys(). */
    duplicateCrmKeys?: ReadonlySet<string>
    /** Field ids the section's address groups reference (street, number, postcode, city). */
    addressFieldIds?: ReadonlySet<string>
    requireStoredPrivacy?: boolean
}

/**
 * Person CRM keys set on more than one field, sensitive ones included. Such a
 * form names several persons (applicant, representative, payee) and nothing
 * says which field is the applicant's until fields carry a role:
 * none of them is prefilled and the form cannot be published. A structured
 * address next to its own postal code field is a common single-person form
 * and does not count.
 */
export function duplicateCrmKeys(schema: Pick<FormSchema, 'sections'>): Set<string> {
    const counts = new Map<string, number>();
    for (const section of schema.sections) {
        for (const field of section.fields) {
            const key = typeof field.crm_key === 'string' ? field.crm_key.trim() : '';
            if (key.startsWith('person.')) counts.set(key, (counts.get(key) ?? 0) + 1);
        }
    }
    return new Set([...counts].filter(([, count]) => count > 1).map(([key]) => key));
}

export const PURPOSE_BOUND_AUTHORING_POLICIES: readonly string[] = ['sovereign_only', 'local_only'];

/** Purpose-bound result-schema definitions of a file field (both formats). */
function purposeBoundDefinitions(field: FormField): Array<Record<string, unknown>> {
    const schema = field.type === 'file' ? field.analysis?.resultSchema : undefined;
    if (!schema || typeof schema !== 'object') return [];
    const record = schema as Record<string, unknown>;
    const entries = [
        ...(record.properties && typeof record.properties === 'object' ? Object.values(record.properties as Record<string, unknown>) : []),
        ...(Array.isArray(record.fields) ? record.fields : [])
    ];
    return entries.filter((entry): entry is Record<string, unknown> =>
        Boolean(entry) && typeof entry === 'object' && (entry as Record<string, unknown>).purposeBound === true);
}

function normalizeToken(value: unknown): string {
    return String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '');
}

export function normalizeIdToken(value: unknown): string {
    return String(value ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/ß/g, 'ss')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .replace(/_+/g, '_');
}

function localizedFieldTextParts(i18n: unknown): string[] {
    if (!i18n || typeof i18n !== 'object' || Array.isArray(i18n)) return [];

    const parts: string[] = [];
    for (const translation of Object.values(i18n as Record<string, unknown>)) {
        if (!translation || typeof translation !== 'object' || Array.isArray(translation)) continue;
        const record = translation as Record<string, unknown>;
        for (const key of ['label', 'placeholder']) {
            const value = record[key];
            if (typeof value === 'string' && value.trim().length > 0) parts.push(value);
        }

        const options = record.options;
        if (Array.isArray(options)) {
            parts.push(...options.filter((value): value is string => typeof value === 'string' && value.trim().length > 0));
        } else if (options && typeof options === 'object') {
            parts.push(...Object.values(options as Record<string, unknown>)
                .filter((value): value is string => typeof value === 'string' && value.trim().length > 0));
        }
    }

    return parts;
}

function localizedSectionTextParts(i18n: unknown): string[] {
    if (!i18n || typeof i18n !== 'object' || Array.isArray(i18n)) return [];

    const parts: string[] = [];
    for (const translation of Object.values(i18n as Record<string, unknown>)) {
        if (!translation || typeof translation !== 'object' || Array.isArray(translation)) continue;
        const record = translation as Record<string, unknown>;
        for (const key of ['title', 'description']) {
            const value = record[key];
            if (typeof value === 'string' && value.trim().length > 0) parts.push(value);
        }
    }

    return parts;
}

function sectionContextParts(context: SchemaAuthoringSectionContext = {}): string[] {
    return [
        context.sectionTitle,
        context.sectionDescription,
        ...localizedSectionTextParts(context.sectionI18n)
    ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

function buildFieldContext(field: Partial<FormField>, extraParts: string[] = []): string {
    const context = [
        field.type,
        field.format,
        field.crm_key,
        field.id,
        field.label,
        field.placeholder,
        ...(Array.isArray(field.options) ? field.options : []),
        ...localizedFieldTextParts(field.i18n),
        ...extraParts
    ]
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .join(' ');

    return normalizeSearchText(context);
}

function buildSearchableFieldContext(field: Partial<FormField>, extraParts: string[] = []): string {
    return buildFieldContext(field, extraParts);
}

function normalizeSearchText(value: string): string {
    return value
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[_-]+/g, ' ')
        .replace(/ß/g, 'ss')
        .toLowerCase();
}

function normalizePrivacyKind(value: unknown): FormFieldPrivacyKind | undefined {
    if (typeof value !== 'string') return undefined;
    const normalized = value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .replace(/_+/g, '_');
    return FORM_FIELD_PRIVACY_KIND_SET.has(normalized)
        ? normalized as FormFieldPrivacyKind
        : undefined;
}

export function isSensitiveFlag(value: unknown): boolean {
    if (value === true || value === 1) return true;
    if (typeof value !== 'string') return false;

    const normalized = value.trim().toLowerCase();
    return normalized === 'true'
      || normalized === 'yes'
      || normalized === 'on'
      || normalized === '1';
}

const HIGH_RISK_FIELD_PATTERNS = [
    /\bdiagnos(?:e|is|en|edaten)?\b/u,
    /\bkrank[a-z]*\b/u,
    /\berkrankung[a-z]*\b/u,
    /\bgesundheit[a-z]*\b/u,
    /\bhealth[a-z]*\b/u,
    /\bmedical[a-z]*\b/u,
    /\barzt[a-z]*\b/u,
    /\battest[a-z]*\b/u,
    /\bmedikament[a-z]*\b/u,
    /\bpflegegrad[a-z]*\b/u,
    /\bgdb\b/u,
    /\bgrad[\s_-]*der[\s_-]*behinderung\b/u,
    /\bschwerbehinderung[a-z]*\b/u,
    /\bschwerbehindert[a-z]*\b/u,
    /\bbehinderung[a-z]*\b/u,
    /\bdisability[a-z]*\b/u,
    /\binfektion[a-z]*\b/u,
    /\binfektionsschutz[a-z]*\b/u,
    /\bifsg\b/u,
    /\bimpfung[a-z]*\b/u,
    /\breligion[a-z]*\b/u,
    /\bkonfession[a-z]*\b/u,
    /\bweltanschauung[a-z]*\b/u,
    /\b(?:ueberzeugung|uberzeugung)[a-z]*\b/u,
    /\bgewerkschaft[a-z]*\b/u,
    /\bpolitisch[a-z]*\b/u,
    /\bethni(?:sch|c)[a-z]*\b/u,
    /\bherkunft[a-z]*\b/u,
    /\borientierung[a-z]*\b/u,
    /\bsexual(?:itaet|itat|leben| life| orientation)?[a-z]*\b/u,
    /\bsexuell[a-z]*\b/u,
    /\bbiometr(?:ie|isch|ic)[a-z]*\b/u,
    /\bgenet(?:ik|isch|ic)[a-z]*\b/u,
    /\bstraf[a-z]*\b/u,
    /\bvorstrafe[a-z]*\b/u,
    /\b(?:fuehrungszeugnis|fuhrungszeugnis)[a-z]*\b/u,
    /\bpolizei[a-z]*\b/u
];

const RISKY_REUSABLE_CRM_KEYS = new Set<string>([
    'person.birthdate',
    'person.iban',
    'person.account_holder',
    'person.gender',
    'person.nationality',
    'person.marital_status',
    'person.tax_id',
    'company.register_number',
    'company.vat_id'
]);

const PERSONAL_DATA_POLICY_CRM_KEYS = new Set<string>([
    'person.full_name',
    'person.first_name',
    'person.last_name',
    'person.birthdate',
    'person.address',
    'person.street',
    'person.postal_code',
    'person.city',
    'person.phone',
    'person.email',
    'person.iban',
    'person.account_holder',
    'person.gender',
    'person.nationality',
    'person.marital_status',
    'person.tax_id',
    'company.contact_person'
]);

const CONTACT_PRIVACY_CRM_KEYS = new Set<string>([
    'person.address',
    'person.street',
    'person.postal_code',
    'person.city',
    'person.phone',
    'person.email',
    'company.contact_person'
]);

const FINANCIAL_PRIVACY_CRM_KEYS = new Set<string>([
    'person.iban',
    'person.account_holder',
    'company.vat_id'
]);

const CRIMINAL_OFFENSE_FIELD_PATTERNS = [
    /\bstraf[a-z]*\b/u,
    /\bvorstrafe[a-z]*\b/u,
    /\b(?:fuehrungszeugnis|fuhrungszeugnis)[a-z]*\b/u,
    /\bpolizei[a-z]*\b/u
];

const PERSONAL_DATA_FIELD_PATTERNS = [
    /\b(name|vorname|nachname|familienname|surname|forename|full[\s_-]*name|first[\s_-]*name|last[\s_-]*name|given[\s_-]*name|family[\s_-]*name)\b/u,
    /\b(?:applicant|claimant|requester|submitter|citizen|antragsteller(?:in)?)[\s_-]*(?:(?:full|first|last|given|family)[\s_-]*)?(?:name|vorname|nachname|familienname|surname|forename)\b/u,
    /\b(kontaktperson|ansprechpartner(?:in)?|vertreter(?:in)?|bevollmaechtigt[a-z]*|bevollmachtigt[a-z]*|bevollmächtigt[a-z]*|contact[\s_-]*person|representative|authorized[\s_-]*person)\b/u,
    /\bgeburts(?:datum|tag|ort|name)?\b/u,
    /\b(maedchenname|madchenname|birth(?:date|day|place|name)?)\b/u,
    /\b(adresse|anschrift|strasse|str|street|hausnummer|hausnr|wohnort|wohnsitz(?:es)?|wohnanschrift|meldeadresse|residence)\b/u,
    // A possessive makes a place word personal: "Ihr Ort", "Your city".
    /\b(ihr|ihre|your|my|mein|meine)[\s_-]+(ort|stadt|city|str)\b/u,
    /\b(address|postal[\s_-]*code|postalcode|house[\s_-]*number)\b/u,
    /\b(plz|postleitzahl)\b/u,
    /\b(telefon|telefonnummer|handy|mobil|phone|phone[\s_-]*number|telephone|mobile|tel)\b/u,
    /\b(e[\s_-]?mail|email)\b/u,
    /\b(?:applicant|claimant|requester|submitter|citizen|antragsteller(?:in)?)[\s_-]*(?:e[\s_-]?mail|email)\b/u,
    /\b(?:(?:(?:hunde?|tier|fahrzeug|kfz|grundstueck|grundstuck)[\s_-]*)?halter(?:in)?s?[\s_-]*name|(?:(?:hunde?|tier|fahrzeug|kfz|grundstueck|grundstuck)[\s_-]*)?besitzer(?:in)?s?[\s_-]*name|(?:(?:hunde?|tier|fahrzeug|kfz|grundstueck|grundstuck)[\s_-]*)?(?:eigentuemer|eigentumer)(?:in)?s?[\s_-]*name|(?:(?:[a-z0-9]+[\s_-]+)+|[a-z0-9]+)?owner[\s_-]*name)\b/u,
    /\b(iban|bic|steuer[\s_-]?id|steueridentifikationsnummer|tax[\s_-]?id)\b/u,
    /\b(geschlecht|gender|nationalitat|nationalitaet|nationality|staatsangehorigkeit|staatsangehoerigkeit|familienstand|marital[\s_-]*status)\b/u,
    /\b(ausweis(?:nummer)?|personalausweis|passnummer|passport[\s_-]*number|identity[\s_-]*card|id[\s_-]*number|sozialversicherungsnummer|social[\s_-]*security[\s_-]*number)\b/u
];

// A place word on its own ("Ort", "Stadt", "in (Ort)", "Reiseziel") names a
// municipality or a destination, not a person: the local jurisdiction is the
// city that offers the form anyway. A place is personal only as part of an
// address next to a street, which an address group marks with its address
// semantics. "Wohnort", "Geburtsort" and "Str./Nr." stay signals above.
const NON_PERSON_NAME_FIELD_PATTERN = /(?:\b(?:hundename|hundenamen|katzenname|katzennamen|tiername|tiernamen|haustiername|haustiernamen|dogname|catname|animalname|petname|objektname|objectname)\b|\b(?:hund|dog|cat|animal|pet|objekt|object)[\s_-]*name\b|\bname[\s_-]*(?:des|der|vom|of[\s_-]*the)?[\s_-]*(?:hund(?:es)?|katze|tiers?|haustiers?|dog|cat|animal|pet|objekt(?:s)?|object)\b)/u;

export function isHighRiskFormField(field: FormField, context: SchemaAuthoringSectionContext = {}): boolean {
    const searchableContext = buildSearchableFieldContext(field, sectionContextParts(context));
    return HIGH_RISK_FIELD_PATTERNS.some(pattern => pattern.test(searchableContext));
}

function isRiskyReusableCrmField(field: FormField): boolean {
    return typeof field.crm_key === 'string'
      && RISKY_REUSABLE_CRM_KEYS.has(field.crm_key.trim().toLowerCase());
}

function hasHardPersonalDataSignal(field: Partial<FormField>): boolean {
    const crmKey = typeof field.crm_key === 'string' ? field.crm_key.trim().toLowerCase() : '';
    const format = typeof field.format === 'string' ? field.format.trim().toLowerCase() : '';
    if (PERSONAL_DATA_POLICY_CRM_KEYS.has(crmKey)) return true;
    if (field.type === 'email' || field.type === 'tel') return true;
    return format === 'postal_code'
      || format === 'iban'
      || format === 'bic'
      || format === 'tax_id';
}

const PRECHECK_DIALOGUE_SAFE_FIELD_TYPES = new Set<FormField['type']>([
    'text',
    'textarea',
    'number',
    'date',
    'select',
    'radio',
    'checkbox'
]);

const PRECHECK_BLOCKED_FIELD_FORMATS = new Set<NonNullable<FormField['format']>>([
    'postal_code',
    'iban',
    'bic',
    'tax_id',
    'reference_number',
    'url'
]);

/**
 * Returns whether a canonical field may drive deterministic citizen precheck
 * questions. This is deliberately a positive gate: only explicitly
 * non-personal fields with non-identifier input shapes are eligible.
 */
export function isPrecheckDialogueSafeField(field: FormField): boolean {
    const format = typeof field.format === 'string' ? field.format.trim().toLowerCase() : '';
    return field.privacy?.kind === 'not_personal'
      && !hasHardPersonalDataSignal(field)
      && !isRiskyReusableCrmField(field)
      && PRECHECK_DIALOGUE_SAFE_FIELD_TYPES.has(field.type)
      && !PRECHECK_BLOCKED_FIELD_FORMATS.has(format as NonNullable<FormField['format']>)
      && !isSensitiveFlag(field.sensitive)
      && !isHighRiskFormField(field);
}

function hasExplicitNonPersonalClassification(field: FormField): boolean {
    return getFormFieldPrivacyKind(field) === 'not_personal';
}

function isPersonalDataField(field: FormField, context: SchemaAuthoringSectionContext = {}): boolean {
    if (hasHardPersonalDataSignal(field)) return true;
    if (hasExplicitNonPersonalClassification(field)) return false;

    if (typeof field.semantics?.concept === 'string' && field.semantics.concept.startsWith('address.')) return true;
    if (context.addressFieldIds?.has(field.id)) return true;

    const fieldOnlyContext = buildSearchableFieldContext(field);
    const searchableContext = buildSearchableFieldContext(field, sectionContextParts(context));
    if (/\b(name|vorname|nachname|full[\s_-]*name|first[\s_-]*name|last[\s_-]*name)\b/u.test(fieldOnlyContext) && NON_PERSON_NAME_FIELD_PATTERN.test(fieldOnlyContext)) {
        return false;
    }
    return PERSONAL_DATA_FIELD_PATTERNS.some(pattern => pattern.test(searchableContext));
}

export function collectFieldAuthoringIssues(
    field: FormField,
    context: SchemaAuthoringSectionContext = {}
): SchemaAuthoringIssue[] {
    const issues: SchemaAuthoringIssue[] = [];
    const base = {
        sectionId: context.sectionId,
        sectionTitle: context.sectionTitle,
        fieldId: field.id,
        fieldLabel: field.label || field.id
    };

    const requireStoredPrivacy = context.requireStoredPrivacy === true;
    const privacyKind = requireStoredPrivacy ? storedFormFieldPrivacyKind(field) : getFormFieldPrivacyKind(field);
    const highRisk = isHighRiskFormField(field, context);
    const highRiskKind = isHighRiskPrivacyKind(privacyKind);

    if ((highRisk || (requireStoredPrivacy && highRiskKind)) && !isSensitiveFlag(field.sensitive)) {
        issues.push({
            ...base,
            code: 'high_risk_unmarked',
            severity: 'blocking'
        });
    } else if (highRisk && !highRiskKind) {
        issues.push({
            ...base,
            code: 'personal_data_classification_missing',
            severity: 'blocking'
        });
    }

    const invalidStoredPrivacy = requireStoredPrivacy && field.privacy !== undefined && privacyKind === undefined;
    const missingPersonalDataClass = isPersonalDataField(field, context)
      && (!privacyKind || (requireStoredPrivacy && privacyKind === 'not_personal'));
    if (invalidStoredPrivacy || missingPersonalDataClass) {
        issues.push({
            ...base,
            code: 'personal_data_classification_missing',
            severity: 'blocking'
        });
    }

    if (isRiskyReusableCrmField(field) && !isSensitiveFlag(field.sensitive)) {
        issues.push({
            ...base,
            code: 'risky_crm_key',
            severity: 'warning'
        });
    }

    if (typeof field.crm_key === 'string' && context.duplicateCrmKeys?.has(field.crm_key.trim())) {
        issues.push({
            ...base,
            code: 'duplicate_crm_key',
            severity: 'warning'
        });
    }

    // Mirrors the Drupal save-time rules for purpose-bound values, so the
    // editor sees why a save would be refused.
    const purposeBound = purposeBoundDefinitions(field);
    if (purposeBound.length > 0 && !PURPOSE_BOUND_AUTHORING_POLICIES.includes(field.analysis?.egressPolicy ?? '')) {
        issues.push({
            ...base,
            code: 'purpose_bound_needs_sovereign',
            severity: 'blocking'
        });
    }
    if (context.numberFieldIds && purposeBound.some(definition =>
        definition.compareWith !== undefined
        && (typeof definition.compareWith !== 'string'
          || !context.numberFieldIds!.has(definition.compareWith)
          || (definition.type !== 'number' && definition.type !== 'integer')))) {
        issues.push({
            ...base,
            code: 'purpose_bound_compare_invalid',
            severity: 'blocking'
        });
    }
    // A check for case workers only runs under sovereign or local processing.
    // Under any other policy the text stays stored but never runs; warn so the
    // author notices it outside the closed tab (not blocking).
    if (
        field.type === 'file'
        && attachmentAnalysisPrompts(field.analysis).staff
        && !PURPOSE_BOUND_AUTHORING_POLICIES.includes(field.analysis?.egressPolicy ?? '')
    ) {
        issues.push({
            ...base,
            code: 'staff_prompt_inactive',
            severity: 'warning'
        });
    }

    return issues;
}

function storedFormFieldPrivacyKind(field: Partial<FormField>): FormFieldPrivacyKind | undefined {
    const privacy = field.privacy;
    return privacy && typeof privacy === 'object' && !Array.isArray(privacy)
        ? normalizePrivacyKind(privacy.kind)
        : undefined;
}

export function inferFormFieldPrivacyKind(field: Partial<FormField>): FormFieldPrivacyKind | undefined {
    const explicitKind = storedFormFieldPrivacyKind(field);
    if (explicitKind && explicitKind !== 'not_personal') return explicitKind;

    if (typeof field.crm_key === 'string') {
        if (CONTACT_PRIVACY_CRM_KEYS.has(field.crm_key)) return 'contact';
        if (FINANCIAL_PRIVACY_CRM_KEYS.has(field.crm_key)) return 'financial';
        if (PERSONAL_DATA_POLICY_CRM_KEYS.has(field.crm_key)) return 'identity';
    }

    if (field.type === 'address') return explicitKind === 'not_personal' ? 'not_personal' : 'contact';

    if (field.type === 'email' || field.type === 'tel') return 'contact';
    if (field.format === 'postal_code') return 'contact';
    if (field.format === 'iban' || field.format === 'bic') return 'financial';
    if (field.format === 'tax_id') return 'identity';

    if (isSensitiveFlag(field.sensitive)) {
        const context = buildSearchableFieldContext(field);
        return CRIMINAL_OFFENSE_FIELD_PATTERNS.some(pattern => pattern.test(context))
            ? 'criminal_offense'
            : 'special_category';
    }

    if (explicitKind === 'not_personal') return explicitKind;

    return undefined;
}

export function getFormFieldPrivacyKind(field: Partial<FormField>): FormFieldPrivacyKind | undefined {
    return inferFormFieldPrivacyKind(field);
}

function normalizeFormFieldPrivacy(field: Partial<FormField>): FormFieldPrivacy | undefined {
    const kind = inferFormFieldPrivacyKind(field);
    return kind ? { kind } : undefined;
}

function normalizeFormAddressWidget(value: unknown, fieldType: FormFieldType): FormAddressWidget | undefined {
    if (fieldType !== 'address') return undefined;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return { autocomplete: true, map: false, boundary: 'off' };
    }

    const input = value as Record<string, unknown>;
    return {
        autocomplete: input.autocomplete !== false,
        map: input.map === true,
        boundary: input.boundary === 'advisory' ? 'advisory' : 'off'
    };
}

function normalizeFormFieldSemantics(value: unknown): FormFieldSemantics | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const input = value as Record<string, unknown>;
    const concept = typeof input.concept === 'string' && /^[a-z][a-z0-9_.-]{0,127}$/u.test(input.concept.trim())
        ? input.concept.trim()
        : undefined;
    const sourcePath = typeof input.sourcePath === 'string'
        ? input.sourcePath.trim().slice(0, 1000) || undefined
        : undefined;
    return concept || sourcePath ? { concept, sourcePath } : undefined;
}

function normalizeFormAddressGroups(value: unknown, fields: FormField[]): FormAddressGroup[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const fieldTypes = new Map(fields.map(field => [field.id, field.type]));
    const seenGroupIds = new Set<string>();
    const usedFieldIds = new Set<string>();
    const groups: FormAddressGroup[] = [];

    for (const item of value) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        const input = item as Record<string, unknown>;
        const id = normalizeSafeFieldId(input.id);
        const rawFields = input.fields;
        if (!id || fieldTypes.has(id) || seenGroupIds.has(id) || !rawFields || typeof rawFields !== 'object' || Array.isArray(rawFields)) continue;
        const componentInput = rawFields as Record<string, unknown>;
        const components = {
            street: String(componentInput.street ?? ''),
            houseNumber: String(componentInput.houseNumber ?? ''),
            postcode: String(componentInput.postcode ?? ''),
            city: String(componentInput.city ?? '')
        };
        const referenced = Object.values(components);
        if (
            referenced.some(fieldId => fieldTypes.get(fieldId) !== 'text' || usedFieldIds.has(fieldId))
            || new Set(referenced).size !== referenced.length
        ) continue;

        seenGroupIds.add(id);
        referenced.forEach(fieldId => usedFieldIds.add(fieldId));
        const label = typeof input.label === 'string' ? input.label.trim().slice(0, 240) : '';
        groups.push({
            id,
            ...(label ? { label } : {}),
            fields: components,
            autocomplete: input.autocomplete !== false,
            map: input.map === true,
            boundary: input.boundary === 'advisory' ? 'advisory' : 'off'
        });
    }

    return groups.length > 0 ? groups : undefined;
}

export function isHighRiskPrivacyKind(kind: FormFieldPrivacyKind | undefined): boolean {
    return kind === 'special_category' || kind === 'criminal_offense';
}

export function collectSchemaAuthoringIssues(schema: FormSchema, options: Pick<NormalizeFormSchemaOptions, 'requireStoredPrivacy'> = {}): LocatedSchemaAuthoringIssue[] {
    const comparableFieldIds = numberFieldIds(schema);
    const sharedCrmKeys = duplicateCrmKeys(schema);
    return schema.sections.flatMap((section, sectionIndex) => {
        const addressFieldIds = new Set((section.addressGroups ?? []).flatMap(group => Object.values(group.fields)));
        return section.fields.flatMap((field, fieldIndex) =>
            collectFieldAuthoringIssues(field, {
                sectionId: section.id,
                sectionTitle: section.title,
                sectionDescription: section.description,
                sectionI18n: section.i18n,
                numberFieldIds: comparableFieldIds,
                duplicateCrmKeys: sharedCrmKeys,
                addressFieldIds,
                requireStoredPrivacy: options.requireStoredPrivacy
            }).map(issue => ({ ...issue, sectionIndex, fieldIndex }))
        );
    });
}

export function hasBlockingSchemaAuthoringIssues(schema: FormSchema): boolean {
    return collectSchemaAuthoringIssues(schema).some(issue => issue.severity === 'blocking');
}

export function listSchemaAuthoringIssueFields(issues: SchemaAuthoringIssue[]): string {
    const labels = issues
        .map(issue => issue.fieldLabel || issue.fieldId)
        .filter(Boolean);
    return [...new Set(labels)].join(', ');
}

function summarizeSchemaAuthoringIssueGroup(
    issues: SchemaAuthoringIssue[],
    severity: SchemaAuthoringIssueSeverity
): SchemaAuthoringIssueSummary | null {
    const labels = [...new Set(issues
        .filter(issue => issue.severity === severity)
        .map(issue => issue.fieldLabel || issue.fieldId)
        .filter(Boolean)
    )];
    if (labels.length === 0) return null;

    const visibleLabels = labels.slice(0, MAX_SCHEMA_AUTHORING_SUMMARY_FIELDS);
    const hiddenCount = labels.length - visibleLabels.length;

    return {
        severity,
        count: labels.length,
        fields: hiddenCount > 0
            ? `${visibleLabels.join(', ')} +${hiddenCount}`
            : visibleLabels.join(', ')
    };
}

export function summarizeSchemaAuthoringIssueGroups(issues: SchemaAuthoringIssue[]): SchemaAuthoringIssueSummary[] {
    return [
        summarizeSchemaAuthoringIssueGroup(issues, 'blocking'),
        summarizeSchemaAuthoringIssueGroup(issues, 'warning')
    ].filter((summary): summary is SchemaAuthoringIssueSummary => summary !== null);
}

export function summarizeSchemaAuthoringIssues(issues: SchemaAuthoringIssue[]): SchemaAuthoringIssueSummary | null {
    return summarizeSchemaAuthoringIssueGroups(issues)[0] ?? null;
}

function inferFieldType(field: Partial<FormField>): FormFieldType | null {
    const context = buildFieldContext(field);

    if (!context) return null;

    const looksLikeEmail = field.crm_key === 'person.email' || context.includes('@') || /\b(e[- ]?mail|email)\b/.test(context);
    if (looksLikeEmail) {
        return 'email';
    }

    const looksLikeTelephone = field.crm_key === 'person.phone' || /\b(telefon|telefonnummer|handy|mobil|mobile|phone|tel)\b/.test(context);
    if (looksLikeTelephone) {
        return 'tel';
    }

    const looksLikeDate = field.crm_key === 'person.birthdate' || /\b(geburtsdatum|date|datum|birthdate)\b/.test(context);
    if (looksLikeDate) {
        return 'date';
    }

    return null;
}

function inferFieldFormat(field: Partial<FormField>): FormFieldFormat | undefined {
    const context = buildFieldContext(field);

    if (!context) return undefined;

    if (field.crm_key === 'person.postal_code' || /\b(plz|postleitzahl|postal code|zipcode|zip)\b/.test(context)) {
        return 'postal_code';
    }

    if (field.crm_key === 'person.iban' || /\biban\b/.test(context)) {
        return 'iban';
    }

    if (field.crm_key === 'person.tax_id' || /\b(steuer[- ]?id|steueridentifikationsnummer|tax id|tax_id)\b/.test(context)) {
        return 'tax_id';
    }

    if (/\b(bic|swift)\b/.test(context)) {
        return 'bic';
    }

    if (/\b(aktenzeichen|kassenzeichen|referenznummer|reference number|referenz|vorgangsnummer)\b/.test(context)) {
        return 'reference_number';
    }

    if (/\b(url|uri|webseite|website|homepage|link|internetadresse|web address)\b/.test(context)) {
        return 'url';
    }

    if (/\b(betrag|gebuehr|gebühr|kosten|summe|euro|eur|beitrag)\b/.test(context)) {
        return 'currency';
    }

    return undefined;
}

function normalizeValidationNumber(value: unknown, options: { min?: number, integer?: boolean } = {}): number | undefined {
    const raw = typeof value === 'string' && /^[0-9]+$/.test(value.trim())
        ? Number.parseInt(value.trim(), 10)
        : value;
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        return undefined;
    }

    const normalized = options.integer ? Math.trunc(raw) : raw;
    if (options.min !== undefined && normalized < options.min) {
        return options.min;
    }

    return normalized;
}

function isEscaped(pattern: string, index: number): boolean {
    let slashCount = 0;
    for (let i = index - 1; i >= 0 && pattern[i] === '\\'; i--) {
        slashCount++;
    }
    return slashCount % 2 === 1;
}

function quantifierKindAt(pattern: string, index: number): 'none' | 'bounded' | 'unbounded' {
    const char = pattern[index];
    if (!char || isEscaped(pattern, index)) return 'none';
    if (char === '*' || char === '+') return 'unbounded';
    if (char === '?') return 'bounded';
    if (char !== '{') return 'none';

    const close = pattern.indexOf('}', index + 1);
    if (close === -1) return 'none';
    const body = pattern.slice(index + 1, close);
    if (!/^\d+(?:,\d*)?$/u.test(body)) return 'none';
    if (body.endsWith(',')) return 'unbounded';

    const [, maxRaw] = body.split(',');
    const max = Number(maxRaw ?? body);
    return Number.isInteger(max) && max <= MAX_VALIDATION_PATTERN_QUANTIFIER_BOUND
        ? 'bounded'
        : 'unbounded';
}

/**
 * Why a validation pattern is not kept, for the editor to say so at the field instead of
 * dropping it in silence. The rule itself is unchanged (security hardening c27ed2b): only the
 * product's own patterns run (`EXECUTABLE_VALIDATION_PATTERNS`), every other pattern is refused.
 */
export type ValidationPatternRefusal = 'invalid' | 'not_built_in';

export function validationPatternRefusal(pattern: string): ValidationPatternRefusal | null {
    const trimmed = pattern.trim();
    if (trimmed === '') return null;
    try {
        new RegExp(trimmed, 'u');
    } catch {
        return 'invalid';
    }
    return isSafeValidationPattern(trimmed) ? null : 'not_built_in';
}

function isSafeValidationPattern(pattern: string): boolean {
    if (!EXECUTABLE_VALIDATION_PATTERNS.has(pattern)) return false;
    if (pattern.length > MAX_VALIDATION_PATTERN_LENGTH) return false;
    if (/\\[1-9]/u.test(pattern)) return false;

    try {
        new RegExp(pattern, 'u');
    } catch {
        return false;
    }

    for (let i = 0; i < pattern.length; i++) {
        const char = pattern[i];
        if (isEscaped(pattern, i)) continue;

        if (char === '[') {
            const close = findCharacterClassEnd(pattern, i + 1);
            if (close === -1) return false;
            i = close;
            continue;
        }

        if (char === '(' || char === ')' || char === '|' || char === '*' || char === '+') {
            return false;
        }

        const quantifier = quantifierKindAt(pattern, i);
        if (quantifier === 'unbounded') {
            return false;
        }
        if (quantifier === 'bounded') {
            i = pattern.indexOf('}', i);
        }
    }

    return true;
}

function findCharacterClassEnd(pattern: string, start: number): number {
    for (let i = start; i < pattern.length; i++) {
        if (pattern[i] === ']' && !isEscaped(pattern, i)) {
            return i;
        }
    }
    return -1;
}

function normalizeFormFieldValidation(validation?: Partial<FormFieldValidation>): FormFieldValidation | undefined {
    if (!validation || typeof validation !== 'object') {
        return undefined;
    }

    const normalized: FormFieldValidation = {};

    if (typeof validation.pattern === 'string' && validation.pattern.trim().length > 0) {
        const pattern = validation.pattern.trim();
        if (isSafeValidationPattern(pattern)) {
            normalized.pattern = pattern;
        }
    }

    const minLength = normalizeValidationNumber(validation.minLength, { min: 0, integer: true });
    if (minLength !== undefined) {
        normalized.minLength = minLength;
    }

    const maxLength = normalizeValidationNumber(validation.maxLength, { min: 0, integer: true });
    if (maxLength !== undefined) {
        normalized.maxLength = maxLength;
    }

    const min = normalizeValidationNumber(validation.min);
    if (min !== undefined) {
        normalized.min = min;
    }

    const max = normalizeValidationNumber(validation.max);
    if (max !== undefined) {
        normalized.max = max;
    }

    const step = normalizeValidationNumber(validation.step, { min: 0 });
    if (step !== undefined) {
        normalized.step = step;
    }

    const maxFiles = normalizeValidationNumber(validation.maxFiles, { min: 1, integer: true });
    if (maxFiles !== undefined) {
        normalized.maxFiles = maxFiles;
    }

    const maxSizeBytes = normalizeValidationNumber(validation.maxSizeBytes, { min: 1, integer: true });
    if (maxSizeBytes !== undefined) {
        normalized.maxSizeBytes = maxSizeBytes;
    }

    const maxFileSizeBytes = normalizeValidationNumber(validation.maxFileSizeBytes, { min: 1, integer: true });
    if (maxFileSizeBytes !== undefined) {
        normalized.maxFileSizeBytes = maxFileSizeBytes;
    }

    return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeAnalysisText(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed.slice(0, MAX_ANALYSIS_TEXT_LENGTH) : undefined;
}

function resultSchemaDepth(value: unknown, depth = 0): number {
    if (!value || typeof value !== 'object') return depth;
    if (depth > MAX_ANALYSIS_RESULT_SCHEMA_DEPTH) return depth;
    const children = Array.isArray(value)
        ? value
        : Object.values(value as Record<string, unknown>);
    if (children.length === 0) return depth;
    return Math.max(...children.map(child => resultSchemaDepth(child, depth + 1)));
}

export function normalizeAnalysisResultSchema(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    try {
        const serialized = JSON.stringify(value);
        if (
            serialized.length > MAX_ANALYSIS_RESULT_SCHEMA_JSON_LENGTH
            || resultSchemaDepth(value) > MAX_ANALYSIS_RESULT_SCHEMA_DEPTH
        ) {
            return undefined;
        }
    } catch {
        return undefined;
    }
    return value as Record<string, unknown>;
}

function normalizeFormAttachmentAnalysisProfile(
    analysis: unknown,
    fieldType: FormFieldType
): FormAttachmentAnalysisProfile | undefined {
    if (fieldType !== 'file' || !analysis || typeof analysis !== 'object' || Array.isArray(analysis)) {
        return undefined;
    }

    const input = analysis as Record<string, unknown>;
    const normalized: FormAttachmentAnalysisProfile = {};
    if (input.enabled === false) {
        normalized.enabled = false;
    } else if (isSensitiveFlag(input.enabled)) {
        normalized.enabled = true;
    }

    const version = normalizeValidationNumber(input.version, { min: 1, integer: true });
    if (version !== undefined) {
        normalized.version = version;
    }

    const expectedDocumentType = normalizeAnalysisText(input.expectedDocumentType);
    if (expectedDocumentType) {
        normalized.expectedDocumentType = expectedDocumentType;
    }

    const promptSuggestion = normalizeAnalysisText(input.promptSuggestion);
    if (promptSuggestion) {
        normalized.promptSuggestion = promptSuggestion;
    }

    const citizenPrompt = normalizeAnalysisText(input.citizenPrompt);
    if (citizenPrompt) {
        normalized.citizenPrompt = citizenPrompt;
    }

    const staffPrompt = normalizeAnalysisText(input.staffPrompt);
    if (staffPrompt) {
        normalized.staffPrompt = staffPrompt;
    }

    // Kept only when a human chose it; a missing key means 'none' at runtime
    // and lets the editor still propose 'when_possible' later.
    if (typeof input.redaction === 'string' && FORM_ATTACHMENT_ANALYSIS_REDACTION_SET.has(input.redaction)) {
        normalized.redaction = input.redaction as FormAttachmentAnalysisRedaction;
    }

    const resultSchema = normalizeAnalysisResultSchema(input.resultSchema);
    if (resultSchema) {
        normalized.resultSchema = resultSchema;
    }

    if (typeof input.egressPolicy === 'string' && FORM_ATTACHMENT_ANALYSIS_EGRESS_POLICY_SET.has(input.egressPolicy)) {
        normalized.egressPolicy = input.egressPolicy as FormAttachmentAnalysisEgressPolicy;
    }

    if (Object.keys(normalized).length === 0) {
        return undefined;
    }

    normalized.egressPolicy ??= 'no_ai';
    if (normalized.enabled === undefined) {
        normalized.enabled = true;
    }
    if (
        normalized.egressPolicy !== 'no_ai'
        && typeof input.modelClass === 'string'
        && FORM_ATTACHMENT_ANALYSIS_MODEL_CLASS_SET.has(input.modelClass)
        && isFormAttachmentAnalysisModelClassAllowed(normalized.egressPolicy, input.modelClass as FormAttachmentAnalysisModelClass)
    ) {
        normalized.modelClass = input.modelClass as FormAttachmentAnalysisModelClass;
    }

    return normalized;
}

function mergeValidationRules(...validations: Array<FormFieldValidation | undefined>): FormFieldValidation | undefined {
    const merged: FormFieldValidation = {};

    for (const validation of validations) {
        if (!validation) continue;
        Object.assign(merged, validation);
    }

    return Object.keys(merged).length > 0 ? merged : undefined;
}

function normalizeSafeFieldId(id: unknown): string {
    const raw = String(id ?? '');
    return UNSAFE_FORM_FIELD_IDS.has(raw)
        ? normalizeIdToken(`${raw}_field`) || 'field'
        : raw;
}

function normalizeConditionalOn(conditionalOn: FormField['conditionalOn']): FormField['conditionalOn'] {
    if (!conditionalOn || UNSAFE_FORM_FIELD_IDS.has(String(conditionalOn.fieldId))) {
        return undefined;
    }
    return conditionalOn;
}

function normalizeI18nText(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    return trimmed.slice(0, MAX_I18N_TEXT_LENGTH);
}

function normalizeI18nOptions(value: unknown): string[] | Record<string, string> | undefined {
    if (Array.isArray(value)) {
        const items = value
            .map(item => normalizeI18nText(item))
            .filter((item): item is string => Boolean(item))
            .slice(0, MAX_I18N_OPTIONS);
        return items.length > 0 ? items : undefined;
    }

    if (!value || typeof value !== 'object') return undefined;

    const options: Record<string, string> = {};
    for (const [key, optionValue] of Object.entries(value).slice(0, MAX_I18N_OPTIONS)) {
        const source = normalizeI18nText(key);
        const label = normalizeI18nText(optionValue);
        if (source && label) {
            options[source] = label;
        }
    }

    return Object.keys(options).length > 0 ? options : undefined;
}

function normalizeI18nMap(
    value: unknown,
    allowedKeys: readonly string[],
    optionsKey = false
): Record<string, Record<string, string | string[] | Record<string, string>>> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;

    const normalized: Record<string, Record<string, string | string[] | Record<string, string>>> = {};
    for (const [locale, translationValue] of Object.entries(value).slice(0, MAX_I18N_LOCALES)) {
        if (!LOCALE_KEY_PATTERN.test(locale) || !translationValue || typeof translationValue !== 'object' || Array.isArray(translationValue)) {
            continue;
        }

        const translationInput = translationValue as Record<string, unknown>;
        const translation: Record<string, string | string[] | Record<string, string>> = {};
        for (const key of allowedKeys) {
            const text = normalizeI18nText(translationInput[key]);
            if (text) {
                translation[key] = text;
            }
        }

        if (optionsKey) {
            const options = normalizeI18nOptions(translationInput.options);
            if (options) {
                translation.options = options;
            }
        }

        if (Object.keys(translation).length > 0) {
            normalized[locale] = translation;
        }
    }

    return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeContextSourceText(value: unknown, maxLength = MAX_CONTEXT_SOURCE_TEXT_LENGTH): string | undefined {
    if (typeof value !== 'string') return undefined;
    const normalized = value.replace(/\s+/g, ' ').trim();
    return normalized.length > 0 ? normalized.slice(0, maxLength) : undefined;
}

function normalizeContextSourceType(value: unknown): FormContextSourceType | undefined {
    if (typeof value !== 'string') return undefined;
    const normalized = value.trim().toLowerCase();
    return FORM_CONTEXT_SOURCE_TYPE_SET.has(normalized)
        ? normalized as FormContextSourceType
        : undefined;
}

function normalizeContextSourceUsages(value: unknown): FormContextSourceUsage[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const usages = value
        .filter((item): item is string => typeof item === 'string')
        .map(item => item.trim().toLowerCase())
        .filter((item): item is FormContextSourceUsage => FORM_CONTEXT_SOURCE_USAGE_SET.has(item));
    const unique = [...new Set(usages)];
    return unique.length > 0 ? unique : undefined;
}

function normalizeContextSourceId(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const id = value.trim();
    return CONTEXT_SOURCE_ID_PATTERN.test(id) ? id : undefined;
}

function normalizeContextSourceChanged(value: unknown): number | undefined {
    const changed = normalizeValidationNumber(value, { min: 0, integer: true });
    return changed !== undefined ? changed : undefined;
}

function normalizeFormContextSource(value: unknown): FormContextSource | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;

    const input = value as Record<string, unknown>;
    const type = normalizeContextSourceType(input.type);
    const id = normalizeContextSourceId(input.id);
    const title = normalizeContextSourceText(input.title, 240);
    if (!type || !id || !title) {
        return undefined;
    }

    const placement = normalizeContextSourceText(input.placement, 80);
    const version = normalizeContextSourceText(input.version, 120);
    const changed = normalizeContextSourceChanged(input.changed);

    return {
        type,
        id,
        title,
        ...(placement ? { placement } : {}),
        ...(version ? { version } : {}),
        ...(changed !== undefined ? { changed } : {}),
        enabledFor: normalizeContextSourceUsages(input.enabledFor) ?? ['editor'],
        requiredCitation: input.requiredCitation === false ? false : true
    };
}

function normalizeFormContextSources(value: unknown): FormContextSource[] | undefined {
    if (!Array.isArray(value)) return undefined;

    const seen = new Set<string>();
    const sources: FormContextSource[] = [];
    for (const item of value) {
        const source = normalizeFormContextSource(item);
        if (!source) continue;
        const key = source.id.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        sources.push(source);
        if (sources.length >= MAX_CONTEXT_SOURCES) break;
    }

    return sources.length > 0 ? sources : undefined;
}

function normalizePrecheckText(value: unknown, maxLength = MAX_PRECHECK_TEXT_LENGTH): string | undefined {
    if (typeof value !== 'string') return undefined;
    const normalized = value.replace(/\s+/gu, ' ').trim();
    return normalized.length > 0 ? normalized.slice(0, maxLength) : undefined;
}

function normalizePrecheckLocalizedText(value: unknown): FormPrecheckLocalizedText | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const input = value as Record<string, unknown>;
    const de = normalizePrecheckText(input.de, 500);
    if (!de) return undefined;
    const en = normalizePrecheckText(input.en, 500);
    return {
        de,
        ...(en ? { en } : {})
    };
}

function normalizePrecheckEvidence(value: unknown): FormPrecheckEvidence | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const input = value as Record<string, unknown>;
    const sourceType = input.sourceType === 'form_source' || input.sourceType === 'context_source'
        ? input.sourceType
        : undefined;
    const quote = normalizePrecheckText(input.quote);
    if (!sourceType || !quote) return undefined;

    const sourceId = typeof input.sourceId === 'string' && PRECHECK_CONTEXT_SOURCE_ID_PATTERN.test(input.sourceId.trim())
        ? input.sourceId.trim().toLowerCase()
        : undefined;
    if (
        (sourceType === 'context_source' && !sourceId)
        || (sourceType === 'form_source' && sourceId)
    ) {
        return undefined;
    }
    const sourceTitle = normalizePrecheckText(input.sourceTitle, 240);
    const page = normalizeValidationNumber(input.page, { min: 1, integer: true });

    return {
        sourceType,
        ...(sourceType === 'context_source' && sourceId ? { sourceId } : {}),
        ...(sourceTitle ? { sourceTitle } : {}),
        quote,
        ...(page !== undefined ? { page } : {})
    };
}

function normalizePrecheckFactType(value: unknown): FormPrecheckFactType | undefined {
    if (typeof value !== 'string') return undefined;
    const normalized = value.trim().toLowerCase();
    return FORM_PRECHECK_FACT_TYPE_SET.has(normalized)
        ? normalized as FormPrecheckFactType
        : undefined;
}

function normalizePrecheckReviewStatus(value: unknown): FormPrecheckReviewStatus {
    if (typeof value !== 'string') return 'suggested';
    const normalized = value.trim().toLowerCase();
    return FORM_PRECHECK_REVIEW_STATUS_SET.has(normalized)
        ? normalized as FormPrecheckReviewStatus
        : 'suggested';
}

function normalizePrecheckAffects(value: unknown): FormPrecheckAffects {
    return value === 'procedure_fit' || value === 'obligation' || value === 'both'
        ? value
        : 'procedure_fit';
}

function normalizePrecheckOptions(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const options = [...new Set(value
        .map(option => normalizePrecheckText(option, 120))
        .filter((option): option is string => Boolean(option)))]
        .slice(0, MAX_PRECHECK_OPTIONS);
    return options.length > 0 ? options : undefined;
}

function normalizeFormPrecheckCriterion(value: unknown, fallbackOrder: number): FormPrecheckCriterion | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const input = value as Record<string, unknown>;
    const normalizedId = normalizeIdToken(input.id);
    const normalizedFactKey = normalizeIdToken(input.factKey);
    const normalizedFieldId = normalizeIdToken(input.fieldId);
    const id = PRECHECK_MACHINE_ID_PATTERN.test(normalizedId) ? normalizedId : '';
    const factKey = PRECHECK_MACHINE_ID_PATTERN.test(normalizedFactKey) ? normalizedFactKey : '';
    const fieldId = PRECHECK_MACHINE_ID_PATTERN.test(normalizedFieldId) ? normalizedFieldId : undefined;
    const privacyInput = input.privacy;
    const privacy = !fieldId
      && privacyInput
      && typeof privacyInput === 'object'
      && !Array.isArray(privacyInput)
      && (privacyInput as Record<string, unknown>).kind === 'not_personal'
        ? { kind: 'not_personal' as const }
        : undefined;
    const factType = normalizePrecheckFactType(input.factType);
    const label = normalizePrecheckLocalizedText(input.label);
    const question = normalizePrecheckLocalizedText(input.question);
    const evidence = normalizePrecheckEvidence(input.evidence);
    if (!id || !factKey || !factType || !label || !question || !evidence) {
        return undefined;
    }

    let reviewStatus = normalizePrecheckReviewStatus(input.reviewStatus);
    if (
        reviewStatus === 'approved'
        && (
            evidence.sourceType !== 'context_source'
            || !evidence.sourceId
            || !label.en
            || !question.en
            || (!fieldId && !privacy)
        )
    ) {
        reviewStatus = 'suggested';
    }
    const order = normalizeValidationNumber(input.order, { min: 0, integer: true }) ?? fallbackOrder;
    const unit = normalizePrecheckText(input.unit, 80);
    const options = normalizePrecheckOptions(input.options);
    if (factType === 'enum' && !options) {
        return undefined;
    }

    return {
        id,
        factKey,
        ...(fieldId ? { fieldId } : {}),
        ...(privacy ? { privacy } : {}),
        factType,
        label,
        question,
        affects: normalizePrecheckAffects(input.affects),
        order,
        reviewStatus,
        evidence,
        ...(unit ? { unit } : {}),
        ...(factType === 'enum' && options ? { options } : {})
    };
}

export function normalizeFormPrecheckSchema(value: unknown): FormPrecheckSchema | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const input = value as Record<string, unknown>;
    if (input.version !== 1 || !Array.isArray(input.criteria)) return undefined;

    const seenIds = new Set<string>();
    const seenFactKeys = new Set<string>();
    const criteria: FormPrecheckCriterion[] = [];
    for (const [index, item] of input.criteria.entries()) {
        const criterion = normalizeFormPrecheckCriterion(item, index);
        if (!criterion || seenIds.has(criterion.id) || seenFactKeys.has(criterion.factKey)) continue;
        seenIds.add(criterion.id);
        seenFactKeys.add(criterion.factKey);
        criteria.push(criterion);
        if (criteria.length >= MAX_PRECHECK_CRITERIA) break;
    }

    return criteria.length > 0 ? { version: 1, criteria } : undefined;
}

export function normalizeFormFieldType(type: unknown, field: Partial<FormField>): FormFieldType {
    const normalizedType = normalizeToken(type);
    const aliasedType = FIELD_TYPE_ALIASES[normalizedType];

    if (aliasedType) {
        return aliasedType;
    }

    if (FORM_FIELD_TYPE_SET.has(normalizedType)) {
        const currentType = normalizedType as FormFieldType;
        if (currentType === 'text') {
            return inferFieldType(field) ?? currentType;
        }
        return currentType;
    }

    return inferFieldType(field) ?? (Array.isArray(field.options) && field.options.length > 0 ? 'select' : 'text');
}

export function normalizeFormFieldFormat(format: unknown, field: Partial<FormField>, { requireCurrencyMetadata = false } = {}): FormFieldFormat | undefined {
    const normalizedFormat = normalizeToken(format);
    const aliasedFormat = FIELD_FORMAT_ALIASES[normalizedFormat];

    if (aliasedFormat) {
        return aliasedFormat;
    }

    if (FORM_FIELD_FORMAT_SET.has(normalizedFormat)) {
        return normalizedFormat as FormFieldFormat;
    }

    const inferred = inferFieldFormat(field);
    return requireCurrencyMetadata && inferred === 'currency' ? undefined : inferred;
}

export function normalizeFormField(field: Partial<FormField>, options?: Pick<NormalizeFormSchemaOptions, 'requireCurrencyMetadata' | 'requireStoredPrivacy'>): FormField {
    const normalizedType = normalizeFormFieldType(field.type, field);
    // A declared
    // upload ("file" or an alias) stays one. No format, declared or inferred from the label or a
    // profile key ("PLZ", "IBAN", "Kosten", "Link"), turns it into a text or number field, so the
    // editor, the citizen page, the submit route and the staff edit see the upload Drupal sees.
    // Type inference runs only for "text" and never yields "file".
    const normalizedFormat = normalizedType === 'file' ? undefined : normalizeFormFieldFormat(field.format, field, options);
    const preferredType = normalizedFormat ? FIELD_FORMAT_DEFAULTS[normalizedFormat].type : normalizedType;
    const typeDefaults = FIELD_TYPE_VALIDATION_DEFAULTS[preferredType];
    const formatDefaults = normalizedFormat ? FIELD_FORMAT_DEFAULTS[normalizedFormat].validation : undefined;
    const explicitValidation = normalizeFormFieldValidation(field.validation);
    const normalizedSensitive = isSensitiveFlag(field.sensitive) ? true : undefined;
    const normalizedFieldForPrivacy = {
        ...field,
        type: preferredType,
        format: normalizedFormat,
        sensitive: normalizedSensitive
    };
    // Publication must assess the stored classification and protection flag.
    // Keep an invalid value visible to the check instead of inferring a class.
    const storedKind = options?.requireStoredPrivacy ? storedFormFieldPrivacyKind(field) : undefined;
    const normalizedPrivacy = options?.requireStoredPrivacy
        ? (storedKind ? { kind: storedKind } : field.privacy)
        : normalizeFormFieldPrivacy(normalizedFieldForPrivacy);
    const effectiveSensitive = normalizedSensitive
      || (!options?.requireStoredPrivacy && isHighRiskPrivacyKind(normalizedPrivacy?.kind) ? true : undefined);

    return {
        ...field,
        id: normalizeSafeFieldId(field.id),
        label: String(field.label ?? field.id ?? ''),
        type: preferredType,
        format: normalizedFormat,
        i18n: normalizeI18nMap(field.i18n, ['label', 'placeholder'], true),
        sensitive: effectiveSensitive,
        privacy: normalizedPrivacy,
        conditionalOn: normalizeConditionalOn(field.conditionalOn),
        validation: mergeValidationRules(typeDefaults, formatDefaults, explicitValidation),
        widget: normalizeFormAddressWidget(field.widget, preferredType),
        semantics: normalizeFormFieldSemantics(field.semantics),
        analysis: normalizeFormAttachmentAnalysisProfile(field.analysis, preferredType),
        options: Array.isArray(field.options)
            ? field.options.map(option => String(option))
            : undefined
    } as FormField;
}

const POSTAL_COMPONENT_PATTERN = /(^|[^a-z0-9])(plz|postleitzahl|postal\s*code|postalcode|zip|zipcode)(?=$|[^a-z0-9])/u;
const CITY_COMPONENT_PATTERN = /(^|[^a-z0-9])(ort|stadt|wohnort|city)(?=$|[^a-z0-9])/u;
const STREET_COMPONENT_PATTERN = /(^|[^a-z0-9])(strasse|straße|str|str\.|street|hausnummer|house\s*number|nr)(?=$|[^a-z0-9])/u;
const ADDRESS_COMPONENT_TOKEN_PATTERN = /(^|_)(plz|postleitzahl|postal_code|postalcode|zip|zipcode|ort|stadt|wohnort|city|und|and|u)(?=_|$)/g;
const PERSON_ADDRESS_CRM_KEYS = new Set(['person.address', 'person.postal_code', 'person.city']);

export interface NormalizeFormSchemaOptions {
    /** Citizen input syntax follows the published format, even if the label sounds like an amount. */
    requireCurrencyMetadata?: boolean
    /** Publication checks explicit stored privacy metadata before applying any inference. */
    requireStoredPrivacy?: boolean
    /**
     * Expand legacy compound address fields into canonical component fields
     * plus a presentation-only addressGroup before first persistence.
     */
    expandAddressFields?: boolean
    /**
     * Split AI-generated combo fields like "PLZ / Ort" before first persistence.
     * Keep disabled when reading stored schemas, otherwise old field IDs can drift.
     */
    splitAddressFields?: boolean
    /**
     * Turn AI-recognized paper attachment cues into direct digital upload
     * fields. Enable only while ingesting a newly compiled schema so stored
     * schemas never gain fields merely by being read.
     */
    inferAttachmentRequirements?: boolean
    /**
     * Rewrite section/field ids that violate Drupal's FormSchema machine-id
     * contract (^[a-z][a-z0-9_]*$). Enable only for AI-ingested schemas
     * before first persistence; stored schemas must keep their ids stable,
     * otherwise saved field_data keys no longer map.
     */
    enforceMachineIds?: boolean
}

const MACHINE_ID_PATTERN = /^[a-z][a-z0-9_]*$/;

function toMachineId(value: unknown, fallback: string): string {
    let id = normalizeIdToken(value);
    if (!id) {
        return fallback;
    }
    if (!/^[a-z]/.test(id)) {
        id = `f_${id}`;
    }
    return id;
}

/** Creates a safe draft identifier with the same normalization as form imports. */
export function formMachineIdFromLabel(label: string, fallback: string): string {
    return normalizeSafeFieldId(toMachineId(label, fallback));
}

function enforceSchemaMachineIds(schema: FormSchema): FormSchema {
    const usedSectionIds = new Set<string>();
    const usedFieldIds = new Set<string>();
    const usedAddressGroupIds = new Set<string>();
    const renamedFields = new Map<string, string>();

    // Reserve ids that already satisfy the contract so repairs cannot
    // collide with them.
    for (const section of schema.sections) {
        if (MACHINE_ID_PATTERN.test(section.id)) {
            usedSectionIds.add(section.id);
        }
        for (const field of section.fields) {
            if (MACHINE_ID_PATTERN.test(field.id)) {
                usedFieldIds.add(field.id);
            }
        }
        for (const group of section.addressGroups ?? []) {
            if (MACHINE_ID_PATTERN.test(group.id)) {
                usedAddressGroupIds.add(group.id);
            }
        }
    }

    const uniqueId = (base: string, used: Set<string>): string => {
        let candidate = base;
        let suffix = 2;
        while (used.has(candidate)) {
            candidate = `${base}_${suffix}`;
            suffix += 1;
        }
        used.add(candidate);
        return candidate;
    };

    const sections = schema.sections.map((section, sectionIndex) => {
        const fields = section.fields.map((field, fieldIndex) => {
            if (MACHINE_ID_PATTERN.test(field.id)) {
                return field;
            }
            const repaired = uniqueId(toMachineId(field.id || field.label, `field_${fieldIndex + 1}`), usedFieldIds);
            renamedFields.set(field.id, repaired);
            return { ...field, id: repaired };
        });
        return {
            ...section,
            id: MACHINE_ID_PATTERN.test(section.id)
                ? section.id
                : uniqueId(toMachineId(section.id || section.title, `section_${sectionIndex + 1}`), usedSectionIds),
            fields,
            addressGroups: section.addressGroups?.map((group, groupIndex) => ({
                ...group,
                id: MACHINE_ID_PATTERN.test(group.id)
                    ? group.id
                    : uniqueId(toMachineId(group.id || group.label, `address_${groupIndex + 1}`), usedAddressGroupIds)
            }))
        };
    });

    // Conditional visibility references renamed fields by id; remap them.
    const remappedSections = renamedFields.size === 0
        ? sections
        : sections.map(section => ({
            ...section,
            fields: section.fields.map((field) => {
                const renamed = field.conditionalOn
                    ? renamedFields.get(String(field.conditionalOn.fieldId))
                    : undefined;
                return renamed
                    ? { ...field, conditionalOn: { ...field.conditionalOn!, fieldId: renamed } }
                    : field;
            }),
            addressGroups: section.addressGroups?.map(group => ({
                ...group,
                fields: Object.fromEntries(
                    Object.entries(group.fields).map(([component, fieldId]) => [
                        component,
                        renamedFields.get(fieldId) ?? fieldId
                    ])
                ) as unknown as FormAddressGroup['fields']
            }))
        }));

    return { ...schema, sections: remappedSections };
}

function shouldSplitPostalCityField(field: FormField): boolean {
    if (field.type !== 'text' && field.type !== 'textarea') return false;
    if (Array.isArray(field.options) && field.options.length > 0) return false;

    const context = buildFieldContext(field);
    return POSTAL_COMPONENT_PATTERN.test(context)
      && CITY_COMPONENT_PATTERN.test(context)
      && !STREET_COMPONENT_PATTERN.test(context);
}

function addressComponentBaseId(field: FormField, component: 'postal_code' | 'city'): string {
    const source = normalizeIdToken(field.id || field.label);
    const prefix = source
        .replace(ADDRESS_COMPONENT_TOKEN_PATTERN, '$1')
        .replace(/^_+|_+$/g, '')
        .replace(/_+/g, '_');
    const suffix = component === 'postal_code' ? 'plz' : 'ort';

    return [prefix, suffix].filter(Boolean).join('_') || suffix;
}

function makeUniqueFieldId(id: string, usedIds: Set<string>): string {
    const base = normalizeIdToken(id) || 'field';
    let candidate = base;
    let suffix = 2;

    while (usedIds.has(candidate)) {
        candidate = `${base}_${suffix}`;
        suffix += 1;
    }

    usedIds.add(candidate);
    return candidate;
}

function getAddressComponentPrefix(field: FormField): string {
    const label = String(field.label || '').trim();
    const match = label.match(/\b(plz|postleitzahl|postal\s*code|zip)\b/iu);
    const prefix = match && match.index !== undefined
        ? label.slice(0, match.index).trim().replace(/[\s:,\-/]+$/u, '')
        : '';

    return prefix;
}

function addressComponentLabel(field: FormField, component: 'postal_code' | 'city'): string {
    const prefix = getAddressComponentPrefix(field);
    const suffix = component === 'postal_code' ? 'PLZ' : 'Ort';

    return [prefix, suffix].filter(Boolean).join(' ');
}

function addressComponentCrmKey(field: FormField, component: 'postal_code' | 'city'): FormField['crm_key'] | undefined {
    if (!field.crm_key || !PERSON_ADDRESS_CRM_KEYS.has(String(field.crm_key))) {
        return undefined;
    }

    return component === 'postal_code' ? 'person.postal_code' : 'person.city';
}

function splitPostalCityField(field: FormField, usedIds: Set<string>): FormField[] | null {
    if (!shouldSplitPostalCityField(field)) return null;

    // Both halves keep the classification of the combined field and carry
    // their address semantics, so the city half stays personal data.
    const common = {
        required: field.required,
        conditionalOn: field.conditionalOn,
        ...(field.privacy ? { privacy: field.privacy } : {}),
        ...(field.sensitive !== undefined ? { sensitive: field.sensitive } : {})
    };

    return [
        normalizeFormField({
            ...common,
            id: makeUniqueFieldId(addressComponentBaseId(field, 'postal_code'), usedIds),
            label: addressComponentLabel(field, 'postal_code'),
            type: 'text',
            format: 'postal_code',
            placeholder: '12345',
            crm_key: addressComponentCrmKey(field, 'postal_code'),
            semantics: { concept: 'address.postcode', ...(field.semantics?.sourcePath ? { sourcePath: field.semantics.sourcePath } : {}) }
        }),
        normalizeFormField({
            ...common,
            id: makeUniqueFieldId(addressComponentBaseId(field, 'city'), usedIds),
            label: addressComponentLabel(field, 'city'),
            type: 'text',
            placeholder: 'Musterstadt',
            crm_key: addressComponentCrmKey(field, 'city'),
            semantics: { concept: 'address.city', ...(field.semantics?.sourcePath ? { sourcePath: field.semantics.sourcePath } : {}) }
        })
    ];
}

function normalizeSectionFields(fields: Array<Partial<FormField>>, options: NormalizeFormSchemaOptions): FormField[] {
    const inputFields = fields.map(field => normalizeFormField(field, options));

    if (!options.splitAddressFields) {
        return inputFields;
    }

    const usedIds = new Set(inputFields.map(field => field.id).filter(Boolean));
    const normalizedFields: FormField[] = [];

    for (const field of inputFields) {
        usedIds.delete(field.id);
        const splitFields = splitPostalCityField(field, usedIds);

        if (splitFields) {
            normalizedFields.push(...splitFields);
            continue;
        }

        usedIds.add(field.id);
        normalizedFields.push(field);
    }

    return normalizedFields;
}

function expandLegacyAddressFields(fields: FormField[]): { fields: FormField[], addressGroups: FormAddressGroup[] } {
    const usedIds = new Set(fields.filter(field => field.type !== 'address').map(field => field.id));
    const expanded: FormField[] = [];
    const addressGroups: FormAddressGroup[] = [];

    for (const field of fields) {
        if (field.type !== 'address') {
            expanded.push(field);
            continue;
        }
        const isPersonAddress = typeof field.crm_key === 'string' && PERSON_ADDRESS_CRM_KEYS.has(field.crm_key);
        const componentDefinitions = [
            { key: 'street', suffix: 'strasse', label: 'Straße', crm_key: isPersonAddress ? 'person.street' : undefined },
            { key: 'houseNumber', suffix: 'hausnummer', label: 'Hausnummer', crm_key: undefined },
            { key: 'postcode', suffix: 'plz', label: 'Postleitzahl', crm_key: isPersonAddress ? 'person.postal_code' : undefined },
            { key: 'city', suffix: 'ort', label: 'Ort', crm_key: isPersonAddress ? 'person.city' : undefined }
        ] as const;
        const componentIds: Record<string, string> = {};
        for (const component of componentDefinitions) {
            const id = makeUniqueFieldId(`${field.id}_${component.suffix}`, usedIds);
            componentIds[component.key] = id;
            expanded.push(normalizeFormField({
                id,
                type: 'text',
                label: component.label,
                i18n: { en: { label: component.key === 'houseNumber' ? 'House number' : component.key === 'postcode' ? 'Postal code' : component.key === 'city' ? 'City' : 'Street' } },
                required: field.required,
                conditionalOn: field.conditionalOn,
                privacy: field.privacy,
                sensitive: field.sensitive,
                crm_key: component.crm_key,
                format: component.key === 'postcode' ? 'postal_code' : undefined,
                semantics: {
                    concept: component.key === 'houseNumber' ? 'address.house_number' : `address.${component.key}`,
                    ...(field.semantics?.sourcePath ? { sourcePath: `${field.semantics.sourcePath}.${component.key}` } : {})
                }
            }));
        }
        addressGroups.push({
            id: field.id,
            label: field.label,
            fields: componentIds as unknown as FormAddressGroup['fields'],
            autocomplete: field.widget?.autocomplete !== false,
            map: field.widget?.map === true,
            boundary: field.widget?.boundary ?? 'off'
        });
    }

    return { fields: expanded, addressGroups };
}

const ATTACHMENT_REFERENCE_CUE_PATTERN = /\b(?:siehe|gem\.?|gemaess|gemäß)\s+(?:der\s+)?(?:anlage|beiblatt)\b|\bauf\s+(?:einem?\s+)?gesondert(?:em|en)?\s+(?:blatt|beiblatt)\b|\b(?:anlage|beiblatt|nachweis|unterlage|plan)\s+(?:ist\s+)?(?:beifuegen|beifügen|beizufuegen|beizufügen|vorlegen|vorzulegen|einreichen|einzureichen|nachreichen|nachzureichen)\b|\b(?:beifuegen|beifügen|beizufuegen|beizufügen|vorlegen|vorzulegen|einreichen|einzureichen|nachreichen|nachzureichen)\b/iu;
const REQUIRED_ATTACHMENT_CUE_PATTERN = /\b(?:beifuegen|beifügen|beizufuegen|beizufügen|vorlegen|vorzulegen|einreichen|einzureichen|nachreichen|nachzureichen|hinzufuegen|hinzufügen)\b/iu;
const ATTACHMENT_FILE_LABEL_PATTERN = /(?:anlage|beiblatt|plan|nachweis|unterlage)/iu;

function attachmentCueText(field: FormField): string {
    return [
        field.label,
        field.placeholder,
        ...(Array.isArray(field.options) ? field.options : [])
    ]
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .join(' ');
}

function isAttachmentReferenceCue(field: FormField): boolean {
    return field.type !== 'file' && ATTACHMENT_REFERENCE_CUE_PATTERN.test(attachmentCueText(field));
}

function attachmentRequirementIsMandatory(field: FormField): boolean {
    return REQUIRED_ATTACHMENT_CUE_PATTERN.test(attachmentCueText(field));
}

function attachmentLegalBasisForSection(section: FormSection): string | undefined {
    const context = [
        section.title,
        section.description,
        ...section.fields.flatMap(field => [field.label, field.placeholder])
    ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0).join(' ');
    const match = context.match(/\b(?:art\.?|§)\s*\d+[a-z]?(?:\s*abs\.\s*\d+[a-z]?)?(?:\s*satz\s*\d+)?\s*(?:baybo|bauo\s*[a-zäöü]+|lbo\s*[a-zäöü]+)\b/iu);
    return match?.[0]?.replace(/\s+/gu, ' ').trim();
}

function attachmentProfileForSection(
    section: FormSection,
    candidateAnalysis?: unknown
): FormAttachmentAnalysisProfile {
    const context = `${section.title} ${section.description || ''}`.toLowerCase();
    const isAbstandsflaechenplan = /abstandsfl[aä]chen/.test(context);
    const isAbstandsplan = !isAbstandsflaechenplan && /abst[aä]nde/.test(context);
    const legalBasis = attachmentLegalBasisForSection(section);
    const candidate = normalizeFormAttachmentAnalysisProfile(candidateAnalysis, 'file');
    // The built-in fallback text stays in promptSuggestion while the editor and
    // the chat still author that key; a fallback citizenPrompt would switch the
    // profile to story mode and silently ignore what the admin types. A
    // candidate that already carries citizenPrompt keeps it. staffPrompt and
    // redaction are never taken over: both need a human choice.
    const preserveSuggestedProfileAsDraft = (fallback: FormAttachmentAnalysisProfile): FormAttachmentAnalysisProfile => {
        const fallbackPrompt = candidate?.citizenPrompt ? undefined : fallback.promptSuggestion;
        const promptSuggestion = candidate?.promptSuggestion ?? fallbackPrompt;
        return {
            enabled: false,
            version: candidate?.version ?? fallback.version ?? 1,
            expectedDocumentType: candidate?.expectedDocumentType ?? fallback.expectedDocumentType,
            ...(promptSuggestion ? { promptSuggestion } : {}),
            ...(candidate?.citizenPrompt ? { citizenPrompt: candidate.citizenPrompt } : {}),
            resultSchema: candidate?.resultSchema ?? fallback.resultSchema,
            egressPolicy: 'no_ai'
        };
    };

    if (isAbstandsflaechenplan || isAbstandsplan) {
        const isFlachen = isAbstandsflaechenplan;
        return preserveSuggestedProfileAsDraft({
            version: 1,
            expectedDocumentType: `${isFlachen ? 'Abstandsflächenplan' : 'Abstandsplan'}${legalBasis ? ` nach ${legalBasis}` : ''}`,
            promptSuggestion: isFlachen
                ? `Prüfe, ob der Plan Grenzverlauf, Bestandsgebäude, geplante Gebäude, notwendige Abstandsflächen und den geforderten Maßstab enthält.${legalBasis ? ` Berücksichtige die im Formular genannte Rechtsgrundlage ${legalBasis}.` : ''}`
                : `Prüfe, ob der Plan Grenzverlauf, Bestandsgebäude, geplante Gebäude, notwendige Abstände und den geforderten Maßstab enthält.${legalBasis ? ` Berücksichtige die im Formular genannte Rechtsgrundlage ${legalBasis}.` : ''}`,
            resultSchema: {
                type: 'object',
                required: [
                    'grenzverlauf_dargestellt',
                    'bestandsgebaeude_dargestellt',
                    'geplante_gebaeude_dargestellt',
                    isFlachen ? 'notwendige_abstandsflaechen_dargestellt' : 'notwendige_abstaende_dargestellt',
                    'massstab'
                ],
                properties: {
                    grenzverlauf_dargestellt: { type: 'boolean', title: 'Grenzverlauf dargestellt / Plot boundary shown', nonPersonal: true },
                    bestandsgebaeude_dargestellt: { type: 'boolean', title: 'Bestandsgebäude dargestellt / Existing buildings shown', nonPersonal: true },
                    geplante_gebaeude_dargestellt: { type: 'boolean', title: 'Geplante Gebäude dargestellt / Planned buildings shown', nonPersonal: true },
                    [isFlachen ? 'notwendige_abstandsflaechen_dargestellt' : 'notwendige_abstaende_dargestellt']: {
                        type: 'boolean',
                        title: isFlachen
                            ? 'Notwendige Abstandsflächen dargestellt / Required setback areas shown'
                            : 'Notwendige Abstände dargestellt / Required distances shown',
                        nonPersonal: true
                    },
                    massstab: { type: 'boolean', title: 'Geforderter Maßstab erkennbar / Required scale shown', nonPersonal: true }
                }
            }
        });
    }

    return preserveSuggestedProfileAsDraft({
        version: 1,
        expectedDocumentType: 'Anlage',
        promptSuggestion: `Prüfe, ob die Anlage die im Abschnitt „${section.title || 'Formularangabe'}“ verlangten fachlichen Angaben enthält.`,
        resultSchema: {
            type: 'object',
            required: ['dokument_passt_zur_anforderung'],
            properties: {
                dokument_passt_zur_anforderung: { type: 'boolean', title: 'Anlage passt zur Anforderung / Attachment matches the requirement', nonPersonal: true }
            }
        }
    });
}

function attachmentFieldIdentity(section: FormSection, cue: FormField, usedIds: Set<string>): { id: string, label: string } {
    const context = `${section.title} ${section.description || ''}`.toLowerCase();
    if (/abstandsfl[aä]chen/.test(context)) {
        return {
            id: makeUniqueFieldId('abstandsflaechenplan', usedIds),
            label: 'Abstandsflächenplan hochladen'
        };
    }
    if (/abst[aä]nde/.test(context)) {
        return {
            id: makeUniqueFieldId('abstandsplan', usedIds),
            label: 'Abstandsplan hochladen'
        };
    }
    return {
        id: makeUniqueFieldId(`${normalizeIdToken(cue.id || cue.label) || 'anlage'}_datei`, usedIds),
        label: 'Anlage hochladen'
    };
}

function inferAttachmentRequirements(section: FormSection): FormSection {
    const cues = section.fields.filter(isAttachmentReferenceCue);
    const fields = section.fields.filter(field => !isAttachmentReferenceCue(field));
    const usedIds = new Set(fields.map(field => field.id).filter(Boolean));
    const usedFileIndexes = new Set<number>();
    const inferredAttachmentIds = new Set<string>();

    for (const cue of cues) {
        const existingIndex = fields.findIndex((field, index) =>
            !usedFileIndexes.has(index)
            && field.type === 'file'
            && (field.conditionalOn?.fieldId === cue.id || ATTACHMENT_FILE_LABEL_PATTERN.test(attachmentCueText(field)))
        );
        const required = attachmentRequirementIsMandatory(cue);

        if (existingIndex >= 0) {
            const existing = fields[existingIndex]!;
            usedFileIndexes.add(existingIndex);
            inferredAttachmentIds.add(existing.id);
            fields[existingIndex] = {
                ...existing,
                required: existing.required === true || required,
                conditionalOn: existing.conditionalOn?.fieldId === cue.id ? undefined : existing.conditionalOn
            };
            continue;
        }

        const identity = attachmentFieldIdentity(section, cue, usedIds);
        const inferred = normalizeFormField({
            id: identity.id,
            type: 'file',
            label: identity.label,
            required,
            ...(cue.semantics?.sourcePath ? { semantics: { sourcePath: cue.semantics.sourcePath } } : {})
        });
        inferredAttachmentIds.add(inferred.id);
        fields.push(inferred);
    }

    if (cues.length === 0 && !fields.some(field => field.type === 'file' && (
        ATTACHMENT_FILE_LABEL_PATTERN.test(attachmentCueText(field))
        || field.analysis !== undefined
    ))) {
        return section;
    }

    return {
        ...section,
        fields: fields.map(field => field.type === 'file'
          && (
              inferredAttachmentIds.has(field.id)
              || ATTACHMENT_FILE_LABEL_PATTERN.test(attachmentCueText(field))
              || field.analysis !== undefined
          )
            ? { ...field, analysis: attachmentProfileForSection(section, field.analysis) }
            : field)
    };
}

export function normalizeFormSchema(schema: Partial<FormSchema>, options: NormalizeFormSchemaOptions = {}): FormSchema {
    const normalized = {
        ...schema,
        title: String(schema.title ?? ''),
        sections: (Array.isArray(schema.sections) ? schema.sections : []).map((section) => {
            const normalizedFields = normalizeSectionFields(Array.isArray(section.fields) ? section.fields : [], options);
            const expanded = options.expandAddressFields
                ? expandLegacyAddressFields(normalizedFields)
                : { fields: normalizedFields, addressGroups: [] };
            const rawAddressGroups = [
                ...(Array.isArray(section.addressGroups) ? section.addressGroups : []),
                ...expanded.addressGroups
            ];
            return {
                ...section,
                id: String(section.id ?? ''),
                title: String(section.title ?? ''),
                i18n: normalizeI18nMap(section.i18n, ['title', 'description']),
                fields: expanded.fields,
                addressGroups: normalizeFormAddressGroups(rawAddressGroups, expanded.fields)
            };
        })
    } as FormSchema;
    if (options.inferAttachmentRequirements) {
        normalized.sections = normalized.sections.map(inferAttachmentRequirements);
    }
    normalized.i18n = normalizeI18nMap(schema.i18n, ['title', 'description']) as FormSchema['i18n'];
    normalized.contextSources = normalizeFormContextSources(schema.contextSources);
    normalized.precheckSchema = normalizeFormPrecheckSchema(schema.precheckSchema);
    if (normalized.precheckSchema) {
        const fieldsById = new Map(
            normalized.sections.flatMap(section => section.fields).map(field => [field.id, field])
        );
        normalized.precheckSchema = {
            version: 1,
            criteria: normalized.precheckSchema.criteria.map((criterion) => {
                const field = criterion.fieldId ? fieldsById.get(criterion.fieldId) : undefined;
                if (
                    criterion.reviewStatus !== 'approved'
                    || (
                        criterion.fieldId
                            ? field !== undefined && isPrecheckDialogueSafeField(field)
                            : criterion.privacy?.kind === 'not_personal'
                    )
                ) {
                    return criterion;
                }
                return { ...criterion, reviewStatus: 'suggested' };
            })
        };
    }

    return options.enforceMachineIds ? enforceSchemaMachineIds(normalized) : normalized;
}

export function parseStoredFormSchema(raw: string, id?: string, options?: Pick<NormalizeFormSchemaOptions, 'requireCurrencyMetadata'>): FormSchema {
    const schema = normalizeFormSchema(JSON.parse(raw) as FormSchema, options);
    if (id) {
        schema.id = id;
    }
    return schema;
}

export function localizedFormSchemaValue(i18n: unknown, key: string, locale: string): unknown {
    if (!i18n || typeof i18n !== 'object' || Array.isArray(i18n)) return undefined;
    const map = i18n as Record<string, unknown>;
    const current = String(locale || 'de').trim().toLowerCase();
    const base = current.split('-')[0] || current;
    const candidates = [...new Set([
        current,
        base,
        ...Object.keys(map)
            .map(candidate => candidate.toLowerCase())
            .filter(candidate => candidate.split('-')[0] === base)
    ].filter(Boolean))];

    for (const candidate of candidates) {
        const translationKey = Object.keys(map).find(candidateKey => candidateKey.toLowerCase() === candidate) ?? candidate;
        const translation = map[translationKey];
        if (translation && typeof translation === 'object' && !Array.isArray(translation) && Object.prototype.hasOwnProperty.call(translation, key)) {
            return (translation as Record<string, unknown>)[key];
        }
    }

    return undefined;
}

export function localizedFormSchemaString(i18n: unknown, key: string, locale: string, fallback?: string): string {
    const value = localizedFormSchemaValue(i18n, key, locale);
    return typeof value === 'string' && value.trim()
        ? value
        : fallback || '';
}

export function getLocalizedFormSchemaTitle(schema: Pick<FormSchema, 'title' | 'i18n'>, locale: string): string {
    return localizedFormSchemaString(schema.i18n, 'title', locale, schema.title);
}

export function getLocalizedFormSchemaDescription(schema: Pick<FormSchema, 'description' | 'i18n'>, locale: string): string | undefined {
    const description = localizedFormSchemaString(schema.i18n, 'description', locale, schema.description);
    return description.trim() || undefined;
}

export function getLocalizedFormSectionTitle(section: FormSchema['sections'][number], locale: string): string {
    return localizedFormSchemaString(section.i18n, 'title', locale, section.title);
}

export function getLocalizedFormSectionDescription(section: FormSchema['sections'][number], locale: string): string | undefined {
    const description = localizedFormSchemaString(section.i18n, 'description', locale, section.description);
    return description.trim() || undefined;
}

export function getLocalizedFormFieldLabel(field: FormField, locale: string, fallback?: string): string {
    return localizedFormSchemaString(field.i18n, 'label', locale, fallback ?? field.label);
}

export function getLocalizedFormFieldPlaceholder(field: FormField, locale: string): string | undefined {
    return localizedFormSchemaString(field.i18n, 'placeholder', locale, field.placeholder) || undefined;
}

export function getLocalizedFormFieldOptionLabel(field: FormField, option: string, index: number, locale: string): string {
    const options = localizedFormSchemaValue(field.i18n, 'options', locale);
    if (Array.isArray(options)) {
        const value = options[index];
        return typeof value === 'string' && value.trim() ? value : option;
    }
    if (options && typeof options === 'object') {
        const value = (options as Record<string, unknown>)[option];
        return typeof value === 'string' && value.trim() ? value : option;
    }
    return option;
}

export function getLocalizedFormFieldChoiceItems(field: FormField, locale: string): Array<{ label: string, value: string }> {
    return (field.options || []).map((option, index) => ({
        label: getLocalizedFormFieldOptionLabel(field, option, index, locale),
        value: option
    }));
}

export function getFieldInputMode(field: FormField): string | undefined {
    if (field.type === 'email') return 'email';
    if (field.type === 'tel') return 'tel';
    if (field.format === 'url') return 'url';
    if (field.type === 'number' || field.format === 'currency') return 'decimal';
    if (field.format === 'postal_code' || field.format === 'tax_id') return 'numeric';
    return undefined;
}

export function getFieldAutocomplete(field: FormField): string | undefined {
    switch (field.crm_key) {
        case 'person.full_name':
            return 'name';
        case 'person.first_name':
            return 'given-name';
        case 'person.last_name':
            return 'family-name';
        case 'person.birthdate':
            return 'bday';
        case 'person.street':
        case 'person.address':
            return 'street-address';
        case 'person.city':
            return 'address-level2';
        case 'person.postal_code':
            return 'postal-code';
        case 'person.phone':
            return 'tel';
        case 'person.email':
            return 'email';
        default:
            break;
    }

    if (field.type === 'email') return 'email';
    if (field.type === 'tel') return 'tel';
    if (field.format === 'postal_code') return 'postal-code';
    if (field.format === 'url') return 'url';
    return undefined;
}

/**
 * Whether a field still checks its format with the product's own rule.
 *
 * A message that names the rule ("5 Ziffern") is only true while the field
 * carries the default pattern of its format; a form that set its own pattern
 * gets the generic format message instead.
 */
export function fieldUsesDefaultFormatRule(field: Pick<FormField, 'format' | 'validation'>): boolean {
    if (!field.format) return false;
    const defaults = FIELD_FORMAT_DEFAULTS[field.format]?.validation;
    if (!defaults?.pattern) return false;
    return field.validation?.pattern === defaults.pattern
      && (field.validation.minLength ?? defaults.minLength) === defaults.minLength
      && (field.validation.maxLength ?? defaults.maxLength) === defaults.maxLength;
}

export function isFieldValueEmpty(value: unknown): boolean {
    if (value === undefined || value === null) return true;
    if (typeof value === 'string') return value.trim() === '';
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === 'boolean') return value === false;
    return false;
}

function isValidUrlFormat(value: string): boolean {
    const candidate = value.trim();
    if (!candidate || /\s/u.test(candidate)) return false;

    let parsed: URL;
    try {
        parsed = new URL(URL_SCHEME_PATTERN.test(candidate) ? candidate : `https://${candidate}`);
    } catch {
        return false;
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    if (parsed.username || parsed.password) return false;

    const hostname = parsed.hostname.replace(/\.$/u, '');
    const labels = hostname.split('.');
    if (labels.length < 2 || labels.some(label => !HOST_LABEL_PATTERN.test(label))) return false;

    if (parsed.port) {
        const port = Number(parsed.port);
        if (!Number.isInteger(port) || port < 1 || port > 65535) return false;
    }

    return true;
}

export function validateFormFieldValue(field: FormField, value: unknown, { localizedCurrency = false } = {}): FormFieldValidationIssue[] {
    const issues: FormFieldValidationIssue[] = [];

    if (field.type === 'address') {
        const normalized = normalizeFormAddressValue(value);
        if (!normalized) {
            if (field.required || isFieldValueEmpty(value)) {
                if (field.required) issues.push({ code: 'required' });
            } else {
                issues.push({ code: 'format' });
            }
        }
        return issues;
    }

    if (isFieldValueEmpty(value)) {
        if (field.required) {
            issues.push({ code: 'required' });
        }
        return issues;
    }

    const currency = localizedCurrency && isCurrencyField(field);
    if (currency) {
        const canonical = canonicalCurrencyAmount(value);
        if (canonical === null) return [{ code: 'number_format' }];
        value = canonical;
    }

    if (STRING_VALUE_FIELD_TYPES.has(field.type) && typeof value !== 'string') {
        issues.push({ code: 'format', format: field.format });
        return issues;
    }

    if (field.type === 'checkbox' && (!Array.isArray(field.options) || field.options.length === 0) && typeof value !== 'boolean') {
        issues.push({ code: 'format', format: field.format });
        return issues;
    }

    if (Array.isArray(field.options) && field.options.length > 0) {
        const allowed = new Set(field.options.map(String));
        if (field.type === 'checkbox') {
            if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !allowed.has(item))) {
                issues.push({ code: 'option' });
                return issues;
            }
        } else if ((field.type === 'select' || field.type === 'radio') && !allowed.has(String(value))) {
            issues.push({ code: 'option' });
            return issues;
        }
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();

        if (field.format === 'url' && !isValidUrlFormat(trimmed)) {
            issues.push({
                code: 'format',
                format: field.format
            });
            return issues;
        }
    }

    const validation = field.validation ?? (currency ? FIELD_FORMAT_DEFAULTS.currency.validation : undefined);
    if (!validation) {
        return issues;
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();

        if (validation.minLength !== undefined && trimmed.length < validation.minLength) {
            issues.push({ code: 'minLength', value: validation.minLength });
        }

        if (validation.maxLength !== undefined && trimmed.length > validation.maxLength) {
            issues.push({ code: 'maxLength', value: validation.maxLength });
        }

        if (validation.pattern) {
            if (!isSafeValidationPattern(validation.pattern)) {
                issues.push({
                    code: field.format ? 'format' : 'pattern',
                    format: field.format
                });
            } else {
                const regex = new RegExp(validation.pattern, 'u');
                if (!regex.test(trimmed)) {
                    issues.push({
                        code: field.format ? 'format' : 'pattern',
                        format: field.format
                    });
                }
            }
        }
    }

    if (currency && (typeof value === 'string' || typeof value === 'number')) {
        return [...issues, ...currencyConstraintIssues(value, validation)];
    }

    if (field.type === 'number') {
        const numericValue = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));

        if (!Number.isFinite(numericValue)) {
            issues.push({ code: 'format', format: field.format });
            return issues;
        }

        if (validation.min !== undefined && numericValue < validation.min) {
            issues.push({ code: 'min', value: validation.min });
        }

        if (validation.max !== undefined && numericValue > validation.max) {
            issues.push({ code: 'max', value: validation.max });
        }

        if (validation.step !== undefined && validation.step > 0) {
            const base = validation.min ?? 0;
            const remainder = Math.abs((numericValue - base) / validation.step);
            if (Math.abs(remainder - Math.round(remainder)) > 0.0000001) {
                issues.push({ code: 'step', value: validation.step });
            }
        }
    }

    return issues;
}

export { validateImportedFormSchema } from './form-schema/import-definition';
