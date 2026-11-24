/**
 * GET /api/v1/jurisdictions/:slug/documents/:id/file
 *
 * Anonymous proxy for the file of a public editorial download. The document
 * list hands out Drupal's path relative to `NUXT_PUBLIC_API_BASE`; where that
 * base is the UI host (public demo, Drupal not routed), this route serves it.
 * Drupal still decides visibility; this route only narrows what passes.
 */
import { createSafeError } from '../../../../../../utils/error-handling';
import { checkRateLimit, getClientIp } from '../../../../../../utils/rate-limit';
import { validatePublicJurisdictionSlug } from '../../../../../../utils/jurisdiction-settings';
import { normalizePublicWorkspaceSlug } from '../../../../../../utils/public-workspace';
import { getOptionalServiceAuthHeader } from '../../../../../../utils/auth';
import { serviceProxyRateLimitIdentifier } from '../../../../../../utils/public-status-proxy';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PLACEMENTS = new Set(['footer', 'org_start', 'form_intro', 'form_downloads', 'form_sidebar', 'submission_success']);
const MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const MAX_BYTES = 20 * 1024 * 1024;

function notFound(): never {
    throw createSafeError({
        statusCode: 404,
        message: 'errors.content.documentNotFound',
        data: { code: 'errors.content.documentNotFound' }
    });
}

function single(value: unknown): string | null {
    const raw = Array.isArray(value) ? value[0] : value;
    return typeof raw === 'string' ? raw.trim().toLowerCase() : null;
}

/**
 * Rebuilds the only query Drupal accepts here, from validated values.
 */
export function publicDocumentFileQuery(query: Record<string, unknown>): URLSearchParams {
    const allowed = new Set(['placement', 'form', 'organisation']);
    if (Object.keys(query).some(key => !allowed.has(key))) notFound();
    const out = new URLSearchParams();
    const placement = single(query.placement);
    if (!placement || !PLACEMENTS.has(placement)) notFound();
    out.set('placement', placement);
    if (query.form !== undefined) {
        const form = single(query.form);
        if (!form || !UUID_PATTERN.test(form)) notFound();
        out.set('form', form);
    }
    if (query.organisation !== undefined) {
        const organisation = normalizePublicWorkspaceSlug(query.organisation);
        if (!organisation) notFound();
        out.set('organisation', organisation);
    }
    return out;
}

/**
 * Reads the body while counting, so a missing Content-Length cannot buffer
 * an unbounded response. Returns null past the limit.
 */
async function readBounded(response: Response): Promise<ArrayBuffer | null> {
    if (!response.body) return new ArrayBuffer(0);
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_BYTES) {
            await reader.cancel();
            return null;
        }
        chunks.push(value);
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return out.buffer;
}

export default defineEventHandler(async (event) => {
    const ip = getClientIp(event);
    checkRateLimit(ip, 'public_document_file', event);

    const slug = validatePublicJurisdictionSlug(getRouterParam(event, 'slug'));
    const id = single(getRouterParam(event, 'id'));
    if (!id || !UUID_PATTERN.test(id)) notFound();
    const query = publicDocumentFileQuery(getQuery(event));

    const apiBase = useRuntimeConfig().apiBase;
    if (!apiBase) {
        throw createSafeError({
            statusCode: 500,
            message: 'errors.server.configuration',
            data: { code: 'errors.server.configuration' }
        });
    }
    const headers: Record<string, string> = { Accept: [...MIME_TYPES].join(', ') };
    const serviceAuthHeader = getOptionalServiceAuthHeader();
    if (serviceAuthHeader) {
        headers['X-Beantragt-Service-Authorization'] = serviceAuthHeader;
        headers['X-Beantragt-Rate-Limit-Identifier'] = serviceProxyRateLimitIdentifier('public-documents', ip);
    }

    let upstream: Response;
    try {
        upstream = await fetch(
            `${apiBase}/api/v1/jurisdictions/${encodeURIComponent(slug)}/documents/${encodeURIComponent(id)}/file?${query.toString()}`,
            { method: 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(15_000) }
        );
    } catch {
        throw createSafeError({
            statusCode: 502,
            message: 'errors.content.documentLoadFailed',
            data: { code: 'errors.content.documentLoadFailed' }
        });
    }
    if (upstream.status === 404 || upstream.status === 403) notFound();
    if (upstream.status === 429) {
        throw createSafeError({
            statusCode: 429,
            message: 'errors.rateLimit.tooManyRequests',
            data: { code: 'errors.rateLimit.tooManyRequests' }
        });
    }
    const contentType = (upstream.headers.get('content-type') || '').split(';')[0]!.trim().toLowerCase();
    const length = Number(upstream.headers.get('content-length') || '0');
    if (!upstream.ok || !MIME_TYPES.has(contentType) || length > MAX_BYTES) {
        throw createSafeError({
            statusCode: 502,
            message: 'errors.content.documentLoadFailed',
            data: { code: 'errors.content.documentLoadFailed' }
        });
    }
    const body = await readBounded(upstream);
    if (!body) {
        throw createSafeError({
            statusCode: 502,
            message: 'errors.content.documentLoadFailed',
            data: { code: 'errors.content.documentLoadFailed' }
        });
    }
    const responseHeaders = new Headers({
        'Content-Type': contentType,
        'Content-Length': String(body.byteLength),
        // Private: the demo gate guards this route by cookie, and Drupal may
        // unpublish a document at any time.
        'Cache-Control': 'private, max-age=300',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': 'sandbox; default-src \'none\''
    });
    // Always a download: an inline PDF would run on the UI origin.
    const filename = /filename="?([A-Za-z0-9._-]{1,120})"?/u.exec(upstream.headers.get('content-disposition') || '')?.[1];
    responseHeaders.set('Content-Disposition', filename ? `attachment; filename="${filename}"` : 'attachment');
    return new Response(body, { status: 200, headers: responseHeaders });
});
