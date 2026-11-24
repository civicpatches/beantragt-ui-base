/**
 * Nuxt proxy of the docgen staff API (beantragt_docgen).
 *
 * Two closed dispatchers keep authentication, origin and CSRF checks,
 * workspace binding, body checks and projections identical on every route:
 *
 * - handleDocgenAdmin: /api/admin/docgen/** (catalog, scope settings, form
 *   settings, variables, sample, upload from the form editor, health)
 * - handleDocgenCase: /api/admin/applications/{uuid}/docgen/** (documents of
 *   one application, preview, release)
 *
 * Drupal decides permission, group scope and the release rule; this layer
 * binds every request to the selected workspace, so a person with several
 * workspaces never acts on another tenant through a stale tab.
 */
import { rateLimitCaseRead } from '~~/server/utils/case-read';
import type { H3Event } from 'h3';
import { requireSameOriginRequest, setPrivateNoStore } from '~~/server/utils/request-security';
import { docgenCode, isDocgenErrorCode } from '~~/app/utils/docgen-codes';
import { applyAdminJurisdictionFilter, fetchVisibleAdminWorkspaces, resolveRequiredAdminWorkspace, type AdminWorkspace } from '~~/casework-layer/server/utils/admin-workspace';
import { readBoundedBody } from './bounded-body';
import { preserveIntegrationNoStore } from './integration-no-store';
import {
    allowKeys, docgenError, DOCGEN_MAX_JSON_BODY, DOCGEN_MAX_RELEASE_DOCUMENTS, DOCGEN_MAX_UPLOAD_BODY, DOCGEN_ROUTES,
    inputDocx, inputFormDelivery, inputPurpose, inputText, inputUuid, isUuid, parseJsonBody, sanitizeCaseOverview, sanitizeCatalog,
    sanitizeDeleted, sanitizeDocgenDetails, sanitizeDocument, sanitizeFormSettings, sanitizeFormUpload, sanitizeHealth,
    sanitizeRelease, sanitizeScopeSettings, sanitizeTemplate, sanitizeTemplateDetail, sanitizeVariables
} from './docgen-contract';

type Json = Record<string, unknown>;
type BodyKind = 'none' | 'json' | 'upload';
type Binding = 'none' | 'workspace' | 'template' | 'form';

interface DocgenRouteSpec {
    upstream: string
    body: BodyKind
    binding: Binding
    /** Turns the checked client body into the Drupal `data` object. */
    input?: (body: Json) => Json
    sanitize?: (payload: unknown) => unknown
    download?: { mime: string, fallback: string }
    /** Runs a docgen conversion or stores a file: own rate limit. */
    action?: boolean
    created?: boolean
    query?: Record<string, string>
    resourceId?: string
}

/** Query keys that select the workspace; shared with the Nachreichung proxy. */
export const WORKSPACE_KEYS = ['jurisdiction', 'organisation', 'organization', 'org'];
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PDF_MIME = 'application/pdf';
const MAX_JSON_RESPONSE = 4 * 1024 * 1024;
/**
 * Largest file Drupal serves: a PDF/A preview or notice of up to 20 MiB
 * (docgen maxPdfBytes, ExternalResponseService::MAX_DOCUMENT_BYTES). DOCX
 * files stay far below (5 MiB).
 */
export const DOCGEN_MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;
const UPSTREAM_STATUSES = [400, 401, 403, 404, 405, 409, 413, 415, 422, 429, 500, 502, 503];

function uploadInput(keys: string[], { name = false, purpose = false, replaces = false } = {}) {
    return (body: Json): Json => {
        allowKeys(body, keys);
        const data: Json = { ...inputDocx(body) };
        if (name || body.name !== undefined) data.name = inputText(body, 'name', { required: name });
        if (purpose || body.purpose !== undefined) data.purpose = inputPurpose(body, purpose);
        if (replaces && body.replaces !== undefined) data.replaces = inputUuid(body, 'replaces');
        return Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));
    };
}

function noInput(body: Json): Json {
    allowKeys(body, []);
    return {};
}

