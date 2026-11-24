/**
 * GET /api/schema/:id
 *
 * Proxies form_schema loading from Drupal JSON:API.
 * This avoids CORS issues when the browser fetches directly from Drupal.
 */

import { shouldIncludeDraftSchemas } from '../../utils/schema-catalog';
import { publicFieldDefault } from '../../utils/public-field-default';
import type { PublicWorkspace } from '../../utils/public-workspace';
import { resolvePublicWorkspaceBySlugs } from '../../utils/public-workspace';
import { checkRateLimit, getClientIp } from '../../utils/rate-limit';
import { setPrivateNoStore } from '../../utils/request-security';
import { parseProfileConsentOffers } from '../../utils/profile-consent-offer';
import type { PublicAttachmentAnalysisDisclosure } from '~~/app/types/form';
import { isSensitiveFlag } from '~~/app/utils/form-schema';
import { profilePropertyForPrefillField } from '~~/app/utils/profile-prefill';
import { publicConditionValue } from '~~/app/utils/form-condition-value';
import { normalizeDeliveryOffer } from '~~/app/utils/delivery-offer';
import type { PublicSchemaDeliveryOffer } from '~~/app/types/delivery';
import { applyPublicSchemaExtension } from '../../utils/public-schema-extension';
import { numberValue, publicI18nText, stringArrayValue, stringValue, type JsonObject } from '../../utils/public-schema-values';
import {
    attachmentAnalysisProfileForField,
    attachmentAnalysisScopeFromSchemaResponse,
    type AttachmentAnalysisProfileContext,
    type FormSchemaAnalysisResponse
} from '../../utils/attachment-analysis-contract';
import {
    attachmentAnalysisDisclosure,
    publicAttachmentAnalysisDisclosure
} from '../../utils/attachment-analysis-disclosure';

interface PublicSchemaResource {
    type?: string
    id?: string
    attributes?: {
        label?: string
        field_description?: string | { value?: string }
        field_schema?: string | { value?: string }
        field_workflow_status?: string
        field_publication_scope?: string
        field_profile_consent_offer?: string | null
        /** Computed JSON string `{"configured":false}` or `{"configured":true,"routes":[...],"default":"..."}`. */
        field_delivery_offer?: string | { value?: string | null } | null
    }
    relationships?: {
        field_jurisdiction?: JsonApiRelationship
        field_organisation?: JsonApiRelationship
        field_group?: JsonApiRelationship
    }
}

interface PublicSchemaResponse {
    data?: PublicSchemaResource
    included?: GroupResource[]
}

interface JsonApiRelationship {
    data?: { id?: string, type?: string } | null
}

interface GroupResource {
    id: string
    type?: string
    attributes?: {
        label?: string
        field_slug?: string | null
    }
    relationships?: {
        field_jurisdiction?: JsonApiRelationship
    }
}

interface PublicSchemaScope {
    jurisdictionSlug: string | null
    organisationSlug: string | null
}

type PublicFieldSchemaValue = NonNullable<NonNullable<PublicSchemaResource['attributes']>['field_schema']>;

/**
 * Collects, per upload field, where its file goes for the pre-check. The
 * disclosure travels beside field_schema, never inside it: the client's
 * profile normaliser is shared with the editor, and operator labels must
 * never be written back into a form.
 */
interface PublicProjectionContext {
    analysisScope: AttachmentAnalysisProfileContext['scope']
    disclosures: Record<string, PublicAttachmentAnalysisDisclosure>
}
const PUBLIC_AUTH_MODES = new Set(['anonymous', 'optional', 'required']);
const PUBLIC_AUTH_PROVIDERS = new Set(['passwordless', 'bundid']);
const PUBLIC_IDENTITY_REQUIREMENTS = new Set(['required', 'optional', 'none']);
const PUBLIC_FIELD_TYPES = new Set(['text', 'textarea', 'email', 'tel', 'number', 'date', 'select', 'radio', 'checkbox', 'address', 'file']);
const PUBLIC_FIELD_FORMATS = new Set(['postal_code', 'iban', 'bic', 'tax_id', 'currency', 'reference_number', 'url']);
const PUBLIC_ATTACHMENT_ANALYSIS_EGRESS_POLICIES = new Set([
    'no_ai',
    'local_only',
    'sovereign_only',
    'external_redacted',
    'external_allowed'
]);
const PUBLIC_FIELD_PRIVACY_KINDS = new Set(['not_personal', 'contact', 'identity', 'financial', 'special_category', 'criminal_offense', 'other_personal']);
const PUBLIC_OPTION_FIELD_TYPES = new Set(['select', 'radio', 'checkbox']);
const MAX_PUBLIC_I18N_LOCALES = 16;
const LOCALE_KEY_PATTERN = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/iu;

