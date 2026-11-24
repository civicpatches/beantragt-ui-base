import { handlers, pages } from '#ui-mode-manifest';
import { apiNotFound } from '../utils/api-not-found';
import { requireCitizenSession } from '../utils/citizen-session';
import { hasValidDrupalSession } from '../utils/session';
import { preservePrivateNoStore } from '../utils/preserve-private-no-store';
import { setPrivateNoStore } from '../utils/request-security';
import { serverUiMode } from '../utils/ui-mode';
import { uiRoutePolicy } from '../utils/ui-mode-routing';

export default defineNitroPlugin((app) => {
    const mode = serverUiMode();
    const count = (access: string) => handlers.filter(h => h.access === access && h.path.startsWith('/api/')).length;
    console.info(`ui_mode=${mode} open_api=${count('open')} closed_api=${count('closed')} closed_pages=${pages.filter(p => p.access === 'closed').length}`);
    const base = useRuntimeConfig().app.baseURL.replace(/\/$/u, '');
    const classify = uiRoutePolicy(handlers, pages);
    // Scanned middleware comes after Nitro route rules and public assets. Insert
    // this middleware at the start of the actual H3 stack, ahead of both.
    app.h3App.stack.unshift({ route: '/', handler: defineEventHandler(async (event) => {
        useRuntimeConfig(event).public.uiMode = mode;
        if (mode !== 'citizen') return;
        const requestPath = event.path.split('?')[0] || '/';
        const path = base && requestPath.startsWith(base) ? requestPath.slice(base.length) || '/' : requestPath;
        const result = await classify(path, event.method);
        if (result.denied === 'api') return apiNotFound(event);
        if (result.denied === 'page') {
            setPrivateNoStore(event);
            preservePrivateNoStore(event);
            throw createError({ statusCode: 404, statusMessage: 'Page not found' });
        }
        if (result.api && result.api !== '/api/auth/status' && result.api !== '/api/auth/logout' && hasValidDrupalSession(event)) {
            const otp = result.api === '/api/auth/verify-code' || result.api === '/api/auth/request-code';
            await requireCitizenSession(event, undefined, otp);
        }
    }) });
});