/** Route table of /api/admin/docgen/**. */
export function docgenAdminRoute(path: string, method: string, query: Json): DocgenRouteSpec {
    const segments = path.split('/').filter(Boolean);
    const [resource, id, sub, extra] = segments;
    if (extra !== undefined || segments.some(segment => !/^[A-Za-z0-9-]{1,64}$/u.test(segment))) docgenError('docgen.route_not_found', 404);
    if (id !== undefined && !isUuid(id)) docgenError('docgen.route_not_found', 404);
    const uuid = id?.toLowerCase();
    const key = `${method} ${resource}${id ? '/:id' : ''}${sub ? `/${sub}` : ''}`;
    switch (key) {
        case 'GET health':
            return { upstream: '/api/admin/docgen/health', body: 'none', binding: 'none', sanitize: sanitizeHealth };
        case 'GET templates':
            return { upstream: '/api/admin/docgen/templates', body: 'none', binding: 'workspace', sanitize: sanitizeCatalog };
        case 'POST templates':
            return { upstream: '/api/admin/docgen/templates', body: 'upload', binding: 'workspace', input: uploadInput(['name', 'purpose', 'filename', 'content'], { name: true, purpose: true }), sanitize: sanitizeTemplate, action: true, created: true };
        case 'GET templates/:id':
            return { upstream: `/api/admin/docgen/templates/${uuid}`, body: 'none', binding: 'template', resourceId: uuid, sanitize: sanitizeTemplateDetail };
        case 'PATCH templates/:id':
            return {
                upstream: `/api/admin/docgen/templates/${uuid}`, body: 'json', binding: 'template', resourceId: uuid, sanitize: sanitizeTemplate,
                input: (body) => {
                    allowKeys(body, ['name', 'purpose']);
                    const data: Json = {};
                    if (body.name !== undefined) data.name = inputText(body, 'name');
                    if (body.purpose !== undefined) data.purpose = inputPurpose(body);
                    return data;
                }
            };
        case 'DELETE templates/:id':
            return { upstream: `/api/admin/docgen/templates/${uuid}`, body: 'none', binding: 'template', resourceId: uuid, sanitize: sanitizeDeleted };
        case 'GET templates/:id/file':
            return { upstream: `/api/admin/docgen/templates/${uuid}/file`, body: 'none', binding: 'template', resourceId: uuid, download: { mime: DOCX_MIME, fallback: 'vorlage.docx' } };
        case 'POST templates/:id/release':
            return { upstream: `/api/admin/docgen/templates/${uuid}/release`, body: 'json', binding: 'template', resourceId: uuid, input: noInput, sanitize: sanitizeTemplate };
        case 'POST templates/:id/versions':
            return { upstream: `/api/admin/docgen/templates/${uuid}/versions`, body: 'upload', binding: 'template', resourceId: uuid, input: uploadInput(['name', 'purpose', 'filename', 'content']), sanitize: sanitizeTemplate, action: true, created: true };
        case 'GET settings':
            return { upstream: '/api/admin/docgen/settings', body: 'none', binding: 'workspace', sanitize: sanitizeScopeSettings };
        case 'PUT settings':
            return {
                upstream: '/api/admin/docgen/settings', body: 'json', binding: 'workspace', sanitize: sanitizeScopeSettings,
                input: (body) => {
                    allowKeys(body, ['senderAddress']);
                    return { senderAddress: inputText(body, 'senderAddress', { required: false, max: 1000, multiline: true }) ?? '' };
                }
            };
        case 'GET forms/:id':
            return { upstream: `/api/admin/docgen/forms/${uuid}`, body: 'none', binding: 'form', resourceId: uuid, sanitize: sanitizeFormSettings };
        case 'PUT forms/:id':
            return {
                upstream: `/api/admin/docgen/forms/${uuid}`, body: 'json', binding: 'form', resourceId: uuid, sanitize: sanitizeFormSettings,
                // Every key is optional on its own: the delivery autosave
                // sends only `delivery` and must never overwrite route or templates.
                input: (body) => {
                    allowKeys(body, ['route', 'templates', 'delivery']);
                    const data: Json = {};
                    if (body.route !== undefined) {
                        if (!(DOCGEN_ROUTES as readonly unknown[]).includes(body.route)) docgenError('docgen.input_invalid', 422, { field: 'route' });
                        data.route = body.route;
                    }
                    if (body.templates !== undefined) {
                        const templates = body.templates;
                        if (!Array.isArray(templates) || templates.length > 50 || templates.some(family => !isUuid(family))) docgenError('docgen.input_invalid', 422, { field: 'templates' });
                        data.templates = [...new Set((templates as string[]).map(family => family.toLowerCase()))];
                    }
                    if (body.delivery !== undefined) data.delivery = inputFormDelivery(body.delivery);
                    return data;
                }
            };
        case 'GET forms/:id/variables':
            return { upstream: `/api/admin/docgen/forms/${uuid}/variables`, body: 'none', binding: 'form', resourceId: uuid, sanitize: sanitizeVariables };
        case 'GET forms/:id/sample':
            return { upstream: `/api/admin/docgen/forms/${uuid}/sample`, body: 'none', binding: 'form', resourceId: uuid, query: { lang: query.lang === 'en' ? 'en' : 'de' }, download: { mime: DOCX_MIME, fallback: 'muster.docx' }, action: true };
        case 'POST forms/:id/templates':
            return {
                upstream: `/api/admin/docgen/forms/${uuid}/templates`, body: 'upload', binding: 'form', resourceId: uuid, sanitize: sanitizeFormUpload, action: true, created: true,
                input: body => uploadInput(['name', 'purpose', 'filename', 'content', 'replaces'], { name: body.replaces === undefined, purpose: body.replaces === undefined, replaces: true })(body)
            };
        default:
            return docgenError('docgen.route_not_found', 404);
    }
}

