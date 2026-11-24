// G4, the layer boundary of the open case work. Reads the source only; no build.
//   node scripts/check-layer-boundary.mjs   check, exit 1 on a violation or a dead exception
// Layers: base = app/, server/, shared/ (Layer 2a); case work = casework-layer/ (2b); Pro = the closed layer (3).
// Rules:
//   1. No import in app/, server/, shared/, casework-layer/ resolves into the closed layer; none in app/, server/, shared/
//      resolves into casework-layer/ (type imports included).
//   2. No template tag in app/ or casework-layer/ names a component that exists only in a higher layer; no free
//      identifier there equals an auto-imported export of a higher layer (client: app/composables, app/utils,
//      composables/api; server files: server/utils, which Nitro auto-imports recursively).
//   3. No page path, component name or Nitro route exists in two layers.
//   4. A test whose subject is open references no Pro file (OPEN_SUBJECT_TESTS).
//   5. Base locales contain no Pro-only translation keys or copy.
//   6. Open code does not fetch a Nitro route implemented only by Pro.
// Exceptions: scripts/layer-boundary.exceptions.json. Every entry must still match something, so the file can only shrink.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { parse as parseSfc } from 'vue/compiler-sfc';
import { LOCALES, MANIFEST, loadLocale } from './check-i18n-layers.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const EXCEPTIONS_FILE = 'scripts/layer-boundary.exceptions.json';
export const PRO = 'pro-layer';
export const CASEWORK = 'casework-layer';
const SOURCE_RE = /\.(?:ts|vue|js|mjs)$/u;
const SKIP_DIRS = new Set(['node_modules', '.nuxt', '.output', 'dist']);

// The MCP, RAG and chat locale markers that must stay out of the casework bundles.
export const PRIVATE_LOCALE_OUTPUT = /\b(?:MCP (?:account|access)|MCP-Zugang|RAG[- ]chunks|editor, also by chat|auch per Chat|Chat-Editor)\b/iu;
const PRIVATE_LOCALE_KEY = /\b(?:mcp|rag|chat|assistant|persona|demo (?:gate|tour|compiler|code|citizen|admin|system admin|hint|title)|context sources?)\b/iu;
const PRIVATE_LOCALE_TEXT = /\b(?:MCP|RAG|chats?|assistants?|assistent(?:in|en)?|context sources?|(?:assistenz|assistenten)[- ]?kontext|demo[- ](?:personas?|zugang|access|code|tour))\b/iu;

function localeEntries(object, prefix = '') {
    return Object.entries(object).flatMap(([key, value]) => {
        const path = prefix ? `${prefix}.${key}` : key;
        return value && typeof value === 'object' ? localeEntries(value, path) : [[path, value]];
    });
}

export function checkBaseLocales(projectRoot) {
    const { proLocaleOnly } = JSON.parse(readFileSync(resolve(projectRoot, MANIFEST), 'utf8'));
    const errors = [];
    for (const file of LOCALES) {
        for (const [key, value] of localeEntries(loadLocale(projectRoot, file))) {
            const words = key.replace(/([A-Z]+)([A-Z][a-z])/gu, '$1 $2').replace(/([a-z])([A-Z])/gu, '$1 $2').replace(/[._-]/gu, ' ');
            if (proLocaleOnly.some(prefix => key === prefix || key.startsWith(`${prefix}.`))
              || PRIVATE_LOCALE_KEY.test(words) || PRIVATE_LOCALE_TEXT.test(String(value))) {
                errors.push(`rule 5: ${file} contains a Pro translation at ${key}`);
            }
        }
    }
    return errors;
}

