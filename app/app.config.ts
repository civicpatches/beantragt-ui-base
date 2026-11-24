// The look of the app is the installation's theme, not this file: today's look is
// `app/utils/theme/current.ts` (colours, the button icon sizes and square paddings, the tinted alert and
// badge, the modal footer, the new-tab sign), or the theme `NUXT_UI_THEME` names at build time. The build turns
// it into an app config placed AHEAD of this file (`nuxt.config.ts`, `installationThemeModule`). Keep look entries out
// of here: a second source would win over a theme or, for arrays such as `compoundVariants`, double them.
export default defineAppConfig({});
