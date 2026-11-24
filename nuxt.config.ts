import { openLayerGuard } from './scripts/open-layer-guard';
import { DEFAULT_ADMIN_CASE_READ_LIMIT_PER_MINUTE } from './shared/rate-limits';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addTemplate } from 'nuxt/kit';
import type { Nuxt } from 'nuxt/schema';
import { resolveInstallationTheme, THEME_SETTING } from './app/utils/theme/installation-theme';
import { platformPrimaryCSS, PRODUCT_FONT_WEIGHTS, themeOutput } from './app/utils/theme/theme-output';
import { parseTailwindThemeDefaults, STAFF_THEMES_TEMPLATE, staffPreviewThemes, staffThemesTemplate } from './app/utils/theme/staff-theme-preview';

const isDev = process.env.NODE_ENV === 'development';
const devtoolsEnabled = isDev && process.env.NUXT_DEVTOOLS !== 'false';
const buildScope = (process.env.NUXT_BUILD_SCOPE || 'casework').replace(/[^a-z0-9_-]/gi, '');
const rootDir = dirname(fileURLToPath(import.meta.url));
const proLayerPath = resolve(rootDir, 'pro-layer');
const caseworkLayerPath = resolve(rootDir, 'casework-layer');
// Two semantic scopes: `citizen` (the base app alone) and `casework` (the base
// app with the case-work layer). Every other value, free labels such as `fullcheck` included, is a full build in its
// own folders. Pro (Layer 3) stands first and extends case work (2b), which extends the base app (2a); layer priority
// is not relied on, because no page, component or route exists in two layers (`pnpm check:layers`).
const scope = buildScope === 'citizen' || buildScope === 'casework' ? buildScope : 'full';
const buildDir = buildScope ? `.nuxt-${buildScope}` : '.nuxt';
const citizenOnly = scope === 'citizen';
const caseworkOnly = scope === 'casework';
const layers = citizenOnly
    ? []
    : caseworkOnly
        ? [caseworkLayerPath]
        : [proLayerPath, caseworkLayerPath].filter(path => existsSync(path));
const defaultApiBase = isDev ? 'https://beantragt.ddev.site' : 'http://nginx:8080';
const defaultPublicApiBase = isDev ? 'https://beantragt.ddev.site' : '';
// Theme of the installation: `NUXT_UI_THEME` names a preset of the Nuxt UI
// theme engine or a theme document (.json, relative to the project root) at build time; without it, today's look
// (`app/utils/theme/current.ts`). A theme that fails the contrast rule, an unknown name or an unreadable file throws
// here with a sentence, so the build fails; it never falls back to another look.
const installationTheme = resolveInstallationTheme(process.env[THEME_SETTING], path => readFileSync(resolve(rootDir, path), 'utf8'));
const installationThemeOutput = themeOutput(installationTheme.doc);

/**
 * Applies the installation's theme before the first paint: its CSS as `#build/beantragt-theme.css`, which `main.css`
 * imports right after `tailwindcss` and `@nuxt/ui` (so Tailwind compiles its `@theme` blocks with them), and its app
 * config placed AHEAD of `app/app.config.ts` (Nuxt merges `defuFn(cfg0, cfg1, …, inlineConfig)`, the first wins).
 */
