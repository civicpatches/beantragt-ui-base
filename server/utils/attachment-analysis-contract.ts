import type { H3Event } from 'h3';
import type {
    FormAttachmentAnalysisEgressPolicy,
    FormAttachmentAnalysisModelClass,
    FormAttachmentAnalysisProfile,
    FormField
} from '~~/app/types/form';
import { scrubPii } from '#shared/pii-redaction';
import { attachmentAnalysisPrompts } from '~~/app/utils/attachment-analysis-prompts';
import { normalizeFormField } from '~~/app/utils/form-schema';
import { REDACTION_NOT_POSSIBLE } from './attachment-analysis-source';
import { drupalServiceFetch, drupalSessionFetch } from './auth';

const MAX_PROFILE_PROMPT_CHARS = 2000;
export type AttachmentAnalysisMediaType = 'application/pdf' | 'image/png' | 'image/jpeg';
export type AttachmentAnalysisSourceKind = 'original' | 'derivative';

export interface FormSchemaAnalysisResponse {
    data?: {
        attributes?: {
            field_schema?: string | { value?: string }
        }
        relationships?: Record<string, {
            data?: { id?: string, type?: string } | Array<{ id?: string, type?: string }> | null
        }>
    }
    included?: Array<{
        id?: string
        type?: string
        attributes?: {
            field_slug?: string | null
        }
        relationships?: Record<string, {
            data?: { id?: string, type?: string } | Array<{ id?: string, type?: string }> | null
        }>
    }>
}

export interface AttachmentAnalysisProfileContext {
    profile: FormAttachmentAnalysisProfile | null
    scope: {
        jurisdictionSlug: string | null
        organisationSlug: string | null
    }
}

export interface AttachmentAnalysisDispatchPolicy {
    configured: boolean
    transferBytes: boolean
    redaction: FormAttachmentAnalysisProfile['redaction']
    requiresCitizenConsent: boolean
    /** citizenPrompt or staffPrompt set: story A needs a Drupal run id. */
    storyMode: boolean
    egressPolicy: FormAttachmentAnalysisEgressPolicy
    scope: AttachmentAnalysisProfileContext['scope']
}

function isObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function citizenAnalysisCriteria(value: unknown): Array<{ label: string, status: string }> | undefined {
    if (!Array.isArray(value)) return undefined;
    const criteria = value.flatMap((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
        const criterion = item as Record<string, unknown>;
        const status = typeof criterion.status === 'string'
          && ['confirmed', 'missing', 'unclear'].includes(criterion.status)
            ? criterion.status
            : '';
        const label = typeof criterion.label === 'string'
            ? scrubPii(criterion.label.trim().slice(0, 160)).text.trim()
            : '';
        return status && label ? [{ label, status }] : [];
    }).slice(0, 12);
    return criteria.length > 0 ? criteria : undefined;
}

/**
 * Facts about the checked source the applicant may see: only part of a long
 * PDF was checked, or a scan went unredacted and needs a human look.
 */
const CITIZEN_ANALYSIS_NOTICES: ReadonlySet<string> = new Set(['pages_truncated', 'unredacted_scan']);

/**
 * Reduces an internal analysis result to the citizen-facing contract.
 */
export function citizenAttachmentAnalysisResult(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const result = value as Record<string, unknown>;
    const outcome = typeof result.outcome === 'string' && ['pass', 'needs_review', 'fail', 'unknown'].includes(result.outcome)
        ? result.outcome
        : undefined;
    const documentType = typeof result.documentType === 'string'
        ? scrubPii(result.documentType.trim().slice(0, 500)).text.trim()
        : '';
    const criteria = citizenAnalysisCriteria(result.criteria);
    // Fixed tokens only; the texts live in i18n.
    const isNotice = (notice: unknown): notice is string =>
        typeof notice === 'string' && CITIZEN_ANALYSIS_NOTICES.has(notice);
    const notices = Array.isArray(result.notices) ? [...new Set(result.notices.filter(isNotice))] : [];
    const pagesChecked = typeof result.pagesChecked === 'number'
      && Number.isInteger(result.pagesChecked)
      && result.pagesChecked > 0
        ? Math.min(result.pagesChecked, 99)
        : undefined;
    const response = {
        ...(outcome ? { outcome } : {}),
        ...(documentType ? { documentType } : {}),
        ...(documentType && result.documentTypeLanguage === 'de' ? { documentTypeLanguage: 'de' } : {}),
        ...(criteria ? { criteria } : {}),
        ...(notices.length > 0 ? { notices } : {}),
        ...(pagesChecked === undefined ? {} : { pagesChecked })
    };
    return Object.keys(response).length > 0 ? response : undefined;
}

