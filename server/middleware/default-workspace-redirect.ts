import { createRouterMatcher } from 'vue-router';
import { pages } from '#ui-mode-manifest';
import { normalizeLocalReturnPath, publicWorkspacePath } from '../../app/utils/public-form-path';
import type { UiPage } from '../../shared/ui-mode';
import { fullyDecoded } from '../../shared/ui-path';
import { validatePublicJurisdictionSlug } from '../utils/jurisdiction-settings';
import { loadPublicJurisdictionConfig } from '../utils/public-jurisdiction-config';
import { withPublicLookupTimeout } from '../utils/public-lookup';
import { isPublicWorkspaceDocumentRequest, publicWorkspaceRouteScope } from '../utils/public-workspace-route';
import { setPrivateNoStore } from '../utils/request-security';

const WORKSPACE_PREFIX = /^\/:workspace(?=\/|$)(?!\/:)/u;
const ROOT_ROUTE = { path: '/', params: {}, name: undefined, matched: [], meta: {} };

function workspaceRouteMatcher(records: UiPage[]) {
    // Match the suffix of a real jurisdiction page. Generic organisation
    // home routes would otherwise match unrelated paths like /<slug>/health.
    const matcher = createRouterMatcher(records
        .filter(page => WORKSPACE_PREFIX.test(page.path))
        .map(page => ({
            path: page.path.replace(WORKSPACE_PREFIX, '') || '/',
            name: page.path,
            component: {}
        })), {});

    return (path: string): string | null => {
        if (publicWorkspaceRouteScope(path.toLowerCase())) return null;
        const match = matcher.resolve({ path }, ROOT_ROUTE);
        if (!match.name) return null;
        if (path === path.toLowerCase()) return path;

        // Vue Router accepts mixed case. Use the route's spelling for the
        // static segments while keeping the original encoded parameters.
        const canonical = matcher.resolve({ name: match.name, params: match.params }, ROOT_ROUTE).path;
        return canonical !== '/' && path.endsWith('/') ? `${canonical}/` : canonical;
    };
}

const publicRouteSuffix = workspaceRouteMatcher(pages.filter(page => page.access === 'open'));
const returnRouteSuffix = workspaceRouteMatcher(pages);

let workspacePathLookup: Promise<string | null> | undefined;
let workspacePathFailedAt = 0;
/** A failed lookup (e.g. Drupal still starting) is retried after this delay instead of disabling redirects for good. */
const FAILED_LOOKUP_RETRY_MS = 60_000;

async function resolveWorkspacePath(value: string, apiBase: string): Promise<string | null> {
    try {
        const jurisdictionSlug = validatePublicJurisdictionSlug(value);
        const path = publicWorkspacePath({ jurisdictionSlug });
        if (!apiBase || !publicWorkspaceRouteScope(path)?.valid) throw new Error();
        await withPublicLookupTimeout(signal => loadPublicJurisdictionConfig(apiBase, jurisdictionSlug, signal));
        return path;
    } catch {
        console.warn('[default-workspace] NUXT_PUBLIC_DEFAULT_WORKSPACE could not be resolved via the public jurisdiction config. Redirects pause and the lookup is retried in 60 seconds.');
        return null;
    }
}

function redirectQuery(url: URL, workspacePath: string): string {
    const values = url.searchParams.getAll('redirect');
    const targets = values.map((value) => {
        const target = normalizeLocalReturnPath(value);
        if (!target) return null;
        const path = new URL(target, url).pathname;
        if (!normalizeLocalReturnPath(fullyDecoded(path))) return null;
        const suffix = returnRouteSuffix(path);
        return suffix ? `${workspacePath}${suffix}${target.slice(path.length)}` : target;
    });
    if (targets.every((target, index) => target === values[index])) return url.search;

    const query = new URLSearchParams();
    // If a duplicate contains an unsafe target, let login use its fallback.
    const hasUnsafeTarget = targets.includes(null);
    let index = 0;
    for (const [key, value] of url.searchParams) {
        if (key === 'redirect' && hasUnsafeTarget) continue;
        const target = key === 'redirect' ? targets[index++] ?? null : value;
        if (target !== null) query.append(key, target);
    }
    const search = query.toString();
    return search ? `?${search}` : '';
}

export default defineEventHandler(async (event) => {
    const config = useRuntimeConfig(event);
    if (config.public.defaultWorkspace === '') return;

    const url = getRequestURL(event);
    const base = config.app.baseURL.replace(/\/$/u, '');
    if (base && url.pathname !== base && !url.pathname.startsWith(`${base}/`)) return;
    const path = url.pathname.slice(base.length) || '/';
    if (!isPublicWorkspaceDocumentRequest(getMethod(event), path, getHeader(event, 'accept'))) return;
    const suffix = publicRouteSuffix(path);
    if (!suffix) return;

    // Cache successes and the in-flight lookup; retry a failure after a short pause.
    if (workspacePathLookup && workspacePathFailedAt && Date.now() - workspacePathFailedAt > FAILED_LOOKUP_RETRY_MS) {
        workspacePathLookup = undefined;
        workspacePathFailedAt = 0;
    }
    workspacePathLookup ??= resolveWorkspacePath(config.public.defaultWorkspace, config.apiBase);
    const workspacePath = await workspacePathLookup;
    if (!workspacePath) {
        workspacePathFailedAt ||= Date.now();
        return;
    }

    setPrivateNoStore(event);
    return sendRedirect(event, `${base}${workspacePath}${suffix}${redirectQuery(url, workspacePath)}`, 302);
});
