// i18n ownership of the open case work. Reads the source only.
//   node scripts/check-i18n-layers.mjs   check, exit 1 on a violation or a dead exception
// Read the base locales and any translations delivered by Pro. `i18n/layer-keys.json` names the key
// prefixes owned by `casework` and by `pro` (and `base` prefixes inside those); every other key is base; the longest
// matching prefix decides. Rules:
//   (a) every prefix of the manifest exists in both locales;
//   (b) no literal key in app/, server/, shared/ starts with a casework or pro prefix;
//   (c) no literal key in casework-layer/ starts with a pro prefix;
//   (d) keys built at run time (template strings, concatenation, a variable passed to t()) are listed, not failed;
//   (e) exceptions live in the manifest, each with a reason; one that no longer matches anything fails.
// A literal key is any string literal in a script or a template expression whose value is a key of the locales.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import { parse as parseSfc } from 'vue/compiler-sfc';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const MANIFEST = 'i18n/layer-keys.json';
export const LOCALES = ['i18n/locales/de.ts', 'i18n/locales/en.ts'];
/** Source roots per layer, the same roots as `tests/unit/source-roots.ts`. */
export const LAYER_ROOTS = { base: ['app', 'server', 'shared'], casework: ['casework-layer'], pro: ['pro-layer'] };
const SOURCE_RE = /\.(?:ts|vue|js|mjs)$/u;
const SKIP_DIRS = new Set(['node_modules', '.nuxt', '.output', 'dist']);
const T_CALLEES = new Set(['t', '$t', 'te', 'tm', 'rt']);

/** The object literal of `export default { ... }`, evaluated without running the module (as check-translations.js). */
export function loadLocale(root, file) {
    const text = readFileSync(resolve(root, file), 'utf8');
    const start = text.indexOf('{', text.indexOf('export default'));
    let depth = 0;
    let quote = null;
    let end = -1;
    for (let i = start; i < text.length; i++) {
        const c = text[i];
        if (quote) {
            if (c === '\\') i++;
            else if (c === quote) quote = null;
            continue;
        }
        if (c === '\'' || c === '"' || c === '`') quote = c;
        else if (c === '/' && text[i + 1] === '/') i = text.indexOf('\n', i);
        else if (c === '{') depth++;
        else if (c === '}' && --depth === 0) {
            end = i;
            break;
        }
    }
    return new vm.Script(`(${text.slice(start, end + 1)})`, { filename: file }).runInNewContext(Object.create(null), { timeout: 2000 });
}

/** Every key path of a locale object, inner nodes included (`admin`, `admin.detail`, `admin.detail.title`). */
export function keyPaths(object, prefix = '', out = new Set()) {
    for (const [key, value] of Object.entries(object)) {
        const path = prefix ? `${prefix}.${key}` : key;
        out.add(path);
        if (value && typeof value === 'object' && !Array.isArray(value)) keyPaths(value, path, out);
    }
    return out;
}

function walk(root, directory, out = []) {
    const path = resolve(root, directory);
    if (!existsSync(path)) return out;
    for (const entry of readdirSync(path, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (!SKIP_DIRS.has(entry.name)) walk(root, join(directory, entry.name), out);
        } else if (SOURCE_RE.test(entry.name) && !entry.name.endsWith('.d.ts')) {
            out.push(join(directory, entry.name));
        }
    }
    return out;
}

/**
 * A `t()` argument whose every outcome is written out: a literal, or `a ? 'x' : 'y'` over literals. Its literals are
 * counted as literal keys; a template string that starts with a key is listed by its own rule, so it counts here too.
 * Anything else (a variable, a call, `${prefix}.label`) is a run-time-built key of the call.
 */
function literalChoice(node, startsWithKey) {
    if (ts.isParenthesizedExpression(node)) return literalChoice(node.expression, startsWithKey);
    if (ts.isConditionalExpression(node)) return literalChoice(node.whenTrue, startsWithKey) && literalChoice(node.whenFalse, startsWithKey);
    if (ts.isTemplateExpression(node)) return startsWithKey(node.head.text);
    return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
}

function calleeName(expression) {
    if (ts.isIdentifier(expression)) return expression.text;
    if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
    return null;
}

