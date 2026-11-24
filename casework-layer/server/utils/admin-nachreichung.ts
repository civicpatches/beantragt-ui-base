/**
 * Nuxt proxy of the Nachreichung staff API (beantragt_nachreichung, step 1).
 * Internal routes, Nuxt proxy only (no /api/v1, no OpenAPI, no Bruno):
 *
 * - GET  /api/admin/applications/{uuid}/nachreichung                         card
 * - POST /api/admin/applications/{uuid}/cover-sheet                          "Deckblatt drucken" (PDF/A)
 * - POST /api/admin/applications/{uuid}/cover-sheets/{coverUuid}/revoke      "Deckblatt sperren"
 * - POST /api/admin/applications/{uuid}/nachforderung/{requestUuid}/deadline "Frist der Nachforderung verlängern" (step 2)
 * - POST /api/admin/applications/{uuid}/nachreichung/{entryUuid}/remove      "Vom Antrag entfernen" (step 2)
 * - POST /api/admin/applications/{uuid}/nachreichung/{entryUuid}/reassign    "Neu zuordnen" (step 2)
 *
 * Same boundary as the docgen case proxy (admin-docgen.ts): no-store, HEAD
 * refused, same origin on POST, a rate-limited staff session,
 * only workspace keys in the query, an explicit workspace on POST, the
 * application resolved through JSON:API inside the selected workspace, the
 * session decides access (never a service account), CSRF on POST. Drupal
 * decides the gate (protected data), the limit of active cover sheets and
 * the audit; every body is checked here first and every answer passes the
 * allowlist. The card never carries an identifier, its hash, the QR hash or
 * the key version, and the proxy would drop them if Drupal sent them.
 */
import { requireCaseStaff } from '~~/server/utils/case-read';
import type { H3Event } from 'h3';
import { requireSameOriginRequest, setPrivateNoStore } from '~~/server/utils/request-security';
import { createSafeError } from '~~/server/utils/error-handling';
import { isDocgenErrorCode } from '~~/app/utils/docgen-codes';
import {
    NACHREICHUNG_COVER_ORIGINS,
    NACHREICHUNG_COVER_STATES,
    NACHREICHUNG_DEADLINE_REASONS,
    NACHREICHUNG_ENTRY_DECISIONS,
    NACHREICHUNG_PRINT_BLOCKERS,
    NACHREICHUNG_PROOF_REASONS,
    NACHREICHUNG_PROOF_STATUSES,
    NACHREICHUNG_RECEIVED_ON_SOURCES,
    NACHREICHUNG_REQUEST_STATES,
    NACHREICHUNG_REVERT_MODES,
    NACHREICHUNG_REVOKE_REASONS,
    isNachreichungDeadlineReason,
    isNachreichungErrorCode,
    isNachreichungRevokeReason,
    nachreichungCode,
    type NachreichungDeadlineReason,
    type NachreichungRevokeReason
} from '~~/app/utils/nachreichung-codes';
import type { NachreichungCard, NachreichungCover, NachreichungEntry, NachreichungEntryResult, NachreichungRequest } from '~~/casework-layer/app/types/nachreichung';
import { applyAdminJurisdictionFilter } from '~~/casework-layer/server/utils/admin-workspace';
import { attachmentDisposition, downloadFilename, headerValue, requireWorkspaceSelector, WORKSPACE_KEYS } from './admin-docgen';
import { readBoundedBody } from './bounded-body';
import { isUuid } from './docgen-contract';
import { preserveIntegrationNoStore } from './integration-no-store';

export type NachreichungAction = 'card' | 'print' | 'revoke' | 'deadline' | 'remove' | 'reassign';

type Json = Record<string, unknown>;

/** Client bodies: print sends nothing, revoke one reason. */
export const NACHREICHUNG_MAX_BODY = 4096;
/** A one-page cover sheet PDF/A stays far below this. */
export const NACHREICHUNG_MAX_PDF_BYTES = 2 * 1024 * 1024;
/** At most 50 requests and 50 cover sheets per card. */
export const NACHREICHUNG_MAX_LIST = 50;
const MAX_JSON_RESPONSE = 256 * 1024;
const PDF_MIME = 'application/pdf';
const UPSTREAM_STATUSES = [400, 401, 403, 404, 405, 409, 413, 415, 422, 429, 500, 502, 503];
const DAY = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/u;
/** A requested proof key of the request record: `<fieldId>#` or `<fieldId>#<section>#<index>`. */
const PROOF_KEY = /^[a-z][a-z0-9_]{0,127}#(?:[a-z][a-z0-9_]{0,127}#\d{1,3})?$/u;
/** At most 60 attachments per receipt (one per file of an envelope) and 20 unmet criteria per proof. */
const MAX_ATTACHMENTS = 60;
const MAX_CRITERIA = 20;

