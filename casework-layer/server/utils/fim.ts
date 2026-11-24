import { basename } from 'node:path';
import type { H3Event } from 'h3';
import type { FormSchema } from '~~/app/types/form';
import { normalizeFormSchema } from '~~/app/utils/form-schema';
import { formCreateError, normalizeFormCreateError, postFormResourceAsSession } from '~~/casework-layer/server/utils/form-create';

const FITKO_INDEX_URL = 'https://schema.fitko.de/fim/';
const FITKO_HOST = 'schema.fitko.de';
const FITKO_SCHEMA_PATH_PATTERN = /^\/fim\/s[0-9]+_[0-9.]+\.schema\.json$/iu;
const INDEX_TTL = 30 * 60 * 1000;
const SCHEMA_TTL = 30 * 60 * 1000;
const DEFAULT_SEARCH_LIMIT = 20;
const MAX_SEARCH_LIMIT = 50;
const CATALOG_BATCH_SIZE = 12;
const FITKO_FETCH_TIMEOUT_MS = 10000;
const MAX_SCHEMA_BYTES = 2 * 1024 * 1024;
const MAX_INDEX_BYTES = 512 * 1024;
const PRIORITY_SEARCH_FILES: Array<{ terms: string[], files: string[] }> = [
    {
        terms: ['hund', 'hundesteuer'],
        files: ['s05000039_1.1.schema.json', 's05000040_1.0.schema.json', 's05000069_1.0.schema.json']
    },
    {
        terms: ['bewohner', 'bewohnerpark', 'bewohnerparkausweis', 'parkausweis'],
        files: ['s05000058_1.0.schema.json']
    },
    {
        terms: ['gewerbe', 'gewerbeanmeldung'],
        files: ['s03000234_1.0.schema.json']
    },
    {
        terms: ['wohngeld', 'mietzuschuss'],
        files: ['s00000159_1.4.schema.json']
    },
    {
        terms: ['schwerbehindert', 'schwerbehindertenausweis'],
        files: ['s00000138_1.0.schema.json']
    },
    {
        terms: ['personalausweis', 'reisepass', 'ausweis'],
        files: [
            's00000310_1.0.schema.json',
            's00000311_1.0.schema.json',
            's00000312_1.0.schema.json',
            's00000313_1.0.schema.json'
        ]
    }
];

interface CachedValue<T> {
    value: T
    timestamp: number
}

interface FimSource {
    type: 'fim-json-schema'
    url: string
    file: string
    schemaId: string
    version?: string
}

export interface FimCatalogItem {
    file: string
    url: string
    schemaId: string
    version?: string
    title: string
    description: string
    sections: number
    fields: number
    importedId?: string
    importedStatus?: string
    /** Organisation of the imported form, when it has one and the person may see it. */
    importedOrganisation?: string
}

export interface FimCatalogSearchResult {
    query: string
    totalFiles: number
    results: FimCatalogItem[]
}

export interface FimImportResult {
    id: string
    operation: 'create'
    status: 'draft' | 'published'
    item: FimCatalogItem
}

type FimFormSchema = FormSchema & { source: FimSource };

let fileIndexCache: CachedValue<string[]> | null = null;
const rawSchemaCache = new Map<string, CachedValue<Record<string, unknown>>>();
const catalogItemCache = new Map<string, CachedValue<FimCatalogItem>>();

function isFresh<T>(entry: CachedValue<T> | null | undefined, ttl: number): entry is CachedValue<T> {
    return Boolean(entry && Date.now() - entry.timestamp < ttl);
}

function normalizeWhitespace(value: unknown): string {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function sanitizeId(value: unknown, fallback: string): string {
    // Must satisfy Drupal FormSchema::validateMachineId(): ^[a-z][a-z0-9_]*$
    let sanitized = String(value || fallback)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, '_')
        .replace(/^_+|_+$/g, '');
    if (!sanitized) {
        return fallback;
    }
    if (!/^[a-z]/.test(sanitized)) {
        sanitized = `f_${sanitized}`;
    }
    return sanitized;
}