function installationThemeModule(_options: unknown, nuxt: Nuxt) {
    // The theme's own config is a Tailwind source: the classes of a theme file's `components` exist only in
    // the generated config, which lives in the ignored build dir; the same device as `.nuxt/ui.css` (`@source "./ui"`).
    addTemplate({
        filename: 'beantragt-theme.css',
        write: true,
        // On the development server the personal theme mock's configs are a source too (their component classes, e.g.
        // Sunset's `shadow-primary/30`). Production builds exclude those configs.
        getContents: () => `@source "./beantragt-theme.config.ts";\n${nuxt.options.dev ? `@source "./${STAFF_THEMES_TEMPLATE}";\n` : ''}\n${installationThemeOutput.css}\n`
    });
    // The personal theme mock: the offered presets on the development server only; every build gets an empty list.
    addTemplate({
        filename: STAFF_THEMES_TEMPLATE,
        write: true,
        getContents: () => staffThemesTemplate(nuxt.options.dev
            ? staffPreviewThemes(
                installationThemeOutput,
                (nuxt.options.appConfig.ui ?? {}) as Record<string, unknown>,
                parseTailwindThemeDefaults(readFileSync(resolve(rootDir, 'node_modules/tailwindcss/theme.css'), 'utf8'))
            )
            : [])
    });
    const config = addTemplate({
        // `.ts`, not `.mjs`: Nuxt's type template imports every app config without its extension, and TypeScript
        // does not try `.mjs` for that, so the theme's `ui` would drop out of `AppConfig`.
        filename: 'beantragt-theme.config.ts',
        write: true,
        getContents: () => `// Generated from the installation's theme (${THEME_SETTING}: ${installationTheme.name}). Do not edit.\nexport default ${JSON.stringify(installationThemeOutput.config, null, 2)};\n`
    });
    nuxt.hook('app:resolve', (app) => {
        app.configs.unshift(config.dst ?? join(nuxt.options.buildDir, 'beantragt-theme.config.ts'));
    });
}

const drupalServiceUser = process.env.NUXT_DRUPAL_SERVICE_USER || (isDev ? '' : 'nuxt_service');
const drupalServicePassword = process.env.NUXT_DRUPAL_SERVICE_PASSWORD || '';

interface NuxtPage {
    name?: string
    path: string
    file?: string
    children?: NuxtPage[]
    [key: string]: unknown
}

function collectAdminPages(pages: NuxtPage[], result: NuxtPage[] = []): NuxtPage[] {
    for (const page of pages) {
        if (page.path === '/admin' || page.path.startsWith('/admin/')) {
            result.push(page);
        }
        if (page.children?.length) {
            collectAdminPages(page.children, result);
        }
    }
    return result;
}

function findPageByFile(pages: NuxtPage[], fileSuffix: string): NuxtPage | null {
    for (const page of pages) {
        if (page.file?.endsWith(fileSuffix)) {
            return page;
        }
        const child = page.children?.length ? findPageByFile(page.children, fileSuffix) : null;
        if (child) return child;
    }
    return null;
}

/**
 * Copy of a page under another path. With a child name prefix the children
 * are copied along (the setup pages under the form page: they render
 * in a modal over it), named with the same prefix; their paths are relative
 * and stay, so the workspace URLs reach them too.
 */
function pageAlias(page: NuxtPage, overrides: Partial<NuxtPage>, childNamePrefix?: string): NuxtPage {
    const alias: NuxtPage = { ...page, ...overrides };
    if (childNamePrefix && page.children?.length) {
        alias.children = page.children.map(child => pageAlias(child, {
            name: child.name ? `${childNamePrefix}${child.name}` : undefined
        }, childNamePrefix));
    } else {
        delete alias.children;
    }
    return alias;
}

function collectPagePaths(pages: NuxtPage[], result: string[] = []): string[] {
    for (const page of pages) {
        result.push(page.path);
        if (page.children?.length) collectPagePaths(page.children, result);
    }
    return result;
}

function isStaffOrPrivatePagePath(path: string): boolean {
    return path === '/admin'
      || path.includes('/admin/')
      || path === '/demo-access'
      || path === '/demo/compile'
      || path === '/workspace/invite';
}