/**
 * Maps internal analysis failures to a stable citizen-facing code.
 */
export function citizenAttachmentAnalysisCode(status: string, code: string | undefined): string {
    if (status === REDACTION_NOT_POSSIBLE.status) return REDACTION_NOT_POSSIBLE.code;
    if (status === 'skipped' && code === 'analysis_after_submit') return code;
    if (status === 'failed' && code === 'guard_unavailable') return code;
    if (code === 'consent_required') return code;
    // Still running on the server: the form polls, nothing failed.
    if (status === 'pending') return 'analysis_pending';
    if (status === 'complete' && code === 'analysis_complete') return code;
    return 'analysis_unavailable';
}

function configuredText(value: unknown, maxLength = 500): string {
    if (typeof value !== 'string') return '';
    return value.trim().slice(0, maxLength);
}

function scrubbedConfiguredText(value: unknown, maxLength = 500): string | undefined {
    const scrubbed = scrubPii(configuredText(value, maxLength)).text.trim();
    return scrubbed || undefined;
}

function fieldSchemaText(raw: unknown): string {
    if (typeof raw === 'string') return raw;
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && typeof (raw as { value?: unknown }).value === 'string') {
        return (raw as { value: string }).value;
    }
    return '';
}

function normalizeSlug(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const slug = value.trim().toLowerCase();
    return /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/.test(slug) ? slug : null;
}

/**
 * The runtime's view of a field's analysis profile: what every run reads.
 * The disclosure uses the same normaliser, so it judges the same input.
 */
export function normalizeAnalysisProfile(value: unknown): FormAttachmentAnalysisProfile | null {
    if (!isObject(value) || value.enabled !== true) return null;
    const egressPolicy = typeof value.egressPolicy === 'string'
        ? value.egressPolicy as FormAttachmentAnalysisEgressPolicy
        : 'no_ai';
    if (!['no_ai', 'local_only', 'sovereign_only', 'external_redacted', 'external_allowed'].includes(egressPolicy)) {
        return null;
    }
    const modelClass = typeof value.modelClass === 'string' && [
        'local_ocr',
        'local_vision',
        'ollama',
        'openai_compatible',
        'openai',
        'claude_sonnet'
    ].includes(value.modelClass)
        ? value.modelClass as FormAttachmentAnalysisModelClass
        : undefined;

    return {
        enabled: true,
        version: typeof value.version === 'number' && Number.isInteger(value.version) && value.version > 0 ? value.version : 1,
        expectedDocumentType: scrubbedConfiguredText(value.expectedDocumentType),
        promptSuggestion: scrubbedConfiguredText(value.promptSuggestion, MAX_PROFILE_PROMPT_CHARS),
        citizenPrompt: scrubbedConfiguredText(value.citizenPrompt, MAX_PROFILE_PROMPT_CHARS),
        staffPrompt: scrubbedConfiguredText(value.staffPrompt, MAX_PROFILE_PROMPT_CHARS),
        // The one runtime default: a profile without the key runs unredacted
        // as before. It only ever acts under sovereign_only or local_only.
        redaction: value.redaction === 'when_possible' ? 'when_possible' : 'none',
        resultSchema: isObject(value.resultSchema) ? value.resultSchema : undefined,
        egressPolicy,
        modelClass
    };
}

/**
 * Normalises one stored schema field like the runtime does before it reads
 * the analysis profile: the field first, then its profile. Not a file field
 * means no profile.
 */
export function attachmentAnalysisProfileForField(value: unknown): FormAttachmentAnalysisProfile | null {
    if (!isObject(value) || value.type !== 'file') return null;
    return normalizeAnalysisProfile(normalizeFormField(value as Partial<FormField>).analysis);
}