function isFitkoFilename(input: string): boolean {
    return /^s[0-9]+_[0-9.]+\.schema\.json$/iu.test(input);
}

function normalizeQuery(value: unknown): string {
    return normalizeWhitespace(value).toLocaleLowerCase('de-DE');
}

function sourceKey(source: Pick<FimSource, 'schemaId' | 'version'>): string {
    return `${source.schemaId}:${source.version || ''}`;
}

function createFimError(statusCode: number, code: string): Error & { statusCode: number, data: { code: string } } {
    return Object.assign(new Error(code), { statusCode, data: { code } });
}

function sourceParts(source: string): FimSource {
    const file = basename(source);
    const match = file.match(/^(s[0-9]+)_([0-9.]+)\.schema\.json$/iu);
    return {
        type: 'fim-json-schema',
        url: source,
        file,
        schemaId: match?.[1]?.toLowerCase() || file.replace(/\.schema\.json$/iu, ''),
        version: match?.[2] || undefined
    };
}

export function toFitkoSchemaUrl(input: string): string {
    if (isFitkoFilename(input)) {
        return `${FITKO_INDEX_URL}${input.toLowerCase()}`;
    }

    if (!/^https?:\/\//iu.test(input)) {
        throw createFimError(400, 'errors.fim.invalidFileOrUrl');
    }

    const url = new URL(input);
    if (url.protocol !== 'https:' || url.hostname !== FITKO_HOST || !FITKO_SCHEMA_PATH_PATTERN.test(url.pathname)) {
        throw createFimError(400, 'errors.fim.invalidUrl');
    }

    url.hash = '';
    url.search = '';
    return url.href;
}

async function fetchText(url: string, options: { accept: string, maxBytes: number }): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FITKO_FETCH_TIMEOUT_MS);

    try {
        const response = await fetch(url, {
            redirect: 'manual',
            signal: controller.signal,
            headers: {
                Accept: options.accept
            }
        });

        if (response.status >= 300 && response.status < 400) {
            throw createFimError(502, 'errors.fim.redirectRejected');
        }

        if (!response.ok) {
            throw createFimError(502, 'errors.fim.fetchFailed');
        }

        const contentLength = Number.parseInt(response.headers.get('content-length') || '0', 10);
        if (contentLength > options.maxBytes) {
            throw createFimError(502, 'errors.fim.responseTooLarge');
        }

        if (!response.body) return '';
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const parts: string[] = [];
        let bytesRead = 0;
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                bytesRead += value.byteLength;
                if (bytesRead > options.maxBytes) {
                    await reader.cancel();
                    throw createFimError(502, 'errors.fim.responseTooLarge');
                }
                parts.push(decoder.decode(value, { stream: true }));
            }
        } finally {
            reader.releaseLock();
        }
        parts.push(decoder.decode());
        return parts.join('');
    } finally {
        clearTimeout(timeout);
        controller.abort();
    }
}

async function fetchJson<T>(url: string): Promise<T> {
    const body = await fetchText(url, {
        accept: 'application/schema+json, application/json',
        maxBytes: MAX_SCHEMA_BYTES
    });

    try {
        return JSON.parse(body) as T;
    } catch {
        throw createFimError(502, 'errors.fim.invalidJson');
    }
}

export async function listFitkoSchemaFiles(): Promise<string[]> {
    if (isFresh(fileIndexCache, INDEX_TTL)) {
        return fileIndexCache.value;
    }

    const html = await fetchText(FITKO_INDEX_URL, {
        accept: 'text/html',
        maxBytes: MAX_INDEX_BYTES
    });
    const files = [...new Set(
        [...html.matchAll(/href="(s[0-9]+_[0-9.]+\.schema\.json)"/g)]
            .map(match => match[1])
            .filter((file): file is string => Boolean(file))
    )].sort();

    fileIndexCache = { value: files, timestamp: Date.now() };
    return files;
}

async function loadFimSchema(input: string): Promise<{ source: string, raw: Record<string, unknown> }> {
    const url = toFitkoSchemaUrl(input);
    const cached = rawSchemaCache.get(url);

    if (isFresh(cached, SCHEMA_TTL)) {
        return { source: url, raw: cached.value };
    }

    const raw = await fetchJson<Record<string, unknown>>(url);
    rawSchemaCache.set(url, { value: raw, timestamp: Date.now() });
    return { source: url, raw };
}

