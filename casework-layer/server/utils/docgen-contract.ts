/**
 * Projections and input checks of the docgen staff proxy.
 *
 * Every Drupal answer passes a whitelist: the browser only sees the fields
 * the UI uses (no download URLs pointing at Drupal, no unknown keys). Every
 * request body is checked before it reaches Drupal; Drupal checks again.
 */
import { createSafeError } from '~~/server/utils/error-handling';
import { docgenCode, isDocgenErrorCode, isDocgenWarningCode } from '~~/app/utils/docgen-codes';
import { DELIVERY_ROUTES } from '~~/app/types/delivery';
import { sanitizeDeliveryPreview, sanitizeFormDelivery } from './docgen-delivery-contract';

export const DOCGEN_PURPOSES = ['approval', 'rejection', 'request_info', 'acknowledgement', 'other'] as const;
export const DOCGEN_ROUTES = ['none', 'template', 'case_system'] as const;
/** 5 MB DOCX, as in docgen and Drupal. */
export const DOCGEN_MAX_DOCX_BYTES = 5 * 1024 * 1024;
/** Upload body: 5 MB DOCX in base64 plus envelope, as Drupal's limit. */
export const DOCGEN_MAX_UPLOAD_BODY = 7 * 1024 * 1024 + 65536;
export const DOCGEN_MAX_JSON_BODY = 65536;
export const DOCGEN_MAX_RELEASE_DOCUMENTS = 10;

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu;
const SHA256 = /^[a-f0-9]{64}$/u;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/u;

type Json = Record<string, unknown>;

export function docgenError(code: string, statusCode = 422, details: Json = {}): never {
    const safe = docgenCode(code);
    throw createSafeError({ statusCode, message: safe, data: { code: safe, ...details } });
}

const record = (value: unknown): Json => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};
const text = (value: unknown, max = 255): string => typeof value === 'string' ? value.slice(0, max) : '';
const nullableText = (value: unknown, max = 255): string | null => typeof value === 'string' ? value.slice(0, max) : null;
const int = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number => {
    const numeric = typeof value === 'number' ? value : Number(value);
    return Number.isSafeInteger(numeric) && numeric >= min && numeric <= max ? numeric : min;
};
const nullableInt = (value: unknown): number | null => value === null || value === undefined ? null : int(value);
const bool = (value: unknown): boolean => value === true;
const uuid = (value: unknown): string => typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : '';
const nullableUuid = (value: unknown): string | null => typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : null;
const sha = (value: unknown): string => typeof value === 'string' && SHA256.test(value) ? value : '';
const list = <T>(value: unknown, map: (item: unknown) => T, max = 500): T[] => Array.isArray(value) ? value.slice(0, max).map(map) : [];
const strings = (value: unknown, max = 500, length = 255): string[] => Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').slice(0, max).map(item => item.slice(0, length))
    : [];
const purpose = (value: unknown) => (DOCGEN_PURPOSES as readonly unknown[]).includes(value) ? value as typeof DOCGEN_PURPOSES[number] : 'other';
const route = (value: unknown) => (DOCGEN_ROUTES as readonly unknown[]).includes(value) ? value as typeof DOCGEN_ROUTES[number] : 'none';
const label = (value: unknown) => {
    const labels = record(value);
    return { de: text(labels.de, 500), en: text(labels.en, 500) };
};

export function sanitizeScope(value: unknown) {
    const scope = record(value);
    if (!Object.keys(scope).length) return null;
    return {
        id: int(scope.id, 0),
        type: scope.type === 'organisation' ? 'organisation' as const : 'jurisdiction' as const,
        name: text(scope.name)
    };
}

function sanitizeTemplateError(value: unknown) {
    const error = record(value);
    return {
        id: /^[a-z0-9_]{1,64}$/u.test(text(error.id, 64)) ? text(error.id, 64) : 'template_error',
        message: text(error.message, 500),
        tag: nullableText(error.tag, 200)
    };
}

