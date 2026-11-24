/**
 * Pure result rules of the attachment analysis: which result-schema keys a
 * story may see, how a model answer becomes a bounded result, and how the
 * applicant's view (criteria, missing hints, document type) is derived from
 * the profile. No provider, prompt or persistence code lives here, so the
 * citizen poll route may rebuild the same view from a persisted story A
 * result that the upload response showed right away.
 */
import type { FormAttachmentAnalysisProfile } from '~~/app/types/form';
import { scrubPii } from '#shared/pii-redaction';
import { hasUnsafeDocumentFactSignal, hasUnsafeExtractionSignal } from './attachment-extraction-terms';

type AttachmentAnalysisLanguage = 'de' | 'en';

/**
 * Which check a run performs. 'legacy' is today's single run of a profile
 * without citizenPrompt/staffPrompt. In story mode 'citizen' (story A) may
 * only see and return nonPersonal facts, 'staff' (story B) only purposeBound
 * values. Story B runs only when Drupal's queue asks for it after the claim,
 * and only under sovereign_only or local_only.
 */
export type AttachmentAnalysisStory = 'legacy' | 'citizen' | 'staff';

interface ExtractedFieldDefinition {
    key: string
    label?: string
    type?: string
    /**
     * Personal value released for staff only (for example the gross pay on a
     * payslip). Accepted only when the profile keeps the attachment with the
     * operator or a sovereign processor; never shown to the applicant.
     */
    purposeBound?: true
}

/** Egress policies under which purpose-bound personal values may be read. */
const PURPOSE_BOUND_EGRESS_POLICIES: readonly string[] = ['sovereign_only', 'local_only'];

interface ExtractedFieldItem {
    key: string
    label?: string
    value: number | boolean | null
    type?: string
}

interface CitizenAnalysisCriterion {
    key: string
    label: string
    status: 'confirmed' | 'missing' | 'unclear'
}

const MAX_EXTRACTED_ITEMS = 20;
const MAX_EXTRACTED_KEY_LENGTH = 80;
const MAX_EXTRACTED_LABEL_LENGTH = 160;
const MAX_RESULT_LIST_ITEMS = 12;
const DEFAULT_ENGLISH_CRITERION_LABELS: Readonly<Record<string, string>> = {
    boundary_shown: 'Plot boundary shown',
    grenzverlauf_dargestellt: 'Plot boundary shown',
    existing_buildings_shown: 'Existing buildings shown',
    bestandsgebaeude_dargestellt: 'Existing buildings shown',
    planned_buildings_shown: 'Planned buildings shown',
    geplante_gebaeude_dargestellt: 'Planned buildings shown',
    setback_areas_shown: 'Required setback areas shown',
    notwendige_abstandsflaechen_dargestellt: 'Required setback areas shown',
    required_distances_shown: 'Required distances shown',
    notwendige_abstaende_dargestellt: 'Required distances shown',
    scale_shown: 'Required scale visible',
    massstab: 'Required scale visible',
    designer_signature_shown: 'Designer signature visible',
    dokument_passt_zur_anforderung: 'Attachment matches the stated requirement'
};

function isObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function configuredText(value: unknown, maxLength = 500): string {
    if (typeof value !== 'string') return '';
    return value.trim().slice(0, maxLength);
}

function scrubbedConfiguredText(value: unknown, maxLength = 500): string | undefined {
    const scrubbed = scrubPii(configuredText(value, maxLength)).text.trim();
    return scrubbed || undefined;
}

function normalizedExtractionKey(value: unknown): string {
    if (typeof value !== 'string') return '';
    const normalized = value.trim().slice(0, MAX_EXTRACTED_KEY_LENGTH);
    return /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(normalized) ? normalized : '';
}

function normalizedExtractionLabel(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const normalized = value.trim().slice(0, MAX_EXTRACTED_LABEL_LENGTH);
    const scrubbed = scrubPii(normalized).text.trim();
    return scrubbed || undefined;
}

function normalizedExtractionType(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const normalized = value.trim().slice(0, 40);
    return ['boolean', 'number', 'integer'].includes(normalized) ? normalized : undefined;
}

function isNonPersonalExtractionDefinition(value: Record<string, unknown>): boolean {
    return value.nonPersonal === true || value.xBeantragtNonPersonal === true;
}