/** Route table of /api/admin/applications/{uuid}/docgen/** (path below docgen). */
export function docgenCaseRoute(path: string, method: string, internalId: number): DocgenRouteSpec {
    const segments = path.split('/').filter(Boolean);
    const [resource, id, sub, extra] = segments;
    if (extra !== undefined || segments.some(segment => !/^[A-Za-z0-9-]{1,64}$/u.test(segment))) docgenError('docgen.route_not_found', 404);
    if (id !== undefined && !isUuid(id)) docgenError('docgen.route_not_found', 404);
    const base = `/api/admin/applications/${internalId}/docgen`;
    const document = `${base}/documents/${id?.toLowerCase()}`;
    const key = `${method} ${resource ?? ''}${id ? '/:id' : ''}${sub ? `/${sub}` : ''}`;
    switch (key) {
        case 'GET ':
            return { upstream: base, body: 'none', binding: 'none', sanitize: sanitizeCaseOverview };
        case 'POST documents':
            return {
                upstream: `${base}/documents`, body: 'json', binding: 'none', sanitize: sanitizeDocument, action: true, created: true,
                input: (body) => {
                    allowKeys(body, ['templateId', 'title']);
                    const data: Json = { templateId: inputUuid(body, 'templateId') };
                    const title = inputText(body, 'title', { required: false, max: 200 });
                    if (title !== undefined && title.trim()) data.title = title.trim();
                    return data;
                }
            };
        case 'GET documents/:id':
            return { upstream: document, body: 'none', binding: 'none', sanitize: sanitizeDocument };
        case 'DELETE documents/:id':
            return { upstream: document, body: 'none', binding: 'none', sanitize: sanitizeDeleted };
        case 'GET documents/:id/docx':
            return { upstream: `${document}/docx`, body: 'none', binding: 'none', download: { mime: DOCX_MIME, fallback: 'bescheid.docx' } };
        case 'POST documents/:id/docx':
            return { upstream: `${document}/docx`, body: 'upload', binding: 'none', input: uploadInput(['filename', 'content']), sanitize: sanitizeDocument, action: true };
        case 'POST documents/:id/preview':
            return { upstream: `${document}/preview`, body: 'json', binding: 'none', input: noInput, sanitize: sanitizeDocument, action: true };
        case 'POST documents/:id/rerender':
            // "Neu aus der Vorlage erstellen": a request letter whose deadline
            // is from an earlier day and whose Word file was uploaded.
            return { upstream: `${document}/rerender`, body: 'json', binding: 'none', input: noInput, sanitize: sanitizeDocument, action: true };
        case 'GET documents/:id/pdf':
            return { upstream: `${document}/pdf`, body: 'none', binding: 'none', download: { mime: PDF_MIME, fallback: 'bescheid.pdf' } };
        case 'GET documents/:id/cover-pdf':
            // Cover sheet of a request letter (Nachreichung): same gate and
            // headers as the letter's PDF; Drupal records no view for it.
            return { upstream: `${document}/cover-pdf`, body: 'none', binding: 'none', download: { mime: PDF_MIME, fallback: 'deckblatt.pdf' } };
        case 'POST documents/:id/viewed':
            // The browser confirms the preview it received (SHA-256 of the
            // bytes); only then does Drupal record the view.
            return {
                upstream: `${document}/viewed`, body: 'json', binding: 'none', sanitize: sanitizeDocument,
                input: (body) => {
                    allowKeys(body, ['pdfSha256']);
                    const hash = body.pdfSha256;
                    if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/u.test(hash)) docgenError('docgen.input_invalid', 422, { field: 'pdfSha256' });
                    return { pdfSha256: hash };
                }
            };
        case 'POST release':
            return {
                upstream: `${base}/release`, body: 'json', binding: 'none', sanitize: sanitizeRelease, action: true,
                input: (body) => {
                    allowKeys(body, ['documents']);
                    const documents = body.documents;
                    if (!Array.isArray(documents) || documents.length < 1 || documents.length > DOCGEN_MAX_RELEASE_DOCUMENTS || documents.some(item => !isUuid(item))) {
                        docgenError('docgen.release_count_invalid', 422, { max: DOCGEN_MAX_RELEASE_DOCUMENTS });
                    }
                    return { documents: [...new Set((documents as string[]).map(item => item.toLowerCase()))] };
                }
            };
        default:
            return docgenError('docgen.route_not_found', 404);
    }
}