export function sanitizeTemplate(value: unknown) {
    const template = record(value);
    return {
        id: uuid(template.id),
        family: uuid(template.family),
        version: int(template.version, 1),
        name: text(template.name),
        purpose: purpose(template.purpose),
        closesProcedure: bool(template.closesProcedure),
        status: template.status === 'released' ? 'released' as const : 'draft' as const,
        scope: sanitizeScope(template.scope),
        filename: text(template.filename),
        size: int(template.size),
        sha256: sha(template.sha256),
        placeholders: strings(template.placeholders, 2000),
        loops: strings(template.loops, 500),
        errors: list(template.errors, sanitizeTemplateError, 100),
        systemPlaceholders: strings(template.systemPlaceholders, 100),
        createdAt: int(template.createdAt),
        createdBy: nullableText(template.createdBy),
        releasedAt: nullableInt(template.releasedAt),
        releasedBy: nullableText(template.releasedBy)
    };
}

export function sanitizeTemplateDetail(value: unknown) {
    return { ...sanitizeTemplate(value), versions: list(record(value).versions, sanitizeTemplate, 200) };
}

export function sanitizeCatalog(value: unknown) {
    const catalog = record(value);
    return {
        templates: list(catalog.templates, sanitizeTemplate, 1000),
        canManage: bool(catalog.canManage),
        purposes: list(catalog.purposes, purpose, 10),
        closingPurposes: list(catalog.closingPurposes, purpose, 10)
    };
}

export function sanitizeScopeSettings(value: unknown) {
    const settings = record(value);
    return {
        scope: int(settings.scope),
        senderAddress: text(settings.senderAddress, 1000),
        effectiveSenderAddress: text(settings.effectiveSenderAddress, 1000)
    };
}

export function sanitizeHealth(value: unknown) {
    const health = record(value);
    const state = (item: unknown) => /^[a-z_]{1,32}$/u.test(text(item, 32)) ? text(item, 32) : 'unknown';
    return {
        configured: bool(health.configured),
        status: state(health.status),
        ...(health.gotenberg !== undefined ? { gotenberg: state(health.gotenberg) } : {}),
        ...(health.verapdf !== undefined ? { verapdf: state(health.verapdf) } : {})
    };
}

export function sanitizeComparison(value: unknown) {
    const comparison = record(value);
    return {
        known: strings(comparison.known, 2000),
        unknown: list(comparison.unknown, (item) => {
            const entry = record(item);
            return { tag: text(entry.tag), suggestion: nullableText(entry.suggestion) };
        }, 2000),
        protected: strings(comparison.protected, 2000),
        unused: strings(comparison.unused, 2000)
    };
}

function sanitizeWarning(value: unknown) {
    const warning = record(value);
    return {
        code: isDocgenWarningCode(warning.code) ? warning.code : 'docgen.template_missing',
        ...(warning.family !== undefined ? { family: uuid(warning.family) } : {}),
        ...(warning.placeholders !== undefined ? { placeholders: sanitizeComparison({ unknown: warning.placeholders }).unknown } : {})
    };
}

export function sanitizeFormSettings(value: unknown) {
    const settings = record(value);
    return {
        formId: uuid(settings.formId),
        route: route(settings.route),
        routes: list(settings.routes, route, 3),
        templates: list(settings.templates, (item) => {
            const template = record(item);
            return {
                family: uuid(template.family),
                name: text(template.name),
                purpose: purpose(template.purpose),
                latestVersion: int(template.latestVersion, 1),
                latestId: uuid(template.latestId),
                latestStatus: template.latestStatus === 'released' ? 'released' as const : 'draft' as const,
                latestHasErrors: bool(template.latestHasErrors),
                releasedVersion: nullableInt(template.releasedVersion),
                releasedId: nullableUuid(template.releasedId),
                comparison: sanitizeComparison(template.comparison)
            };
        }, 50),
        warnings: list(settings.warnings, sanitizeWarning, 200),
        scope: sanitizeScope(settings.scope) ?? { id: 0, type: 'jurisdiction' as const, name: '' },
        canManage: bool(settings.canManage),
        // Set by the proxy, never by Drupal: the form's catalog is the one
        // of the selected workspace (the catalog link leads there).
        catalogInWorkspace: false,
        delivery: sanitizeFormDelivery(settings.delivery)
    };
}

