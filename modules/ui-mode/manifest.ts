import { relative } from 'node:path';
import type { NuxtPage } from 'nuxt/schema';
import type { UiAccess, UiHandler, UiOrigin, UiPage } from '../../shared/ui-mode';

function originOf(root: string, file: string, kind: 'page' | 'handler'): UiOrigin {
    const local = relative(root, file);
    const directory = kind === 'page' ? 'app/pages/' : 'server/';
    if (!file.startsWith('/')) throw new Error(`Unclassified UI ${kind}: ${file}`);
    if (local.startsWith(directory)) return 'base';
    if (local.startsWith(`casework-layer/${directory}`)) return 'casework';
    if (local.startsWith(['pro-layer', directory].join('/'))) return 'pro';
    throw new Error(`Unclassified UI ${kind}: ${file}`);
}

const frameworkHandlers = new Map([
    ['/__nuxt_error', '/@nuxt/nitro-server/dist/runtime/handlers/renderer'],
    // nuxt dev only (Nuxt 4.7+): the dev error overlay channel, bound to a loopback token.
    ['/__nuxt_dev__/error/**', '/@nuxt/nitro-server/dist/runtime/handlers/error-channel'],
    ['/__nuxt_island/**', '#internal/nuxt/island-renderer'],
    ['/api/_nuxt_icon/:collection', '/@nuxt/icon/dist/runtime/server/api'],
    ['/_i18n/:hash/:locale/messages.json', '/@nuxtjs/i18n/dist/runtime/server/routes/messages']
]);

export function checkConflicts(routes: (UiPage | UiHandler)[]) {
    const classes = new Map<string, UiAccess>();
    for (const route of routes) {
        const shape = route.path.replace(/:[\w-]+/gu, ':param').toLowerCase();
        const key = `${'method' in route ? route.method ?? '*' : '*'} ${shape}`;
        if (classes.has(key) && classes.get(key) !== route.access) throw new Error(`Conflicting UI route: ${key}`);
        classes.set(key, route.access);
    }
}

interface Handler {
    route?: string
    handler: string
    method?: string
    middleware?: boolean
}

export function classifyHandlers(root: string, handlers: Handler[]): UiHandler[] {
    const result: UiHandler[] = [];
    for (const record of handlers) {
        if (record.middleware) continue;
        if (!record.route) throw new Error(`Missing handler route: ${record.handler}`);
        const path = record.route;
        const known = frameworkHandlers.get(path);
        const file = record.handler.replace(/\.m?js$/u, '');
        const framework = known && (file === known || (file.includes('/node_modules/') && file.endsWith(known)));
        const origin = framework ? 'nuxt' : originOf(root, record.handler, 'handler');
        let access: UiAccess = origin === 'base' || origin === 'nuxt' ? 'open' : 'closed';
        if (origin === 'base') {
            if (path === '/api/**:path'
              || /^\/api\/(?:internal|ai|intelligence)(?:\/|$)/u.test(path)) {
                access = 'closed';
            }
        }
        result.push({ path, method: record.method, origin, access });
    }
    checkConflicts(result);
    return result;
}

export function classifyPages(root: string, pages: NuxtPage[]): UiPage[] {
    const result: UiPage[] = [];
    const filesByName = new Map<string, string>();
    function index(records: NuxtPage[]) {
        for (const page of records) {
            if (page.file && page.name) filesByName.set(page.name, page.file);
            if (page.children) index(page.children);
        }
    }
    index(pages);
    function visit(records: NuxtPage[], parents: string[], parentClosed: boolean) {
        for (const page of records) {
            const redirect = page.redirect;
            const target = typeof redirect === 'object' && 'name' in redirect ? filesByName.get(String(redirect.name)) : undefined;
            const file = page.file ?? target;
            if (!file) throw new Error(`Unclassified UI page: ${page.path}`);
            const origin = originOf(root, file, 'page');
            const access = parentClosed || origin !== 'base' ? 'closed' : 'open';
            for (const view of Object.values(page.components ?? {})) {
                if (originOf(root, view, 'page') !== origin) throw new Error(`Conflicting UI views: ${page.path}`);
            }
            page.meta = { ...page.meta, uiAccess: access };
            const paths = new Set<string>();
            for (const path of [page.path, ...[page.alias ?? []].flat()]) {
                if (path.startsWith('/')) paths.add(path);
                else for (const parent of parents) paths.add(path ? `${parent.replace(/\/$/u, '')}/${path}` : parent);
            }
            for (const path of paths) result.push({ path, name: page.name, redirect, origin, access });
            if (page.children) visit(page.children, [...paths], access === 'closed');
        }
    }
    visit(pages, ['/'], false);
    checkConflicts(result);
    return result;
}