function normalizeWorkspaceSlug(value: unknown): string | null {
    const raw = Array.isArray(value) ? value[0] : value;
    if (typeof raw !== 'string') return null;
    const slug = raw.trim().toLowerCase();
    return /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/.test(slug) ? slug : null;
}

function safeQuery(event: Parameters<typeof getQuery>[0]): Record<string, unknown> {
    if (typeof getQuery !== 'function') return {};
    return getQuery(event) as Record<string, unknown>;
}

function relationshipData(item: PublicSchemaResource, fieldName: string): { id?: string, type?: string } | null {
    const relationships = item.relationships as Record<string, JsonApiRelationship | undefined> | undefined;
    return relationships?.[fieldName]?.data || null;
}

function groupSlug(group: GroupResource | undefined): string | null {
    return normalizeWorkspaceSlug(group?.attributes?.field_slug);
}

function resolvePublicSchemaScope(item: PublicSchemaResource, includedById: Map<string, GroupResource>): PublicSchemaScope {
    const directJurisdiction = relationshipData(item, 'field_jurisdiction');
    const directOrganisation = relationshipData(item, 'field_organisation');
    const legacyGroup = relationshipData(item, 'field_group');

    const organisationId = directOrganisation?.id
      || (legacyGroup?.type === 'group--org' ? legacyGroup.id : undefined);
    if (organisationId) {
        const organisation = includedById.get(organisationId);
        const organisationSlug = groupSlug(organisation);
        const jurisdictionId = organisation?.relationships?.field_jurisdiction?.data?.id
          || directJurisdiction?.id;
        const jurisdictionSlug = jurisdictionId ? groupSlug(includedById.get(jurisdictionId)) : null;
        return { jurisdictionSlug, organisationSlug };
    }

    const jurisdictionId = directJurisdiction?.id
      || (legacyGroup?.type === 'group--jur' ? legacyGroup.id : undefined);
    const jurisdictionSlug = jurisdictionId ? groupSlug(includedById.get(jurisdictionId)) : null;
    return { jurisdictionSlug, organisationSlug: null };
}

function publicFormPath(id: string, scope: PublicSchemaScope): string {
    if (!scope.jurisdictionSlug) return `/form/${id}`;
    if (scope.organisationSlug) return `/${scope.jurisdictionSlug}/${scope.organisationSlug}/form/${id}`;
    return `/${scope.jurisdictionSlug}/form/${id}`;
}

function assertRequestedWorkspaceMatchesSchema(
    workspace: PublicWorkspace | null,
    item: PublicSchemaResource,
    includedById: Map<string, GroupResource>
): void {
    if (!workspace) return;

    const directJurisdiction = relationshipData(item, 'field_jurisdiction');
    const directOrganisation = relationshipData(item, 'field_organisation');
    const legacyGroup = relationshipData(item, 'field_group');
    const organisationId = directOrganisation?.id
      || (legacyGroup?.type === 'group--org' ? legacyGroup.id : undefined)
      || null;
    const jurisdictionId = directJurisdiction?.id
      || (legacyGroup?.type === 'group--jur' ? legacyGroup.id : undefined)
      || null;

    let isMatch: boolean;
    if (workspace.type === 'organisation') {
        isMatch = organisationId === workspace.id
          && (!jurisdictionId || jurisdictionId === workspace.jurisdictionId);
    } else if (organisationId) {
        // Jurisdiction-level request (e.g. the /start assistant, which has no
        // organisation in scope): accept an org-scoped form when its organisation
        // belongs to this jurisdiction. Still gated on field_publication_scope
        // === 'internet' above, so this never widens reach beyond public forms.
        const orgJurisdictionId = includedById.get(organisationId)
            ?.relationships?.field_jurisdiction?.data?.id;
        isMatch = typeof orgJurisdictionId === 'string' && orgJurisdictionId === workspace.jurisdictionId;
    } else {
        isMatch = jurisdictionId === workspace.jurisdictionId;
    }

    if (!isMatch) {
        throw createSafeError({
            statusCode: 404,
            message: 'errors.schema.notFound',
            data: { code: 'errors.schema.notFound' }
        });
    }
}

