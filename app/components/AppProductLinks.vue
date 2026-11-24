<script setup lang="ts">
import AppSourceLink from '~/components/AppSourceLink.vue';
import BrandLogo from '~/components/BrandLogo.vue';
import { FOOTER_LINK_CLASS } from '~/utils/citizen-layout';
import { httpLinkHref, productReleaseInfo } from '~/utils/source-link';

const props = withDefaults(defineProps<{
    as?: 'li' | 'p'
    platformFooter?: boolean
    hideProductLinks?: boolean
}>(), {
    as: 'li'
});

const { t } = useI18n();
const config = useRuntimeConfig();
const showProductLine = computed(() => !props.hideProductLinks && !config.public.hideProductLinks);
const websiteHref = computed(() => httpLinkHref(config.public.websiteUrl));
const release = computed(() => productReleaseInfo(config.public.sourceUrl, config.public.appVersion));
const sourceLabel = computed(() => release.value.version
    ? t('nav.productSourceVersionLabel', { version: release.value.version })
    : t('nav.productSourceLabel'));
const producerHref = computed(() => props.platformFooter && httpLinkHref(config.public.civicPatchesUrl));
const docsHref = computed(() => props.platformFooter && httpLinkHref(config.public.docsUrl));
const docsLabel = computed(() => String(config.public.docsLabel ?? '').trim() || t('nav.documentation'));
</script>

<template>
  <component
    :is="as"
    v-if="producerHref || showProductLine || docsHref"
    class="flex min-w-0 max-w-full flex-wrap items-center gap-x-3 gap-y-2"
  >
    <ULink
      v-if="producerHref"
      :to="producerHref"
      target="_blank"
      rel="noopener"
      :class="['gap-2', FOOTER_LINK_CLASS]"
    >
      {{ t('nav.productBy') }}
      <UColorModeImage
        light="/brand/civic-patches-logo.svg"
        dark="/brand/civic-patches-logo-dark.svg"
        alt="Civic Patches"
        width="65"
        height="24"
      />
    </ULink>
    <span
      v-if="showProductLine"
      class="inline-flex min-w-0 max-w-full items-center gap-1.5 text-muted"
      data-testid="app-product-line"
    >
      <ULink
        v-if="websiteHref"
        :to="websiteHref"
        target="_blank"
        rel="noopener"
        :aria-label="t('nav.productWebsite')"
        :class="FOOTER_LINK_CLASS"
      >
        <BrandLogo
          mark
          show-text
        />
      </ULink>
      <BrandLogo
        v-else
        mark
        show-text
      />
      <span
        v-if="release.version"
        class="min-w-0 wrap-anywhere"
        data-testid="app-product-version"
      >{{ release.version }}</span>
      <AppSourceLink
        v-if="release.href"
        :href="release.href"
        :aria-label="sourceLabel"
        :title="sourceLabel"
        class="min-w-6 shrink-0 justify-center"
        :class="FOOTER_LINK_CLASS"
      >
        <UIcon
          :name="release.icon"
          class="size-4"
          aria-hidden="true"
        />
      </AppSourceLink>
    </span>
    <ULink
      v-if="docsHref"
      :to="docsHref"
      target="_blank"
      rel="noopener"
      :class="['min-w-0 max-w-full', FOOTER_LINK_CLASS]"
    >
      {{ docsLabel }}
    </ULink>
  </component>
</template>