/**
 * A write must name its workspace; the cookie fallback never picks a tenant
 * for a change. `fail` throws the caller's own error (docgen by default).
 */
export function requireWorkspaceSelector(event: H3Event, fail: () => never = () => docgenError('docgen.workspace_required', 400)): void {
    const query = getQuery(event);
    const validSlug = (value: unknown) => typeof value === 'string' && /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/u.test(value);
    if (!validSlug(query.jurisdiction) || WORKSPACE_KEYS.slice(1).some(key => query[key] !== undefined && !validSlug(query[key]))) {
        fail();
    }
    const orgs = WORKSPACE_KEYS.slice(1).flatMap(key => query[key] === undefined ? [] : [query[key]]);
    if (new Set(orgs).size > 1) fail();
}

function workspaceGroupId(workspace: AdminWorkspace): number {
    const id = workspace.internalId;
    if (!id || !Number.isSafeInteger(id) || id < 1 || id > 9999999999) docgenError('docgen.scope_required', 400);
    return id;
}

/** True when a template scope group belongs to the selected workspace's tenant. */
async function scopeInWorkspace(event: H3Event, workspace: AdminWorkspace, scope: { id: number, type: string } | null): Promise<boolean> {
    if (!scope?.id) return false;
    if (scope.id === workspace.internalId) return true;
    if (workspace.type === 'organisation') return scope.type === 'jurisdiction' && scope.id === workspace.jurisdictionInternalId;
    if (scope.type === 'jurisdiction') return scope.id === workspace.jurisdictionInternalId;
    // An organisation template seen from its municipality's workspace.
    const visible = await fetchVisibleAdminWorkspaces(event);
    return visible.some(item => item.type === 'organisation' && item.internalId === scope.id && item.jurisdictionInternalId === workspace.jurisdictionInternalId);
}

async function readUpstreamJson(response: { ok: boolean, status: number, json: <T = unknown>() => Promise<T>, headers: Record<string, string | string[] | undefined> }): Promise<unknown> {
    let payload: unknown = null;
    try {
        payload = await response.json();
    } catch {
        payload = null;
    }
    if (!response.ok) failFromUpstream(response.status, payload, response.headers);
    return payload;
}

function failFromUpstream(status: number, payload: unknown, headers: Record<string, string | string[] | undefined> = {}): never {
    const error = payload && typeof payload === 'object' && 'error' in payload ? (payload as { error?: unknown }).error : null;
    const data = error && typeof error === 'object' ? error as Json : {};
    const statusCode = UPSTREAM_STATUSES.includes(status) ? status : 502;
    let code = isDocgenErrorCode(data.code) ? data.code : null;
    // Drupal's own 403 (no session) carries no envelope.
    if (!code) code = status === 401 || status === 403 ? 'docgen.access_denied' : status === 404 ? 'docgen.route_not_found' : 'docgen.internal_error';
    const details = sanitizeDocgenDetails(data.details);
    if (code === 'docgen.busy' && details.retryAfter === undefined) {
        const header = Number(Array.isArray(headers['retry-after']) ? headers['retry-after'][0] : headers['retry-after']);
        details.retryAfter = Number.isSafeInteger(header) && header >= 1 && header <= 300 ? header : 5;
    }
    return docgenError(code, code === 'docgen.internal_error' && statusCode < 500 ? 502 : statusCode, details);
}

