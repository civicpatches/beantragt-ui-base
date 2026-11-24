// These options define which literals the theme guard checks. The counting script uses the same options.
import defaults from './nuxt-ui-defaults.json' with { type: 'json' };

/** Severity of the guard. It was `warn` while T2 removed the literals; T2 is done (13.11.), so it is an error. */
export const LITERAL_VARIANT_SEVERITY = 'error';

export const literalVariantOptions = {
    // Class (a): the default of @nuxt/ui 4.11.3 or of the app's theme.
    defaults: defaults.components,
    // Class (b): what the theme is meant to steer, also where it is not the default today.
    themeSteered: [
        // All alert variants are theme-steered. The snapshot supplies the native subtle default.
        { components: ['UAlert'], attribute: 'variant', values: '*', source: 'audit 4.2, UAlert subtle / soft / outline' },
        // 4.2: badge `subtle` becomes the default; `outline` and `soft`: "no reason found".
        { components: ['UBadge'], attribute: 'variant', values: '*', source: 'audit 4.2, UBadge subtle / outline / soft' },
        // 4.2: the one filled primary button is what a theme restyles; `solid` and `primary` repeat the default today.
        { components: ['UButton'], attribute: 'variant', values: ['solid'], source: 'audit 4.2, UButton variant="solid"' },
        { components: ['UButton'], attribute: 'color', values: ['primary'], source: 'audit 4.2, UButton color="primary"' },
        // Contract 2: the standard size is part of the installation's theme.
        { components: '*', attribute: 'size', values: ['md'], source: 'the theme sets the default size' }
    ],
    // Deliberate deviations: allowed, never reported.
    allowed: [
        // Keep ghost and outline explicit where they distinguish quiet and secondary actions.
        { components: ['UButton'], attribute: 'variant', values: ['ghost', 'outline'], source: 'audit 4.2, ghost 222 / outline 163' },
        { components: ['UButton'], attribute: 'color', values: ['neutral'], with: { variant: ['ghost', 'outline'] }, source: 'audit 4.2, color="neutral" with ghost / outline' },
        // 4.2: "UButton variant=link: differs on purpose (pattern addition line 626)".
        { components: ['UButton'], attribute: 'variant', values: ['link'], source: 'audit 4.2, variant="link"' },
        // Contract 4, addition 08:43: "Fehlerfarbe an einer Löschaktion".
        { components: ['UButton'], attribute: 'color', values: ['error'], source: 'error colour on a destructive action' },
        // Keep condition chips outlined to distinguish editable relations from state indicators.
        {
            components: ['UBadge'], attribute: 'variant', values: ['outline'],
            files: ['casework-layer/app/components/admin/WorkflowTransitionsEditor.vue'],
            source: 'condition chips of a status transition (two places): a token you act on, not a state; lead recommends outline; pending the owner\'s look, 13.11.'
        }
    ],
    // Script side: `variant: 'subtle'` in an object. The target component is not known in a script; in this code
    // base `subtle` is only given to alerts and badges (audit 4.2: 25 such map entries), both theme-steered.
    scriptVariants: ['subtle']
};