function isPurposeBoundExtractionDefinition(value: Record<string, unknown>, egressPolicy: string | undefined): boolean {
    return value.purposeBound === true
      && !isNonPersonalExtractionDefinition(value)
      && PURPOSE_BOUND_EGRESS_POLICIES.includes(egressPolicy ?? '');
}

/**
 * Story filter on a single definition. 'citizen' never admits a value
 * declared purposeBound, whatever the policy; 'staff' admits only those;
 * 'legacy' keeps today's mixed set.
 */
function admittedForStory(purposeBound: boolean, story: AttachmentAnalysisStory): boolean {
    if (story === 'citizen') return !purposeBound;
    if (story === 'staff') return purposeBound;
    return true;
}

/**
 * A non-personal yes/no fact about the document may name a signature
 * ("signature_present"); every value, and every purpose-bound definition,
 * gets the full term list.
 */
function hasUnsafeTermFor(purposeBound: boolean, type: string, key: string, label: string | undefined): boolean {
    return !purposeBound && type === 'boolean'
        ? hasUnsafeDocumentFactSignal(key, label, type)
        : hasUnsafeExtractionSignal(key, label, type);
}

export function extractionDefinitionsFromSchema(
    schema: unknown,
    egressPolicy?: string,
    story: AttachmentAnalysisStory = 'legacy'
): Map<string, ExtractedFieldDefinition> {
    const definitions = new Map<string, ExtractedFieldDefinition>();
    if (!isObject(schema)) return definitions;

    const properties = isObject(schema.properties) ? schema.properties : null;
    if (properties) {
        for (const [rawKey, rawDefinition] of Object.entries(properties)) {
            const key = normalizedExtractionKey(rawKey);
            if (!key) continue;
            const definition = isObject(rawDefinition) ? rawDefinition : {};
            const purposeBound = isPurposeBoundExtractionDefinition(definition, egressPolicy);
            // A value declared purpose-bound is personal: when the policy does
            // not allow it, it is skipped, never read as a non-personal fact.
            if (definition.purposeBound === true && !purposeBound) continue;
            if (!purposeBound && !isNonPersonalExtractionDefinition(definition)) continue;
            if (!admittedForStory(definition.purposeBound === true, story)) continue;
            const label = normalizedExtractionLabel(definition.label) || normalizedExtractionLabel(definition.title);
            const type = normalizedExtractionType(definition.type);
            // The unsafe-term list also guards purpose-bound values: an amount
            // may be read, identifiers such as tax ID or IBAN never.
            if (!type || hasUnsafeTermFor(purposeBound, type, key, label)) continue;
            definitions.set(key, {
                key,
                label,
                type,
                ...(purposeBound ? { purposeBound: true as const } : {})
            });
            if (definitions.size >= MAX_EXTRACTED_ITEMS) break;
        }
    }

    const fields = Array.isArray(schema.fields) ? schema.fields : [];
    for (const field of fields) {
        if (!isObject(field)) continue;
        const purposeBound = isPurposeBoundExtractionDefinition(field, egressPolicy);
        if (field.purposeBound === true && !purposeBound) continue;
        if (!purposeBound && !isNonPersonalExtractionDefinition(field)) continue;
        if (!admittedForStory(field.purposeBound === true, story)) continue;
        const key = normalizedExtractionKey(field.key) || normalizedExtractionKey(field.id) || normalizedExtractionKey(field.name);
        if (!key || definitions.has(key)) continue;
        const label = normalizedExtractionLabel(field.label) || normalizedExtractionLabel(field.title);
        const type = normalizedExtractionType(field.type);
        if (!type || hasUnsafeTermFor(purposeBound, type, key, label)) continue;
        definitions.set(key, {
            key,
            label,
            type,
            ...(purposeBound ? { purposeBound: true as const } : {})
        });
        if (definitions.size >= MAX_EXTRACTED_ITEMS) break;
    }

    return definitions;
}

export function requiredResultSchemaKeys(
    schema: unknown,
    definitions = extractionDefinitionsFromSchema(schema),
    story: AttachmentAnalysisStory = 'legacy'
): string[] {
    // Story B only reads values for staff: nothing in it can pass or fail the
    // attachment, so its outcome stays 'unknown'.
    if (story === 'staff') return [];
    if (!isObject(schema) || !Array.isArray(schema.required)) return [];
    const keys: string[] = [];
    for (const rawKey of schema.required) {
        const key = normalizedExtractionKey(rawKey);
        // Purpose-bound values are staff-only: they never drive the outcome or
        // the missing-evidence hints the applicant sees.
        if (!key || !definitions.has(key) || definitions.get(key)?.purposeBound || keys.includes(key)) continue;
        keys.push(key);
        if (keys.length >= MAX_EXTRACTED_ITEMS) break;
    }
    return keys;
}

