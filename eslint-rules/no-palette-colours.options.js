// Options of `beantragt/no-palette-colours` (./no-palette-colours.js). Every exception is bound to its files and
// names its reason; the classes are compared without variant, opacity and `!` (`dark:bg-white/20` -> `bg-white`).

export const PALETTE_COLOUR_SEVERITY = 'error';

export const paletteColourOptions = {
    allowed: [
        {
            files: ['casework-layer/app/pages/admin/settings/branding.vue'],
            classes: ['bg-white', 'bg-neutral-900', 'text-neutral-600', 'text-neutral-400'],
            source: 'logo previews: the plates show the logo on the background it will stand on; the "no logo" texts sit on those fixed plates'
        },
        {
            files: ['app/components/MunicipalityBrand.vue', 'app/pages/index.vue'],
            classes: ['bg-white'],
            source: 'pattern 11: the white plate behind a light logo in dark mode'
        }
    ]
};