/** Only these staff pages are open. The /admin entry is checked separately as a redirect. */
const CASEWORK_STAFF_PAGES = new Map([
    ['/admin/applications', 'admin/applications/index.vue'],
    ['/admin/applications/:id()', 'admin/applications/[id]/index.vue'],
    ['/admin/applications/:id()/print', 'admin/applications/[id]/print.vue'],
    ['/admin/forms', 'admin/forms/index.vue'],
    ['/admin/forms/:id()', 'admin/forms/[id]/index.vue'],
    ['/admin/forms/:id()/edit', 'admin/forms/[id]/edit.vue'],
    ['/admin/form-groups', 'admin/form-groups/index.vue'],
    ['/admin/settings/email', 'admin/settings/email.vue'],
    ['/admin/settings/workflow', 'admin/settings/workflow.vue'],
    ['/admin/settings/decisions', 'admin/settings/decisions.vue'],
    ['/admin/settings/content', 'admin/settings/content.vue'],
    ['/admin/fim', 'admin/fim.vue'],
    ['/admin/settings', 'admin/settings/index.vue'],
    ['/admin/settings/branding', 'admin/settings/branding.vue'],
    ['/admin/settings/general', 'admin/settings/general.vue'],
    ['/admin/settings/embed', 'admin/settings/embed.vue'],
    ['/admin/settings/tenant', 'admin/settings/tenant.vue'],
    ['/workspace/invite', 'workspace/invite.vue']
]);
const WORKSPACE_PREFIXES = [['', ''], ['workspace-', '/:workspace'], ['workspace-organisation-', '/:workspace/:organisation']] as const;

function findPageByName(pages: NuxtPage[], name: string): NuxtPage | null {
    for (const page of pages) {
        if (page.name === name) return page;
        const child = page.children?.length ? findPageByName(page.children, name) : null;
        if (child) return child;
    }
    return null;
}

/**
 * Casework opens the application list at the admin entry. Full keeps the legacy forms entry.
 * A named redirect keeps the route's workspace params, query and hash in Vue Router.
 */
function adminEntryRedirects(pages: NuxtPage[]): NuxtPage[] {
    const target = caseworkOnly ? 'admin-applications' : 'admin-forms';
    if (caseworkOnly && !findPageByName(pages, target)) {
        throw new Error('Casework build has no application list page (route admin-applications) for the redirect of /admin');
    }
    if (!findPageByName(pages, target)) return [];
    return WORKSPACE_PREFIXES.map(([namePrefix, pathPrefix]) => ({
        path: `${pathPrefix}/admin`,
        redirect: { name: `${namePrefix}${target}` }
    }));
}

/** The redirect record of `/admin` or one of its workspace forms, naming the list route of the same form. */
function isCaseworkAdminRedirect(page: NuxtPage): boolean {
    if (page.file !== undefined) return false;
    const form = WORKSPACE_PREFIXES.find(([, pathPrefix]) => page.path === `${pathPrefix}/admin`);
    const name = (page.redirect as { name?: unknown } | undefined)?.name;
    return form !== undefined && name === `${form[0]}admin-applications`;
}

function collectPageRecords(pages: NuxtPage[], result: NuxtPage[] = []): NuxtPage[] {
    for (const page of pages) {
        result.push(page);
        if (page.children?.length) collectPageRecords(page.children, result);
    }
    return result;
}

/** Records of the scope `casework` that are not allowed: Pro pages, and any `/admin` record that is not the redirect. */
function caseworkPageLeaks(pages: NuxtPage[]): string[] {
    return collectPageRecords(pages).filter((page) => {
        // Workspace forms of the admin pages are checked like the pages they alias.
        const path = page.path.replace(/^\/:workspace(?:\/:organisation)?(?=\/admin(?:\/|$))/u, '');
        if (path === '/admin') return !isCaseworkAdminRedirect(page);
        if (!isStaffOrPrivatePagePath(path)) return false;
        const file = CASEWORK_STAFF_PAGES.get(path);
        return !file || page.file !== resolve(caseworkLayerPath, 'app/pages', file);
    }).map(page => page.file ? `${page.path} (${page.file})` : page.path);
}

/** The page records of the scope `casework` as `casework-pages.json` in the build dir, for `pnpm build:casework` (G3). */
function caseworkPagesModule() {
    addTemplate({
        filename: 'casework-pages.json',
        write: true,
        getContents: ({ app }) => `${JSON.stringify(collectPageRecords((app?.pages ?? []) as NuxtPage[])
            .map(page => ({ path: page.path, ...(page.redirect ? { redirect: page.redirect } : {}), ...(page.file ? { file: relative(rootDir, page.file) } : {}) })), null, 2)}\n`
    });
}