/** Throws a proxy error with a Nachreichung code (unknown codes become internal_error). */
export function nachreichungError(code: string, statusCode = 400, details: Json = {}): never {
    const safe = nachreichungCode(code);
    throw createSafeError({ statusCode, message: safe, data: { code: safe, ...details } });
}

/** Forwards a code Drupal sent: Nachreichung or docgen vocabulary only. */
function forwardedError(code: string, statusCode: number, details: Json): never {
    const safe = isDocgenErrorCode(code) ? code : nachreichungCode(code);
    throw createSafeError({ statusCode, message: safe, data: { code: safe, ...details } });
}

const record = (value: unknown): Json => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};
const nullableInt = (value: unknown, max = Number.MAX_SAFE_INTEGER): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max ? value : null;
const count = (value: unknown, max: number): number => nullableInt(value, max) ?? 0;
const day = (value: unknown): string | null => typeof value === 'string' && DAY.test(value) ? value : null;
const oneOf = <T extends string>(values: readonly T[], value: unknown): T | null => typeof value === 'string' && (values as readonly string[]).includes(value) ? value as T : null;

function sanitizeRequest(value: unknown): NachreichungRequest | null {
    const item = record(value);
    const state = oneOf(NACHREICHUNG_REQUEST_STATES, item.state);
    if (!isUuid(item.id) || !state) return null;
    return {
        id: item.id.toLowerCase(),
        state,
        releasedAt: nullableInt(item.releasedAt),
        deadlinePrinted: day(item.deadlinePrinted),
        deadline: day(item.deadline),
        extended: item.extended === true,
        deadlineReason: oneOf(NACHREICHUNG_DEADLINE_REASONS, item.deadlineReason),
        // Only a waiting request can be extended (3.12); Drupal decides the permission.
        canExtend: item.canExtend === true && (state === 'open' || state === 'partly_answered')
    };
}

/** "Antragsteller" or "Haushaltsmitglied n": a closed shape, so no name can pass as a person label. */
const personLabel = (value: unknown): string | null => typeof value === 'string' && /^(?:Antragsteller|Haushaltsmitglied \d{1,3})$/u.test(value) ? value : null;
const boundedText = (value: unknown, max: number): string | null => typeof value === 'string' && value.trim() !== '' && value.length <= max ? value : null;
const pages = (value: unknown): number[] => Array.isArray(value) ? value.map(page => nullableInt(page, 1000)).filter((page): page is number => page !== null && page >= 1).slice(0, 30) : [];

function sanitizeResult(value: unknown): NachreichungEntryResult | null {
    const item = record(value);
    const status = oneOf(NACHREICHUNG_PROOF_STATUSES, item.status);
    if (typeof item.key !== 'string' || !PROOF_KEY.test(item.key) || !status) return null;
    const reason = status === 'insufficient' ? oneOf(NACHREICHUNG_PROOF_REASONS, item.reason) : null;
    return {
        key: item.key,
        label: boundedText(item.label, 200),
        personLabel: personLabel(item.personLabel),
        status,
        reason,
        // Criterion titles of the record's form revision, only for an unmet requirement.
        criteria: reason === 'requirement_not_met' && Array.isArray(item.criteria)
            ? item.criteria.map(title => boundedText(title, 500)).filter((title): title is string => title !== null).slice(0, MAX_CRITERIA)
            : []
    };
}

/** One receipt (Vermerk) of section 3.13: dates, decision, results and attachment UUIDs; never a file name, a name or an identifier. */
function sanitizeEntry(value: unknown): NachreichungEntry | null {
    const item = record(value);
    const decision = oneOf(NACHREICHUNG_ENTRY_DECISIONS, item.decision);
    if (!isUuid(item.id) || !decision) return null;
    const reverted = record(item.reverted);
    const mode = oneOf(NACHREICHUNG_REVERT_MODES, reverted.mode);
    const canRemove = item.canRemove === true && !mode;
    return {
        id: item.id.toLowerCase(),
        receivedOn: day(item.receivedOn),
        receivedOnSource: oneOf(NACHREICHUNG_RECEIVED_ON_SOURCES, item.receivedOnSource),
        batchReceivedOn: day(item.batchReceivedOn),
        decision,
        decidedAt: nullableInt(item.decidedAt),
        identityConfirmed: item.identityConfirmed === true,
        cover: item.cover === true,
        pageCount: count(item.pageCount, 1000),
        results: sanitizeList(item.results, sanitizeResult),
        attachments: (Array.isArray(item.attachments) ? item.attachments.slice(0, MAX_ATTACHMENTS) : []).flatMap((entry) => {
            const attachment = record(entry);
            return isUuid(attachment.id) ? [{ id: attachment.id.toLowerCase(), coverPages: pages(attachment.coverPages) }] : [];
        }),
        reverted: mode ? { at: nullableInt(reverted.at), mode } : null,
        canRemove,
        canReassign: canRemove && item.canReassign === true
    };
}