function sanitizeVariableChild(value: unknown) {
    const child = record(value);
    return {
        tag: text(child.tag, 300),
        syntax: text(child.syntax, 300),
        label: label(child.label),
        type: text(child.type, 32),
        protected: bool(child.protected),
        privacyKind: nullableText(child.privacyKind, 64)
    };
}

export function sanitizeVariables(value: unknown) {
    const result = record(value);
    return {
        formId: uuid(result.formId),
        title: text(result.title, 500),
        variables: list(result.variables, (item) => {
            const variable = record(item);
            const section = record(variable.section);
            return {
                tag: text(variable.tag, 300),
                syntax: text(variable.syntax, 700),
                group: variable.group === 'system' ? 'system' as const : 'form' as const,
                label: label(variable.label),
                type: text(variable.type, 32),
                section: Object.keys(section).length ? { id: text(section.id, 128), title: label(section.title) } : null,
                protected: bool(variable.protected),
                repeatable: bool(variable.repeatable),
                ...(variable.privacyKind !== undefined ? { privacyKind: nullableText(variable.privacyKind, 64) } : {}),
                ...(Array.isArray(variable.children) ? { children: list(variable.children, sanitizeVariableChild, 500) } : {})
            };
        }, 2000),
        loopExample: text(result.loopExample, 300)
    };
}

export function sanitizeFormUpload(value: unknown) {
    const result = record(value);
    return {
        template: sanitizeTemplate(result.template),
        comparison: sanitizeComparison(result.comparison),
        settings: sanitizeFormSettings(result.settings)
    };
}

function sanitizeValidation(value: unknown) {
    const validation = record(value);
    if (!Object.keys(validation).length) return null;
    return {
        profile: text(validation.profile, 16),
        compliant: bool(validation.compliant),
        failedRules: int(validation.failedRules),
        failedChecks: int(validation.failedChecks),
        summary: text(validation.summary, 500)
    };
}

/** Cover sheet of a request letter; NULL without one or with a malformed hash. */
function sanitizeCover(value: unknown) {
    const cover = record(value);
    const sha256 = sha(cover.sha256);
    if (!sha256) return null;
    return { sha256, validation: sanitizeValidation(cover.validation) };
}

export function sanitizeDocument(value: unknown) {
    const document = record(value);
    const template = record(document.template);
    const docx = record(document.docx);
    const preview = record(document.preview);
    return {
        id: uuid(document.id),
        title: text(document.title, 200),
        purpose: purpose(document.purpose),
        closesProcedure: bool(document.closesProcedure),
        state: document.state === 'released' || document.state === 'releasing' ? document.state : 'draft' as const,
        template: {
            id: nullableUuid(template.id),
            family: uuid(template.family),
            version: int(template.version, 1),
            name: nullableText(template.name),
            sha256: sha(template.sha256)
        },
        dataSha256: sha(document.dataSha256),
        missing: strings(document.missing, 2000),
        protectedOmitted: strings(document.protectedOmitted, 2000),
        renderedMissing: strings(document.renderedMissing, 2000),
        protectedValues: bool(document.protectedValues),
        docx: {
            sha256: sha(docx.sha256),
            revision: int(docx.revision, 1),
            source: docx.source === 'uploaded' ? 'uploaded' as const : 'rendered' as const,
            size: nullableInt(docx.size)
        },
        preview: Object.keys(preview).length
            ? {
                sha256: sha(preview.sha256),
                docxSha256: sha(preview.docxSha256),
                current: bool(preview.current),
                validation: sanitizeValidation(preview.validation),
                viewedByYou: bool(preview.viewedByYou)
            }
            : null,
        // Request letters: the companion cover sheet (Nachreichung). Its
        // downloadUrl points at Drupal and is dropped like the preview's.
        cover: sanitizeCover(document.cover),
        renderedAt: nullableInt(document.renderedAt) || null,
        canRelease: bool(document.canRelease),
        releaseBlockers: strings(document.releaseBlockers, 20, 64).filter(isDocgenErrorCode),
        createdAt: int(document.createdAt),
        createdBy: nullableText(document.createdBy),
        changedAt: int(document.changedAt),
        releasedAt: nullableInt(document.releasedAt),
        releasedBy: nullableText(document.releasedBy),
        responseId: nullableUuid(document.responseId),
        releaseId: nullableUuid(document.releaseId),
        historyIntact: bool(document.historyIntact)
    };
}

