// ESLint rule `beantragt/no-palette-colours`: the framework decides the
// look, so a class names what a colour MEANS (`text-muted`, `text-error`, `bg-elevated`, `border-default`), never a
// fixed step of a Tailwind palette (`text-neutral-500`, `bg-red-500`, `ring-black/10`). A palette step has no meaning
// in dark mode, misses the installation's contrast floor and does not follow a tenant's theme.
// Reported: a palette colour utility (also `black` and `white`, with or without variant prefix, opacity or `!`) in
//   - a static `class` attribute of the template,
//   - a string or template literal in a template expression (`:class`, `:ui`, any binding),
//   - a string or template literal in a script or a `.ts` file (class maps in constants).
// Not reported: the framework's own tokens and the theme's colours (`text-primary`, `bg-success/10`, `--ui-*`),
// and the places listed in ./no-palette-colours.options.js, each bound to its files with a reason.
import { relative, sep } from 'node:path';

export const PALETTES = [
    'slate', 'gray', 'zinc', 'neutral', 'stone', 'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald',
    'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose', 'black', 'white'
];
const PROPERTIES = [
    'text', 'bg', 'border', 'border-x', 'border-y', 'border-t', 'border-r', 'border-b', 'border-l', 'border-s',
    'border-e', 'ring', 'ring-offset', 'inset-ring', 'outline', 'divide', 'fill', 'stroke', 'from', 'via', 'to',
    'placeholder', 'decoration', 'caret', 'accent', 'shadow', 'inset-shadow'
];
const UTILITY = new RegExp(
    `^-?(?:${PROPERTIES.join('|')})-(?:${PALETTES.join('|')})(?:-(?:50|[1-9]00|950))?(?:/(?:\\d{1,3}|\\[[^\\]]+\\]|\\([^)]+\\)))?$`,
    'u'
);

/** The utility of a class token without its variants (`dark:`, `hover:`, `group-data-[x=y]:`) and `!`. */
export function utilityOf(token) {
    let depth = 0;
    let last = -1;
    for (let index = 0; index < token.length; index += 1) {
        const char = token[index];
        if (char === '[' || char === '(') depth += 1;
        else if (char === ']' || char === ')') depth -= 1;
        else if (char === ':' && depth === 0) last = index;
    }
    return token.slice(last + 1).replace(/^!|!$/gu, '');
}

/** The utility without opacity, the unit of an allow entry: `ring-black/10` -> `ring-black`. */
export function baseOf(utility) {
    return utility.replace(/^-/u, '').replace(/\/.*$/u, '');
}

/** The palette colour classes in a class string, as `{ token, base }`. */
export function paletteClasses(text) {
    return String(text).split(/\s+/u).filter(Boolean)
        .map(token => ({ token, utility: utilityOf(token) }))
        .filter(({ utility }) => UTILITY.test(utility))
        .map(({ token, utility }) => ({ token, base: baseOf(utility) }));
}

function fileMatches(files, file) {
    return files.some(entry => entry.endsWith('/') ? file.startsWith(entry) : file === entry);
}

/** True when an allow entry of `options` covers `base` in `file`. */
export function isAllowed(options, file, base) {
    return (options.allowed ?? []).some(entry => fileMatches(entry.files, file)
      && (entry.classes === '*' || entry.classes.includes(base)));
}

const entrySchema = {
    type: 'object',
    properties: {
        files: { type: 'array', items: { type: 'string' }, minItems: 1 },
        classes: { anyOf: [{ const: '*' }, { type: 'array', items: { type: 'string' }, minItems: 1 }] },
        source: { type: 'string' }
    },
    required: ['files', 'classes', 'source'],
    additionalProperties: false
};

export default {
    meta: {
        type: 'suggestion',
        docs: { description: 'Report Tailwind palette colour utilities; the theme\'s semantic tokens say what a colour means' },
        schema: [{
            type: 'object',
            properties: { allowed: { type: 'array', items: entrySchema } },
            additionalProperties: false
        }],
        messages: {
            palette: '`{{token}}` is a fixed palette colour. Use the theme token that says what it means (text-muted, text-highlighted, text-error, bg-default, bg-elevated, border-default, ...). A deliberate exception belongs in eslint-rules/no-palette-colours.options.js.'
        }
    },
    create(context) {
        const options = context.options[0] ?? {};
        const file = relative(context.cwd, context.filename).split(sep).join('/');

        function check(node, text) {
            if (typeof text !== 'string' || text === '') return;
            for (const { token, base } of paletteClasses(text)) {
                if (!isAllowed(options, file, base)) context.report({ node, messageId: 'palette', data: { token } });
            }
        }
        const literalVisitor = {
            Literal(node) {
                if (typeof node.value === 'string' && node.parent?.type !== 'ImportDeclaration') check(node, node.value);
            },
            TemplateElement(node) {
                check(node, node.value?.cooked ?? node.value?.raw);
            }
        };
        const templateVisitor = {
            ...literalVisitor,
            VAttribute(node) {
                if (!node.directive && node.key?.name === 'class' && node.value) check(node, node.value.value);
            }
        };

        const services = context.sourceCode.parserServices;
        if (services?.defineTemplateBodyVisitor) return services.defineTemplateBodyVisitor(templateVisitor, literalVisitor);
        return literalVisitor;
    }
};