function resolveRef(schema: Record<string, unknown>, ref: string, stack = new Set<string>()): Record<string, unknown> {
    if (!ref.startsWith('#/$defs/')) {
        return {};
    }

    const key = decodeURIComponent(ref.slice('#/$defs/'.length));
    if (stack.has(key)) {
        return {};
    }

    const defs = schema.$defs as Record<string, unknown> | undefined;
    const definition = defs?.[key];
    if (!definition || typeof definition !== 'object') {
        return {};
    }

    stack.add(key);
    const resolved = resolveNode(schema, definition as Record<string, unknown>, stack);
    stack.delete(key);
    return resolved;
}

function resolveNode(
    schema: Record<string, unknown>,
    node: Record<string, unknown>,
    stack = new Set<string>()
): Record<string, unknown> {
    if (typeof node.$ref === 'string') {
        return {
            ...resolveRef(schema, node.$ref, stack),
            ...Object.fromEntries(Object.entries(node).filter(([key]) => key !== '$ref'))
        };
    }

    return node;
}

/**
 * A FIM list field (type array) carries its title on the item definition, not
 * on the property, so a missing title is looked up there before the FIM key
 * (such as F60000262) becomes the label.
 */
function nodeTitle(schema: Record<string, unknown>, node: Record<string, unknown>, key: string): string {
    let title = node.title;
    if (!title && node.type === 'array' && node.items && typeof node.items === 'object' && !Array.isArray(node.items)) {
        title = resolveNode(schema, node.items as Record<string, unknown>).title;
    }
    return normalizeWhitespace(title || key);
}

function inferCrmKey(title: string): string | undefined {
    const text = title.toLowerCase();
    if (/\be-?mail\b|de-mail/iu.test(text)) return 'person.email';
    if (/telefon|telefonnummer|mobil|handy/iu.test(text)) return 'person.phone';
    if (/postleitzahl|\bplz\b/iu.test(text)) return 'person.postal_code';
    if (/straße|strasse/iu.test(text)) return 'person.street';
    if (/\bort\b|wohnort/iu.test(text)) return 'person.city';
    if (/geburtsdatum/iu.test(text)) return 'person.birthdate';
    if (/familienname|nachname/iu.test(text)) return 'person.last_name';
    if (/vorname/iu.test(text)) return 'person.first_name';
    if (/vollständiger name|name der person/iu.test(text)) return 'person.full_name';
    return undefined;
}

function inferFormat(title: string, node: Record<string, unknown>): string | undefined {
    const text = title.toLowerCase();
    if (node.format === 'uri' || node.format === 'uri-reference' || node.format === 'url') return 'url';
    if (/postleitzahl|\bplz\b/iu.test(text)) return 'postal_code';
    if (/iban/iu.test(text)) return 'iban';
    if (/steueridentifikationsnummer|steuer-id|tax/iu.test(text)) return 'tax_id';
    if (/aktenzeichen|referenznummer|vorgangsnummer/iu.test(text)) return 'reference_number';
    if (/\b(url|uri|webseite|website|homepage|link|internetadresse)\b/iu.test(text)) return 'url';
    if (node.type === 'number' && /betrag|gebühr|gebuehr|euro|kosten/iu.test(text)) return 'currency';
    return undefined;
}

function optionsFromNode(node: Record<string, unknown>): string[] | undefined {
    if (Array.isArray(node.enum) && node.enum.length > 0 && node.enum.length <= 30) {
        return node.enum.map(option => String(option));
    }

    const items = node.items as Record<string, unknown> | undefined;
    if (
        node.type === 'array'
        && Array.isArray(items?.enum)
        && items.enum.length > 0
        && items.enum.length <= 30
    ) {
        return items.enum.map(option => String(option));
    }

    return undefined;
}