function findFileField(schemaText: string, fieldId: string): FormField | null {
    try {
        const schema = JSON.parse(schemaText) as { sections?: unknown };
        const sections = Array.isArray(schema.sections) ? schema.sections : [];
        for (const section of sections) {
            if (!isObject(section) || !Array.isArray(section.fields)) continue;
            for (const field of section.fields) {
                if (!isObject(field) || field.id !== fieldId || field.type !== 'file') continue;
                return {
                    ...normalizeFormField(field as Partial<FormField>),
                    id: fieldId
                };
            }
        }
    } catch {
        return null;
    }
    return null;
}

function relationshipData(
    response: FormSchemaAnalysisResponse,
    fieldName: string
): { id?: string, type?: string } | null {
    const rel = response.data?.relationships?.[fieldName]?.data;
    if (!rel || Array.isArray(rel)) return null;
    return rel;
}

function relationshipId(
    item: NonNullable<FormSchemaAnalysisResponse['included']>[number] | undefined,
    fieldName: string
): string | null {
    const rel = item?.relationships?.[fieldName]?.data;
    return rel && !Array.isArray(rel) && typeof rel.id === 'string' ? rel.id : null;
}

function includedById(response: FormSchemaAnalysisResponse): Map<string, NonNullable<FormSchemaAnalysisResponse['included']>[number]> {
    const map = new Map<string, NonNullable<FormSchemaAnalysisResponse['included']>[number]>();
    for (const item of response.included || []) {
        if (item.id) map.set(item.id, item);
    }
    return map;
}

function groupSlug(item: NonNullable<FormSchemaAnalysisResponse['included']>[number] | undefined): string | null {
    return normalizeSlug(item?.attributes?.field_slug);
}

/**
 * Tenant scope of a form schema JSON:API response (jurisdiction and
 * organisation slugs), as the runtime uses it for policy and overrides.
 */
export function attachmentAnalysisScopeFromSchemaResponse(response: FormSchemaAnalysisResponse): AttachmentAnalysisProfileContext['scope'] {
    const groups = includedById(response);
    const directJurisdiction = relationshipData(response, 'field_jurisdiction');
    const directOrganisation = relationshipData(response, 'field_organisation');
    const legacyGroup = relationshipData(response, 'field_group');
    const organisationGroup = directOrganisation?.id ? groups.get(directOrganisation.id) : undefined;
    const organisationJurisdiction = organisationGroup?.relationships?.field_jurisdiction?.data;
    const parentJurisdiction = organisationJurisdiction && !Array.isArray(organisationJurisdiction)
        ? groups.get(organisationJurisdiction.id || '')
        : undefined;
    const jurisdictionGroup = directJurisdiction?.id ? groups.get(directJurisdiction.id) : undefined;
    const legacyGroupEntity = legacyGroup?.id ? groups.get(legacyGroup.id) : undefined;
    const legacyGroupType = legacyGroup?.type || legacyGroupEntity?.type || '';
    const legacyParentJurisdiction = relationshipId(legacyGroupEntity, 'field_jurisdiction');
    const legacyParentJurisdictionGroup = legacyParentJurisdiction ? groups.get(legacyParentJurisdiction) : undefined;

    return {
        jurisdictionSlug: groupSlug(jurisdictionGroup)
          || groupSlug(parentJurisdiction)
          || (legacyGroupType === 'group--jur' ? groupSlug(legacyGroupEntity) : null)
          || groupSlug(legacyParentJurisdictionGroup),
        organisationSlug: groupSlug(organisationGroup)
          || (legacyGroupType === 'group--org' ? groupSlug(legacyGroupEntity) : null)
    };
}

function formSchemaAnalysisPath(formId: string): string {
    const query = new URLSearchParams({
        'fields[form_schema--form_schema]': 'field_schema,field_jurisdiction,field_organisation,field_group',
        'fields[group--jur]': 'field_slug',
        'fields[group--org]': 'field_slug,field_jurisdiction',
        'include': 'field_jurisdiction,field_organisation,field_organisation.field_jurisdiction,field_group,field_group.field_jurisdiction'
    });
    return `/jsonapi/form_schema/form_schema/${encodeURIComponent(formId)}?${query.toString()}`;
}

