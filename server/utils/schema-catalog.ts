import type { FormSchemaAttributes, JsonApiCollectionResponse } from '~/types/api';
import {
    drupalPublicFetch,
    drupalServiceFetch,
    getOptionalServiceAuthHeader
} from './auth';
import { serviceProxyRateLimitIdentifier } from './public-status-proxy';
import { publicLookupUnavailableError, withPublicLookupTimeout } from './public-lookup';

export interface DiscoverableSchema {
    id: string
    title: string
    description: string
    status: string
    publicationScope: 'internet' | 'intranet'
    keywords: string[]
    jurisdictionSlug: string | null
    jurisdictionLabel: string | null
    organisationSlug: string | null
    organisationLabel: string | null
    path: string
    i18n?: PublicFormTranslations
}

export type PublicFormLocale = 'de' | 'en';

export interface PublicFormTranslation {
    title?: string
    description?: string
}

export type PublicFormTranslations = Partial<Record<PublicFormLocale, PublicFormTranslation>>;

type SchemaResource = JsonApiCollectionResponse<Partial<FormSchemaAttributes>>['data'][number];
type PublicationScope = DiscoverableSchema['publicationScope'];

interface NormalizeDiscoverableOptions {
    includeDrafts?: boolean
    publicationScopes?: PublicationScope[]
}

interface PublicFormSummary {
    id?: string
    title?: string
    description?: string
    status?: string
    publicationScope?: string
    keywords?: unknown
    jurisdiction?: {
        slug?: string | null
        name?: string | null
    } | null
    organisation?: {
        slug?: string | null
        name?: string | null
    } | null
    path?: string
    i18n?: unknown
}

interface PublicFormListResponse {
    data?: PublicFormSummary[]
}

interface ScopedCatalogOptions {
    proxyRateLimitIp?: string
    includeDrafts?: boolean
}

interface DiscoverableCatalogOptions {
    includeDrafts?: boolean
}

const PUBLIC_CATALOG_CACHE_TTL_MS = 60_000;
const PUBLIC_CATALOG_CACHE_MAX_ENTRIES = 512;
const PUBLIC_CATALOG_MAX_IN_FLIGHT = 128;

type PublicCatalogCacheEntry = {
    expiresAt: number
    schemas: DiscoverableSchema[]
};

const publicCatalogCache = new Map<string, PublicCatalogCacheEntry>();
const publicCatalogLookups = new Map<string, Promise<DiscoverableSchema[]>>();
// Bumped by every form lifecycle change; a lookup that started before the change
// must not put its older result back into the cache.
let publicCatalogGeneration = 0;

function cloneDiscoverableSchemas(schemas: DiscoverableSchema[]): DiscoverableSchema[] {
    return schemas.map(schema => ({
        ...schema,
        keywords: [...schema.keywords],
        ...(schema.i18n
            ? {
                i18n: {
                    ...(schema.i18n.de ? { de: { ...schema.i18n.de } } : {}),
                    ...(schema.i18n.en ? { en: { ...schema.i18n.en } } : {})
                }
            }
            : {})
    }));
}

function prunePublicCatalogCache(now: number): void {
    for (const [key, entry] of publicCatalogCache.entries()) {
        if (entry.expiresAt <= now) {
            publicCatalogCache.delete(key);
        }
    }

    while (publicCatalogCache.size > PUBLIC_CATALOG_CACHE_MAX_ENTRIES) {
        const oldestKey = publicCatalogCache.keys().next().value;
        if (!oldestKey) return;
        publicCatalogCache.delete(oldestKey);
    }
}

