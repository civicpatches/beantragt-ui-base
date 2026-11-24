import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { CASEWORK, CASEWORK_ROUTE_FILES, PRO, routeOfFile } from './check-layer-boundary.mjs';
import { checkGuardReports, clearGuardReports, checkOpenOutput, checkNoPdfViewer, checkOpenRoutes, checkOpenSources, routeTable } from './check-open-build.mjs';

const projectRoot = resolve(import.meta.dirname, '..');
const outputDir = resolve(projectRoot, process.env.NITRO_OUTPUT_DIR || '.output-casework');
const generatedDir = resolve(projectRoot, '.nuxt-casework');
const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
checkOpenSources(projectRoot, ['app', 'server', 'shared', 'casework-layer']);

if (!process.argv.includes('--no-build')) {
    clearGuardReports(generatedDir);
    const build = spawnSync(command, ['exec', 'nuxt', 'build'], {
        cwd: projectRoot,
        env: {
            ...process.env,
            NODE_OPTIONS: process.env.NODE_OPTIONS || '--max-old-space-size=1536',
            NUXT_BUILD_SCOPE: 'casework',
            NITRO_OUTPUT_DIR: outputDir
        },
        stdio: 'inherit'
    });
    if (build.error) throw build.error;
    if (build.status !== 0) process.exit(build.status ?? 1);
}
if (!existsSync(resolve(outputDir, 'server/index.mjs'))) throw new Error(`No casework output in ${outputDir}`);

const readGenerated = file => readFileSync(resolve(generatedDir, file), 'utf8');

const routes = routeTable(readGenerated('types/nitro-routes.d.ts'));
const componentTypes = readGenerated('components.d.ts');
const pages = JSON.parse(readGenerated('casework-pages.json'));
const errors = [];
checkOpenRoutes(routes);
checkGuardReports(generatedDir, 'casework');
checkOpenOutput(outputDir);
const requiredCitizenRoutes = [
    '/api/auth/request-code', '/api/schema/:id', '/api/schemas/published', '/api/status/:ref', '/api/submit',
    '/api/platform/maintenance/recovery/request-code', '/api/platform/maintenance/recovery/verify-code', '/api/platform/maintenance/recovery-disable'
];
for (const route of requiredCitizenRoutes) {
    if (!routes.has(route)) errors.push(`missing citizen API route ${route}`);
}

const allowed = new Set();
if (routes.get('/api/admin/schemas/:id/status')?.size !== 1) {
    errors.push('expected exactly one method (PATCH) for /api/admin/schemas/:id/status');
}
for (const file of CASEWORK_ROUTE_FILES) {
    const { method, path } = routeOfFile(file);
    allowed.add(`${method} ${path}`);
    const source = routes.get(path)?.get(method);
    if (!source?.endsWith(`/${CASEWORK}/${file.slice(0, -3)}`)) {
        errors.push(`expected case-work route ${method} ${path} from ${CASEWORK}/${file}`);
    }
}
for (const [path, methods] of routes) {
    if (!/^\/api\/(?:admin|export|workspace-invites)(?:\/|$)/iu.test(path)) continue;
    for (const method of methods.keys()) {
        if (!allowed.has(`${method} ${path}`)) errors.push(`API route outside the case-work allow-list: ${method} ${path}`);
    }
}

const forbiddenPrefixes = ['/api/demo-gate', '/api/demo-tour', '/api/demo-regie', '/api/staff'];
for (const path of routes.keys()) {
    const prefix = forbiddenPrefixes.find(item => path === item || path.startsWith(`${item}/`));
    if (prefix) errors.push(`forbidden Pro route ${path}`);
}
if (componentTypes.includes(`/${PRO}/`)) errors.push('components.d.ts registers a component from the closed layer');

