<script setup lang="ts">
import {
    publicStatusLookupPath,
    publicWorkspaceFromRoute,
    type PublicFormPathInput
} from '~/utils/public-form-path';
import { usePublicFooterLinks } from '~/composables/usePublicFooterLinks';
import { useLoadedPublicJurisdictionConfig } from '~/composables/usePublicJurisdictionConfig';
import { appExtensions, type AppExtensionOutletName } from '~/utils/app-extensions';
import AppProductLinks from '~/components/AppProductLinks.vue';
import { FOOTER_LINK_CLASS } from '~/utils/citizen-layout';

/**
 * The one footer of every public citizen page: the status lookup and
 * the legal and help pages of the municipality, in the same place on every
 * page, the legal pages included. Layers can add an entry everywhere or
 * just on the start page.
 */
const props = withDefaults(defineProps<{
    /** Workspace of the links; defaults to the one in the route. */
    workspace?: PublicFormPathInput
    showStartActions?: boolean
    hideProductLinks?: boolean
    /** The page body already links to the status lookup. */
    hideStatusLookup?: boolean
}>(), {
    workspace: undefined
});

const { t } = useI18n();
const route = useRoute();
const footerWorkspace = computed(() => props.workspace ?? publicWorkspaceFromRoute(route));
const tenantConfig = useLoadedPublicJurisdictionConfig(() => footerWorkspace.value.jurisdictionSlug);
const { links } = usePublicFooterLinks(footerWorkspace);
const statusLookupPath = computed(() => publicStatusLookupPath(footerWorkspace.value));
const footerOutlets = computed(() => {
    const outlets: AppExtensionOutletName[] = ['footer-actions'];
    if (props.showStartActions) outlets.push('start-footer-actions');
    return outlets.filter(name => appExtensions(name).length > 0);
});
</script>

<template>
  <!--
    Left aligned at the container edge at every width; the empty side
    slots of UFooter would push the list off the edge.
  -->
  <UFooter
    class="print:hidden"
    :ui="{
      root: 'border-t border-default',
      container: 'max-w-6xl py-6 lg:px-6 lg:py-6 xl:pe-0',
      left: 'hidden',
      right: 'hidden',
      center: 'mt-0 w-full min-w-0 flex-col items-start gap-3',
    }"
    data-testid="app-footer"
  >
    <nav
      :aria-label="t('nav.footerLabel')"
      class="w-full min-w-0"
    >
      <ul class="flex flex-wrap items-center justify-start gap-x-6 gap-y-2 text-sm">
        <li v-if="!hideStatusLookup">
          <ULink
            :to="statusLookupPath"
            :class="FOOTER_LINK_CLASS"
            data-testid="app-footer-status-lookup"
          >
            {{ t('nav.statusLookup') }}
          </ULink>
        </li>
        <li
          v-for="link in links"
          :key="link.key === 'accessibility' ? 'accessibility' : link.id || link.path"
          class="min-w-0 max-w-full"
        >
          <ULink
            :to="link.path"
            :class="FOOTER_LINK_CLASS"
            data-testid="app-footer-link"
          >
            {{ link.title }}
          </ULink>
        </li>
        <!-- "Demo starten" of demo mode: the last action of the same list. -->
        <li
          v-for="outlet in footerOutlets"
          :key="outlet"
          data-testid="app-footer-actions"
        >
          <AppExtensionOutlet :name="outlet" />
        </li>
        <AppProductLinks
          :hide-product-links="hideProductLinks"
          :platform-footer="!tenantConfig"
          class="basis-full xl:ms-auto xl:basis-auto"
        />
      </ul>
    </nav>
  </UFooter>
</template>
