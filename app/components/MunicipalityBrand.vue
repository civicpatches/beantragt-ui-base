<script setup lang="ts">
/**
 * The municipality's logo or, without one, its crest and name.
 *
 * Sizes: `md` (default) is the citizen header and the standalone pages, logo
 * 40 px high and at most 96 px wide below `sm`, 192 px from `sm`; `sm` is the
 * staff sidebar, logo 32 px high and at most 160 px wide; `xs` is the
 * collapsed sidebar, where a wide logo becomes the municipality's first letter
 * in a square avatar.
 *
 * The logo always stands in the same box, so it does not move when the colour
 * mode changes. Dark mode: with a dark variant of the logo the two pictures
 * swap (like `BrandLogo`) and the box stays transparent; with one logo only
 * the box becomes a white plate. The interface never guesses a logo's colours:
 * an uploaded SVG gets a dark variant only when it brings its own dark styling
 * (`utils/svg-logo-color-modes.ts`), and both forms are only ever `<img src>`.
 * Without a logo the crest keeps its place in the sidebar (`px-2`, which the
 * sidebar link gave it before the logo box existed).
 */
import { getPublicWorkspaceBrand } from '~/utils/public-brand';
import BrandLogo from '~/components/BrandLogo.vue';
import {
    publicJurisdictionLogoAlt,
    publicJurisdictionLogoDarkSrc,
    publicJurisdictionLogoSrc,
    publicJurisdictionName
} from '~/utils/public-jurisdiction-config';
import { publicWorkspaceFromRoute, type PublicFormPathInput } from '~/utils/public-form-path';
import { svgLogoColorModes } from '~/utils/svg-logo-color-modes';

const props = withDefaults(defineProps<{
    showText?: boolean
    size?: 'xs' | 'sm' | 'md'
    workspace?: PublicFormPathInput | null
}>(), {
    showText: true,
    size: 'md',
    workspace: null
});

const { t } = useI18n();
const route = useRoute();
const workspace = computed(() => props.workspace || publicWorkspaceFromRoute(route));
const { config: publicConfig } = usePublicJurisdictionConfig(computed(() => workspace.value.jurisdictionSlug));
const publicBrand = computed(() => getPublicWorkspaceBrand(workspace.value));
const runtimeJurisdictionName = computed(() => publicJurisdictionName(publicConfig.value));
const runtimeLogoSrc = computed(() => publicJurisdictionLogoSrc(publicConfig.value));
const runtimeLogoDarkSrc = computed(() => publicJurisdictionLogoDarkSrc(publicConfig.value));
const runtimeLogoAlt = computed(() => publicJurisdictionLogoAlt(publicConfig.value));
const workspaceLabel = computed(() => props.workspace?.jurisdictionLabel?.trim() || null);
const label = computed(() =>
    workspaceLabel.value
    || runtimeJurisdictionName.value
    || publicBrand.value?.name
    || t('common.municipalitySubtitle')
);
const subtitle = computed(() => publicBrand.value?.subtitle || t('common.municipalitySubtitle'));
/**
 * Pictures that did not load. A derived form or a dark variant that fails gives way to the
 * original logo on its plate, never to a broken picture without the plate.
 */
const failedSources = ref<ReadonlySet<string>>(new Set());
function onLogoError(event: Event) {
    const src = (event.currentTarget as HTMLImageElement | null)?.getAttribute('src');
    if (src && !failedSources.value.has(src)) failedSources.value = new Set([...failedSources.value, src]);
}
/**
 * Light and dark picture of the uploaded logo. Dark, in this order: the uploaded dark logo, the
 * derived dark form of an SVG that styles itself, none (the plate). A dark logo without a logo
 * shows nothing of its own. When any picture other than the uploaded logo fails, the uploaded logo
 * stands on its plate, never a broken picture without it.
 */
const runtimeLogoPair = computed(() => {
    const source = runtimeLogoSrc.value;
    if (!source) return null;
    const modes = svgLogoColorModes(source);
    const uploadedDark = runtimeLogoDarkSrc.value;
    const light = modes?.light || source;
    const dark = uploadedDark || modes?.dark || null;
    const alternatives = [dark, light === source ? null : light].filter((src): src is string => Boolean(src));
    if (alternatives.some(src => failedSources.value.has(src))) return { light: source, dark: null };
    return { light, dark };
});
const logoSrc = computed(() => runtimeLogoPair.value?.light || publicBrand.value?.logoSrc || null);
// The static dark variant belongs to the static logo it was drawn for, never to an upload.
const logoDarkSrc = computed(() => {
    if (runtimeLogoSrc.value) return runtimeLogoPair.value?.dark || null;
    const dark = publicBrand.value?.logoDarkSrc;
    return dark && !failedSources.value.has(dark) ? dark : null;
});
const logoAlt = computed(() => runtimeLogoAlt.value || publicBrand.value?.logoAlt || publicBrand.value?.name || label.value);
const initial = computed(() => Array.from(label.value.trim())[0]?.toLocaleUpperCase('de') || '');