async function cachedPublicCatalog(
    cacheKey: string,
    loader: (signal: AbortSignal) => Promise<DiscoverableSchema[]>
): Promise<DiscoverableSchema[]> {
    const now = Date.now();
    prunePublicCatalogCache(now);

    const cached = publicCatalogCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
        return cloneDiscoverableSchemas(cached.schemas);
    }

    // A lookup started before the last lifecycle change keeps its own key, so it
    // still counts against the in-flight limit but nobody joins its older result.
    const generation = publicCatalogGeneration;
    const lookupKey = `${generation}:${cacheKey}`;
    const pendingLookup = publicCatalogLookups.get(lookupKey);
    if (pendingLookup) {
        return cloneDiscoverableSchemas(await pendingLookup);
    }

    if (publicCatalogLookups.size >= PUBLIC_CATALOG_MAX_IN_FLIGHT) {
        throw publicLookupUnavailableError();
    }

    const lookup = (async () => {
        const schemas = cloneDiscoverableSchemas(await withPublicLookupTimeout(loader));
        if (generation !== publicCatalogGeneration) return schemas;
        publicCatalogCache.set(cacheKey, {
            schemas,
            expiresAt: Date.now() + PUBLIC_CATALOG_CACHE_TTL_MS
        });
        prunePublicCatalogCache(Date.now());
        return schemas;
    })();

    publicCatalogLookups.set(lookupKey, lookup);

    try {
        return cloneDiscoverableSchemas(await lookup);
    } finally {
        if (publicCatalogLookups.get(lookupKey) === lookup) publicCatalogLookups.delete(lookupKey);
    }
}

/**
 * Drops every cached public catalog after a published form changed (published,
 * withdrawn, archived, assigned to an organisation), so the next citizen request
 * in this Nuxt process shows the effective forms.
 */
export function invalidatePublicCatalogCache(): void {
    publicCatalogGeneration += 1;
    publicCatalogCache.clear();
}

export function clearPublicCatalogCacheForTests(): void {
    publicCatalogGeneration = 0;
    publicCatalogCache.clear();
    publicCatalogLookups.clear();
}

interface GroupResource {
    id: string
    type?: string
    attributes?: {
        label?: string
        field_slug?: string | null
    }
    relationships?: {
        field_jurisdiction?: {
            data?: { id?: string, type?: string } | null
        }
    }
}

interface SchemaScope {
    jurisdictionSlug: string | null
    jurisdictionLabel: string | null
    organisationSlug: string | null
    organisationLabel: string | null
}

function normalizeSlug(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const slug = value.trim().toLowerCase();
    return /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/.test(slug) ? slug : null;
}

function relationshipData(item: SchemaResource, fieldName: string): { id?: string, type?: string } | null {
    const rel = item.relationships?.[fieldName]?.data;
    if (!rel || Array.isArray(rel)) return null;
    return rel;
}

function groupSlug(group: GroupResource | undefined): string | null {
    return normalizeSlug(group?.attributes?.field_slug);
}

function groupLabel(group: GroupResource | undefined, fallback: string | null): string | null {
    return group?.attributes?.label || fallback;
}

function buildPublicFormPath(id: string, scope: SchemaScope): string {
    if (!scope.jurisdictionSlug) return `/form/${id}`;
    if (scope.organisationSlug) return `/${scope.jurisdictionSlug}/${scope.organisationSlug}/form/${id}`;
    return `/${scope.jurisdictionSlug}/form/${id}`;
}

function stringList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === 'string').slice(0, 30);
}

function publicFormText(value: unknown, maxLength: number): string | undefined {
    if (typeof value !== 'string') return undefined;
    const text = value.trim();
    return text ? text.slice(0, maxLength) : undefined;
}

function normalizePublicFormTranslations(value: unknown): PublicFormTranslations | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const input = value as Record<string, unknown>;
    const out: PublicFormTranslations = {};
    for (const locale of ['de', 'en'] as const) {
        const translation = input[locale];
        if (!translation || typeof translation !== 'object' || Array.isArray(translation)) continue;
        const record = translation as Record<string, unknown>;
        const title = publicFormText(record.title, 500);
        const description = publicFormText(record.description, 5000);
        if (title || description) {
            out[locale] = { ...(title ? { title } : {}), ...(description ? { description } : {}) };
        }
    }
    return Object.keys(out).length > 0 ? out : undefined;
}

export function normalizePublicFormLocale(value: unknown): PublicFormLocale | null {
    const raw = Array.isArray(value) ? value[0] : value;
    if (typeof raw !== 'string') return null;
    const locale = raw.trim().toLowerCase().split('-')[0];
    return locale === 'de' || locale === 'en' ? locale : null;
}