export function headerValue(headers: Record<string, string | string[] | undefined>, name: string): string {
    const value = headers[name.toLowerCase()];
    return (Array.isArray(value) ? value[0] : value) ?? '';
}

/** File name from Drupal's Content-Disposition, reduced to safe characters. */
export function downloadFilename(disposition: string, fallback: string, extension: string): string {
    let name = '';
    const extended = disposition.match(/filename\*=UTF-8''([^;]+)/iu)?.[1];
    if (extended) {
        try {
            name = decodeURIComponent(extended);
        } catch {
            name = '';
        }
    }
    if (!name) name = disposition.match(/filename="([^"]*)"/iu)?.[1] ?? '';
    // eslint-disable-next-line no-control-regex
    name = name.replace(/[\u0000-\u001f\u007f"\\/:*?<>|]/gu, '_').trim().slice(0, 150);
    if (!name || !name.toLowerCase().endsWith(extension)) return fallback;
    return name;
}

export function attachmentDisposition(filename: string): string {
    const ascii = filename.replace(/[^\x20-\x7e]/gu, '_').replace(/["\\]/gu, '_');
    return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

async function proxy(event: H3Event, spec: DocgenRouteSpec, upstreamQuery: URLSearchParams): Promise<unknown> {
    const method = event.method;
    const mutation = method !== 'GET' && method !== 'HEAD';
    let data: Json | null = null;
    if (mutation) {
        const limit = spec.body === 'upload' ? DOCGEN_MAX_UPLOAD_BODY : DOCGEN_MAX_JSON_BODY;
        const declared = Number(getHeader(event, 'content-length'));
        if (Number.isFinite(declared) && declared > limit) docgenError(spec.body === 'upload' ? 'docgen.docx_too_large' : 'docgen.input_too_large', 413);
        const raw = await readBoundedBody(event, limit, () => docgenError(spec.body === 'upload' ? 'docgen.docx_too_large' : 'docgen.input_too_large', 413));
        const body = parseJsonBody(raw, getHeader(event, 'content-type') || '');
        data = spec.input ? spec.input(body) : (allowKeys(body, []), {});
    }
    const cookieHeader = getHeader(event, 'cookie') || '';
    const target = upstreamQuery.size ? `${spec.upstream}?${upstreamQuery.toString()}` : spec.upstream;
    if (new URL(target, 'http://docgen.invalid').pathname !== spec.upstream) docgenError('docgen.route_not_found', 404);

    if (spec.download) {
        const response = await drupalSessionRequest(event, target, {
            headers: buildDrupalRequestHeaders(event, { accept: `${spec.download.mime}, application/json`, cookieHeader }),
            maxResponseBytes: DOCGEN_MAX_DOWNLOAD_BYTES
        });
        if (!response.ok) await readUpstreamJson(response);
        const extension = spec.download.mime === PDF_MIME ? '.pdf' : '.docx';
        const filename = downloadFilename(headerValue(response.headers, 'content-disposition'), spec.download.fallback, extension);
        const headers = new Headers({
            'Content-Type': spec.download.mime,
            'Content-Disposition': attachmentDisposition(filename),
            'Cache-Control': 'private, no-store, max-age=0',
            'Pragma': 'no-cache',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': 'sandbox allow-same-origin allow-downloads'
        });
        return new Response(await response.arrayBuffer(), { status: 200, headers });
    }

    const headers = mutation
        ? buildDrupalRequestHeaders(event, { accept: 'application/json', contentType: 'application/json', cookieHeader })
        : buildDrupalRequestHeaders(event, { accept: 'application/json', cookieHeader });
    if (mutation) headers['X-CSRF-Token'] = await fetchCsrfToken(cookieHeader, event);
    const hasBody = mutation && data && Object.keys(data).length > 0;
    const response = await drupalSessionRequest(event, target, {
        method,
        headers,
        maxResponseBytes: MAX_JSON_RESPONSE,
        ...(hasBody ? { body: JSON.stringify({ data }) } : {})
    });
    const payload = await readUpstreamJson(response);
    const envelope = payload && typeof payload === 'object' ? (payload as { data?: unknown }).data : undefined;
    setResponseStatus(event, spec.created ? 201 : 200);
    return { data: spec.sanitize ? spec.sanitize(envelope) : envelope };
}

async function prepare(event: H3Event, extraQuery: string[], bucket: 'admin' | 'bulk_sichtung_auth' | 'admin_read' = 'admin') {
    preserveIntegrationNoStore(event);
    setPrivateNoStore(event);
    const mutation = event.method !== 'GET' && event.method !== 'HEAD';
    if (event.method === 'HEAD') docgenError('docgen.route_not_found', 405);
    if (mutation) requireSameOriginRequest(event);
    let user;
    if (bucket === 'admin_read') user = await rateLimitCaseRead(event, requireStaff);
    else checkRateLimit(getClientIp(event), bucket, event);
    const query = getQuery(event);
    if (Object.keys(query).some(key => !WORKSPACE_KEYS.includes(key) && !extraQuery.includes(key))) docgenError('docgen.unknown_key', 400);
    return { mutation, user: user ?? await requireStaff(event) };
}

/**
 * Marks form settings whose catalog is the selected workspace's catalog, so
 * the editor only links to a catalog that lists the form's templates.
 */
function markCatalogInWorkspace(result: unknown, workspaceId: number): void {
    const data = (result as { data?: unknown } | null)?.data;
    if (!data || typeof data !== 'object') return;
    const settings = ('settings' in data ? (data as { settings?: unknown }).settings : data) as { scope?: { id?: number }, catalogInWorkspace?: boolean } | undefined;
    if (settings && typeof settings === 'object' && 'catalogInWorkspace' in settings) {
        settings.catalogInWorkspace = settings.scope?.id === workspaceId;
    }
}

function handleFailure(event: H3Event, error: unknown, area: string): never {
    const failure = error as { statusCode?: number, data?: { code?: unknown, seconds?: unknown } };
    const status = failure?.statusCode;
    const code = failure?.data?.code;
    if (!status || status >= 500) console.error(`[docgen] ${area} proxy failure`, { method: event.method, status: status || 500, code: typeof code === 'string' && isDocgenErrorCode(code) ? code : undefined });
    if (typeof code === 'string' && code.startsWith('docgen.')) throw error;
    if (code === 'errors.workspace.required') docgenError('docgen.workspace_required', 400);
    // Session or origin problems are no missing permission: the person has
    // to reload or sign in again (the UI redirects to the login on 401).
    if (status === 401) docgenError('docgen.csrf_invalid', 401);
    if (typeof code === 'string' && code.startsWith('errors.security.')) docgenError('docgen.csrf_invalid', 403);
    if (status === 403) docgenError('docgen.access_denied', 403);
    if (status === 429) {
        // The UI waits as long as the limiter says (same field as docgen.busy).
        const seconds = Number(failure?.data?.seconds);
        docgenError('docgen.rate_limited', 429, Number.isSafeInteger(seconds) && seconds >= 1 ? { retryAfter: Math.min(seconds, 300) } : {});
    }
    if (status === 413) docgenError('docgen.input_too_large', 413);
    return docgenError(docgenCode(null), 500);
}

/** /api/admin/docgen/** */
export async function handleDocgenAdmin(event: H3Event): Promise<unknown> {
    try {
        const { mutation } = await prepare(event, ['lang']);
        let path: string;
        try {
            path = decodeURIComponent(getRouterParam(event, 'path') || '');
        } catch {
            return docgenError('docgen.route_not_found', 404);
        }
        const query = getQuery(event);
        const spec = docgenAdminRoute(path, event.method, query as Json);
        if (query.lang !== undefined && !spec.query?.lang) docgenError('docgen.unknown_key', 400);
        if (mutation) requireWorkspaceSelector(event);
        if (spec.action) checkRateLimit(getClientIp(event), 'docgen_action', event);
        const upstreamQuery = new URLSearchParams(spec.query ?? {});
        let formWorkspaceId: number | null = null;
        if (spec.binding !== 'none') {
            const workspace = await resolveRequiredAdminWorkspace(event);
            if (spec.binding === 'workspace') {
                upstreamQuery.set('scope', String(workspaceGroupId(workspace)));
            } else if (spec.binding === 'form') {
                // The form must belong to the selected workspace (organisation
                // forms only inside their organisation's workspace).
                const lookup = new URLSearchParams({ 'filter[id]': spec.resourceId!, 'fields[form_schema--form_schema]': 'drupal_internal__id', 'page[limit]': '1' });
                await applyAdminJurisdictionFilter(event, lookup, 'field_jurisdiction', { required: true });
                const form = await drupalSessionFetch<{ data?: Array<{ id?: string }> }>(event, `/jsonapi/form_schema/form_schema?${lookup.toString()}`, { maxResponseBytes: 64 * 1024 });
                if (!form.data?.some(item => item.id?.toLowerCase() === spec.resourceId)) docgenError('docgen.form_not_found', 404);
                formWorkspaceId = workspace.internalId ?? null;
            } else {
                const cookieHeader = getHeader(event, 'cookie') || '';
                const response = await drupalSessionRequest(event, `/api/admin/docgen/templates/${spec.resourceId}`, {
                    headers: buildDrupalRequestHeaders(event, { accept: 'application/json', cookieHeader }),
                    maxResponseBytes: MAX_JSON_RESPONSE
                });
                const payload = await readUpstreamJson(response);
                const detail = sanitizeTemplateDetail((payload as { data?: unknown } | null)?.data);
                if (!await scopeInWorkspace(event, workspace, detail.scope)) docgenError('docgen.template_not_found', 404);
                if (event.method === 'GET' && !spec.download) {
                    setResponseStatus(event, 200);
                    return { data: detail };
                }
            }
        }
        const result = await proxy(event, spec, upstreamQuery);
        if (formWorkspaceId !== null) markCatalogInWorkspace(result, formWorkspaceId);
        return result;
    } catch (error) {
        return handleFailure(event, error, 'catalog');
    }
}

/** /api/admin/applications/{uuid}/docgen/** with `path` below docgen. */
export async function handleDocgenCase(event: H3Event, path: string): Promise<unknown> {
    try {
        // Only the three preview steps and the request letter's cover sheet
        // may use the Sichtung budget. The marker is a routing hint, never
        // authorization: the scoped lookup also requires bulk origin.
        const previewPath = /^documents\/([0-9a-f-]{36})\/(preview|pdf|viewed|cover-pdf)$/iu.exec(path);
        const sichtung = getHeader(event, 'x-bulk-sichtung') === '1' && !!previewPath
          && isUuid(previewPath[1]) && event.method === (previewPath[2] === 'pdf' || previewPath[2] === 'cover-pdf' ? 'GET' : 'POST');
        const overview = event.method === 'GET' && path === '';
        const { mutation, user } = await prepare(event, [], overview ? 'admin_read' : sichtung ? 'bulk_sichtung_auth' : 'admin');
        if (sichtung) checkRateLimit(`bulk-user:${user.uid}`, 'bulk_sichtung', event);
        const id = getRouterParam(event, 'id') || '';
        const numericId = sichtung && /^[1-9]\d*$/u.test(id) && Number.isSafeInteger(Number(id));
        if (!isUuid(id) && !numericId) docgenError('docgen.input_invalid', 400, { field: 'application' });
        // Route shape first, without the internal id, so bad paths never reach Drupal.
        const shape = docgenCaseRoute(path, event.method, 1);
        if (mutation) requireWorkspaceSelector(event);
        if (shape.action) checkRateLimit(sichtung ? `bulk-user:${user.uid}` : getClientIp(event), 'docgen_action', event);
        const lookup = new URLSearchParams({ [numericId ? 'filter[drupal_internal__id]' : 'filter[id]']: id.toLowerCase(), 'fields[application--application]': sichtung ? 'drupal_internal__id,field_origin' : 'drupal_internal__id', 'page[limit]': '1' });
        if (sichtung) lookup.set('filter[field_origin]', 'bulk');
        await applyAdminJurisdictionFilter(event, lookup, 'field_jurisdiction', { required: true });
        const scoped = await drupalSessionFetch<{ data?: Array<{ attributes?: { drupal_internal__id?: number | string, field_origin?: string } }> }>(event, `/jsonapi/application/application?${lookup.toString()}`, { maxResponseBytes: 64 * 1024 });
        if (sichtung && scoped.data?.[0]?.attributes?.field_origin !== 'bulk') docgenError('docgen.application_not_found', 404);
        const internalId = Number(scoped.data?.[0]?.attributes?.drupal_internal__id);
        if (!Number.isSafeInteger(internalId) || internalId < 1) docgenError('docgen.application_not_found', 404);
        if (numericId && internalId !== Number(id)) docgenError('docgen.application_not_found', 404);
        return await proxy(event, docgenCaseRoute(path, event.method, internalId), new URLSearchParams());
    } catch (error) {
        return handleFailure(event, error, 'case');
    }
}