function sanitizeCover(value: unknown): NachreichungCover | null {
    const item = record(value);
    const origin = oneOf(NACHREICHUNG_COVER_ORIGINS, item.origin);
    const state = oneOf(NACHREICHUNG_COVER_STATES, item.state);
    if (!isUuid(item.id) || !origin || !state) return null;
    return {
        id: item.id.toLowerCase(),
        origin,
        state,
        createdAt: nullableInt(item.createdAt),
        activatedAt: nullableInt(item.activatedAt),
        revokedAt: nullableInt(item.revokedAt),
        revokeReason: oneOf(NACHREICHUNG_REVOKE_REASONS, item.revokeReason)
    };
}

function sanitizeList<T>(value: unknown, map: (item: unknown) => T | null): T[] {
    if (!Array.isArray(value)) return [];
    return value.slice(0, NACHREICHUNG_MAX_LIST).map(map).filter((item): item is T => item !== null);
}

/**
 * The card of section 9 of the step-1 contract plus the receipts and the
 * request fields of step 2, field by field.
 */
export function sanitizeNachreichungCard(value: unknown): NachreichungCard {
    const card = record(value);
    const printBlocker = oneOf(NACHREICHUNG_PRINT_BLOCKERS, card.printBlocker);
    return {
        coverSheet: card.coverSheet === true,
        canPrint: card.canPrint === true && printBlocker === null,
        printBlocker,
        canRevoke: card.canRevoke === true,
        activeCount: count(card.activeCount, 1000),
        activeLimit: count(card.activeLimit, 1000),
        nachforderungen: sanitizeList(card.nachforderungen, sanitizeRequest),
        eingaenge: sanitizeList(card.eingaenge, sanitizeEntry),
        deckblaetter: sanitizeList(card.deckblaetter, sanitizeCover)
    };
}

/** Error details the UI may see: wait time and the limit of active cover sheets. */
function sanitizeDetails(value: unknown): Json {
    const details = record(value);
    const result: Json = {};
    const retryAfter = Number(details.retryAfter);
    if (Number.isSafeInteger(retryAfter) && retryAfter >= 1 && retryAfter <= 300) result.retryAfter = retryAfter;
    const limit = Number(details.limit);
    if (Number.isSafeInteger(limit) && limit >= 1 && limit <= 1000) result.limit = limit;
    return result;
}