export function localizeDiscoverableSchema(schema: DiscoverableSchema, locale: PublicFormLocale): DiscoverableSchema {
    const translation = schema.i18n?.[locale];
    return {
        ...schema,
        title: translation?.title || schema.title,
        description: translation?.description || schema.description
    };
}

export function localizeDiscoverableSchemas(schemas: DiscoverableSchema[], locale: PublicFormLocale): DiscoverableSchema[] {
    return schemas
        .map(schema => localizeDiscoverableSchema(schema, locale))
        .sort((a, b) => a.title.localeCompare(b.title, locale));
}

function normalizePublicFormSummaries(forms: PublicFormSummary[]): DiscoverableSchema[] {
    return forms
        .map((form): DiscoverableSchema | null => {
            if (!form.id || !form.title) return null;
            if (form.status !== 'published' || form.publicationScope !== 'internet') return null;

            const jurisdictionSlug = normalizeSlug(form.jurisdiction?.slug);
            const organisationSlug = normalizeSlug(form.organisation?.slug);
            const scope = {
                jurisdictionSlug,
                jurisdictionLabel: form.jurisdiction?.name || jurisdictionSlug,
                organisationSlug,
                organisationLabel: form.organisation?.name || organisationSlug
            };

            return {
                id: form.id,
                title: form.title,
                description: typeof form.description === 'string' ? form.description : '',
                status: 'published',
                publicationScope: 'internet',
                keywords: stringList(form.keywords),
                ...scope,
                path: buildPublicFormPath(form.id, scope),
                i18n: normalizePublicFormTranslations(form.i18n)
            };
        })
        .filter((form): form is DiscoverableSchema => Boolean(form))
        .sort((a, b) => a.title.localeCompare(b.title, 'de'));
}

export function resolveSchemaScope(item: SchemaResource, includedById: Map<string, GroupResource>): SchemaScope {
    const directJurisdiction = relationshipData(item, 'field_jurisdiction');
    const directOrganisation = relationshipData(item, 'field_organisation');
    const legacyGroup = relationshipData(item, 'field_group');

    const organisationId = directOrganisation?.id
      || (legacyGroup?.type === 'group--org' ? legacyGroup.id : undefined);
    if (organisationId) {
        const organisation = includedById.get(organisationId);
        const organisationSlug = groupSlug(organisation);
        const organisationLabel = groupLabel(organisation, organisationSlug);
        const jurisdictionId = organisation?.relationships?.field_jurisdiction?.data?.id
          || directJurisdiction?.id;
        const jurisdiction = jurisdictionId ? includedById.get(jurisdictionId) : undefined;
        const jurisdictionSlug = groupSlug(jurisdiction);
        const jurisdictionLabel = groupLabel(jurisdiction, jurisdictionSlug);
        return { jurisdictionSlug, jurisdictionLabel, organisationSlug, organisationLabel };
    }

    const jurisdictionId = directJurisdiction?.id
      || (legacyGroup?.type === 'group--jur' ? legacyGroup.id : undefined);
    const jurisdiction = jurisdictionId ? includedById.get(jurisdictionId) : undefined;
    const jurisdictionSlug = groupSlug(jurisdiction);
    const jurisdictionLabel = groupLabel(jurisdiction, jurisdictionSlug);
    return { jurisdictionSlug, jurisdictionLabel, organisationSlug: null, organisationLabel: null };
}

function extractDescription(raw: FormSchemaAttributes['field_description'] | undefined): string {
    if (typeof raw === 'string') return raw;
    return raw?.value || '';
}