/** The Nitro routes of the case work, as sub-paths below casework-layer/ (G3's allow-list, `check-casework-build.mjs`). */
export const CASEWORK_ROUTE_FILES = [
    'server/api/admin/jurisdictions.get.ts',
    'server/api/admin/application-counts.get.ts',
    'server/api/admin/schemas.get.ts',
    'server/api/admin/schemas/import.post.ts',
    'server/api/admin/schema-group-counts.get.ts',
    'server/api/admin/schemas/[id].delete.ts',
    'server/api/admin/schemas/[id]/classification.patch.ts',
    'server/api/admin/schemas/[id]/status.patch.ts',
    'server/api/admin/fim/catalog.get.ts',
    'server/api/admin/fim/import.post.ts',
    'server/api/admin/applications.get.ts',
    'server/api/admin/applications/deadlines.get.ts',
    'server/api/admin/applications/[id]/index.get.ts',
    'server/api/admin/applications/[id]/index.delete.ts',
    'server/api/admin/applications/[id]/status.patch.ts',
    'server/api/admin/applications/[id]/deadline.patch.ts',
    'server/api/admin/applications/[id]/assignee.patch.ts',
    'server/api/admin/applications/[id]/assignees.get.ts',
    'server/api/admin/applications/[id]/data.patch.ts',
    'server/api/admin/applications/[id]/events/index.get.ts',
    'server/api/admin/applications/[id]/events/[kind]/seen.post.ts',
    'server/api/admin/case-layout/index.get.ts',
    'server/api/admin/case-layout/index.patch.ts',
    'server/api/admin/case-layout/workspace.patch.ts',
    'server/api/admin/applications/[id]/delegate.post.ts',
    'server/api/admin/applications/[id]/status-correction.patch.ts',
    'server/api/admin/applications/[id]/status-rollback.patch.ts',
    'server/api/admin/applications/[id]/attachments/[attachmentId].delete.ts',
    'server/api/admin/applications/[id]/attachments/[attachmentId]/preview.get.ts',
    'server/api/admin/applications/[id]/attachments/[attachmentId]/download.get.ts',
    'server/api/admin/jurisdictions/[jurisdiction]/boilerplates.get.ts',
    'server/api/admin/workspace-settings.get.ts',
    'server/api/admin/workspace-settings.patch.ts',
    'server/api/admin/workspace-organisations.get.ts',
    'server/api/admin/workspace-organisations.post.ts',
    'server/api/admin/workspace-organisations/[id].patch.ts',
    'server/api/admin/workspace-organisations/[id].delete.ts',
    'server/api/export/excel.post.ts',
    'server/api/workspace-invites/index.post.ts',
    'server/api/workspace-invites/claim/[token].post.ts',
    'server/api/workspace-invites/verify/[token].get.ts',
    'server/api/admin/jurisdictions/[jurisdiction]/settings/branding.get.ts',
    'server/api/admin/jurisdictions/[jurisdiction]/settings/branding.patch.ts',
    'server/api/admin/jurisdictions/[jurisdiction]/settings/general.get.ts',
    'server/api/admin/jurisdictions/[jurisdiction]/settings/general.patch.ts',
    'server/api/admin/jurisdictions/[jurisdiction]/settings/embed.get.ts',
    'server/api/admin/jurisdictions/[jurisdiction]/settings/embed.patch.ts',
    'server/api/admin/applications/[id]/cover-sheet.post.ts',
    'server/api/admin/applications/[id]/cover-sheets/[coverId]/revoke.post.ts',
    'server/api/admin/applications/[id]/docgen/[...path].ts',
    'server/api/admin/applications/[id]/docgen/index.get.ts',
    'server/api/admin/applications/[id]/nachforderung/[requestId]/deadline.post.ts',
    'server/api/admin/applications/[id]/nachreichung.get.ts',
    'server/api/admin/applications/[id]/nachreichung/[entryId]/reassign.post.ts',
    'server/api/admin/applications/[id]/nachreichung/[entryId]/remove.post.ts',
    'server/api/admin/docgen/[...path].ts',
    'server/api/admin/form-schema-groups/index.get.ts',
    'server/api/admin/form-schema-groups/index.post.ts',
    'server/api/admin/jurisdictions/[jurisdiction]/content.get.ts',
    'server/api/admin/jurisdictions/[jurisdiction]/content.post.ts',
    'server/api/admin/jurisdictions/[jurisdiction]/content/[id].patch.ts',
    'server/api/admin/jurisdictions/[jurisdiction]/documents/[id].delete.ts',
    'server/api/admin/jurisdictions/[jurisdiction]/documents.get.ts',
    'server/api/admin/jurisdictions/[jurisdiction]/documents.post.ts',
    'server/api/admin/jurisdictions/[jurisdiction]/documents/[id].get.ts',
    'server/api/admin/jurisdictions/[jurisdiction]/documents/[id].patch.ts',
    'server/api/admin/jurisdictions/[jurisdiction]/settings/delegation.get.ts',
    'server/api/admin/jurisdictions/[jurisdiction]/settings/delegation.patch.ts',
    'server/api/admin/jurisdictions/[jurisdiction]/settings/notification_mail.get.ts',
    'server/api/admin/jurisdictions/[jurisdiction]/settings/notification_mail.patch.ts',
    'server/api/admin/schemas/[id].get.ts',
    'server/api/admin/schemas/[id].patch.ts',
    'server/api/admin/schemas/[id]/organisation.patch.ts',
    'server/api/admin/schemas/[id]/route.get.ts',
    'server/api/admin/schemas/[id]/workflow.get.ts',
    'server/api/admin/schemas/[id]/workflow.patch.ts',
    'server/api/admin/settings/email/[id].put.ts',
    'server/api/admin/settings/email/index.get.ts',
    'server/api/admin/workflow-statuses/[id].delete.ts',
    'server/api/admin/workflow-statuses/[id].patch.ts',
    'server/api/admin/workflow-statuses/index.get.ts',
    'server/api/admin/workflow-statuses/index.post.ts'
];

/**
 * Tests whose subject is open (contract 5.1). They may reference open files only, directly or through a fixture they
 * import; Pro parts go to a sibling `*.pro.test.ts`. Besides this list, every `*.open.test.ts` and every test that has a
 * `*.pro.test.ts` sibling counts as open-subject (`openSubjectTests`), so a divided test stays under the rule.
 * Not here although the contract's list named them: `server/admin-application-precheck.test.ts` (subject: the Pro
 * pre-check sanitizer) and `server/schema-workflow-admin.test.ts` (subject: the Pro `schema-workflow.ts`);
 * `theme/dimmed-token.test.ts`, a guard over every source root whose Pro entries are its allow-list.
 */