export default defineNuxtConfig({
    extends: layers,

    modules: [
        '@nuxt/ui',
        '@nuxt/eslint',
        '@nuxtjs/i18n',
        ...(caseworkOnly ? [caseworkPagesModule] : []),
        './modules/ui-mode',
        installationThemeModule
    ],

    ssr: false,

    devtools: { enabled: devtoolsEnabled },

    app: {
        head: {
            // The native platform tokens are in the SPA document before JavaScript. The active frame
            // replaces this entry once its tenant config loads. After the bundled installation stylesheet
            // so the engine's regular token selectors keep their native specificity in dev and production.
            style: [{ id: 'beantragt-primary-theme', tagPosition: 'bodyClose', innerHTML: platformPrimaryCSS(installationTheme.doc) }],
            link: [
                { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
                { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' },
                { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' }
            ]
        }
    },

    css: [
        // Absolute path on purpose: Vite 8 resolves a leading './' against the
        // generated virtual module in .nuxt/ instead of the project root, so the
        // dev server failed with "Failed to resolve import
        // ./app/assets/css/main.css from virtual:nuxt:.nuxt/css.mjs".
        resolve(rootDir, 'app/assets/css/main.css')
    ],

    runtimeConfig: {
        geocodingProvider: process.env.NUXT_GEOCODING_PROVIDER || process.env.GEOCODING_PROVIDER || 'disabled',
        geocodingPhotonBaseUrl: process.env.NUXT_GEOCODING_PHOTON_BASE_URL || process.env.GEOCODING_PHOTON_BASE_URL || '',
        apiBase: process.env.NUXT_API_BASE || defaultApiBase,
        drupalServiceUser,
        drupalServicePassword,
        trustProxyIpHeaders: process.env.NUXT_TRUST_PROXY_IP_HEADERS === 'true' || process.env.TRUST_PROXY_IP_HEADERS === 'true',
        adminCaseReadLimitPerMinute: DEFAULT_ADMIN_CASE_READ_LIMIT_PER_MINUTE,
        ssoBundidProvider: process.env.NUXT_SSO_BUNDID_PROVIDER || (isDev ? 'bundid_mock' : 'bundid'),
        public: {
            uiMode: 'citizen' as 'citizen' | 'all',
            apiBase: process.env.NUXT_PUBLIC_API_BASE || defaultPublicApiBase,
            defaultWorkspace: '',
            // Operator-controlled MapLibre styles. The legacy value remains a
            // fallback for existing deployments. Keep all values empty to
            // disable the optional picker without affecting address input.
            addressMapStyleUrl: process.env.NUXT_PUBLIC_ADDRESS_MAP_STYLE_URL || '',
            addressMapStyleUrlLight: process.env.NUXT_PUBLIC_ADDRESS_MAP_STYLE_URL_LIGHT || '',
            addressMapStyleUrlDark: process.env.NUXT_PUBLIC_ADDRESS_MAP_STYLE_URL_DARK || '',
            addressMapFallbackStyleUrlLight: process.env.NUXT_PUBLIC_ADDRESS_MAP_FALLBACK_STYLE_URL_LIGHT || '',
            addressMapFallbackStyleUrlDark: process.env.NUXT_PUBLIC_ADDRESS_MAP_FALLBACK_STYLE_URL_DARK || '',
            addressMapAllowedOrigins: process.env.NUXT_PUBLIC_ADDRESS_MAP_ALLOWED_ORIGINS || '',
            ssoBundidEnabled: process.env.NUXT_PUBLIC_SSO_BUNDID_ENABLED === 'true' || isDev,
            websiteUrl: 'https://beantragt.ai',
            hideProductLinks: false,
            civicPatchesUrl: 'https://civic-patches.de',
            docsUrl: '',
            docsLabel: '',
            // Source URLs may contain `{version}`, filled from a release tag in `appVersion`.
            sourceUrl: process.env.NUXT_PUBLIC_SOURCE_URL || '',
            appVersion: process.env.NUXT_PUBLIC_APP_VERSION || ''
        }
    },

    buildDir,

    routeRules: {
        '/**': {
            headers: {
                'X-Content-Type-Options': 'nosniff',
                'X-Frame-Options': 'DENY',
                'Referrer-Policy': 'strict-origin-when-cross-origin',
                'Permissions-Policy': 'geolocation=(), camera=(), microphone=()'
            }
        },
        // Allow iframe embedding for public form pages.
        // Baseline: SAMEORIGIN (allows same-domain iframes).
        // Cross-origin: server/middleware/embed-headers.ts removes
        // X-Frame-Options entirely when ?embed=true is present.
        '/form/**': {
            headers: {
                'X-Frame-Options': 'SAMEORIGIN'
            }
        },
        '/:workspace/form/**': {
            headers: {
                'X-Frame-Options': 'SAMEORIGIN'
            }
        },
        '/:workspace/:organisation/form/**': {
            headers: {
                'X-Frame-Options': 'SAMEORIGIN'
            }
        },
        // Staff-only attachment previews are embedded in the admin detail modal.
        '/api/admin/applications/:id/attachments/:attachmentId/preview': {
            headers: {
                'X-Frame-Options': 'SAMEORIGIN'
            }
        },
        // The invite token lives in this page's URL. Keep the Referer
        // same-origin so the token is never sent to third-party resources.
        '/workspace/invite': {
            headers: {
                'Referrer-Policy': 'same-origin'
            }
        },
        // Public status tokens must not reach third-party resources via Referer.
        '/form/:id/status/:applicationId': {
            headers: { 'Referrer-Policy': 'same-origin' }
        },
        '/:workspace/form/:id/status/:applicationId': {
            headers: { 'Referrer-Policy': 'same-origin' }
        },
        '/:workspace/:organisation/form/:id/status/:applicationId': {
            headers: { 'Referrer-Policy': 'same-origin' }
        },
        '/status': {
            headers: { 'Referrer-Policy': 'same-origin' }
        },
        '/status/**': {
            headers: { 'Referrer-Policy': 'same-origin' }
        },
        '/:workspace/status': {
            headers: { 'Referrer-Policy': 'same-origin' }
        },
        '/:workspace/:organisation/status': {
            headers: { 'Referrer-Policy': 'same-origin' }
        }
    },

    compatibilityDate: '2025-03-26',

    nitro: {
        // Keep verification builds separate from the running development server.
        output: { dir: resolve(rootDir, process.env.NITRO_OUTPUT_DIR || (buildScope ? `.output-${buildScope}` : '.output')) },
        // Production server source maps materially increase Rollup memory use.
        // Keep them for local debugging, but make CI-sized builds deterministic.
        sourceMap: isDev,
        ...(scope !== 'full' ? { rollupConfig: { plugins: [openLayerGuard(scope, 'nitro', resolve(rootDir, buildDir))] } } : {})
    },

    vite: {
        server: {
            // Nuxt 4.7 enforces this list in nuxt dev: every DDEV project (main and second instance)
            // reaches the dev server through the DDEV router under its own *.ddev.site name.
            allowedHosts: ['.ddev.site']
        },
        css: {
            devSourcemap: true
        },
        plugins: [
            ...(scope !== 'full' ? [openLayerGuard(scope, 'vite', resolve(rootDir, buildDir))] : []),
            // Fix CSS MIME type issues in DDEV/proxy environments
            // Copied from Mark-a-Spot dev/ - battle-tested pattern
            ...(isDev
                ? [{
                    name: 'fix-css-imports',
                    enforce: 'pre' as const,
                    apply: 'serve' as const,
                    transform(code: string, id: string, options?: { ssr?: boolean }) {
                        if (options?.ssr) return null;

                        const isCssMjs = id.includes('css.mjs') && (id.includes('.nuxt') || id.includes('virtual:nuxt'));
                        if (isCssMjs) {
                            const transformed = code.replace(
                                /import\s+["']([^"']+\.css)["'];?/g,
                                (_match: string, cssPath: string) => {
                                    const varName = `css_${Math.random().toString(36).slice(2, 8)}`;
                                    return `import ${varName} from "${cssPath}?inline";
(function(){const s=document.createElement('style');s.textContent=${varName};document.head.appendChild(s);})();`;
                                }
                            );
                            return { code: transformed, map: null };
                        }
                        return null;
                    },
                    configureServer(server: any) {
                        server.middlewares.use((req: any, res: any, next: any) => {
                            const url = req.url || '';
                            const secFetchDest = req.headers['sec-fetch-dest'];

                            if ((url.includes('.css') || url.includes('lang.css'))
                              && !url.includes('?inline') && secFetchDest === 'script') {
                                const originalEnd = res.end.bind(res);
                                let body = '';

                                res.write = (chunk: any) => {
                                    body += chunk.toString();
                                    return true;
                                };

                                res.end = (chunk?: any) => {
                                    if (chunk) body += chunk.toString();

                                    if (body.trim().startsWith('/*') || body.trim().startsWith('@')
                                      || body.trim().startsWith('.') || body.trim().startsWith(':')) {
                                        const escaped = JSON.stringify(body);
                                        const jsModule = `const css = ${escaped};
const style = document.createElement('style');
style.textContent = css;
document.head.appendChild(style);
export default css;`;
                                        res.setHeader('Content-Type', 'text/javascript');
                                        res.setHeader('Content-Length', Buffer.byteLength(jsModule));
                                        return originalEnd(jsModule);
                                    }
                                    return originalEnd(body);
                                };
                            }
                            next();
                        });
                    }
                }]
                : [])
        ]
    },

    hooks: {
        // Nuxt 4.7 also auto-imports app/types of every layer. A lower layer could then use a
        // pro type without an import, which check:layers cannot see: keep the 4.5 scan.
        'imports:dirs'(dirs) {
            for (let i = dirs.length - 1; i >= 0; i--) {
                if (/[\\/]app[\\/]types$/u.test(dirs[i] ?? '')) dirs.splice(i, 1);
            }
        },
        'pages:extend'(pages) {
            const adminPages = collectAdminPages(pages as NuxtPage[]);
            const workspaceAdminPages = adminPages.flatMap(page => [
                pageAlias(page, {
                    name: page.name ? `workspace-${page.name}` : undefined,
                    path: `/:workspace${page.path}`
                }, 'workspace-'),
                pageAlias(page, {
                    name: page.name ? `workspace-organisation-${page.name}` : undefined,
                    path: `/:workspace/:organisation${page.path}`
                }, 'workspace-organisation-')
            ]);

            pages.push(...workspaceAdminPages);
            if (!citizenOnly) pages.push(...adminEntryRedirects(pages as NuxtPage[]));

            const formPage = findPageByFile(pages as NuxtPage[], '/pages/form/[id]/index.vue');
            if (formPage) {
                pages.push(
                    pageAlias(formPage, { name: 'workspace-public-form', path: '/:workspace/form/:id' }),
                    pageAlias(formPage, { name: 'workspace-organisation-public-form', path: '/:workspace/:organisation/form/:id' })
                );
            }

            const startPage = findPageByFile(pages as NuxtPage[], '/pages/start.vue');
            if (startPage) {
                pages.push(
                    pageAlias(startPage, { name: 'workspace-public-home', path: '/:workspace' }),
                    pageAlias(startPage, { name: 'workspace-organisation-public-home', path: '/:workspace/:organisation' }),
                    pageAlias(startPage, { name: 'workspace-public-start', path: '/:workspace/start' }),
                    pageAlias(startPage, { name: 'workspace-organisation-public-start', path: '/:workspace/:organisation/start' })
                );
            }

            const loginPage = findPageByFile(pages as NuxtPage[], '/pages/auth/login.vue');
            if (loginPage) {
                pages.push(
                    pageAlias(loginPage, { name: 'workspace-auth-login', path: '/:workspace/auth/login' }),
                    pageAlias(loginPage, { name: 'workspace-organisation-auth-login', path: '/:workspace/:organisation/auth/login' })
                );
            }

            const myApplicationsPage = findPageByFile(pages as NuxtPage[], '/pages/meine-antraege.vue');
            if (myApplicationsPage) {
                pages.push(
                    pageAlias(myApplicationsPage, { name: 'workspace-my-applications', path: '/:workspace/meine-antraege' }),
                    pageAlias(myApplicationsPage, { name: 'workspace-organisation-my-applications', path: '/:workspace/:organisation/meine-antraege' })
                );
            }

            const myApplicationPage = findPageByFile(pages as NuxtPage[], '/pages/meine-antraege/[id].vue');
            if (myApplicationPage) {
                pages.push(
                    pageAlias(myApplicationPage, { name: 'workspace-my-application', path: '/:workspace/meine-antraege/:id' }),
                    pageAlias(myApplicationPage, { name: 'workspace-organisation-my-application', path: '/:workspace/:organisation/meine-antraege/:id' })
                );
            }

            const statusLookupPage = findPageByFile(pages as NuxtPage[], '/pages/status/index.vue');
            if (statusLookupPage) {
                pages.push(
                    pageAlias(statusLookupPage, { name: 'workspace-public-status-lookup', path: '/:workspace/status' }),
                    pageAlias(statusLookupPage, { name: 'workspace-organisation-public-status-lookup', path: '/:workspace/:organisation/status' })
                );
            }

            const myDataPage = findPageByFile(pages as NuxtPage[], '/pages/meine-daten.vue');
            if (myDataPage) {
                pages.push(
                    pageAlias(myDataPage, { name: 'workspace-my-data', path: '/:workspace/meine-daten' }),
                    pageAlias(myDataPage, { name: 'workspace-organisation-my-data', path: '/:workspace/:organisation/meine-daten' })
                );
            }

            const formStatusPage = findPageByFile(pages as NuxtPage[], '/pages/form/[id]/status/[applicationId].vue');
            if (formStatusPage) {
                pages.push(
                    pageAlias(formStatusPage, { name: 'workspace-public-form-status', path: '/:workspace/form/:id/status/:applicationId' }),
                    pageAlias(formStatusPage, { name: 'workspace-organisation-public-form-status', path: '/:workspace/:organisation/form/:id/status/:applicationId' })
                );
            }

            if (citizenOnly) {
                const leakedProPages = collectPagePaths(pages as NuxtPage[]).filter(isStaffOrPrivatePagePath);
                if (leakedProPages.length > 0) {
                    throw new Error(`Citizen build contains Pro pages: ${leakedProPages.join(', ')}`);
                }
            }

            if (caseworkOnly) {
                const leakedPages = caseworkPageLeaks(pages as NuxtPage[]);
                if (leakedPages.length > 0) {
                    throw new Error(`Casework build contains pages outside the case-work allow-list: ${leakedPages.join(', ')}`);
                }
            }
        }
    },

    // Self-hosted webfonts via @nuxt/fonts (auto-registered by @nuxt/ui).
    // provider 'google' downloads the woff2 files at build time and serves
    // them from our own origin. No runtime request to Google (GDPR-safe).
    // The families are those of the installation's theme (today: Hanken Grotesk);
    // the build therefore needs network to the provider.
    fonts: {
        families: installationThemeOutput.fontFamilies.map(name => ({
            name,
            provider: 'google' as const,
            weights: PRODUCT_FONT_WEIGHTS
        }))
    },

    i18n: {
        strategy: 'no_prefix',
        langDir: 'locales',
        locales: [
            { code: 'de', language: 'de-DE', file: 'de.ts', name: 'Deutsch' },
            { code: 'en', language: 'en-US', file: 'en.ts', name: 'English' }
        ],
        defaultLocale: 'de',
        detectBrowserLanguage: false
    },

    icon: {
        provider: 'server',
        serverBundle: {
            collections: ['lucide']
        },
        // Bundle every statically used icon into the client (same as
        // markaspot-ui). @nuxt/icon is pinned to 2.5.1 (pnpm.overrides): 2.6.2
        // sent runtime icon loads to the public Iconify API instead of the
        // local endpoint, the CSP blocked them and icons rendered empty.
        clientBundle: {
            // The shared product line selects the source icon by URL host.
            icons: ['lucide:github', 'lucide:code'],
            scan: true,
            sizeLimitKb: 1024
        },
        fallbackToApi: false
    }
});