const logoBoxClass = computed(() => {
    const box = props.size === 'md'
        ? 'inline-flex shrink-0 items-center rounded-md px-1.5 py-1.5 sm:px-2.5'
        : 'inline-flex shrink-0 items-center rounded-md px-2.5 py-1.5';
    return logoDarkSrc.value ? box : `${box} dark:bg-white`;
});
const logoImageClass = computed(() => props.size === 'md'
    ? 'h-10 w-auto max-w-24 object-contain object-left sm:max-w-48'
    : 'h-8 w-auto max-w-40 object-contain object-left');
const fallbackBoxClass = computed(() => props.size === 'md' ? 'size-9 rounded-lg' : 'size-8 rounded-md');
const fallbackIconClass = computed(() => props.size === 'md' ? 'size-7' : 'size-6');
</script>

<template>
  <BrandLogo
    v-if="!publicConfig"
    :size="size"
  />
  <span
    v-else
    class="inline-flex items-center gap-2 min-w-0"
    :class="{ 'px-2': size === 'sm' && !logoSrc }"
  >
    <UAvatar
      v-if="logoSrc && size === 'xs'"
      :text="initial"
      :ui="{ root: 'rounded-md' }"
      role="img"
      :aria-label="showText ? undefined : label"
      :aria-hidden="showText ? 'true' : undefined"
      data-testid="municipality-brand-mark"
    />
    <span
      v-else-if="logoSrc"
      :class="logoBoxClass"
      data-testid="municipality-brand-logo"
    >
      <!-- Two pictures from the framework (light `dark:hidden`, dark `hidden dark:block`) in the same box,
           so the logo keeps place and height when the mode changes; one picture on the plate otherwise. -->
      <UColorModeImage
        v-if="logoDarkSrc"
        :light="logoSrc"
        :dark="logoDarkSrc"
        :alt="showText ? '' : logoAlt"
        :aria-hidden="showText ? 'true' : undefined"
        :class="logoImageClass"
        data-testid="municipality-brand-logo-pair"
        @error="onLogoError"
      />
      <img
        v-else
        :src="logoSrc"
        :alt="showText ? '' : logoAlt"
        :aria-hidden="showText ? 'true' : undefined"
        :class="logoImageClass"
        @error="onLogoError"
      >
    </span>
    <span
      v-else
      class="inline-flex shrink-0 items-center justify-center border border-(--ui-border) bg-(--ui-bg-elevated)"
      :class="fallbackBoxClass"
      :aria-hidden="showText ? 'true' : undefined"
      :aria-label="showText ? undefined : label"
      :role="showText ? undefined : 'img'"
    >
      <svg
        viewBox="0 0 36 42"
        :class="fallbackIconClass"
        focusable="false"
      >
        <path
          d="M18 2 32 7v12c0 9.5-5.8 16.6-14 20.8C9.8 35.6 4 28.5 4 19V7l14-5Z"
          fill="var(--ui-primary)"
        />
        <path
          d="M18 5.3 28.7 9v10c0 7-3.9 12.8-10.7 16.6C11.2 31.8 7.3 26 7.3 19V9L18 5.3Z"
          fill="white"
        />
        <path
          d="M10.5 11.4 18 8.8l7.5 2.6v7.4c0 5.2-2.7 9.7-7.5 12.9-4.8-3.2-7.5-7.7-7.5-12.9v-7.4Z"
          fill="var(--ui-primary)"
        />
        <path
          d="M18 9.2v22.3c4.8-3.2 7.5-7.6 7.5-12.8v-7.3L18 9.2Z"
          fill="rgb(255 255 255 / 0.22)"
        />
        <path
          d="M12.6 16.4h10.8M12.6 20.8h10.8M12.6 25.2h10.8"
          stroke="white"
          stroke-width="2"
          stroke-linecap="round"
        />
      </svg>
    </span>
    <span
      v-if="showText && !logoSrc"
      class="min-w-0 leading-tight"
    >
      <span class="block text-sm font-semibold text-(--ui-text-highlighted) truncate">
        {{ label }}
      </span>
      <span class="block text-xs text-(--ui-text-muted) truncate">
        {{ subtitle }}
      </span>
    </span>
    <span
      v-else-if="showText"
      class="sr-only"
    >
      {{ label }}. {{ subtitle }}
    </span>
  </span>
</template>
