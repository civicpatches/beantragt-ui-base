// ESLint rule `beantragt/nuxt-ui-literal-variants`: the theme guard. A theme only takes effect where the code does not
// write a variant into the template, so a literal `variant`, `color` or `size` on a Nuxt UI component is reported
// when it
//   (a) repeats the default of the installed @nuxt/ui or of the app's theme, current.ts (`defaults`), or
//   (b) sets what the theme is meant to steer (`themeSteered`).
// Deliberate deviations (`allowed`) and every other literal are not reported. A bound value (`:variant="x"`) is
// not reported. In scripts and template expressions, `variant: '<value>'` properties listed in `scriptVariants`
// are reported as (b), except in an object with `label` or `onClick`: that is an action button (alert actions,
// menu items), whose variant is a rank, not the theme's. The component an object goes to is otherwise unknown.
// Options and the list of deviations: ./nuxt-ui-literal-variants.options.js. An `allowed` entry with `files` holds
// only in those files (repo-relative paths): a deviation of named places, checked before the theme's class, so it can
// keep a literal the theme would otherwise own there; a literal that repeats a default is still reported.
// `count: true` (used by scripts/count-literal-variants.mjs only) reports every Nuxt UI element and every literal
// with its class, so the totals can be watched going down.

import { relative, sep } from 'node:path';

const ATTRIBUTES = ['variant', 'color', 'size'];

/** `UButton` and `u-button` -> `UButton`; anything else -> null. */
export function nuxtUiName(rawName) {
    if (/^U[A-Z]/u.test(rawName)) return rawName;
    if (/^u-[a-z]/u.test(rawName)) return rawName.replace(/(^|-)([a-z])/gu, (_, _dash, letter) => letter.toUpperCase());
    return null;
}

function listed(list, value) {
    return list === '*' || (Array.isArray(list) && list.includes(value));
}

function matches(entry, component, attribute, value, literals, file) {
    if (entry.attribute !== attribute || !listed(entry.components, component) || !listed(entry.values, value)) return false;
    if (entry.files && !entry.files.includes(file)) return false;
    // `with`: the entry holds only together with these literal values on the same element.
    return Object.entries(entry.with ?? {}).every(([name, values]) => listed(values, literals[name]));
}

/**
 * The class of one literal: 'default' (a), 'theme' (b), 'allowed', or 'other'.
 * @param {object} options the rule options
 * @param {string} component e.g. `UButton`
 * @param {string} attribute `variant`, `color` or `size`
 * @param {string} value the literal value
 * @param {Record<string, string>} literals all literal look attributes of the same element
 * @param {string} [file] the repo-relative path of the file, for `allowed` entries bound to `files`
 */
export function classify(options, component, attribute, value, literals = {}, file = '') {
    if (options.defaults?.[component]?.[attribute] === value) return { kind: 'default' };
    const allowed = options.allowed ?? [];
    if (allowed.some(entry => entry.files && matches(entry, component, attribute, value, literals, file))) return { kind: 'allowed' };
    const steered = (options.themeSteered ?? []).find(entry => matches(entry, component, attribute, value, literals, file));
    if (steered) return { kind: 'theme', source: steered.source };
    if (allowed.some(entry => !entry.files && matches(entry, component, attribute, value, literals, file))) return { kind: 'allowed' };
    return { kind: 'other' };
}

const entrySchema = {
    type: 'object',
    properties: {
        components: { anyOf: [{ const: '*' }, { type: 'array', items: { type: 'string' } }] },
        attribute: { enum: ATTRIBUTES },
        values: { anyOf: [{ const: '*' }, { type: 'array', items: { type: 'string' } }] },
        with: { type: 'object', additionalProperties: { type: 'array', items: { type: 'string' } } },
        files: { type: 'array', items: { type: 'string' }, minItems: 1 },
        source: { type: 'string' }
    },
    required: ['components', 'attribute', 'values'],
    additionalProperties: false
};