function normalizePrivacyKind(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const normalized = value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .replace(/_+/g, '_');
    return PUBLIC_FIELD_PRIVACY_KINDS.has(normalized) ? normalized : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
    return typeof value === 'boolean' ? value : undefined;
}

function publicI18nOptions(value: unknown, allowedOptions: readonly string[]): string[] | JsonObject | undefined {
    if (allowedOptions.length === 0) return undefined;

    if (Array.isArray(value)) {
        const items = value
            .slice(0, allowedOptions.length)
            .map(item => publicI18nText(item))
            .filter((item): item is string => Boolean(item));
        return items.length > 0 ? items : undefined;
    }

    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const input = value as JsonObject;
    const out: JsonObject = {};
    for (const option of allowedOptions) {
        const text = publicI18nText(input[option]);
        if (text) {
            out[option] = text;
        }
    }

    return Object.keys(out).length > 0 ? out : undefined;
}

function publicI18nProjection(
    value: unknown,
    allowedKeys: readonly string[],
    optionsKey = false,
    allowedOptions: readonly string[] = []
): JsonObject | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;

    const out: JsonObject = {};
    for (const [locale, translationValue] of Object.entries(value).slice(0, MAX_PUBLIC_I18N_LOCALES)) {
        if (!LOCALE_KEY_PATTERN.test(locale) || !translationValue || typeof translationValue !== 'object' || Array.isArray(translationValue)) {
            continue;
        }

        const input = translationValue as JsonObject;
        const translation: JsonObject = {};
        for (const key of allowedKeys) {
            const text = publicI18nText(input[key]);
            if (text) translation[key] = text;
        }
        if (optionsKey) {
            const options = publicI18nOptions(input.options, allowedOptions);
            if (options) translation.options = options;
        }
        if (Object.keys(translation).length > 0) {
            out[locale] = translation;
        }
    }

    return Object.keys(out).length > 0 ? out : undefined;
}

function validationProjection(value: unknown): JsonObject | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const input = value as JsonObject;
    const out: JsonObject = {};
    for (const key of ['minLength', 'maxLength', 'min', 'max', 'step', 'maxFiles', 'maxSizeBytes', 'maxFileSizeBytes'] as const) {
        const number = numberValue(input[key]);
        if (number !== undefined) out[key] = number;
    }
    return Object.keys(out).length > 0 ? out : undefined;
}

function privacyProjection(value: unknown): JsonObject | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const input = value as JsonObject;
    const kind = normalizePrivacyKind(input.kind);
    return kind ? { kind } : undefined;
}

function conditionalProjection(value: unknown, publicFieldIds: Set<string>): JsonObject | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const input = value as JsonObject;
    const fieldId = stringValue(input.fieldId);
    if (!fieldId || !publicFieldIds.has(fieldId)) return undefined;
    const out: JsonObject = { fieldId };
    const conditionValue = publicConditionValue(input.value);
    if (conditionValue !== undefined) out.value = conditionValue;
    return out;
}

function publicAttachmentAnalysisProjection(
    field: JsonObject,
    context: PublicProjectionContext
): JsonObject | undefined {
    const value = field.analysis;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const input = value as JsonObject;
    if (booleanValue(input.enabled) !== true) return undefined;
    const egressPolicy = stringValue(input.egressPolicy);
    if (!egressPolicy || !PUBLIC_ATTACHMENT_ANALYSIS_EGRESS_POLICIES.has(egressPolicy)) return undefined;

    const fieldId = stringValue(field.id);
    if (fieldId && field.type === 'file') {
        // Labels only, resolved from the operator configuration like a run
        // resolves its provider; never model class ids, prompts or schema.
        context.disclosures[fieldId] = publicAttachmentAnalysisDisclosure(attachmentAnalysisDisclosure(
            attachmentAnalysisProfileForField(field),
            context.analysisScope
        ));
    }

    return {
        enabled: true,
        egressPolicy
    };
}