function inferType(title: string, node: Record<string, unknown>): string {
    const text = title.toLowerCase();
    const enumValues = optionsFromNode(node);

    if (enumValues?.length && node.type === 'array') return 'checkbox';
    if (enumValues?.length) return 'select';
    if (node.type === 'boolean') return 'checkbox';
    if (node.type === 'integer' || node.type === 'number') return 'number';
    if (node.format === 'date' || /datum/iu.test(text)) return 'date';
    if (/\be-?mail\b|de-mail/iu.test(text) || /@/.test(String(node.pattern || ''))) return 'email';
    if (/telefon|telefonnummer|mobil|handy/iu.test(text)) return 'tel';
    if (node.type === 'array') return 'textarea';

    return 'text';
}

function validationFromNode(node: Record<string, unknown>): Record<string, number | string> | undefined {
    const validation: Record<string, number | string> = {};

    if (typeof node.minLength === 'number') validation.minLength = node.minLength;
    if (typeof node.maxLength === 'number') validation.maxLength = node.maxLength;
    if (typeof node.minimum === 'number') validation.min = node.minimum;
    if (typeof node.maximum === 'number') validation.max = node.maximum;
    if (typeof node.multipleOf === 'number') validation.step = node.multipleOf;

    return Object.keys(validation).length > 0 ? validation : undefined;
}

function addressComponent(text: string): 'street' | 'houseNumber' | 'postcode' | 'city' | undefined {
    if (/hausnummer|house\s*number|housenumber/iu.test(text)) return 'houseNumber';
    if (/postleitzahl|\bplz\b|postal\s*code|zipcode|\bzip\b/iu.test(text)) return 'postcode';
    if (/straße|strasse|\bstreet\b/iu.test(text)) return 'street';
    if (/\bort\b|wohnort|\bstadt\b|\bcity\b|locality/iu.test(text)) return 'city';
    return undefined;
}

interface CollectedFields {
    fields: Array<Record<string, unknown>>
    addressGroups: Array<Record<string, unknown>>
}

function buildAddressFields(
    schema: Record<string, unknown>,
    key: string,
    rawNode: Record<string, unknown>,
    context: { path?: string[], required: boolean }
): CollectedFields | null {
    const node = resolveNode(schema, rawNode);
    const properties = node.properties;
    if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return null;

    const components = new Map<string, { key: string, node: Record<string, unknown> }>();
    for (const [propertyKey, rawProperty] of Object.entries(properties as Record<string, Record<string, unknown>>)) {
        const property = resolveNode(schema, rawProperty);
        const component = addressComponent(`${propertyKey} ${normalizeWhitespace(property.title)}`);
        if (component && !components.has(component)) components.set(component, { key: propertyKey, node: property });
    }
    if (!components.has('street') || !components.has('houseNumber') || !components.has('postcode') || !components.has('city')) {
        return null;
    }

    const path = [...(context.path ?? []), key];
    const requiredComponents = new Set(Array.isArray(node.required) ? node.required.map(String) : []);
    const fields: Array<Record<string, unknown>> = [];
    const fieldIds: Record<string, string> = {};
    for (const component of ['street', 'houseNumber', 'postcode', 'city'] as const) {
        const source = components.get(component)!;
        const field = buildField(schema, source.key, source.node, {
            index: fields.length + 1,
            path,
            required: context.required && (requiredComponents.size === 0 || requiredComponents.has(source.key))
        });
        const fieldId = String(field.id);
        fieldIds[component] = fieldId;
        fields.push({
            ...field,
            type: 'text',
            ...(component === 'postcode' ? { format: 'postal_code' } : {}),
            privacy: { kind: 'contact' },
            semantics: {
                concept: component === 'houseNumber' ? 'address.house_number' : `address.${component}`,
                sourcePath: [...path, source.key].join('.')
            }
        });
    }

    const idSeed = path.join('_');
    return {
        fields,
        addressGroups: [{
            id: sanitizeId(`${idSeed}_address`, 'address_group'),
            label: nodeTitle(schema, node, key),
            fields: fieldIds,
            autocomplete: true,
            map: false,
            boundary: 'off'
        }]
    };
}