function failFromUpstream(status: number, payload: unknown, headers: Record<string, string | string[] | undefined> = {}): never {
    const error = record(record(payload).error);
    const statusCode = UPSTREAM_STATUSES.includes(status) ? status : 502;
    const known = typeof error.code === 'string' && (isNachreichungErrorCode(error.code) || isDocgenErrorCode(error.code)) ? error.code : null;
    // Route-level refusals of Drupal (gate, CSRF header, entity lookup) carry no envelope.
    const code = known ?? (status === 401
        ? 'nachreichung.csrf_invalid'
        : status === 403
            ? 'nachreichung.access_denied'
            : status === 404
                ? 'nachreichung.application_not_found'
                : status === 429 ? 'nachreichung.rate_limited' : 'nachreichung.internal_error');
    const details = sanitizeDetails(error.details);
    if ((code === 'nachreichung.busy' || code === 'nachreichung.rate_limited') && details.retryAfter === undefined) {
        const header = Number(headerValue(headers, 'retry-after'));
        details.retryAfter = Number.isSafeInteger(header) && header >= 1 && header <= 300 ? header : 5;
    }
    return forwardedError(code, code === 'nachreichung.internal_error' && statusCode < 500 ? 502 : statusCode, details);
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

type Input = { reason: NachreichungRevokeReason } | { deadline: string, reason: NachreichungDeadlineReason } | null;

/** Reads the bounded client body: nothing for print, remove and reassign, exactly `{reason}` for revoke, `{deadline, reason}` for the extension. */
async function readInput(event: H3Event, action: Exclude<NachreichungAction, 'card'>): Promise<Input> {
    const declared = Number(getHeader(event, 'content-length'));
    if (Number.isFinite(declared) && declared > NACHREICHUNG_MAX_BODY) nachreichungError('nachreichung.input_invalid', 413);
    const raw = await readBoundedBody(event, NACHREICHUNG_MAX_BODY, () => nachreichungError('nachreichung.input_invalid', 413));
    let body: Json = {};
    if (raw?.trim()) {
        if ((getHeader(event, 'content-type') || '').split(';')[0]?.trim().toLowerCase() !== 'application/json') nachreichungError('nachreichung.input_invalid', 400);
        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch {
            return nachreichungError('nachreichung.input_invalid', 400);
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) nachreichungError('nachreichung.input_invalid', 400);
        body = parsed as Json;
    }
    const allowed = action === 'revoke' ? ['reason'] : action === 'deadline' ? ['deadline', 'reason'] : [];
    if (Object.keys(body).some(key => !allowed.includes(key))) nachreichungError('nachreichung.input_invalid', 400);
    if (action === 'print' || action === 'remove' || action === 'reassign') return null;
    if (action === 'deadline') {
        // Drupal decides the calendar rules (after the current deadline, at most a year after the printed one).
        if (typeof body.deadline !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(body.deadline) || !isNachreichungDeadlineReason(body.reason)) nachreichungError('nachreichung.input_invalid', 400);
        return { deadline: body.deadline as string, reason: body.reason as NachreichungDeadlineReason };
    }
    if (!isNachreichungRevokeReason(body.reason)) nachreichungError('nachreichung.input_invalid', 400);
    return { reason: body.reason as NachreichungRevokeReason };
}

/** Second router parameter per action: the cover sheet, the request record or the receipt, each a UUID. */
function subjectParam(event: H3Event, action: NachreichungAction): string | null {
    if (action === 'revoke') return getRouterParam(event, 'coverId') || '';
    if (action === 'deadline') return getRouterParam(event, 'requestId') || '';
    if (action === 'remove' || action === 'reassign') return getRouterParam(event, 'entryId') || '';
    return null;
}

function upstreamPath(base: string, action: NachreichungAction, subject: string | null): string {
    switch (action) {
        case 'revoke': return `${base}/cover-sheets/${subject!.toLowerCase()}/revoke`;
        case 'deadline': return `${base}/nachforderung/${subject!.toLowerCase()}/deadline`;
        case 'remove': case 'reassign': return `${base}/nachreichung/${subject!.toLowerCase()}/${action}`;
        default: return `${base}/nachreichung`;
    }
}

/** Internal id of the application, only when it lies in the selected workspace. */
async function scopedApplication(event: H3Event, id: string): Promise<number> {
    const lookup = new URLSearchParams({ 'filter[id]': id.toLowerCase(), 'fields[application--application]': 'drupal_internal__id', 'page[limit]': '1' });
    await applyAdminJurisdictionFilter(event, lookup, 'field_jurisdiction', { required: true });
    const scoped = await drupalSessionFetch<{ data?: Array<{ attributes?: { drupal_internal__id?: number | string } }> }>(event, `/jsonapi/application/application?${lookup.toString()}`, { maxResponseBytes: 64 * 1024 });
    const internalId = Number(scoped.data?.[0]?.attributes?.drupal_internal__id);
    if (!Number.isSafeInteger(internalId) || internalId < 1) nachreichungError('nachreichung.application_not_found', 404);
    return internalId;
}

function startsWithPdfSignature(bytes: ArrayBuffer): boolean {
    const head = new Uint8Array(bytes, 0, Math.min(5, bytes.byteLength));
    return head.length === 5 && String.fromCharCode(...head) === '%PDF-';
}

/** Streams the cover sheet PDF/A as an attachment; anything else than a PDF becomes internal_error. */
async function forwardPrint(event: H3Event, upstream: string, cookieHeader: string): Promise<Response> {
    const headers = buildDrupalRequestHeaders(event, { accept: `${PDF_MIME}, application/json`, contentType: 'application/json', cookieHeader });
    headers['X-CSRF-Token'] = await fetchCsrfToken(cookieHeader, event);
    const response = await drupalSessionRequest(event, upstream, { method: 'POST', headers, maxResponseBytes: NACHREICHUNG_MAX_PDF_BYTES });
    if (!response.ok) await readUpstreamJson(response);
    if (headerValue(response.headers, 'content-type').split(';')[0]?.trim().toLowerCase() !== PDF_MIME) nachreichungError('nachreichung.internal_error', 502);
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > NACHREICHUNG_MAX_PDF_BYTES || !startsWithPdfSignature(bytes)) nachreichungError('nachreichung.internal_error', 502);
    const filename = downloadFilename(headerValue(response.headers, 'content-disposition'), 'deckblatt.pdf', '.pdf');
    return new Response(bytes, {
        status: 200,
        headers: new Headers({
            'Content-Type': PDF_MIME,
            'Content-Disposition': attachmentDisposition(filename),
            'Cache-Control': 'private, no-store, max-age=0',
            'Pragma': 'no-cache',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': 'sandbox allow-same-origin allow-downloads'
        })
    });
}