const OPEN_SUBJECT_TESTS = [];

/** The open-subject tests: the list above, every `*.open.test.ts`, every test with a `*.pro.test.ts` sibling. */
function openSubjectTests(tests) {
    const all = new Set(tests);
    return new Set([...OPEN_SUBJECT_TESTS, ...tests.filter(test => /\.open\.test\.ts$/u.test(test)
      || (/\.test\.ts$/u.test(test) && !/\.pro\.test\.ts$/u.test(test) && all.has(test.replace(/\.test\.ts$/u, '.pro.test.ts'))))]);
}

const LAYER_REFERENCE = /(?:pro-layer|casework-layer)\/[\w./@[\]-]+/gu;

/** Layer files a test names, directly or (one level deep) through a fixture under tests/unit/fixtures/ it imports. */
function testReferences(test) {
    const text = readFileSync(resolve(root, test), 'utf8');
    const named = (source, via) => [...source.matchAll(LAYER_REFERENCE)]
        .map(match => match[0].replace(/[.]+$/u, ''))
        .map(reference => ({ file: resolveSpecifier(`~~/${reference}`, test) ?? reference, via }));
    const found = named(text, null);
    for (const match of text.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/gu)) {
        const target = resolveSpecifier(match[1], test);
        if (target?.startsWith('tests/unit/fixtures/')) found.push(...named(readFileSync(resolve(root, target), 'utf8'), target));
    }
    const unique = new Map();
    for (const item of found) if (!unique.has(item.file) || (unique.get(item.file).via && !item.via)) unique.set(item.file, item);
    return [...unique.values()];
}

// ---------------------------------------------------------------------------------------------------------------
// Files and layers

export function layerOf(file) {
    if (file.startsWith(`${PRO}/`)) return 'pro';
    if (file.startsWith(`${CASEWORK}/`)) return 'casework';
    if (/^(?:app|server|shared)\//u.test(file)) return 'base';
    if (file.startsWith('tests/')) return 'tests';
    return 'other';
}

const RANK = { base: 0, casework: 1, pro: 2 };

/** Sub-path below the layer root: `casework-layer/app/x.vue` and `app/x.vue` both give `app/x.vue`. */
function subPath(file) {
    return file.replace(/^(?:pro-layer|casework-layer)\//u, '');
}

function isServerFile(file) {
    return subPath(file).startsWith('server/');
}

function walk(directory, result = []) {
    if (!existsSync(directory)) return result;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (!SKIP_DIRS.has(entry.name)) walk(join(directory, entry.name), result);
        } else if (SOURCE_RE.test(entry.name) && !entry.name.endsWith('.d.ts')) {
            result.push(relative(root, join(directory, entry.name)));
        }
    }
    return result;
}

function isFile(file) {
    const path = resolve(root, file);
    return existsSync(path) && statSync(path).isFile();
}

const RESOLVE_SUFFIXES = ['', '.ts', '.vue', '.js', '.mjs', '/index.ts', '/index.js'];

