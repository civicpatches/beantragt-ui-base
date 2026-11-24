import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { checkBaseLocales, parseFile, PRIVATE_LOCALE_OUTPUT, resolveSpecifier, PRO } from './check-layer-boundary.mjs';

const privateIntelligenceConfig = /\b(?:intelligenceV1Service(?:BaseUrl|Key)|(?:NUXT_)?INTELLIGENCE_V1_SERVICE_\w+)\b/u;
const privateRuntimeSecrets = /\b(?:anthropicApiKey|openaiApiKey|aiSovereignApiKey|assistantSovereignApiKey|demoGateCookieSecret|demoCompileToken)\b/u;
const bundlers = ['vite', 'nitro'];

export function clearGuardReports(buildDir) {
    for (const bundler of bundlers) rmSync(join(buildDir, `open-layer-guard-${bundler}.json`), { force: true });
}

export function checkGuardReports(buildDir, scope) {
    for (const bundler of bundlers) {
        const path = join(buildDir, `open-layer-guard-${bundler}.json`);
        const report = JSON.parse(readFileSync(path, 'utf8'));
        if (report.scope !== scope || report.bundler !== bundler || !Number.isSafeInteger(report.moduleCount) || report.moduleCount < 1) {
            throw new Error(`Invalid open layer guard report: ${path}`);
        }
        console.log(`${scope} ${bundler} guard checked ${report.moduleCount} modules`);
    }
}

/** path -> Map(method -> source file), from Nitro's route types. */
export function routeTable(text) {
    const routes = new Map();
    let current = null;
    for (const line of text.split('\n')) {
        const key = line.match(/^ {4}'([^']+)': \{$/u);
        if (key) {
            current = new Map();
            routes.set(key[1], current);
            continue;
        }
        const method = line.match(/^ {6}'(\w+)': .*import\('([^']+)'\)/u);
        if (method && current) current.set(method[1] === 'default' ? 'ALL' : method[1].toUpperCase(), method[2]);
    }
    return routes;
}

// Open attachment adapters (paths relative to the base server).
const openIntelligenceModules = new Set([
    'utils/attachment-analysis-contract.ts', 'utils/attachment-analysis-disclosure.ts',
    'utils/attachment-analysis-persistence.ts', 'utils/attachment-analysis-result.ts',
    'utils/attachment-analysis-source.ts',
    'utils/attachment-citizen-analysis.ts', 'utils/attachment-extraction-terms.ts',
    'utils/intelligence-attachment-analysis-client.ts',
    'utils/intelligence-service.ts'
]);

// The moved assistant, matcher and editor helpers used to sit alongside ordinary base utilities.
function privateServerModule(name) {
    if (openIntelligenceModules.has(name)) return false;
    return /^(?:(?:utils\/)?ai\/|utils\/(?:attachment-|intelligence-|assistant-|compile-)|api\/(?:ai|intelligence|internal)\/)/u.test(name)
      || /^middleware\/00-intelligence-service-gate\./u.test(name)
      || /^utils\/(?:form-matching|schema-context-sources|citizen-form-context|evidence-text)\./u.test(name)
      || /(?:^|\/)(?:rag|mcp)(?:[./-]|$)/u.test(name);
}

function privateSource(tree, name) {
    if (tree === 'server') return privateServerModule(name);
    return /(?:^|\/)(?:assistant|compile|mcp)(?:[./-]|$)/u.test(name);
}

