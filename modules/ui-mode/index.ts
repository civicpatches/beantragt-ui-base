import { defineNuxtModule, importModule } from 'nuxt/kit';
import { checkConflicts, classifyHandlers, classifyPages } from './manifest';
import type { UiHandler, UiPage } from '../../shared/ui-mode';

declare module '@nuxt/schema' {
    interface NuxtHooks {
        'beantragt:ui-mode:handlers': (handlers: UiHandler[]) => void
    }
}

export default defineNuxtModule({
    meta: { name: 'beantragt-ui-mode' },
    setup(_, nuxt) {
        const root = nuxt.options.rootDir;
        let pages: UiPage[] = [];
        nuxt.hook('pages:resolved', (tree) => {
            pages = classifyPages(root, tree);
        });
        nuxt.hook('nitro:init', (nitro) => {
            nitro.options.virtual['#ui-mode-manifest'] = async () => {
                const environments = [nitro.options.dev ? 'dev' : 'prod', nitro.options.preset, nitro.options.preset === 'nitro-prerender' ? 'prerender' : undefined];
                const records = [...nitro.scannedHandlers, ...nitro.options.handlers]
                    .filter(h => !h.env || [h.env].flat().some(env => environments.includes(env)));
                const handlers = classifyHandlers(root, records);
                // Nitro deduplicates equal path/method pairs when scanning layers.
                // Check shadowed files as well, so layer priority cannot hide a conflict.
                const { scanServerRoutes } = await importModule<typeof import('nitropack')>('nitropack', { paths: nitro.options.nodeModulesDirs });
                const raw = await Promise.all([
                    scanServerRoutes(nitro, nitro.options.apiDir || 'api', nitro.options.apiBaseURL || '/api'),
                    scanServerRoutes(nitro, nitro.options.routesDir || 'routes')
                ]);
                const registered = new Set(records.map(r => r.handler));
                const shadowed = raw.flat().filter(r => !registered.has(r.handler) && (!r.env || environments.includes(r.env)));
                if (shadowed.length) classifyHandlers(root, [...records, ...shadowed]);
                await nuxt.callHook('beantragt:ui-mode:handlers', handlers);
                checkConflicts(handlers);
                if (!pages.length) throw new Error('Missing UI page manifest');
                return `export const handlers = ${JSON.stringify(handlers)}; export const pages = ${JSON.stringify(pages)};`;
            };
        });
    }
});
