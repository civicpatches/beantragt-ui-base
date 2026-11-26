import { createRouter, defineEventHandler, type H3Event, type RouterMethod } from 'h3';
import { createRouterMatcher, type RouteRecordRaw } from 'vue-router';
import type { UiHandler, UiPage } from '../../shared/ui-mode';
import { canonicalUiPath, uiPageDocument } from '../../shared/ui-path';
import { isSsoNamespace, ssoOperation } from './sso-routing';

export function uiRoutePolicy(handlers: UiHandler[], pages: UiPage[]) {
    // Use the same method/dynamic/catch-all selection as Nitro, with inert marker handlers.
    const api = createRouter();
    for (const record of handlers) {
        api.use(record.path, defineEventHandler(() => record), record.method as RouterMethod | undefined);
    }
    const pageRouter = createRouterMatcher(pages.map(p => ({
        path: p.path, component: {}, meta: { access: p.access }
    } satisfies RouteRecordRaw)), {});

    function closedPage(path: string) {
        const match = pageRouter.resolve({ path: uiPageDocument(path) }, { path: '/', params: {}, name: undefined, matched: [], meta: {} });
        return match.meta.access === 'closed';
    }

    async function handler(path: string, method: string): Promise<UiHandler | undefined> {
        return await api.handler({ path, method, context: {} } as H3Event) as UiHandler | undefined;
    }

    return async (path: string, method: string) => {
        if (isSsoNamespace(path) && !ssoOperation(path)) return { denied: 'api' } as const;
        const canonical = canonicalUiPath(path);
        const record = await handler(path, method);
        const normalized = path === canonical ? record : await handler(canonical, method);
        const isApi = canonical === '/api' || canonical.startsWith('/api/') || record?.path.startsWith('/api/');
        if (record?.access === 'closed' || normalized?.access === 'closed'
          || (isApi && (!record || !normalized || record.path !== normalized.path))) return { denied: 'api' } as const;
        if (closedPage(path) || closedPage(canonical)) return { denied: 'page' } as const;
        return { api: isApi || (record && record.origin !== 'nuxt') ? record?.path : undefined };
    };
}