export function sanitizeCaseOverview(value: unknown) {
    const overview = record(value);
    return {
        route: route(overview.route),
        templates: list(overview.templates, (item) => {
            const template = record(item);
            return {
                id: uuid(template.id),
                family: uuid(template.family),
                version: int(template.version, 1),
                name: text(template.name),
                purpose: purpose(template.purpose),
                closesProcedure: bool(template.closesProcedure)
            };
        }, 100),
        documents: list(overview.documents, sanitizeDocument, 200),
        canRelease: bool(overview.canRelease),
        maxReleaseDocuments: int(overview.maxReleaseDocuments, 1, DOCGEN_MAX_RELEASE_DOCUMENTS),
        delivery: sanitizeDeliveryPreview(overview.delivery)
    };
}

export function sanitizeRelease(value: unknown) {
    const result = record(value);
    return {
        documents: list(result.documents, sanitizeDocument, DOCGEN_MAX_RELEASE_DOCUMENTS),
        response: { id: uuid(record(result.response).id) }
    };
}

export function sanitizeDeleted() {
    return { deleted: true };
}

/** Error details the UI may see: codes, counts, hashes; never content. */
export function sanitizeDocgenDetails(value: unknown): Json {
    const details = record(value);
    const result: Json = {};
    const retryAfter = Number(details.retryAfter);
    if (Number.isSafeInteger(retryAfter) && retryAfter >= 1 && retryAfter <= 300) result.retryAfter = retryAfter;
    if (typeof details.reason === 'string' && /^[a-z][a-z0-9_]{0,39}$/u.test(details.reason)) result.reason = details.reason;
    if (typeof details.part === 'string' && /^[A-Za-z0-9_.\-/[\]]{1,200}$/u.test(details.part)) result.part = details.part;
    if (typeof details.field === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,39}$/u.test(details.field)) result.field = details.field;
    if (Array.isArray(details.keys)) result.keys = details.keys.filter(key => typeof key === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,39}$/u.test(key)).slice(0, 20);
    if (Array.isArray(details.blockers)) result.blockers = details.blockers.filter(isDocgenErrorCode).slice(0, 20);
    if (typeof details.document === 'string' && UUID.test(details.document)) result.document = details.document.toLowerCase();
    if (typeof details.family === 'string' && UUID.test(details.family)) result.family = details.family.toLowerCase();
    if (Number.isSafeInteger(details.max)) result.max = details.max;
    if (Array.isArray(details.errors)) result.errors = list(details.errors, sanitizeTemplateError, 50);
    if (details.validation !== undefined) result.validation = sanitizeValidation(details.validation);
    return result;
}

/** Reads and checks a JSON object body; returns it without the envelope. */
export function parseJsonBody(raw: string | undefined, contentType: string): Json {
    if (!raw?.trim()) return {};
    if (contentType.split(';')[0]?.trim().toLowerCase() !== 'application/json') docgenError('docgen.json_required', 415);
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return docgenError('docgen.invalid_json', 400);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) docgenError('docgen.input_invalid', 400);
    return parsed as Json;
}