function handleFailure(event: H3Event, error: unknown): never {
    const failure = error as { statusCode?: number, data?: { code?: unknown, seconds?: unknown } };
    const status = failure?.statusCode;
    const code = failure?.data?.code;
    const own = typeof code === 'string' && (isNachreichungErrorCode(code) || isDocgenErrorCode(code));
    if (!status || status >= 500) console.error('[nachreichung] proxy failure', { method: event.method, status: status || 500, code: own ? code : undefined });
    if (own) throw error;
    if (code === 'errors.workspace.required') nachreichungError('nachreichung.workspace_required', 400);
    // Session or origin problems are no missing permission: the person has
    // to reload or sign in again (the UI redirects to the login on 401).
    if (status === 401) nachreichungError('nachreichung.csrf_invalid', 401);
    if (typeof code === 'string' && code.startsWith('errors.security.')) nachreichungError('nachreichung.csrf_invalid', 403);
    if (status === 403) nachreichungError('nachreichung.access_denied', 403);
    if (status === 429) {
        const seconds = Number(failure?.data?.seconds);
        nachreichungError('nachreichung.rate_limited', 429, { retryAfter: Number.isSafeInteger(seconds) && seconds >= 1 ? Math.min(seconds, 300) : 5 });
    }
    if (status === 413) nachreichungError('nachreichung.input_invalid', 413);
    return nachreichungError('nachreichung.internal_error', 500);
}

/** One dispatcher for the six route files. */
export async function handleNachreichung(event: H3Event, action: NachreichungAction): Promise<unknown> {
    try {
        preserveIntegrationNoStore(event);
        setPrivateNoStore(event);
        const mutation = action !== 'card';
        if (event.method !== (mutation ? 'POST' : 'GET')) nachreichungError('nachreichung.input_invalid', 405);
        if (mutation) requireSameOriginRequest(event);
        const user = await requireCaseStaff(event, !mutation);
        if (Object.keys(getQuery(event)).some(key => !WORKSPACE_KEYS.includes(key))) nachreichungError('nachreichung.input_invalid', 400);
        if (mutation) requireWorkspaceSelector(event, () => nachreichungError('nachreichung.workspace_required', 400));
        const id = getRouterParam(event, 'id') || '';
        const subject = subjectParam(event, action);
        if (!isUuid(id) || (subject !== null && !isUuid(subject))) nachreichungError('nachreichung.input_invalid', 400);
        const input = action === 'card' ? null : await readInput(event, action);
        // A refused body never uses up the print budget.
        if (action === 'print') checkRateLimit(`nachreichung-user:${user.uid}`, 'nachreichung_print', event);
        const internalId = await scopedApplication(event, id);
        const base = `/api/admin/applications/${internalId}`;
        const cookieHeader = getHeader(event, 'cookie') || '';
        if (action === 'print') return await forwardPrint(event, `${base}/cover-sheet`, cookieHeader);

        const upstream = upstreamPath(base, action, subject);
        const headers = mutation
            ? buildDrupalRequestHeaders(event, { accept: 'application/json', contentType: 'application/json', cookieHeader })
            : buildDrupalRequestHeaders(event, { accept: 'application/json', cookieHeader });
        if (mutation) headers['X-CSRF-Token'] = await fetchCsrfToken(cookieHeader, event);
        const response = await drupalSessionRequest(event, upstream, {
            method: mutation ? 'POST' : 'GET',
            headers,
            maxResponseBytes: MAX_JSON_RESPONSE,
            ...(input ? { body: JSON.stringify({ data: input }) } : {})
        });
        const payload = await readUpstreamJson(response);
        setResponseStatus(event, 200);
        return { data: sanitizeNachreichungCard(record(payload).data) };
    } catch (error) {
        return handleFailure(event, error);
    }
}