// Page records in all three workspace variants.
const stripWorkspace = path => path.replace(/^\/:workspace(?:\/:organisation)?(?=\/admin(?:\/|$))/u, '');
const adminPages = pages.filter(page => stripWorkspace(page.path) === '/admin' || stripWorkspace(page.path).startsWith('/admin/')
  || ['/demo-access', '/demo/compile', '/workspace/invite'].includes(page.path));
const allowedPages = new Map([
    ['/admin/applications', 'applications/index.vue'],
    ['/admin/applications/:id()', 'applications/[id]/index.vue'],
    ['/admin/applications/:id()/print', 'applications/[id]/print.vue'],
    ['/admin/forms', 'forms/index.vue'],
    ['/admin/forms/:id()', 'forms/[id]/index.vue'],
    ['/admin/forms/:id()/edit', 'forms/[id]/edit.vue'],
    ['/admin/form-groups', 'form-groups/index.vue'],
    ['/admin/settings/email', 'settings/email.vue'],
    ['/admin/settings/workflow', 'settings/workflow.vue'],
    ['/admin/settings/decisions', 'settings/decisions.vue'],
    ['/admin/settings/content', 'settings/content.vue'],
    ['/admin/fim', 'fim.vue'],
    ['/admin/settings', 'settings/index.vue'],
    ['/admin/settings/branding', 'settings/branding.vue'],
    ['/admin/settings/general', 'settings/general.vue'],
    ['/admin/settings/embed', 'settings/embed.vue'],
    ['/admin/settings/tenant', 'settings/tenant.vue']
]);
for (const page of adminPages) {
    const path = stripWorkspace(page.path);
    if (path === '/admin') {
        // The list's route name of the same form, which keeps the workspace.
        const prefix = page.path.match(/^\/:workspace(\/:organisation)?/u);
        const listName = `${prefix ? (prefix[1] ? 'workspace-organisation-' : 'workspace-') : ''}admin-applications`;
        const redirectOk = page.redirect?.name === listName;
        if (page.file || !redirectOk) errors.push(`the record ${page.path} must be the redirect to the application list, found ${JSON.stringify(page)}`);
    } else if (path === '/workspace/invite') {
        if (page.file !== `${CASEWORK}/app/pages/workspace/invite.vue`) {
            errors.push(`expected ${path} from the case-work layer, found ${page.file}`);
        }
    } else if (!allowedPages.has(path) || page.file !== `${CASEWORK}/app/pages/admin/${allowedPages.get(path)}`) {
        errors.push(`page outside the case-work allow-list: ${page.path}${page.file ? ` (${page.file})` : ''}`);
    }
}
if (adminPages.filter(page => page.path === '/workspace/invite').length !== 1) {
    errors.push('expected exactly one case-work page record for /workspace/invite');
}
for (const prefix of ['', '/:workspace', '/:workspace/:organisation']) {
    for (const path of ['/admin', ...allowedPages.keys()]) {
        if (adminPages.filter(page => page.path === `${prefix}${path}`).length !== 1) {
            errors.push(`expected exactly one case-work page record for ${prefix}${path}`);
        }
    }
}

checkNoPdfViewer(outputDir);

const pageFiles = [...allowedPages.values()].map(file => `app/pages/admin/${file}`);
const caseworkPages = pageFiles.filter(file => existsSync(resolve(projectRoot, CASEWORK, file)));
console.log(`Casework scope: ${routes.size} API route paths, ${adminPages.length} admin page records (${caseworkPages.length} of ${allowedPages.size} case-work pages in casework-layer/, plus the /admin redirect and its workspace forms).`);
console.log(`Required case-work route methods: ${allowed.size}`);
if (errors.length) {
    console.error(`\nCasework build check failed (${errors.length}):`);
    for (const error of errors) console.error(`  ${error}`);
    process.exit(1);
}
console.log('Casework build passed: citizen APIs present, PDF.js viewer, worker and decoders excluded, no Pro page, component or route; /api/admin limited to the case-work allow-list.');