export default {
    meta: {
        type: 'suggestion',
        docs: { description: 'Report literal variant, color and size on Nuxt UI components that a default or the theme decides' },
        schema: [{
            type: 'object',
            properties: {
                defaults: { type: 'object', additionalProperties: { type: 'object', additionalProperties: { type: 'string' } } },
                themeSteered: { type: 'array', items: entrySchema },
                allowed: { type: 'array', items: entrySchema },
                scriptVariants: { type: 'array', items: { type: 'string' } },
                count: { type: 'boolean' }
            },
            additionalProperties: false
        }],
        messages: {
            default: '{{component}} {{attribute}}="{{value}}" repeats the default (@nuxt/ui theme or the app theme, app/utils/theme/current.ts). Remove it, so the theme decides.',
            theme: '{{component}} {{attribute}}="{{value}}" is set by the theme ({{source}}). Remove it; a deliberate deviation belongs in the list of eslint-rules/nuxt-ui-literal-variants.options.js.',
            scriptVariant: 'variant: \'{{value}}\' is set by the theme (alerts and badges, audit 4.2). Remove it from the object.',
            // Counting mode only.
            countElement: '{{component}}',
            countAllowed: '{{component}} {{attribute}}="{{value}}" allowed',
            countOther: '{{component}} {{attribute}}="{{value}}" other'
        }
    },
    create(context) {
        const options = context.options[0] ?? {};
        const count = options.count === true;
        const scriptVariants = options.scriptVariants ?? [];
        const file = relative(context.cwd, context.filename).split(sep).join('/');

        const keyOf = property => property.type !== 'Property' || property.computed
            ? null
            : property.key?.type === 'Identifier' ? property.key.name : property.key?.type === 'Literal' ? property.key.value : null;
        const scriptVisitor = {
            Property(node) {
                if (keyOf(node) !== 'variant') return;
                // `'subtle' as const` and `'subtle' satisfies …` carry the same literal.
                let value = node.value;
                while (value && (value.type === 'TSAsExpression' || value.type === 'TSSatisfiesExpression')) value = value.expression;
                if (value?.type !== 'Literal' || typeof value.value !== 'string' || !scriptVariants.includes(value.value)) return;
                const siblings = node.parent?.type === 'ObjectExpression' ? node.parent.properties.map(keyOf) : [];
                if (siblings.includes('label') || siblings.includes('onClick')) return;
                // The one place that says the default (`<component>.defaultVariants` in the app's theme, current.ts).
                const owner = node.parent?.parent;
                if (owner?.type === 'Property' && keyOf(owner) === 'defaultVariants') return;
                context.report({ node: value, messageId: 'scriptVariant', data: { value: value.value } });
            }
        };

        const templateVisitor = {
            // Objects in template expressions (`:items="[{ variant: 'subtle' }]"`).
            Property: scriptVisitor.Property,
            VElement(element) {
                const component = nuxtUiName(element.rawName);
                if (!component) return;
                if (count) context.report({ node: element.startTag, messageId: 'countElement', data: { component } });
                const attributes = element.startTag.attributes.filter(attribute => !attribute.directive && ATTRIBUTES.includes(attribute.key.name) && attribute.value);
                const literals = Object.fromEntries(attributes.map(attribute => [attribute.key.name, attribute.value.value]));
                for (const attribute of attributes) {
                    const name = attribute.key.name;
                    const value = attribute.value.value;
                    const result = classify(options, component, name, value, literals, file);
                    const data = { component, attribute: name, value, source: result.source ?? '' };
                    if (result.kind === 'default') context.report({ node: attribute, messageId: 'default', data });
                    else if (result.kind === 'theme') context.report({ node: attribute, messageId: 'theme', data });
                    else if (count) context.report({ node: attribute, messageId: result.kind === 'allowed' ? 'countAllowed' : 'countOther', data });
                }
            }
        };

        const services = context.sourceCode.parserServices;
        if (services?.defineTemplateBodyVisitor) return services.defineTemplateBodyVisitor(templateVisitor, scriptVisitor);
        return scriptVisitor;
    }
};
