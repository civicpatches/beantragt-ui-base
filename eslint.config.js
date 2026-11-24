// eslint.config.js - ESLint v9 (flat-config) for beantragt.ai Nuxt 4 + TypeScript
import { createConfigForNuxt } from '@nuxt/eslint-config';
import tseslint from 'typescript-eslint';
import nuxtUiLiteralVariants from './eslint-rules/nuxt-ui-literal-variants.js';
import { LITERAL_VARIANT_SEVERITY, literalVariantOptions } from './eslint-rules/nuxt-ui-literal-variants.options.js';
import noPaletteColours from './eslint-rules/no-palette-colours.js';
import { PALETTE_COLOUR_SEVERITY, paletteColourOptions } from './eslint-rules/no-palette-colours.options.js';

export default createConfigForNuxt({
    features: {
        stylistic: true
    }
})
    .prepend(
        {
            ignores: ['.nuxt/**', '.nuxt-*/**', '.output/**', '.output-*/**', 'dist/**']
        },
        {
            // Foreign source, verbatim copies of the Nuxt UI theme engine (app/utils/theme/NOTICE.md): their own
            // style is kept so they stay comparable with upstream; fixes go upstream.
            ignores: ['app/utils/theme/engine/**', 'app/utils/theme/icons.ts', 'app/utils/theme/nuxt-ui-icons.ts']
        },
        // TypeScript parser for .ts/.js files only (not .vue, which uses vue-eslint-parser)
        ...tseslint.configs.recommended.map(config => ({
            ...config,
            files: ['**/*.ts', '**/*.js', '**/*.mjs']
        }))
    )
    .override('nuxt/vue/rules', {
        languageOptions: {
            parserOptions: {
                parser: tseslint.parser
            }
        },
        rules: {
            'vue/multi-word-component-names': ['warn', {
                ignores: ['index', '[id]', '[applicationId]']
            }],
            'vue/require-default-prop': 'off',
            'vue/no-v-html': 'off',
            'vue/no-deprecated-filter': 'off'
        }
    })
    .override('nuxt/stylistic', {
        rules: {
            '@stylistic/no-trailing-spaces': 'warn',
            '@stylistic/comma-dangle': 'warn',
            '@stylistic/semi': 'warn',
            '@stylistic/eol-last': 'warn',
            '@stylistic/indent': 'warn',
            '@stylistic/brace-style': 'warn'
        }
    })
    .append({
        name: 'beantragt-rules',
        files: ['**/*.{ts,js,mjs,vue}'],
        rules: {
            'no-console': 'off',
            'no-debugger': process.env.NODE_ENV === 'production' ? 'error' : 'off',
            'no-undef': 'off',
            'no-unused-vars': 'off',
            // Keep the ESLint 9 rule baseline when Nuxt's config pulls @eslint/js 10.
            'no-useless-assignment': 'off',
            'preserve-caught-error': 'off',
            'prefer-const': 'warn'
        }
    })
    .append({
        name: 'beantragt-typescript',
        files: ['**/*.ts', '**/*.js', '**/*.mjs'],
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unused-vars': ['warn', {
                argsIgnorePattern: '^_',
                varsIgnorePattern: '^_',
                ignoreRestSiblings: true,
                caughtErrors: 'none'
            }],
            '@typescript-eslint/no-require-imports': 'off'
        }
    })
    .append({
        // Theme guard: literal variant, color and size that a default or the theme
        // decides. Severity and the list of deliberate deviations: eslint-rules/nuxt-ui-literal-variants.options.js.
        // Palette colours: a class names what a colour means, from the theme's tokens;
        // the exceptions with their reasons: eslint-rules/no-palette-colours.options.js.
        name: 'beantragt-theme-guard',
        files: ['app/**/*.{vue,ts}', 'casework-layer/**/*.{vue,ts}'],
        plugins: { beantragt: { rules: { 'nuxt-ui-literal-variants': nuxtUiLiteralVariants, 'no-palette-colours': noPaletteColours } } },
        rules: {
            'beantragt/nuxt-ui-literal-variants': [LITERAL_VARIANT_SEVERITY, literalVariantOptions],
            'beantragt/no-palette-colours': [PALETTE_COLOUR_SEVERITY, paletteColourOptions]
        }
    });