function buildField(
    schema: Record<string, unknown>,
    key: string,
    rawNode: Record<string, unknown>,
    context: { index: number, prefix?: string, path?: string[], required: boolean }
) {
    const node = resolveNode(schema, rawNode);
    const title = nodeTitle(schema, node, key);
    const idSeed = context.path?.length ? [...context.path, key].join('_') : key;
    // No placeholder from node.description: FIM descriptions document the data
    // model for modellers (norms, code lists, field lengths), they are no
    // fill-in hint for citizens.
    const field = {
        id: sanitizeId(idSeed, `field_${context.index}`),
        type: inferType(title, node),
        label: context.prefix ? `${context.prefix}: ${title}` : title,
        required: context.required,
        validation: validationFromNode(node),
        crm_key: inferCrmKey(title),
        format: inferFormat(title, node),
        options: optionsFromNode(node)
    };

    return Object.fromEntries(Object.entries(field).filter(([, value]) => value !== undefined && value !== false));
}

function collectFields(
    schema: Record<string, unknown>,
    objectNode: Record<string, unknown>,
    options: { prefix?: string, path?: string[] }
): CollectedFields {
    const node = resolveNode(schema, objectNode);
    const properties = (node.properties || {}) as Record<string, Record<string, unknown>>;
    const required = new Set(Array.isArray(node.required) ? node.required.map(String) : []);
    const fields: Array<Record<string, unknown>> = [];
    const addressGroups: Array<Record<string, unknown>> = [];
    const path = options.path || [];

    for (const [key, rawChild] of Object.entries(properties)) {
        const child = resolveNode(schema, rawChild);
        const childTitle = nodeTitle(schema, child, key);
        const childRequired = required.has(key);

        if (child.properties && typeof child.properties === 'object') {
            const address = buildAddressFields(schema, key, child, {
                path,
                required: childRequired
            });
            if (address) {
                fields.push(...address.fields);
                addressGroups.push(...address.addressGroups);
                continue;
            }
            const nested = collectFields(schema, child, {
                ...options,
                prefix: options.prefix ? `${options.prefix} / ${childTitle}` : childTitle,
                path: [...path, key]
            });
            fields.push(...nested.fields);
            addressGroups.push(...nested.addressGroups);
            continue;
        }

        fields.push(buildField(schema, key, child, {
            index: fields.length + 1,
            prefix: options.prefix,
            path,
            required: childRequired
        }));
    }

    return { fields, addressGroups };
}

function keywordsFromTitle(title: string): string[] {
    return [...new Set(
        normalizeWhitespace(title)
            .split(/[^A-Za-zÄÖÜäöüß0-9]+/u)
            .filter(token => token.length >= 5)
            .slice(0, 12)
    )];
}

export function convertFimJsonSchema(rawSchema: Record<string, unknown>, source: string): FimFormSchema {
    const parts = sourceParts(source);
    const root = resolveNode(rawSchema, rawSchema);
    const rootProperties = (root.properties || {}) as Record<string, Record<string, unknown>>;
    const rootRequired = new Set(Array.isArray(root.required) ? root.required.map(String) : []);
    const sections: Array<Record<string, unknown>> = [];
    const rootFields: Array<Record<string, unknown>> = [];
    const rootAddressGroups: Array<Record<string, unknown>> = [];

    for (const [key, rawNode] of Object.entries(rootProperties)) {
        const node = resolveNode(rawSchema, rawNode);
        const title = nodeTitle(rawSchema, node, key);

        if (node.properties && typeof node.properties === 'object') {
            const address = buildAddressFields(rawSchema, key, node, {
                required: rootRequired.has(key)
            });
            if (address) {
                rootFields.push(...address.fields);
                rootAddressGroups.push(...address.addressGroups);
                continue;
            }
            const collected = collectFields(rawSchema, node, {
                prefix: '',
                path: [key]
            });

            if (collected.fields.length > 0) {
                sections.push({
                    id: sanitizeId(key, `section_${sections.length + 1}`),
                    title,
                    description: normalizeWhitespace(node.description) || undefined,
                    fields: collected.fields,
                    ...(collected.addressGroups.length > 0 ? { addressGroups: collected.addressGroups } : {})
                });
            }
            continue;
        }

        rootFields.push(buildField(rawSchema, key, node, {
            index: rootFields.length + 1,
            prefix: '',
            required: rootRequired.has(key)
        }));
    }

    if (rootFields.length > 0) {
        sections.unshift({
            id: 'general',
            title: 'Allgemeine Angaben',
            fields: rootFields,
            ...(rootAddressGroups.length > 0 ? { addressGroups: rootAddressGroups } : {})
        });
    }

    const title = normalizeWhitespace(root.title || parts.schemaId);
    const schema = normalizeFormSchema({
        title,
        description: normalizeWhitespace(root.description),
        sections: sections as unknown as FormSchema['sections'],
        version: 1,
        semantics: {
            category: 'FIM',
            entities: [...keywordsFromTitle(title), 'FIM'],
            legal_references: [source]
        },
        source: parts
    } as FormSchema & { source: FimSource });

    return schema as FimFormSchema;
}