/** Resolves a specifier the way the Nuxt aliases do (`~`/`@` = app/, `~~`/`@@` = root, `#shared`, `#server`). */
export function resolveSpecifier(specifier, fromFile) {
    let base;
    if (specifier.startsWith('./') || specifier.startsWith('../')) base = join(dirname(fromFile), specifier);
    else if (/^(?:~~|@@)\//u.test(specifier)) base = specifier.slice(3);
    else if (/^[~@]\//u.test(specifier)) base = join('app', specifier.slice(2));
    else if (specifier.startsWith('#shared/')) base = join('shared', specifier.slice('#shared/'.length));
    else if (specifier.startsWith('#server/')) base = join('server', specifier.slice('#server/'.length));
    else return null;
    base = relative(root, resolve(root, base.replace(/[?#].*$/u, '')));
    for (const suffix of RESOLVE_SUFFIXES) {
        if (isFile(base + suffix)) return base + suffix;
    }
    return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Parsing: imports, exports, free identifiers, template tags

const DECLARATION_KINDS = new Set([
    ts.SyntaxKind.VariableDeclaration, ts.SyntaxKind.FunctionDeclaration, ts.SyntaxKind.ClassDeclaration,
    ts.SyntaxKind.InterfaceDeclaration, ts.SyntaxKind.TypeAliasDeclaration, ts.SyntaxKind.EnumDeclaration,
    ts.SyntaxKind.Parameter, ts.SyntaxKind.TypeParameter, ts.SyntaxKind.ImportClause, ts.SyntaxKind.NamespaceImport,
    ts.SyntaxKind.ImportSpecifier, ts.SyntaxKind.BindingElement, ts.SyntaxKind.FunctionExpression,
    ts.SyntaxKind.ClassExpression, ts.SyntaxKind.ModuleDeclaration, ts.SyntaxKind.ImportEqualsDeclaration
]);
const NAME_ONLY_KINDS = new Set([
    ts.SyntaxKind.PropertyAssignment, ts.SyntaxKind.PropertyDeclaration, ts.SyntaxKind.PropertySignature,
    ts.SyntaxKind.MethodDeclaration, ts.SyntaxKind.MethodSignature, ts.SyntaxKind.GetAccessor, ts.SyntaxKind.SetAccessor,
    ts.SyntaxKind.EnumMember, ts.SyntaxKind.LabeledStatement, ts.SyntaxKind.JsxAttribute, ts.SyntaxKind.ExportSpecifier
]);

function isReference(node) {
    const parent = node.parent;
    if (!parent) return true;
    if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
    if (ts.isQualifiedName(parent) && parent.right === node) return false;
    if ((ts.isBreakStatement(parent) || ts.isContinueStatement(parent)) && parent.label === node) return false;
    if (ts.isBindingElement(parent) && parent.propertyName === node) return false;
    if ((DECLARATION_KINDS.has(parent.kind) || NAME_ONLY_KINDS.has(parent.kind)) && parent.name === node) return false;
    if (ts.isImportSpecifier(parent) && parent.propertyName === node) return false;
    return true;
}

const FETCH_NAMES = new Set(['fetch', '$fetch', 'useFetch', 'useLazyFetch', 'staffFetch', 'fetchStaffFile', 'fetchDocgenFile', 'postStaffFile']);

function isFetchCall(expression) {
    if (ts.isIdentifier(expression)) return FETCH_NAMES.has(expression.text);
    if (!ts.isPropertyAccessExpression(expression)) return false;
    return FETCH_NAMES.has(expression.name.text)
      || (['raw', 'native'].includes(expression.name.text) && isFetchCall(expression.expression));
}

function routeExpression(node, constant, seen = new Set()) {
    if (!node || seen.has(node)) return null;
    seen.add(node);
    const read = value => routeExpression(value, constant, new Set(seen));
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) return read(node.body);
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return read(node.expression);
    if (ts.isIdentifier(node)) return read(constant(node));
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'value') return read(node.expression);
    if (ts.isTemplateExpression(node)) {
        return node.head.text + node.templateSpans.map(span => (read(span.expression) ?? '*') + span.literal.text).join('');
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        const left = read(node.left);
        return left === null ? null : left + (read(node.right) ?? '*');
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'computed') return read(node.arguments[0]);
    return null;
}

function fetchRequest(node, constant) {
    const path = routeExpression(node.arguments[0], constant)?.split(/[?#]/u, 1)[0]?.replace(/\/$/u, '') || '';
    if (!path.startsWith('/') || path.startsWith('//')) return;
    if ((ts.isIdentifier(node.expression) ? node.expression.text : node.expression.name?.text) === 'postStaffFile') {
        return { path, method: 'POST' };
    }
    const options = node.arguments[1];
    const methodOption = options && ts.isObjectLiteralExpression(options)
        ? options.properties.find(prop => (ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop))
          && prop.name.getText().replace(/['"]/gu, '') === 'method')
        : undefined;
    const method = methodOption
        ? routeExpression(ts.isShorthandPropertyAssignment(methodOption) ? methodOption.name : methodOption.initializer, constant)?.toUpperCase()
        : !options || (ts.isObjectLiteralExpression(options) && !options.properties.some(ts.isSpreadAssignment)) ? 'GET' : undefined;
    return { path, method };
}

function scanScript(text, fileName, kind, out) {
    const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind);
    const calls = [];
    const constantNames = new Set();
    let checker;
    const constant = (identifier) => {
        if (!constantNames.has(identifier.text)) return;
        // Resolve shadowed names in their lexical scope. This needs only the current script.
        if (!checker) {
            const options = { noLib: true, noResolve: true, allowJs: true, types: [] };
            const host = ts.createCompilerHost(options);
            host.getSourceFile = name => name === fileName ? source : undefined;
            checker = ts.createProgram([fileName], options, host).getTypeChecker();
        }
        const symbol = ts.isShorthandPropertyAssignment(identifier.parent)
            ? checker.getShorthandAssignmentValueSymbol(identifier.parent)
            : checker.getSymbolAtLocation(identifier);
        const binding = symbol?.valueDeclaration;
        if (binding && ts.isVariableDeclaration(binding) && (binding.parent.flags & ts.NodeFlags.Const)) {
            return binding.initializer;
        }
    };
    const visit = (node) => {
        if (out.fetches && ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer
          && (node.parent.flags & ts.NodeFlags.Const)) {
            constantNames.add(node.name.text);
        }
        if (out.fetches && ts.isCallExpression(node) && isFetchCall(node.expression)) calls.push(node);
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
            const clause = ts.isImportDeclaration(node) ? node.importClause : undefined;
            const typeOnly = ts.isExportDeclaration(node)
                ? node.isTypeOnly
                : Boolean(clause?.isTypeOnly || (clause && !clause.name && clause.namedBindings && ts.isNamedImports(clause.namedBindings)
                  && clause.namedBindings.elements.length > 0 && clause.namedBindings.elements.every(element => element.isTypeOnly)));
            out.imports.push({ specifier: node.moduleSpecifier.text, typeOnly, line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1 });
        } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) {
            out.imports.push({ specifier: node.arguments[0].text, typeOnly: false, line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1 });
        } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
            out.imports.push({ specifier: node.argument.literal.text, typeOnly: true, line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1 });
        }
        if (ts.isIdentifier(node)) {
            if (isReference(node)) out.references.add(node.text);
            else if (node.parent && DECLARATION_KINDS.has(node.parent.kind)) out.declared.add(node.text);
        }
        if (out.exports && node.parent === source) collectExports(node, out.exports, fileName);
        ts.forEachChild(node, visit);
    };
    visit(source);
    for (const call of calls) {
        const request = fetchRequest(call, constant);
        if (request) out.fetches.push({ ...request, line: source.getLineAndCharacterOfPosition(call.getStart()).line + 1 });
    }
}

function hasExportModifier(node) {
    return Boolean(ts.canHaveModifiers(node) && ts.getModifiers(node)?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword));
}

function collectExports(node, exports, fileName) {
    if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const element of node.exportClause.elements) exports.add(element.name.text);
        return;
    }
    if (ts.isExportAssignment(node)) {
        // unimport names a default export after its file (`useFoo.ts` gives `useFoo`).
        exports.add(basename(fileName, extname(fileName)).replace(/[-_.](\w)/gu, (_, char) => char.toUpperCase()));
        return;
    }
    if (!hasExportModifier(node)) return;
    if (ts.isVariableStatement(node)) {
        for (const declaration of node.declarationList.declarations) {
            if (ts.isIdentifier(declaration.name)) exports.add(declaration.name.text);
        }
    } else if (node.name && ts.isIdentifier(node.name)) {
        exports.add(node.name.text);
    }
}

function scanTemplateExpression(expression, out) {
    const local = { imports: [], references: new Set(), declared: new Set(), fetches: out.fetches };
    const asExpression = ts.createSourceFile('template.ts', `(${expression});`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    scanScript(asExpression.parseDiagnostics?.length ? expression : `(${expression});`, 'template.ts', ts.ScriptKind.TS, local);
    for (const name of local.references) {
        if (!local.declared.has(name)) out.references.add(name);
    }
}

function declareTemplateNames(pattern, out) {
    const local = { imports: [], references: new Set(), declared: new Set() };
    scanScript(`(${pattern}) => 0;`, 'template.ts', ts.ScriptKind.TS, local);
    for (const name of local.declared) out.declared.add(name);
}

function scanTemplate(nodes, out) {
    for (const node of nodes ?? []) {
        if (node.type === 1) {
            out.tags.add(node.tag);
            for (const prop of node.props) {
                if (prop.type !== 7) continue;
                const expression = prop.exp?.content;
                if (prop.name === 'for' && expression) {
                    const match = expression.match(/^\s*([\s\S]+?)\s+(?:in|of)\s+([\s\S]+)$/u);
                    if (match) {
                        declareTemplateNames(match[1].trim().replace(/^\(([\s\S]*)\)$/u, '$1'), out);
                        scanTemplateExpression(match[2], out);
                    }
                } else if (prop.name === 'slot' && expression) {
                    declareTemplateNames(expression, out);
                } else if (expression) {
                    scanTemplateExpression(expression, out);
                }
            }
            scanTemplate(node.children, out);
        } else if (node.type === 5 && node.content?.content) {
            scanTemplateExpression(node.content.content, out);
        }
    }
}

const parsed = new Map();

/** Imports, free identifiers, template tags and (for auto-import files) exports of one source file. */
export function parseFile(file, withExports = false, projectRoot = root) {
    const path = resolve(projectRoot, file);
    const key = `${path}:${withExports}`;
    if (parsed.has(key)) return parsed.get(key);
    const text = readFileSync(path, 'utf8');
    const out = { imports: [], fetches: [], references: new Set(), declared: new Set(), tags: new Set(), exports: withExports ? new Set() : null };
    if (file.endsWith('.vue')) {
        const { descriptor } = parseSfc(text, { filename: file });
        for (const block of [descriptor.script, descriptor.scriptSetup]) {
            if (block) scanScript(block.content, `${file}.ts`, block.lang === 'tsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS, out);
        }
        if (descriptor.template?.ast) scanTemplate(descriptor.template.ast.children, out);
    } else {
        scanScript(text, file, /\.m?js$/u.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS, out);
    }
    out.free = new Set([...out.references].filter(name => !out.declared.has(name)));
    parsed.set(key, out);
    return out;
}

// ---------------------------------------------------------------------------------------------------------------
// What each layer registers: auto-imports, components, pages, routes

const LAYER_ROOTS = { base: '', casework: `${CASEWORK}/`, pro: `${PRO}/` };

function topLevelFiles(directory) {
    const path = resolve(root, directory);
    if (!existsSync(path)) return [];
    return readdirSync(path, { withFileTypes: true })
        .filter(entry => entry.isFile() && /\.(?:ts|js|mjs)$/u.test(entry.name) && !entry.name.endsWith('.d.ts'))
        .map(entry => join(directory, entry.name));
}

/** name -> files, for the client (Nuxt: top level of composables/, utils/ and the layers' `imports.dirs`) and server (Nitro: server/utils/**). */
export function autoImportIndex() {
    const client = new Map();
    const server = new Map();
    const add = (index, file) => {
        for (const name of parseFile(file, true).exports) {
            if (!index.has(name)) index.set(name, []);
            index.get(name).push(file);
        }
    };
    for (const prefix of Object.values(LAYER_ROOTS)) {
        const dirs = [`${prefix}app/composables`, `${prefix}app/utils`];
        // The casework Nuxt config registers composables/api as well.
        if (prefix) dirs.push(`${prefix}app/composables/api`);
        for (const directory of dirs) topLevelFiles(directory).forEach(file => add(client, file));
        walk(resolve(root, `${prefix}server/utils`)).forEach(file => add(server, file));
    }
    return { client, server };
}

const NUMBER_RE = /\d/u;
function isUpper(char) {
    return NUMBER_RE.test(char) ? undefined : char !== char.toLowerCase();
}

/** scule's `splitByCase`, which Nuxt uses for component names. */
function splitByCase(value) {
    const parts = [];
    let buffer = '';
    let previousUpper;
    let previousSplitter;
    for (const char of value) {
        const splitter = ['-', '_', '/', '.'].includes(char);
        if (splitter) {
            parts.push(buffer);
            buffer = '';
            previousUpper = undefined;
            continue;
        }
        const upper = isUpper(char);
        if (previousSplitter === false) {
            if (previousUpper === false && upper === true) {
                parts.push(buffer);
                buffer = char;
                previousUpper = upper;
                continue;
            }
            if (previousUpper === true && upper === false && buffer.length > 1) {
                const last = buffer.at(-1);
                parts.push(buffer.slice(0, -1));
                buffer = last + char;
                previousUpper = upper;
                continue;
            }
        }
        buffer += char;
        previousUpper = upper;
        previousSplitter = splitter;
    }
    parts.push(buffer);
    return parts;
}

function pascalCase(parts) {
    return parts.filter(Boolean).map(part => part[0].toUpperCase() + part.slice(1)).join('');
}

/** Nuxt's `resolveComponentNameSegments` (path prefix on, duplicated prefix dropped). */
function componentName(componentsDir, file) {
    const relativePath = relative(componentsDir, file);
    let fileName = basename(relativePath, extname(relativePath)).replace(/\.(?:client|server|island)$/u, '');
    const prefixParts = dirname(relativePath) === '.' ? [] : splitByCase(dirname(relativePath));
    if (fileName.toLowerCase() === 'index') fileName = '';
    const fileNameParts = splitByCase(fileName);
    const content = fileNameParts.join('/').toLowerCase();
    const nameParts = prefixParts.flatMap(part => splitByCase(part));
    const matched = [];
    for (let index = prefixParts.length - 1; index >= 0; index--) {
        const prefixPart = prefixParts[index];
        matched.unshift(...splitByCase(prefixPart).map(part => part.toLowerCase()));
        const matchedContent = matched.join('/');
        if (content === matchedContent || content.startsWith(`${matchedContent}/`)
          || (prefixPart.toLowerCase() === content && prefixParts[index + 1] && prefixParts[index] === prefixParts[index + 1])) {
            nameParts.length = index;
        }
    }
    return pascalCase([...nameParts, ...fileNameParts]);
}

/** layer -> Map(component name -> file). */
export function componentIndex() {
    const result = {};
    for (const [layer, prefix] of Object.entries(LAYER_ROOTS)) {
        const directory = `${prefix}app/components`;
        // Nuxt registers render-function components (`.ts`) as well as `.vue` files.
        result[layer] = new Map(walk(resolve(root, directory)).map(file => [componentName(directory, file), file]));
    }
    return result;
}

/** Component name of a template tag (`admin-foo`, `AdminFoo`, `LazyAdminFoo`). */
function tagComponentName(tag) {
    return pascalCase(splitByCase(tag)).replace(/^Lazy(?=[A-Z])/u, '');
}

/** `server/api/a/[id]/index.get.ts` -> `GET /api/a/:id`; `server/routes/x.ts` -> `ALL /x`. */
export function routeOfFile(file) {
    const sub = subPath(file);
    const match = sub.match(/^server\/(api|routes)\/(.+)\.(?:ts|js|mjs)$/u);
    if (!match) return null;
    let path = match[2];
    const method = path.match(/\.(get|post|put|patch|delete|head|options)$/u)?.[1];
    if (method) path = path.slice(0, -(method.length + 1));
    path = path.replace(/(?:^|\/)index$/u, '');
    path = path.replace(/\[\.\.\.(\w*)\]/gu, (_, name) => `**:${name || '_'}`).replace(/\[(\w+)\]/gu, ':$1');
    const prefix = match[1] === 'api' ? '/api' : '';
    return { method: (method ?? 'all').toUpperCase(), path: `${prefix}/${path}`.replace(/\/$/u, '') || '/' };
}

function pageKey(file) {
    return subPath(file).replace(/^app\/pages\//u, '').replace(/\.vue$/u, '');
}

/** Matches a path inferred from a fetch call against a Nitro file route. */
export function matchesFetchRoute(request, route) {
    if (request.method && route.method !== 'ALL' && request.method !== route.method
      && !(request.method === 'HEAD' && route.method === 'GET')) return false;
    const actual = request.path.split('/').slice(1);
    const expected = route.path.split('/').slice(1);
    for (const [index, segment] of expected.entries()) {
        if (segment.startsWith('**')) return true;
        if (actual[index] === undefined) return false;
        if (segment.startsWith(':') || actual[index] === segment) continue;
        if (!actual[index].includes('*')) return false;
        const pattern = actual[index].split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('.*');
        if (!new RegExp(`^${pattern}$`, 'u').test(segment)) return false;
    }
    return actual.length === expected.length;
}

/** Rule 6: a fetch from open code cannot rely on a Pro-only file route. */
export function checkFetchRoutes(files, projectRoot = root) {
    const errors = [];
    const routes = files.flatMap((file) => {
        const route = routeOfFile(file);
        return route ? [{ ...route, file }] : [];
    });
    const proRoutes = routes.filter(route => layerOf(route.file) === 'pro');
    const openRoutes = routes.filter(route => layerOf(route.file) !== 'pro');
    for (const file of files) {
        if (layerOf(file) === 'pro') continue;
        for (const request of parseFile(file, false, projectRoot).fetches) {
            const uncovered = proRoutes.filter((route) => {
                if (!matchesFetchRoute(request, route)) return false;
                if (request.method) return !openRoutes.some(open => matchesFetchRoute(request, open));
                if (route.method === 'ALL') {
                    return !openRoutes.some(open => open.method === 'ALL' && matchesFetchRoute(request, open));
                }
                return !openRoutes.some(open => matchesFetchRoute({ ...request, method: route.method }, open));
            });
            if (uncovered.length) {
                errors.push(`rule 6: ${file}:${request.line} fetches ${request.method ?? 'ANY'} ${request.path}, available only from ${uncovered.map(route => route.file).join(', ')}`);
            }
        }
    }
    return errors;
}

// ---------------------------------------------------------------------------------------------------------------
// The check

function readExceptions() {
    return JSON.parse(readFileSync(resolve(root, EXCEPTIONS_FILE), 'utf8'));
}

/** Runs rules 1 to 6; `exceptions` defaults to the exception file (a test passes its own). */
export function checkLayerBoundary({ exceptions = readExceptions() } = {}) {
    const errors = [];
    const notes = [];
    const files = ['app', 'server', 'shared', PRO, CASEWORK].flatMap(directory => walk(resolve(root, directory)));
    const autoImports = autoImportIndex();
    const components = componentIndex();
    const used = { imports: new Set(), identifiers: new Set(), tags: new Set(), duplicates: new Set(), testReferences: new Set() };
    const importKey = (importer, target) => `${importer} -> ${target}`;
    const importExceptions = new Map((exceptions.imports ?? []).map(entry => [importKey(entry.importer, entry.target), entry]));
    const identifierExceptions = new Set((exceptions.identifiers ?? []).map(entry => `${entry.file}#${entry.name}`));
    const tagExceptions = new Set((exceptions.tags ?? []).map(entry => `${entry.file}#${entry.tag}`));
    const duplicateExceptions = new Set((exceptions.duplicates ?? []).map(entry => `${entry.kind}:${entry.key}`));
    const testExceptions = new Set((exceptions.testReferences ?? []).map(entry => `${entry.test} -> ${entry.target}`));

    // Rule 1: imports out of the open layers.
    let importStatements = 0;
    for (const file of files) {
        const layer = layerOf(file);
        if (layer === 'pro') continue;
        for (const entry of parseFile(file).imports) {
            const target = resolveSpecifier(entry.specifier, file);
            if (!target || RANK[layerOf(target)] === undefined || RANK[layerOf(target)] <= RANK[layer]) continue;
            const key = importKey(file, target);
            if (importExceptions.has(key)) {
                used.imports.add(key);
                importStatements++;
                continue;
            }
            errors.push(`rule 1: ${file}:${entry.line} imports ${target}${entry.typeOnly ? ' (type only)' : ''}`);
        }
    }

    // Rule 2: auto-imported names and component tags that only a higher layer provides.
    for (const file of files) {
        const layer = layerOf(file);
        if (layer === 'pro') continue;
        const info = parseFile(file);
        const index = isServerFile(file) ? autoImports.server : autoImports.client;
        for (const name of info.free) {
            const providers = index.get(name) ?? [];
            if (!providers.length || providers.some(provider => RANK[layerOf(provider)] <= RANK[layer])) continue;
            const key = `${file}#${name}`;
            if (identifierExceptions.has(key)) used.identifiers.add(key);
            else errors.push(`rule 2: ${file} uses ${name}, auto-imported from ${providers.join(', ')}`);
        }
        if (isServerFile(file)) continue;
        for (const tag of info.tags) {
            const name = tagComponentName(tag);
            const providers = ['base', 'casework', 'pro'].filter(provider => components[provider].has(name));
            if (!providers.length || providers.some(provider => RANK[provider] <= RANK[layer])) continue;
            const key = `${file}#${tag}`;
            if (tagExceptions.has(key)) used.tags.add(key);
            else errors.push(`rule 2: ${file} renders <${tag}>, a component of ${providers.map(provider => components[provider].get(name)).join(', ')}`);
        }
    }

    // Rule 3: nothing in two layers.
    const registry = { page: new Map(), component: new Map(), route: new Map() };
    const register = (kind, key, file) => {
        if (!registry[kind].has(key)) registry[kind].set(key, []);
        registry[kind].get(key).push(file);
    };
    for (const file of files) {
        if (layerOf(file) === 'other' || file.startsWith('shared/')) continue;
        if (/^app\/pages\//u.test(subPath(file)) && file.endsWith('.vue')) register('page', pageKey(file), file);
        const route = routeOfFile(file);
        if (route) register('route', `${route.method} ${route.path}`, file);
    }
    for (const index of Object.values(components)) {
        for (const [name, file] of index) register('component', name, file);
    }
    for (const [kind, map] of Object.entries(registry)) {
        for (const [key, owners] of map) {
            if (new Set(owners.map(layerOf)).size < 2) continue;
            const id = `${kind}:${key}`;
            if (duplicateExceptions.has(id)) used.duplicates.add(id);
            else errors.push(`rule 3: ${kind} ${key} exists in two layers: ${owners.join(', ')}`);
        }
    }

    // Rule 4: tests. A Pro reference counts directly or through a fixture the test imports.
    const tests = walk(resolve(root, 'tests'));
    const openSubjects = openSubjectTests(tests);
    const counts = { open: 0, pro: 0, mixed: 0, throughFixture: 0 };
    for (const test of tests) {
        if (test.startsWith('tests/unit/fixtures/')) continue;
        const references = testReferences(test);
        const proReferences = references.filter(reference => layerOf(reference.file) === 'pro');
        const openReferences = references.filter(reference => layerOf(reference.file) === 'casework');
        if (proReferences.length && openReferences.length) counts.mixed++;
        else if (proReferences.length) counts.pro++;
        else if (openReferences.length) counts.open++;
        if (proReferences.length && proReferences.every(reference => reference.via)) counts.throughFixture++;
        if (!openSubjects.has(test)) continue;
        for (const reference of proReferences) {
            const key = `${test} -> ${reference.file}`;
            if (testExceptions.has(key)) used.testReferences.add(key);
            else errors.push(`rule 4: open-subject test ${test} references the Pro file ${reference.file}${reference.via ? ` through the fixture ${reference.via}` : ''}`);
        }
    }
    for (const test of OPEN_SUBJECT_TESTS) {
        if (!isFile(test)) errors.push(`rule 4: open-subject test ${test} does not exist (update OPEN_SUBJECT_TESTS)`);
    }

    errors.push(...checkBaseLocales(root));

    errors.push(...checkFetchRoutes(files));

    // Dead exceptions: the file may only shrink.
    const dead = [
        ...[...importExceptions.keys()].filter(key => !used.imports.has(key)).map(key => `imports: ${key}`),
        ...[...identifierExceptions].filter(key => !used.identifiers.has(key)).map(key => `identifiers: ${key}`),
        ...[...tagExceptions].filter(key => !used.tags.has(key)).map(key => `tags: ${key}`),
        ...[...duplicateExceptions].filter(key => !used.duplicates.has(key)).map(key => `duplicates: ${key}`),
        ...[...testExceptions].filter(key => !used.testReferences.has(key)).map(key => `testReferences: ${key}`)
    ];
    for (const entry of dead) errors.push(`dead exception (matches nothing, remove it): ${entry}`);

    const caseworkFiles = files.filter(file => layerOf(file) === 'casework');
    notes.push(`files: ${files.length} (casework-layer/ ${caseworkFiles.length}, closed layer ${files.filter(file => layerOf(file) === 'pro').length})`);
    notes.push(`exceptions in use: imports ${used.imports.size} (${importStatements} statements), identifiers ${used.identifiers.size}, tags ${used.tags.size}, duplicates ${used.duplicates.size}, testReferences ${used.testReferences.size}`);
    notes.push(`tests referencing layer files (directly or through a fixture): ${counts.open} open only, ${counts.pro} Pro only, ${counts.mixed} mixed (reported, not failed); ${counts.throughFixture} reach Pro only through a fixture`);
    notes.push(`open-subject tests under rule 4: ${openSubjects.size}`);
    return { errors, notes };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const result = checkLayerBoundary();
    for (const note of result.notes) console.log(note);
    if (result.errors.length) {
        console.error(`\nLayer boundary: ${result.errors.length} violation(s)`);
        for (const error of result.errors) console.error(`  ${error}`);
        process.exit(1);
    }
    console.log('Layer boundary passed: no crossing into a higher layer beyond scripts/layer-boundary.exceptions.json.');
}
