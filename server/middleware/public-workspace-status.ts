import type { H3Event } from 'h3';
import { publicStartPath, publicWorkspacePath } from '../../app/utils/public-form-path';
import {
    isPublicWorkspaceDocumentRequest,
    publicWorkspaceRouteExists,
    publicWorkspaceRouteScope
} from '../utils/public-workspace-route';
import { checkRateLimit, getClientIp } from '../utils/rate-limit';

function setNotFoundHeaders(event: H3Event): void {
    setResponseStatus(event, 404, 'Workspace not found');
    setHeader(event, 'Cache-Control', 'private, no-store, max-age=0');
}

/** A slug that can never be a municipality: no app page, a plain answer. */
function invalidWorkspaceResponse(event: H3Event): string {
    setNotFoundHeaders(event);
    setHeader(event, 'Content-Type', 'text/html;charset=utf-8');

    return '<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Seite nicht gefunden</title></head><body><h1>Seite nicht gefunden</h1><p><a href="/">Zur Startseite</a></p></body></html>';
}

/**
 * Unknown municipalities and organisations.
 *
 * The status stays 404 and the answer is never cached. Instead of a bare
 * English HTML page, the app itself answers: on the start path the start
 * page finds no forms and shows "not found" inside the normal frame in the
 * page language (`app/error.vue`); every other path of the unknown
 * workspace is sent there first, so no login or form page renders under a
 * municipality name that does not exist.
 */
export default defineEventHandler(async (event) => {
    const url = getRequestURL(event);
    const method = getMethod(event);
    const accept = getHeader(event, 'accept');

    if (!isPublicWorkspaceDocumentRequest(method, url.pathname, accept)) return;

    const scope = publicWorkspaceRouteScope(url.pathname);
    if (!scope) return;

    if (!scope.valid) {
        return invalidWorkspaceResponse(event);
    }

    checkRateLimit(getClientIp(event), 'workspace_document', event);

    const exists = await publicWorkspaceRouteExists(scope);
    if (exists) return;

    const startPath = publicStartPath(scope);
    const path = (url.pathname.replace(/\/+$/u, '') || '/').toLowerCase();
    if (path !== publicWorkspacePath(scope) && path !== startPath) {
        setHeader(event, 'Cache-Control', 'private, no-store, max-age=0');
        return sendRedirect(event, startPath, 302);
    }

    // Falls through to the app document with status 404 (the Nuxt renderer
    // keeps the status a middleware set).
    setNotFoundHeaders(event);
});