function normalizeExtractedScalar(
    value: unknown,
    definition: ExtractedFieldDefinition
): Pick<ExtractedFieldItem, 'value'> | null {
    if (value === null) return { value: null };
    if (definition.type === 'boolean') {
        return typeof value === 'boolean' ? { value } : null;
    }
    if (definition.type === 'number' || definition.type === 'integer') {
        if (typeof value !== 'number' || !Number.isFinite(value)) return null;
        if (definition.type === 'integer' && !Number.isInteger(value)) return null;
        return { value };
    }
    return null;
}

function normalizeExtractedFields(
    value: unknown,
    resultSchema: unknown,
    egressPolicy?: string,
    story: AttachmentAnalysisStory = 'legacy'
): ExtractedFieldItem[] {
    if (!isObject(value)) return [];
    const definitions = extractionDefinitionsFromSchema(resultSchema, egressPolicy, story);
    if (definitions.size === 0) return [];
    const allowlist = new Set(definitions.keys());
    const items: ExtractedFieldItem[] = [];

    for (const [rawKey, rawValue] of Object.entries(value)) {
        const key = normalizedExtractionKey(rawKey);
        if (!key || !allowlist.has(key)) continue;
        const definition = definitions.get(key);
        if (!definition?.type) continue;
        const normalizedValue = normalizeExtractedScalar(rawValue, definition);
        if (!normalizedValue) continue;
        items.push({
            key,
            ...(definition?.label ? { label: definition.label } : {}),
            ...(definition?.type ? { type: definition.type } : {}),
            ...normalizedValue
        });
        if (items.length >= MAX_EXTRACTED_ITEMS) break;
    }

    return items;
}

function localizedCriterionLabel(
    key: string,
    configuredLabel: string,
    language: AttachmentAnalysisLanguage,
    fallbackNumber: number
): string {
    const bilingualLabels = configuredLabel.split(/\s+\/\s+/u);
    if (language === 'de') return bilingualLabels[0] || configuredLabel;
    if (bilingualLabels.length > 1) return bilingualLabels.at(-1) || configuredLabel;
    return DEFAULT_ENGLISH_CRITERION_LABELS[key] || `Required document criterion ${fallbackNumber}`;
}

function schemaDerivedCriteria(
    definitions: Map<string, ExtractedFieldDefinition>,
    extracted: ExtractedFieldItem[],
    language: AttachmentAnalysisLanguage,
    missingKeys: string[]
): CitizenAnalysisCriterion[] {
    const extractedByKey = new Map(extracted.map(item => [item.key, item]));
    const criteria: CitizenAnalysisCriterion[] = [];

    for (const [key, definition] of definitions) {
        if (definition.purposeBound || (definition.type !== 'boolean' && !missingKeys.includes(key))) continue;
        const configuredLabel = scrubPii(definition.label || key).text.trim() || key;
        const value = extractedByKey.get(key)?.value;
        criteria.push({
            key,
            label: localizedCriterionLabel(key, configuredLabel, language, criteria.length + 1),
            status: value === true ? 'confirmed' : value === false ? 'missing' : 'unclear'
        });
        if (criteria.length >= MAX_RESULT_LIST_ITEMS) break;
    }

    return criteria;
}

function localizedExpectedDocumentType(
    profile: FormAttachmentAnalysisProfile,
    language: AttachmentAnalysisLanguage
): { documentType?: string, documentTypeLanguage?: AttachmentAnalysisLanguage } {
    const configured = scrubbedConfiguredText(profile.expectedDocumentType);
    if (!configured) return {};
    const variants = configured.split(/\s+\/\s+/u);
    if (language === 'en' && variants.length === 1) {
        return { documentType: configured, documentTypeLanguage: 'de' };
    }
    return { documentType: (language === 'en' ? variants.at(-1) : variants[0]) || configured };
}