async function fetchFormSchemaAnalysisResponse(formId: string): Promise<FormSchemaAnalysisResponse> {
    return await drupalServiceFetch<FormSchemaAnalysisResponse>(formSchemaAnalysisPath(formId));
}

/** Tenant scope a run of this form uses, loaded the way the run loads it. */
export async function loadAttachmentAnalysisScope(formId: string): Promise<AttachmentAnalysisProfileContext['scope']> {
    return attachmentAnalysisScopeFromSchemaResponse(await fetchFormSchemaAnalysisResponse(formId));
}

/**
 * The same tenant scope, read with the staff session. Drafts are outside the
 * service account's entity scope (Drupal answers 403), and authors only ever
 * edit drafts, so the form editor must not use the service account here.
 */
export async function loadAttachmentAnalysisScopeForSession(
    event: H3Event,
    formId: string
): Promise<AttachmentAnalysisProfileContext['scope']> {
    return attachmentAnalysisScopeFromSchemaResponse(
        await drupalSessionFetch<FormSchemaAnalysisResponse>(event, formSchemaAnalysisPath(formId))
    );
}

export async function loadAttachmentAnalysisProfile(
    formId: string,
    fieldId: string
): Promise<AttachmentAnalysisProfileContext> {
    const response = await fetchFormSchemaAnalysisResponse(formId);
    const field = findFileField(fieldSchemaText(response.data?.attributes?.field_schema), fieldId);
    return {
        profile: normalizeAnalysisProfile(field?.analysis),
        scope: attachmentAnalysisScopeFromSchemaResponse(response)
    };
}

/**
 * Resolves whether this field's active profile needs an attachment-specific
 * citizen opt-in before a caller reads or forwards the file bytes.
 */
export async function requiresCitizenAttachmentAnalysisConsent(formId: string, fieldId: string): Promise<boolean> {
    const { profile } = await loadAttachmentAnalysisProfile(formId, fieldId);
    return profile?.egressPolicy === 'external_allowed';
}

/**
 * Resolves the pre-transfer decision without importing provider, prompt or
 * analysis-pipeline code into Layers 2 or 3. Layer 4 repeats the profile check
 * after the HTTP boundary and remains authoritative.
 */
export async function resolveAttachmentAnalysisDispatchPolicy(
    formId: string,
    fieldId: string
): Promise<AttachmentAnalysisDispatchPolicy> {
    const { profile, scope } = await loadAttachmentAnalysisProfile(formId, fieldId);
    if (!profile) {
        return {
            configured: false,
            transferBytes: false,
            redaction: 'none',
            requiresCitizenConsent: false,
            storyMode: false,
            egressPolicy: 'no_ai',
            scope
        };
    }
    const requiresCitizenConsent = profile.egressPolicy === 'external_allowed';
    const transferBytes = profile.egressPolicy !== 'no_ai'
      && profile.egressPolicy !== 'local_only'
      && profile.modelClass !== 'local_ocr'
      && profile.modelClass !== 'local_vision'
      && Boolean(profile.modelClass);
    return {
        configured: true,
        transferBytes,
        redaction: profile.redaction,
        requiresCitizenConsent,
        storyMode: attachmentAnalysisPrompts(profile).mode === 'story',
        // Ohne explizite Policy verhaelt sich das Profil an allen
        // Vergleichsstellen wie nicht-extern; 'no_ai' bildet das typsicher ab.
        egressPolicy: profile.egressPolicy ?? 'no_ai',
        scope
    };
}

export function normalizeAttachmentAnalysisMediaType(value: unknown, filename = ''): AttachmentAnalysisMediaType | null {
    const mime = typeof value === 'string' ? value.toLowerCase() : '';
    if (mime === 'application/pdf' || mime === 'image/png' || mime === 'image/jpeg') return mime;
    const ext = filename.split('.').pop()?.toLowerCase();
    if (ext === 'pdf') return 'application/pdf';
    if (ext === 'png') return 'image/png';
    if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
    return null;
}