export function checkOpenSources(root, directories) {
    const localeErrors = checkBaseLocales(root);
    if (localeErrors.length) throw new Error(localeErrors.join('\n'));
    for (const dir of directories) {
        const base = join(root, dir);
        for (const name of readdirSync(base, { recursive: true })) {
            if (!/\.(?:[cm]?[jt]sx?|vue)$/u.test(name)) continue;
            const tree = dir === 'casework-layer' ? name.split('/')[0] : dir.split('/').at(-1);
            const source = dir === 'casework-layer' ? name.slice(tree.length + 1) : name;
            if (privateSource(tree, source)) {
                throw new Error(`Unexpected intelligence source: ${dir}/${name}`);
            }
            const file = join(base, name);
            const localFile = relative(root, file);
            if (privateIntelligenceConfig.test(readFileSync(file, 'utf8'))) {
                throw new Error(`Private intelligence configuration in open source: ${localFile}`);
            }
            if (parseFile(file).imports.some(({ specifier }) => specifier.split(/[/\\?#]/u).includes(PRO)
              || resolveSpecifier(specifier, localFile)?.startsWith(`${PRO}/`))) {
                throw new Error(`Open source imports pro-layer: ${relative(root, file)}`);
            }
        }
    }
}

export function checkOpenRoutes(routes) {
    for (const [route, handlers] of routes) {
        if (/^\/api\/(?:ai|internal|intelligence)(?:\/|$)/iu.test(route)) {
            throw new Error(`Forbidden intelligence route: ${route}`);
        }
        for (const [method, file] of handlers) {
            if (file.split('/').includes('pro-layer')) throw new Error(`Open route ${method} ${route} uses ${file}`);
        }
    }
}

function checkMapSources(map, file) {
    for (const source of map.sources ?? []) {
        const segments = source.replaceAll('\\', '/').split('/');
        if (segments.some((tree, index) => ['server', 'app', 'shared'].includes(tree)
          && privateSource(tree, segments.slice(index + 1).join('/')))) {
            throw new Error(`Private source ${source} in ${file}`);
        }
    }
    for (const section of map.sections ?? []) checkMapSources(section.map, file);
}

/** Check shipped chunks and source maps as well as Nuxt's generated route and component tables. */
export function checkOpenOutput(outputDir) {
    for (const name of readdirSync(outputDir, { recursive: true })) {
        if (/(?:^|\/)node_modules\/(?:ai|openai|@ai-sdk\/[^/]+|@anthropic-ai\/sdk)(?:\/|$)/u.test(name)) {
            throw new Error(`AI provider SDK in open output: ${name}`);
        }
        if (!/\.(?:[cm]?js|css|json|map)$/u.test(name)) continue;
        const contents = readFileSync(join(outputDir, name), 'utf8');
        if (PRIVATE_LOCALE_OUTPUT.test(contents)) throw new Error(`Pro translation in open output: ${name}`);
        if (name.endsWith('.json')) continue;
        if (privateIntelligenceConfig.test(contents) || privateRuntimeSecrets.test(contents) || /(?:^|[/'"`])pro-layer[/\\]/u.test(contents)
          || /form-matching:v[23]|attachment-analysis:v[34]|\b(?:analyzeAttachmentIfConfigured|COMPILE_SYSTEM_PROMPT|runPublicIntakeV1|loadTrustedSchemaContextDocuments|resolveAssistantModel|retrieveCitizenFormContext)\b/u.test(contents)) {
            throw new Error(`Private intelligence or Pro source in open output: ${name}`);
        }
        if (name.endsWith('.map')) checkMapSources(JSON.parse(contents), name);
    }
}

export function checkNoPdfViewer(outputDir) {
    function outputFiles(directory) {
        return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
            const path = join(directory, entry.name);
            if (/^(?:admin-pdfjs|cmaps|standard_fonts|wasm)$/u.test(entry.name)) {
                throw new Error(`Open output contains PDF assets: ${relative(outputDir, path)}`);
            }
            return entry.isDirectory() ? outputFiles(path) : [path];
        });
    }
    const pdfLeaks = outputFiles(outputDir).filter(file =>
        /(?:pdf[.-]?worker|pdfjs|DocumentViewer|DocumentPage)/iu.test(file)
        || (/\.(?:m?js|css|json)$/u.test(file) && /(?:pdfjs-dist|pdfjsVersion|GlobalWorkerOptions|admin-pdfjs|beantragt-document-page-strip|document-viewer\/DocumentPage)/u.test(readFileSync(file, 'utf8'))));
    if (pdfLeaks.length) throw new Error(`Open output contains PDF viewer code: ${pdfLeaks.map(file => relative(outputDir, file)).join(', ')}`);
}