function countFields(schema: FormSchema): number {
    return schema.sections.reduce((total, section) => total + section.fields.length, 0);
}

async function getCatalogItem(file: string): Promise<FimCatalogItem> {
    const url = toFitkoSchemaUrl(file);
    const cached = catalogItemCache.get(url);

    if (isFresh(cached, SCHEMA_TTL)) {
        return cached.value;
    }

    const loaded = await loadFimSchema(url);
    const schema = convertFimJsonSchema(loaded.raw, loaded.source);
    const item: FimCatalogItem = {
        file: schema.source.file,
        url: schema.source.url,
        schemaId: schema.source.schemaId,
        version: schema.source.version,
        title: schema.title,
        description: schema.description || '',
        sections: schema.sections.length,
        fields: countFields(schema)
    };

    catalogItemCache.set(url, { value: item, timestamp: Date.now() });
    return item;
}

function matchesSearch(item: FimCatalogItem, query: string): boolean {
    const normalizedQuery = normalizeQuery(query);
    const terms = normalizedQuery.split(/\s+/u).filter(Boolean);
    const haystack = normalizeQuery(`${item.file} ${item.title} ${item.description}`);
    return terms.every(term => haystack.includes(term));
}

function coerceLimit(limit: unknown): number {
    const parsed = Number.parseInt(String(limit || DEFAULT_SEARCH_LIMIT), 10);
    if (!Number.isFinite(parsed)) return DEFAULT_SEARCH_LIMIT;
    return Math.min(Math.max(parsed, 1), MAX_SEARCH_LIMIT);
}

function priorityFilesForQuery(query: string, availableFiles: string[]): string[] {
    const normalizedQuery = normalizeQuery(query);
    const candidates = new Set<string>();
    const available = new Set(availableFiles);

    for (const group of PRIORITY_SEARCH_FILES) {
        if (group.terms.some(term => normalizedQuery.includes(term))) {
            for (const file of group.files) {
                if (available.has(file)) {
                    candidates.add(file);
                }
            }
        }
    }

    return [...candidates];
}

// Bounds of the lookup per catalogue search: 25 forms a
// page, at most 40 pages (1000 forms) and 8 MB a page. `field_schema` cannot
// be left out: the FIM source sits inside that JSON text, and sparse
// fieldsets only select whole fields.
const EXISTING_PAGE_LIMIT = 25;
const EXISTING_PAGE_CAP = 40;
const EXISTING_PAGE_MAX_BYTES = 8 * 1024 * 1024;

type ExistingFimResponse = {
    data?: Array<{
        id: string
        attributes?: {
            field_schema?: string | { value?: string }
            field_workflow_status?: string
        }
        relationships?: {
            field_organisation?: { data?: { id?: string, type?: string } | null }
        }
    }>
    included?: Array<{ id: string, type: string, attributes?: { label?: string } }>
    links?: { next?: { href?: string } }
};

interface ExistingFimImport {
    id: string
    status: string
    organisationLabel?: string
}