/** Literal strings and run-time-built keys of one piece of code. `line0` offsets template expressions. */
function scanCode(code, kind, line0, keys, out) {
    const source = ts.createSourceFile('x.ts', code, ts.ScriptTarget.Latest, true, kind);
    const lineOf = node => line0 + source.getLineAndCharacterOfPosition(node.getStart(source)).line;
    // `admin.bulk.flow.${x}`, `admin.bulk.log.agentsStopped${x}` and `access.${x}` start with a key; `${x}.title` does not.
    const startsWithKey = (text) => {
        const head = text.replace(/\.$/u, '');
        if (!head.includes('.')) return text.endsWith('.') && keys.has(head);
        return keys.has(head) || keys.has(head.slice(0, head.lastIndexOf('.')));
    };
    const visit = (node) => {
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
            // With a dot only: bare words such as `bulk` are values in code (an origin), not keys.
            if (node.text.includes('.') && keys.has(node.text)) out.literals.push({ key: node.text, line: lineOf(node) });
        } else if (ts.isTemplateExpression(node) && startsWithKey(node.head.text)) {
            out.runtime.push({ text: node.getText(source).replace(/\s+/gu, ' ').slice(0, 160), line: lineOf(node), head: node.head.text.replace(/\.$/u, '') });
        } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken
          && (ts.isStringLiteral(node.left) || ts.isNoSubstitutionTemplateLiteral(node.left)) && startsWithKey(node.left.text)) {
            out.runtime.push({ text: node.getText(source).replace(/\s+/gu, ' ').slice(0, 160), line: lineOf(node), head: node.left.text.replace(/\.$/u, '') });
        } else if (ts.isCallExpression(node) && T_CALLEES.has(calleeName(node.expression) ?? '') && node.arguments[0]
          && !literalChoice(node.arguments[0], startsWithKey)) {
            out.runtime.push({ text: node.getText(source).replace(/\s+/gu, ' ').slice(0, 160), line: lineOf(node) });
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
}

function templateExpressions(nodes, out = []) {
    for (const node of nodes ?? []) {
        if (node.type === 1) {
            for (const prop of node.props) {
                if (prop.type === 7 && prop.exp?.content) out.push({ code: prop.exp.content, line: prop.exp.loc.start.line });
                if (prop.type === 6 && prop.value?.content) out.push({ code: JSON.stringify(prop.value.content), line: prop.loc.start.line });
            }
            templateExpressions(node.children, out);
        } else if (node.type === 5 && node.content?.content) {
            out.push({ code: node.content.content, line: node.content.loc.start.line });
        }
    }
    return out;
}

/** Literal keys and run-time-built keys of one source file. */
export function scanFile(root, file, keys) {
    const text = readFileSync(resolve(root, file), 'utf8');
    const out = { literals: [], runtime: [] };
    if (file.endsWith('.vue')) {
        const { descriptor } = parseSfc(text, { filename: file });
        for (const block of [descriptor.script, descriptor.scriptSetup]) {
            if (block) scanCode(block.content, ts.ScriptKind.TS, block.loc.start.line, keys, out);
        }
        for (const expression of templateExpressions(descriptor.template?.ast?.children)) {
            // `(...)` keeps an object literal an expression; v-for and v-slot heads parse as well or yield nothing.
            scanCode(`(${expression.code});`, ts.ScriptKind.TS, expression.line, keys, out);
        }
    } else {
        scanCode(text, /\.m?js$/u.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS, 1, keys, out);
    }
    return out;
}

/** Every literal key and run-time-built key, per layer. */
export function scanLayers(root, keys) {
    const result = {};
    for (const [layer, dirs] of Object.entries(LAYER_ROOTS)) {
        result[layer] = dirs.flatMap(directory => walk(root, directory)).map(file => ({ file, ...scanFile(root, file, keys) }));
    }
    return result;
}

const owns = (prefix, key) => key === prefix || key.startsWith(`${prefix}.`);