function publicAddressWidgetProjection(value: unknown, fieldType: string): JsonObject | undefined {
    if (fieldType !== 'address') return undefined;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return { autocomplete: true, map: false, boundary: 'off' };
    }
    const input = value as JsonObject;
    return {
        autocomplete: input.autocomplete !== false,
        map: input.map === true,
        boundary: input.boundary === 'advisory' ? 'advisory' : 'off'
    };
}

function fieldProjection(value: unknown, context: PublicProjectionContext): { field: JsonObject, conditionalOn?: unknown } | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const input = value as JsonObject;
    const id = stringValue(input.id);
    const type = stringValue(input.type);
    const label = stringValue(input.label);
    if (!id || !type || !label || !PUBLIC_FIELD_TYPES.has(type)) return null;

    const out: JsonObject = { id, type, label };
    const placeholder = stringValue(input.placeholder);
    if (placeholder) out.placeholder = placeholder;
    const format = stringValue(input.format);
    if (format && PUBLIC_FIELD_FORMATS.has(format)) {
        out.format = format;
    }
    for (const key of ['required'] as const) {
        const bool = booleanValue(input[key]);
        if (bool !== undefined) out[key] = bool;
    }
    if (isSensitiveFlag(input.sensitive)) {
        out.sensitive = true;
    }
    const privacy = privacyProjection(input.privacy);
    if (privacy) out.privacy = privacy;
    const crmKey = stringValue(input.crm_key);
    if (crmKey && profilePropertyForPrefillField({
        type,
        crm_key: crmKey,
        sensitive: input.sensitive,
        privacy
    })) {
        out.crm_key = crmKey;
    }
    const options = stringArrayValue(input.options);
    const hasPublicOptions = Boolean(options && PUBLIC_OPTION_FIELD_TYPES.has(type));
    if (hasPublicOptions) out.options = options;
    const i18n = publicI18nProjection(input.i18n, ['label', 'placeholder'], hasPublicOptions, options ?? []);
    if (i18n) out.i18n = i18n;
    const validation = validationProjection(input.validation);
    if (validation) out.validation = validation;
    const analysis = publicAttachmentAnalysisProjection(input, context);
    if (analysis) out.analysis = analysis;
    const widget = publicAddressWidgetProjection(input.widget, type);
    if (widget) out.widget = widget;
    const rawValidation = input.validation && typeof input.validation === 'object' && !Array.isArray(input.validation) ? input.validation as JsonObject : {};
    const defaultField = { ...out, validation: { ...validation, ...(typeof rawValidation.pattern === 'string' ? { pattern: rawValidation.pattern } : {}) } };
    const defaultValue = publicFieldDefault(defaultField, input.defaultValue);
    if (defaultValue !== undefined) out.defaultValue = defaultValue;
    return { field: out, conditionalOn: input.conditionalOn };
}

function sectionProjection(value: unknown, context: PublicProjectionContext): JsonObject | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const input = value as JsonObject;
    const id = stringValue(input.id);
    const title = stringValue(input.title);
    if (!id || !title || !Array.isArray(input.fields)) return null;

    const projectedFields = input.fields
        .map(field => fieldProjection(field, context))
        .filter((field): field is { field: JsonObject, conditionalOn?: unknown } => Boolean(field));
    const publicFieldIds = new Set(projectedFields.map(item => String(item.field.id)));
    const fields = projectedFields.map((item) => {
        const field = { ...item.field };
        const conditionalOn = conditionalProjection(item.conditionalOn, publicFieldIds);
        if (conditionalOn) {
            field.conditionalOn = conditionalOn;
        }
        return field;
    });
    const out: JsonObject = { id, title, fields };
    const description = stringValue(input.description);
    if (description) out.description = description;
    const i18n = publicI18nProjection(input.i18n, ['title', 'description']);
    if (i18n) out.i18n = i18n;
    const repeatable = booleanValue(input.repeatable);
    if (repeatable !== undefined) out.repeatable = repeatable;
    const maxInstances = numberValue(input.maxInstances);
    if (maxInstances !== undefined) out.maxInstances = maxInstances;
    return out;
}

function identityCollectValue(value: unknown): string | boolean | undefined {
    if (typeof value === 'boolean') return value;
    return typeof value === 'string' && PUBLIC_IDENTITY_REQUIREMENTS.has(value) ? value : undefined;
}