function extractKeywords(raw: FormSchemaAttributes['field_schema'] | undefined): string[] {
    const schemaStr = typeof raw === 'string' ? raw : raw?.value;
    if (!schemaStr) return [];

    try {
        const parsed = JSON.parse(schemaStr) as {
            title?: string
            description?: string
            i18n?: unknown
            sections?: Array<{
                title?: string
                description?: string
                i18n?: unknown
                fields?: Array<{ label?: string, placeholder?: string, options?: string[], i18n?: unknown }>
            }>
            semantics?: {
                category?: string
                entities?: string[]
            }
        };

        const keywords: string[] = [];
        const append = (value: unknown) => {
            if (typeof value === 'string' && value.trim()) keywords.push(value.trim());
        };
        const appendTranslation = (value: unknown, keys: string[]) => {
            if (!value || typeof value !== 'object' || Array.isArray(value)) return;
            for (const translation of Object.values(value as Record<string, unknown>)) {
                if (!translation || typeof translation !== 'object' || Array.isArray(translation)) continue;
                const record = translation as Record<string, unknown>;
                for (const key of keys) append(record[key]);
                if (Array.isArray(record.options)) record.options.forEach(append);
                else if (record.options && typeof record.options === 'object') Object.values(record.options).forEach(append);
            }
        };

        append(parsed.title);
        append(parsed.description);
        appendTranslation(parsed.i18n, ['title', 'description']);

        for (const section of parsed.sections || []) {
            append(section.title);
            append(section.description);
            appendTranslation(section.i18n, ['title', 'description']);
            for (const field of section.fields || []) {
                append(field.label);
                append(field.placeholder);
                field.options?.forEach(append);
                appendTranslation(field.i18n, ['label', 'placeholder']);
            }
        }

        if (parsed.semantics?.category) keywords.push(parsed.semantics.category);
        if (parsed.semantics?.entities) keywords.push(...parsed.semantics.entities);

        return keywords.slice(0, 30);
    } catch {
        return [];
    }
}

function extractTranslations(raw: FormSchemaAttributes['field_schema'] | undefined): PublicFormTranslations | undefined {
    const schemaStr = typeof raw === 'string' ? raw : raw?.value;
    if (!schemaStr) return undefined;
    try {
        const parsed = JSON.parse(schemaStr) as { i18n?: unknown };
        return normalizePublicFormTranslations(parsed.i18n);
    } catch {
        return undefined;
    }
}

export function shouldIncludeDraftSchemas(): boolean {
    // Opt-in only. Coupling this to NODE_ENV silently leaks drafts in staging
    // environments that run with NODE_ENV=production.
    return process.env.NUXT_INCLUDE_DRAFTS === 'true';
}

export function normalizeDiscoverableSchemas(
    resources: SchemaResource[],
    includedOrOptions: GroupResource[] | NormalizeDiscoverableOptions = [],
    options: NormalizeDiscoverableOptions = {}
): DiscoverableSchema[] {
    const included = Array.isArray(includedOrOptions) ? includedOrOptions : [];
    const resolvedOptions = Array.isArray(includedOrOptions) ? options : includedOrOptions;
    const includeDrafts = resolvedOptions.includeDrafts ?? shouldIncludeDraftSchemas();
    const allowedStatuses = new Set(includeDrafts ? ['published', 'draft'] : ['published']);
    const allowedPublicationScopes = new Set(
        Array.isArray(resolvedOptions.publicationScopes) && resolvedOptions.publicationScopes.length > 0
            ? resolvedOptions.publicationScopes
            : ['internet']
    );
    const includedById = new Map(included.map(item => [item.id, item]));

    return (resources || [])
        .map((item) => {
            const attrs = item.attributes;
            const publicationScope: DiscoverableSchema['publicationScope']
                = attrs.field_publication_scope === 'internet' ? 'internet' : 'intranet';
            const scope = resolveSchemaScope(item, includedById);

            return {
                id: item.id,
                title: attrs.label || '',
                description: extractDescription(attrs.field_description),
                status: attrs.field_workflow_status || 'draft',
                publicationScope,
                keywords: extractKeywords(attrs.field_schema),
                jurisdictionSlug: scope.jurisdictionSlug,
                jurisdictionLabel: scope.jurisdictionLabel,
                organisationSlug: scope.organisationSlug,
                organisationLabel: scope.organisationLabel,
                path: buildPublicFormPath(item.id, scope),
                i18n: extractTranslations(attrs.field_schema)
            };
        })
        .filter(item => allowedStatuses.has(item.status) && allowedPublicationScopes.has(item.publicationScope))
        .sort((a, b) => a.title.localeCompare(b.title, 'de'));
}