export function allowKeys(body: Json, allowed: string[]): void {
    const unknown = Object.keys(body).filter(key => !allowed.includes(key));
    if (unknown.length) docgenError('docgen.unknown_key', 400, { keys: unknown.filter(key => /^[A-Za-z][A-Za-z0-9_]{0,39}$/u.test(key)).slice(0, 20) });
}

export function inputText(body: Json, key: string, { required = true, max = 255, multiline = false } = {}): string | undefined {
    const value = body[key];
    if (value === undefined && !required) return undefined;
    if (typeof value !== 'string' || (required && !value.trim()) || value.length > max) docgenError('docgen.input_invalid', 422, { field: key });
    // eslint-disable-next-line no-control-regex
    const control = multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u : CONTROL;
    if (control.test(value)) docgenError('docgen.input_invalid', 422, { field: key });
    return value;
}

export function inputUuid(body: Json, key: string, required = true): string | undefined {
    const value = body[key];
    if (value === undefined && !required) return undefined;
    if (typeof value !== 'string' || !UUID.test(value)) docgenError('docgen.input_invalid', 422, { field: key });
    return value.toLowerCase();
}

export function inputPurpose(body: Json, required = true): string | undefined {
    const value = body.purpose;
    if (value === undefined && !required) return undefined;
    if (!(DOCGEN_PURPOSES as readonly unknown[]).includes(value)) docgenError('docgen.input_invalid', 422, { field: 'purpose' });
    return value as string;
}

/**
 * Checks a DOCX upload: file name, base64 alphabet, decoded size and the ZIP
 * signature. Drupal runs the full structural check and the malware scan.
 */
export function inputDocx(body: Json): { filename: string, content: string } {
    const filename = inputText(body, 'filename') as string;
    if (!/\.docx$/iu.test(filename) || /[\\/]/u.test(filename)) docgenError('docgen.docx_invalid', 422, { reason: 'not_docx' });
    const content = body.content;
    if (typeof content !== 'string' || !content || content.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(content)) {
        docgenError('docgen.input_invalid', 422, { field: 'content' });
    }
    const padding = content.endsWith('==') ? 2 : content.endsWith('=') ? 1 : 0;
    if ((content.length / 4) * 3 - padding > DOCGEN_MAX_DOCX_BYTES) docgenError('docgen.docx_too_large', 413);
    const head = Buffer.from(content.slice(0, 8), 'base64');
    if (head[0] !== 0x50 || head[1] !== 0x4b) docgenError('docgen.docx_invalid', 422, { reason: 'not_zip' });
    return { filename, content };
}

/**
 * Delivery offer of a form settings PUT: exactly `routes` and
 * `default`. `{routes: [], default: ''}` is the unconfigured form; otherwise
 * a non-empty unique subset of the routes with the default among them.
 * Drupal additionally refuses a default that is not available yet (bundid).
 */
export function inputFormDelivery(value: unknown): { routes: string[], default: string } {
    const delivery = record(value);
    if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.keys(delivery).some(key => key !== 'routes' && key !== 'default')) {
        docgenError('docgen.input_invalid', 422, { field: 'deliveryRoutes' });
    }
    const routes = delivery.routes;
    if (!Array.isArray(routes) || routes.length > DELIVERY_ROUTES.length || routes.some(item => !(DELIVERY_ROUTES as readonly unknown[]).includes(item)) || new Set(routes).size !== routes.length) {
        docgenError('docgen.input_invalid', 422, { field: 'deliveryRoutes' });
    }
    const fallback = delivery.default;
    if (typeof fallback !== 'string' || (routes.length === 0 ? fallback !== '' : !routes.includes(fallback))) {
        docgenError('docgen.input_invalid', 422, { field: 'deliveryDefault' });
    }
    return { routes: DELIVERY_ROUTES.filter(route => routes.includes(route)), default: fallback };
}

export function isUuid(value: unknown): value is string {
    return typeof value === 'string' && UUID.test(value);
}
