import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Inspect the resolved graph, including modules that tree shaking removed from chunks. */
export function openLayerGuard(scope: string, bundler: 'vite' | 'nitro', buildDir: string) {
    return {
        name: `beantragt-open-layer-guard-${bundler}`,
        // Nuxt also builds an SSR stub for SPA projects. Only the browser graph owns the Vite report.
        ...(bundler === 'vite' ? { applyToEnvironment: (environment: { name: string }) => environment.name === 'client' } : {}),
        generateBundle(this: { getModuleIds: () => IterableIterator<string> }) {
            let moduleCount = 0;
            for (const id of this.getModuleIds()) {
                if (id.split(/[/\\?#:\0]/u).includes('pro-layer')) {
                    throw new Error(`${scope} ${bundler} build reached Pro module ${id}`);
                }
                if (/(?:^|[/\\])node_modules[/\\](?:ai|openai|@ai-sdk[/\\][^/\\]+|@anthropic-ai[/\\]sdk)(?:[/\\]|$)/u.test(id)) {
                    throw new Error(`${scope} ${bundler} build reached an AI provider SDK: ${id}`);
                }
                moduleCount++;
            }
            const report = { scope, bundler, moduleCount };
            writeFileSync(join(buildDir, `open-layer-guard-${bundler}.json`), JSON.stringify(report) + '\n');
        }
    };
}