export function normalizeAnalysisResult(
    value: unknown,
    profile: FormAttachmentAnalysisProfile,
    language: AttachmentAnalysisLanguage,
    story: AttachmentAnalysisStory = 'legacy'
): Record<string, unknown> {
    const source = isObject(value) ? value : {};
    const confidence = story === 'staff' && typeof source.confidence === 'number' && Number.isFinite(source.confidence)
        ? Math.min(Math.max(source.confidence, 0), 1)
        : null;
    const extracted = normalizeExtractedFields(source.extracted, profile.resultSchema, profile.egressPolicy, story);
    const definitions = extractionDefinitionsFromSchema(profile.resultSchema, profile.egressPolicy, story);
    const required = requiredResultSchemaKeys(profile.resultSchema, definitions, story);
    const evidenced = new Set(extracted.filter(item => item.value !== false && item.value !== null).map(item => item.key));
    const missingKeys = required.filter(key => !evidenced.has(key));
    const criteria = schemaDerivedCriteria(definitions, extracted, language, missingKeys);
    // A missing or unreadable criterion alone cannot establish a different document type.
    const differentType = story !== 'staff' && profile.expectedDocumentType?.trim() && source.differentDocumentTypeVisible === true;
    let outcome = required.length ? 'pass' : 'unknown';
    if (missingKeys.length) outcome = 'needs_review';
    if (differentType) outcome = 'fail';
    return {
        outcome,
        ...localizedExpectedDocumentType(profile, language),
        missingCount: missingKeys.length,
        ...(missingKeys.length > 0 ? { missingKeys } : {}),
        ...(criteria.length > 0 ? { criteria } : {}),
        ...(extracted.length > 0 ? { extracted } : {}),
        ...(confidence === null ? {} : { confidence })
    };
}

/** Notices the applicant may see about the checked source. */
const CITIZEN_NOTICES: readonly string[] = ['pages_truncated', 'unredacted_scan'];

/**
 * Rebuilds the applicant's view of a persisted story A result.
 *
 * Drupal stores only bounded facts (outcome, missingKeys, the nonPersonal
 * yes/no values, notices, pagesChecked). Criteria, missing hints and the
 * document type are derived from the current profile with the same rules the
 * upload response used, always as story A: a purpose-bound key never turns
 * into a criterion, a hint or a value, whatever the stored record holds. The
 * stored outcome and missingKeys stay authoritative (the outcome already
 * carries the notice cap).
 * The caller still passes the result through citizenAttachmentAnalysisResult.
 */
export function citizenViewOfPersistedResult(
    profile: FormAttachmentAnalysisProfile,
    persisted: unknown,
    language: AttachmentAnalysisLanguage
): Record<string, unknown> {
    const source = isObject(persisted) ? persisted : {};
    const definitions = extractionDefinitionsFromSchema(profile.resultSchema, profile.egressPolicy, 'citizen');
    const extracted: ExtractedFieldItem[] = [];
    for (const item of Array.isArray(source.extracted) ? source.extracted : []) {
        if (!isObject(item)) continue;
        const key = normalizedExtractionKey(item.key);
        const definition = key ? definitions.get(key) : undefined;
        if (!definition || definition.purposeBound || definition.type !== 'boolean') continue;
        const normalizedValue = normalizeExtractedScalar(item.value, definition);
        if (!normalizedValue) continue;
        extracted.push({ key, ...(definition.label ? { label: definition.label } : {}), type: definition.type, ...normalizedValue });
    }
    // Drupal keeps booleans and the keys of missing required facts. Recover
    // numeric omissions from those keys without exposing the values themselves.
    const storedMissing = new Set(Array.isArray(source.missingKeys) ? source.missingKeys : []);
    const missingKeys = requiredResultSchemaKeys(profile.resultSchema, definitions, 'citizen').filter(key => storedMissing.has(key));
    const criteria = schemaDerivedCriteria(definitions, extracted, language, missingKeys);
    const outcome = typeof source.outcome === 'string' && ['pass', 'needs_review', 'fail', 'unknown'].includes(source.outcome)
        ? source.outcome
        : 'unknown';
    const notices = Array.isArray(source.notices)
        ? [...new Set(source.notices.filter((notice): notice is string => typeof notice === 'string' && CITIZEN_NOTICES.includes(notice)))]
        : [];
    return {
        outcome: notices.length > 0 && outcome === 'pass' ? 'needs_review' : outcome,
        ...localizedExpectedDocumentType(profile, language),
        ...(criteria.length > 0 ? { criteria } : {}),
        ...(notices.length > 0 ? { notices } : {}),
        ...(typeof source.pagesChecked === 'number' && Number.isInteger(source.pagesChecked) && source.pagesChecked > 0
            ? { pagesChecked: source.pagesChecked }
            : {})
    };
}