function authProjection(value: unknown): JsonObject | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const input = value as JsonObject;
    const out: JsonObject = {};
    const mode = stringValue(input.mode);
    if (mode) {
        out.mode = PUBLIC_AUTH_MODES.has(mode) ? mode : 'required';
    }

    if (Array.isArray(input.providers)) {
        const providers = input.providers
            .filter((provider): provider is string => typeof provider === 'string' && PUBLIC_AUTH_PROVIDERS.has(provider))
            .slice(0, 10);
        out.providers = [...new Set(providers)];
    }

    if (input.collect && typeof input.collect === 'object' && !Array.isArray(input.collect)) {
        const collectInput = input.collect as JsonObject;
        const collect: JsonObject = {};
        for (const key of ['fullName', 'email'] as const) {
            const requirement = identityCollectValue(collectInput[key]);
            if (requirement !== undefined) {
                collect[key] = requirement;
            }
        }
        if (Object.keys(collect).length > 0) {
            out.collect = collect;
        }
    }

    return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Delivery offer of the form: the routes a citizen may choose and the
 * preselected one. The computed field is a JSON string; anything malformed
 * (also a missing field on an older backend) is the unconfigured offer, so
 * the citizen is not asked and the backend uses its default.
 */
function publicDeliveryOffer(attrs: NonNullable<PublicSchemaResource['attributes']>): PublicSchemaDeliveryOffer {
    const raw = attrs.field_delivery_offer;
    const text = typeof raw === 'string' ? raw : raw && typeof raw === 'object' ? raw.value : null;
    if (typeof text !== 'string' || text.length > 1024) return normalizeDeliveryOffer(null);
    try {
        return normalizeDeliveryOffer(JSON.parse(text));
    } catch {
        return normalizeDeliveryOffer(null);
    }
}

function publicSchemaProjection(
    raw: PublicFieldSchemaValue | undefined,
    context: PublicProjectionContext
): { parsed: JsonObject, projected: JsonObject } | null {
    const schemaText = typeof raw === 'string' ? raw : raw?.value;
    if (!schemaText) return null;

    try {
        const parsed = JSON.parse(schemaText) as JsonObject;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

        const title = stringValue(parsed.title);
        const sections = Array.isArray(parsed.sections)
            ? parsed.sections
                .map(section => sectionProjection(section, context))
                .filter((section): section is JsonObject => Boolean(section))
            : [];
        if (!title || sections.length === 0) return null;

        const out: JsonObject = { title, sections };
        const id = stringValue(parsed.id);
        if (id) out.id = id;
        const description = stringValue(parsed.description);
        if (description) out.description = description;
        const i18n = publicI18nProjection(parsed.i18n, ['title', 'description']);
        if (i18n) out.i18n = i18n;
        const version = numberValue(parsed.version);
        if (version !== undefined) out.version = version;
        const auth = authProjection(parsed.auth);
        if (auth) out.auth = auth;
        return { parsed, projected: out };
    } catch {
        return null;
    }
}