export function checkI18nLayers({ root = repoRoot, manifest = JSON.parse(readFileSync(resolve(root, MANIFEST), 'utf8')) } = {}) {
    const hasPro = existsSync(resolve(root, 'pro-layer'));
    const locales = LOCALES.map((file) => {
        const proFile = `${LAYER_ROOTS.pro[0]}/${file}`;
        return new Set([
            ...keyPaths(loadLocale(root, file)),
            ...(existsSync(resolve(root, proFile)) ? keyPaths(loadLocale(root, proFile)) : [])
        ]);
    });
    const keys = new Set([...locales[0], ...locales[1]]);
    const errors = [];
    const notes = [];
    // `base` lists only prefixes that take a part of a wider casework or pro prefix back to base.
    const owners = { base: manifest.base ?? [], casework: manifest.casework ?? [], pro: [...(manifest.pro ?? []), ...(manifest.proLocaleOnly ?? [])] };

    // (a) every prefix exists in both locales
    for (const [owner, prefixes] of Object.entries(owners)) {
        for (const prefix of prefixes) {
            LOCALES.forEach((file, index) => {
                if (!locales[index].has(prefix) && (owner !== 'pro' || hasPro)) errors.push(`(a) the ${owner} prefix ${prefix} is not a key of ${file}`);
            });
        }
    }
    // The longest matching prefix decides: `caseTransfers` is Pro, `caseTransfers.legacyTarget` is case work.
    const ownerOf = (key) => {
        let best = { owner: 'base', length: -1 };
        for (const [owner, prefixes] of Object.entries(owners)) {
            for (const prefix of prefixes) {
                if (owns(prefix, key) && prefix.length > best.length) best = { owner, length: prefix.length };
            }
        }
        return best.owner;
    };
    const exceptions = manifest.exceptions ?? [];
    const used = new Set();
    const scan = scanLayers(root, keys);
    const counts = {};
    const runtime = [];
    for (const [layer, files] of Object.entries(scan)) {
        counts[layer] = { files: files.length, literals: 0, base: 0, casework: 0, pro: 0 };
        for (const { file, literals, runtime: built } of files) {
            for (const { key, line } of literals) {
                const owner = ownerOf(key);
                counts[layer].literals++;
                counts[layer][owner]++;
                const forbidden = (layer === 'base' && owner !== 'base') || (layer === 'casework' && owner === 'pro');
                if (!forbidden) continue;
                const exception = exceptions.findIndex(entry => entry.file === file && entry.key === key);
                if (exception >= 0) {
                    used.add(exception);
                    continue;
                }
                errors.push(`(${layer === 'base' ? 'b' : 'c'}) ${file}:${line} uses the ${owner} key ${key}`);
            }
            for (const { text, line, head } of built) {
                // A fixed part owned by a higher layer is worth a look (the key may be missing there), still not a failure.
                const higher = head !== undefined && ((layer === 'base' && ownerOf(head) !== 'base') || (layer === 'casework' && ownerOf(head) === 'pro'));
                runtime.push({ layer, at: `${file}:${line}`, text, ...(higher ? { higher: ownerOf(head) } : {}) });
            }
        }
    }
    // (e) dead exceptions
    exceptions.forEach((entry, index) => {
        if (!entry.reason) errors.push(`(e) the exception ${entry.file} ${entry.key} has no reason`);
        if (!used.has(index)) errors.push(`(e) dead exception (matches nothing, remove it): ${entry.file} ${entry.key}`);
    });
    for (const [layer, c] of Object.entries(counts)) {
        notes.push(`${layer}: ${c.files} files, ${c.literals} literal keys (base ${c.base}, casework ${c.casework}, pro ${c.pro})`);
    }
    notes.push(`manifest: casework ${owners.casework.length} prefixes, pro ${owners.pro.length} prefixes, base overrides ${owners.base.length}, exceptions ${exceptions.length} (${used.size} in use)`);
    notes.push(`run-time-built keys, listed, not checked: ${runtime.length} (${['base', 'casework', 'pro'].map(layer => `${layer} ${runtime.filter(item => item.layer === layer).length}`).join(', ')}); with a fixed part owned by a higher layer: ${runtime.filter(item => item.higher).length}`);
    return { errors, notes, runtime, counts };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const result = checkI18nLayers();
    for (const note of result.notes) console.log(note);
    for (const item of result.runtime) console.log(`  ${item.layer} ${item.at} ${item.higher ? `[fixed part is ${item.higher}] ` : ''}${item.text}`);
    if (result.errors.length) {
        console.error(`\ni18n layers: ${result.errors.length} violation(s)`);
        for (const error of result.errors) console.error(`  ${error}`);
        process.exit(1);
    }
    console.log(`i18n layers passed: no key of a higher layer in a lower one beyond ${MANIFEST}.`);
}