/**
 * Forms of the current workspace that were imported from FIM, keyed by
 * schema id and version.
 *
 * Read as the person (their Drupal session), like the form list: the service
 * account may view only published internet forms (group scope), so it never
 * saw an imported draft and the catalogue offered the import again.
 * The request event is required: there is no way to run this without the
 * person's session and the workspace filter.
 *
 * Pages in a fixed order (`drupal_internal__id`) with an offset the loop
 * counts itself; `links.next` only says whether to go on, it is never
 * fetched. Drupal may omit resources by access, so a short page does not end
 * the loop while links exist. At the page cap or at a page over the byte
 * limit it stops, logs once and returns what it found: the marks are an aid,
 * a second import stays possible behind the question in the catalogue.
 */
export async function listExistingFimSchemas(event: H3Event): Promise<Map<string, ExistingFimImport>> {
    const { DrupalResponseBodyTooLargeError, drupalSessionFetch } = await import('~~/server/utils/auth');
    const { applyAdminJurisdictionFilter } = await import('~~/casework-layer/server/utils/admin-workspace');
    const existing = new Map<string, ExistingFimImport>();

    for (let page = 0; page < EXISTING_PAGE_CAP; page++) {
        const params = new URLSearchParams({
            'fields[form_schema--form_schema]': 'field_schema,field_workflow_status,field_organisation',
            // The organisation's name, so the municipality workspace can say who
            // imported an entry; Drupal leaves it out where the person may not see it.
            'include': 'field_organisation',
            'fields[group--org]': 'label',
            'sort': 'drupal_internal__id',
            'page[limit]': String(EXISTING_PAGE_LIMIT),
            'page[offset]': String(page * EXISTING_PAGE_LIMIT)
        });
        await applyAdminJurisdictionFilter(event, params);
        const path = `/jsonapi/form_schema/form_schema?${params.toString()}`;
        let response: ExistingFimResponse;
        try {
            response = await drupalSessionFetch<ExistingFimResponse>(event, path, { maxResponseBytes: EXISTING_PAGE_MAX_BYTES });
        } catch (error) {
            if (error instanceof DrupalResponseBodyTooLargeError) {
                console.warn(`[fim] Import lookup stopped at page ${page + 1}: page larger than ${EXISTING_PAGE_MAX_BYTES} bytes.`);
                return existing;
            }
            throw error;
        }

        const items = response.data || [];
        const organisationLabels = new Map(
            (response.included || [])
                .filter(entry => entry.type === 'group--org' && typeof entry.attributes?.label === 'string')
                .map(entry => [entry.id, entry.attributes!.label!])
        );
        for (const item of items) {
            const raw = item.attributes?.field_schema;
            const fieldSchema = typeof raw === 'string' ? raw : raw?.value;
            if (!fieldSchema) continue;

            try {
                const parsed = JSON.parse(fieldSchema) as { source?: FimSource };
                if (parsed.source?.type === 'fim-json-schema') {
                    const organisationId = item.relationships?.field_organisation?.data?.id;
                    const organisationLabel = organisationId ? organisationLabels.get(organisationId) : undefined;
                    existing.set(sourceKey(parsed.source), {
                        id: item.id,
                        status: item.attributes?.field_workflow_status || 'draft',
                        ...(organisationLabel ? { organisationLabel } : {})
                    });
                }
            } catch {
                // Ignore non-JSON legacy schemas.
            }
        }

        const hasNext = response.links
            ? Boolean(response.links.next?.href)
            : items.length >= EXISTING_PAGE_LIMIT;
        if (!hasNext) return existing;
    }

    console.warn(`[fim] Import lookup stopped at the cap of ${EXISTING_PAGE_CAP} pages; later forms are not marked.`);
    return existing;
}

function withExistingState(item: FimCatalogItem, existing: Map<string, ExistingFimImport>): FimCatalogItem {
    const match = existing.get(sourceKey(item));
    if (!match) return item;
    return {
        ...item,
        importedId: match.id,
        importedStatus: match.status,
        ...(match.organisationLabel ? { importedOrganisation: match.organisationLabel } : {})
    };
}

export function resolveFimImportStatus(): FimImportResult['status'] {
    return 'draft';
}