export default defineEventHandler(async (event) => {
    setPrivateNoStore(event);
    const clientIp = getClientIp(event);
    checkRateLimit(clientIp, 'schema_fetch', event);

    const config = useRuntimeConfig();
    const apiBase = config.apiBase;
    if (!apiBase) {
        throw createSafeError({
            statusCode: 500,
            message: 'errors.server.configuration',
            data: { code: 'errors.server.configuration' }
        });
    }
    const id = getRouterParam(event, 'id');
    const eventQuery = safeQuery(event);
    const organisationInput = eventQuery.organisation ?? eventQuery.organization ?? eventQuery.org;
    const hasJurisdictionInput = eventQuery.jurisdiction !== undefined;
    const hasOrganisationInput = eventQuery.organisation !== undefined || eventQuery.organization !== undefined || eventQuery.org !== undefined;
    const jurisdictionSlug = normalizeWorkspaceSlug(eventQuery.jurisdiction);
    const organisationSlug = normalizeWorkspaceSlug(organisationInput);

    if (!id) {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.schema.idRequired',
            data: { code: 'errors.schema.idRequired' }
        });
    }

    validateUuid(id, 'schemaId');

    try {
        if (
            (hasJurisdictionInput && !jurisdictionSlug)
            || (hasOrganisationInput && !organisationSlug)
            || (hasOrganisationInput && !jurisdictionSlug)
        ) {
            throw createSafeError({
                statusCode: 404,
                message: 'workspace.not_found',
                data: { code: 'workspace.not_found' }
            });
        }
        const requestedWorkspace = jurisdictionSlug || organisationSlug
            ? await resolvePublicWorkspaceBySlugs(jurisdictionSlug, organisationSlug)
            : null;
        if ((jurisdictionSlug || organisationSlug) && !requestedWorkspace) {
            throw createSafeError({
                statusCode: 404,
                message: 'workspace.not_found',
                data: { code: 'workspace.not_found' }
            });
        }
        const query = new URLSearchParams({
            'fields[form_schema--form_schema]': 'label,field_description,field_schema,field_workflow_status,field_publication_scope,field_jurisdiction,field_organisation,field_group,field_profile_consent_offer,field_delivery_offer',
            'fields[group--jur]': 'label,field_slug',
            'fields[group--org]': 'label,field_slug,field_jurisdiction',
            // field_group.field_jurisdiction: the attachment analysis scope
            // resolves a legacy organisation group's jurisdiction like a run.
            'include': 'field_jurisdiction,field_organisation,field_organisation.field_jurisdiction,field_group,field_group.field_jurisdiction'
        });
        const response = await drupalServiceFetch<PublicSchemaResponse>(
            `/jsonapi/form_schema/form_schema/${id}?${query.toString()}`
        );

        if (!response.data) {
            throw createSafeError({
                statusCode: 404,
                message: 'errors.schema.notFound',
                data: { code: 'errors.schema.notFound' }
            });
        }

        const attrs = response.data.attributes || {};
        const schemaStatus = attrs.field_workflow_status || 'draft';
        const publicationScope = attrs.field_publication_scope;
        if (publicationScope !== 'internet') {
            throw createSafeError({
                statusCode: 404,
                message: 'errors.schema.notFound',
                data: { code: 'errors.schema.notFound' }
            });
        }
        if (!shouldIncludeDraftSchemas() && schemaStatus !== 'published') {
            throw createSafeError({
                statusCode: 404,
                message: 'errors.schema.notFound',
                data: { code: 'errors.schema.notFound' }
            });
        }

        const includedById = new Map((response.included || []).map(item => [item.id, item]));
        assertRequestedWorkspaceMatchesSchema(requestedWorkspace, response.data, includedById);

        const scope = resolvePublicSchemaScope(response.data, includedById);
        const projectionContext: PublicProjectionContext = {
            // The tenant scope an attachment run of this form uses (policy
            // and tenant overrides), resolved by the runtime's own function.
            analysisScope: attachmentAnalysisScopeFromSchemaResponse(response as unknown as FormSchemaAnalysisResponse),
            disclosures: {}
        };
        const schema = publicSchemaProjection(attrs.field_schema, projectionContext);
        if (!schema) {
            throw createSafeError({
                statusCode: 404,
                message: 'errors.schema.notFound',
                data: { code: 'errors.schema.notFound' }
            });
        }

        const extraAttributes = await applyPublicSchemaExtension({
            ...schema,
            formId: response.data.id || id,
            scope,
            clientIp
        });

        return {
            data: {
                type: response.data.type || 'form_schema--form_schema',
                id: response.data.id || id,
                attributes: {
                    label: attrs.label || '',
                    field_description: attrs.field_description || '',
                    field_schema: JSON.stringify(schema.projected),
                    field_workflow_status: schemaStatus,
                    field_publication_scope: 'internet',
                    field_jurisdiction_slug: scope.jurisdictionSlug,
                    field_organisation_slug: scope.organisationSlug,
                    field_public_path: publicFormPath(response.data.id || id, scope),
                    field_attachment_analysis_disclosures: projectionContext.disclosures,
                    profileConsentOffers: parseProfileConsentOffers(attrs.field_profile_consent_offer),
                    deliveryOffer: publicDeliveryOffer(attrs),
                    ...extraAttributes
                }
            }
        };
    } catch (e: unknown) {
        // Re-throw errors that already carry a status code (our own safe
        // errors and upstream Drupal failures), matching applications/[id].
        if (e && typeof e === 'object' && 'statusCode' in e) {
            throw e;
        }

        throw createSafeError({
            statusCode: 500,
            message: 'errors.schema.loadFailed',
            data: { code: 'errors.schema.loadFailed' }
        });
    }
});