async function loadDiscoverableSchemas(
    includeDrafts: boolean,
    signal?: AbortSignal
): Promise<DiscoverableSchema[]> {
    const resources: SchemaResource[] = [];
    const includedGroupsById = new Map<string, GroupResource>();
    let offset = 0;

    while (true) {
        const queryParams: Record<string, string> = {
            'fields[form_schema--form_schema]': 'label,field_description,field_schema,field_workflow_status,field_publication_scope,field_jurisdiction,field_organisation,field_group',
            'fields[group--jur]': 'label,field_slug',
            'fields[group--org]': 'label,field_slug,field_jurisdiction',
            'filter[field_publication_scope]': 'internet',
            'include': 'field_jurisdiction,field_organisation,field_organisation.field_jurisdiction,field_group',
            'page[limit]': '100',
            'page[offset]': String(offset)
        };
        if (!includeDrafts) {
            queryParams['filter[field_workflow_status]'] = 'published';
        }
        const query = new URLSearchParams(queryParams);
        const response = await drupalServiceFetch<JsonApiCollectionResponse<Partial<FormSchemaAttributes>>>(
            `/jsonapi/form_schema/form_schema?${query.toString()}`,
            { signal }
        );
        const page = response.data || [];
        resources.push(...page);
        for (const item of (response.included || []) as GroupResource[]) {
            if (item.id) includedGroupsById.set(item.id, item);
        }

        if (page.length < 100) break;
        offset += 100;
    }

    return normalizeDiscoverableSchemas(resources, [...includedGroupsById.values()], { includeDrafts });
}

export async function fetchDiscoverableSchemas(options: DiscoverableCatalogOptions = {}): Promise<DiscoverableSchema[]> {
    const includeDrafts = options.includeDrafts ?? shouldIncludeDraftSchemas();
    if (includeDrafts) {
        return loadDiscoverableSchemas(true);
    }

    return cachedPublicCatalog('global', signal => loadDiscoverableSchemas(false, signal));
}

export async function fetchDiscoverableSchemasForScope(
    jurisdictionSlug: string,
    organisationSlug: string | null = null,
    options: ScopedCatalogOptions = {}
): Promise<DiscoverableSchema[]> {
    const normalizedJurisdictionSlug = normalizeSlug(jurisdictionSlug);
    const normalizedOrganisationSlug = organisationSlug ? normalizeSlug(organisationSlug) : null;
    if (!normalizedJurisdictionSlug || (organisationSlug && !normalizedOrganisationSlug)) {
        return [];
    }

    if (options.includeDrafts ?? shouldIncludeDraftSchemas()) {
        return (await fetchDiscoverableSchemas({ includeDrafts: true })).filter((schema) => {
            if (schema.jurisdictionSlug !== normalizedJurisdictionSlug) return false;
            if (normalizedOrganisationSlug && schema.organisationSlug !== normalizedOrganisationSlug) return false;
            return true;
        });
    }

    const cacheKey = `scope:${normalizedJurisdictionSlug}/${normalizedOrganisationSlug || ''}`;
    return cachedPublicCatalog(cacheKey, async (signal) => {
        const query = normalizedOrganisationSlug
            ? `?${new URLSearchParams({ organisation: normalizedOrganisationSlug }).toString()}`
            : '';
        const headers: Record<string, string> = { Accept: 'application/json' };
        const serviceAuthHeader = getOptionalServiceAuthHeader();
        if (serviceAuthHeader && options.proxyRateLimitIp) {
            headers['X-Beantragt-Service-Authorization'] = serviceAuthHeader;
            headers['X-Beantragt-Rate-Limit-Identifier'] = serviceProxyRateLimitIdentifier(
                'public-form-catalog',
                options.proxyRateLimitIp
            );
        }
        const response = await drupalPublicFetch<PublicFormListResponse>(
            `/api/v1/jurisdictions/${normalizedJurisdictionSlug}/forms${query}`,
            { headers, signal }
        );

        return normalizePublicFormSummaries(response.data || []);
    });
}