export async function searchFimCatalog(query: unknown, limit: unknown, event: H3Event): Promise<FimCatalogSearchResult> {
    const q = normalizeWhitespace(query);
    const files = await listFitkoSchemaFiles();
    const maxResults = coerceLimit(limit);

    if (q.length < 2) {
        return { query: q, totalFiles: files.length, results: [] };
    }

    // Earlier imports are looked up once, and only when the search has hits.
    const markImported = async (items: FimCatalogItem[]): Promise<FimCatalogItem[]> => {
        if (items.length === 0) return items;
        const existing = await listExistingFimSchemas(event);
        return items.map(item => withExistingState(item, existing));
    };
    const directFile = files.find(file => file.toLowerCase() === q.toLowerCase());
    const directSchemaId = files.find(file => file.toLowerCase().startsWith(`${q.toLowerCase()}_`));

    if (directFile || directSchemaId) {
        const item = await getCatalogItem(directFile || directSchemaId!);
        return {
            query: q,
            totalFiles: files.length,
            results: await markImported([item])
        };
    }

    const priorityFiles = priorityFilesForQuery(q, files);
    if (priorityFiles.length > 0) {
        const priorityItems = await Promise.all(
            priorityFiles.map(file => getCatalogItem(file).catch(() => null))
        );
        const priorityResults = priorityItems
            .filter((item): item is FimCatalogItem => Boolean(item && matchesSearch(item, q)))
            .slice(0, maxResults);

        if (priorityResults.length > 0) {
            return {
                query: q,
                totalFiles: files.length,
                results: await markImported(priorityResults)
            };
        }
    }

    const results: FimCatalogItem[] = [];

    for (let index = 0; index < files.length && results.length < maxResults; index += CATALOG_BATCH_SIZE) {
        const batch = files.slice(index, index + CATALOG_BATCH_SIZE);
        const items = await Promise.all(
            batch.map(file => getCatalogItem(file).catch(() => null))
        );

        for (const item of items) {
            if (item && matchesSearch(item, q)) {
                results.push(item);
                if (results.length >= maxResults) break;
            }
        }
    }

    return {
        query: q,
        totalFiles: files.length,
        results: await markImported(results)
    };
}

export async function importFimSchema(
    event: H3Event,
    input: unknown,
    relationships: Record<string, unknown>
): Promise<FimImportResult> {
    const sourceInput = normalizeWhitespace(input);
    if (!sourceInput) {
        throw createFimError(400, 'errors.fim.fileMissing');
    }

    const loaded = await loadFimSchema(sourceInput);
    const schema = convertFimJsonSchema(loaded.raw, loaded.source);

    if (schema.sections.length === 0 || countFields(schema) === 0) {
        throw createFimError(422, 'errors.fim.noImportableFields');
    }

    // An import always creates a new draft. It no longer looks up an
    // earlier import to overwrite it: that update replaced label and fields
    // of the existing form and set it to draft (K-126, open for a decision),
    // and it only ever reached forms the service account can see. A second
    // import of one entry stays possible; the catalogue asks first.
    const status = resolveFimImportStatus();
    const payload = {
        data: {
            type: 'form_schema--form_schema',
            attributes: {
                label: schema.title,
                field_description: schema.description || '',
                field_schema: JSON.stringify(schema),
                field_workflow_status: status,
                field_publication_scope: 'internet',
                status: status === 'published'
            },
            relationships
        }
    };

    const response = await postFormResourceAsSession<{ data?: { id?: string } }>(
        event, '/jsonapi/form_schema/form_schema', payload
    ).catch((error) => {
        throw normalizeFormCreateError(error, 'errors.fim.importFailed');
    });
    const id = response?.data?.id;
    if (!id) throw formCreateError(502, 'errors.fim.importFailed');

    return {
        id,
        operation: 'create',
        status,
        item: {
            file: schema.source.file,
            url: schema.source.url,
            schemaId: schema.source.schemaId,
            version: schema.source.version,
            title: schema.title,
            description: schema.description || '',
            sections: schema.sections.length,
            fields: countFields(schema),
            importedId: id,
            importedStatus: status
        }
    };
}
