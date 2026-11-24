<script setup lang="ts">
import { de, en } from '@nuxt/ui/locale';
import CitizenPage from '~/components/citizen/Page.vue';
import {
    publicHomePath,
    publicLoginPath,
    publicWorkspaceFromRoute,
    type PublicFormPathInput
} from '~/utils/public-form-path';

const props = defineProps<{
    error: {
        statusCode: number
        statusMessage?: string
        message?: string
        data?: unknown
    }
}>();

const { t, locale } = useI18n();
const route = useRoute();

// The error page replaces app.vue, so it brings its own UApp (labels of the
// Nuxt UI controls in the page language) and the frame of every public
// page: header, footer and a way back.
const uiLocale = computed(() => locale.value === 'en' ? en : de);

/**
 * An unknown municipality: the start page found no forms for the slug.
 * Every link of the frame then points to the platform pages, since links
 * into the unknown municipality would only lead here again.
 */
const errorCode = computed(() => (props.error.data as { code?: unknown } | undefined)?.code);
const workspaceMissing = computed(() => errorCode.value === 'workspace_not_found');
/** An unknown organisation of a real municipality: the way back is the municipality. */
const organisationMissing = computed(() => errorCode.value === 'organisation_not_found');
/**
 * An unmatched route has no workspace parameter. If the first path segment
 * resolves to a municipality, use its frame, branding and link back.
 */
const routeWorkspace = computed(() => publicWorkspaceFromRoute(route));
const pathSlug = computed(() => {
    if (workspaceMissing.value || organisationMissing.value || routeWorkspace.value.jurisdictionSlug) return null;
    const segment = (route.path || '').split('/')[1]?.toLowerCase() ?? '';
    return /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/u.test(segment) ? segment : null;
});
const { config: pathConfig } = usePublicJurisdictionConfig(pathSlug);
const pathWorkspace = computed(() => pathSlug.value && pathConfig.value ? pathSlug.value : null);
const frameWorkspace = computed<PublicFormPathInput>(() => {
    if (workspaceMissing.value) return {};
    if (pathWorkspace.value) return { jurisdictionSlug: pathWorkspace.value };
    const workspace = routeWorkspace.value;
    return organisationMissing.value ? { jurisdictionSlug: workspace.jurisdictionSlug } : workspace;
});
const homePath = computed(() => publicHomePath(frameWorkspace.value));
const loginPath = computed(() => publicLoginPath(frameWorkspace.value));

onMounted(() => {
    void useGlobalMaintenance().handleRequestError(props.error);
});

const errorTitle = computed(() => {
    if (workspaceMissing.value) return t('errors.workspaceNotFound');
    if (organisationMissing.value) return t('errors.organisationNotFound');
    switch (props.error.statusCode) {
        case 404: return t('errors.pageNotFound');
        case 403: return t('errors.accessDenied');
        case 401: return t('errors.notAuthenticated');
        case 500: return t('errors.serverError');
        default: return t('errors.genericError', { code: props.error.statusCode });
    }
});

// statusMessage carries technical English text ("Workspace not found"),
// so visitors always get the localized description for the status code.
const errorDescription = computed(() => {
    if (workspaceMissing.value) return t('errors.workspaceNotFoundDescription');
    if (organisationMissing.value) return t('errors.organisationNotFoundDescription');
    switch (props.error.statusCode) {
        case 404: return t('errors.pageNotFoundDescription');
        case 403: return t('errors.accessDeniedDescription');
        case 401: return t('errors.notAuthenticatedDescription');
        case 500: return t('errors.serverErrorDescription');
        default: return t('errors.genericDescription');
    }
});

const errorIcon = computed(() => {
    if (workspaceMissing.value || organisationMissing.value) return 'i-lucide-map-pin-off';
    switch (props.error.statusCode) {
        case 404: return 'i-lucide-file-x';
        case 403: return 'i-lucide-shield-x';
        case 401: return 'i-lucide-lock';
        default: return 'i-lucide-alert-triangle';
    }
});

usePublicPrimaryTheme(computed(() => frameWorkspace.value.jurisdictionSlug));
useHead({ title: errorTitle });

const homeLabel = computed(() => workspaceMissing.value ? t('errors.chooseMunicipality') : t('errors.goHome'));

function handleError() {
    clearError({ redirect: homePath.value });
}
</script>

<template>
  <UApp :locale="uiLocale">
    <!-- Citizen frame C1, narrow; header and footer point at the platform when the municipality is unknown. -->
    <CitizenPage
      width="narrow"
      :back-to="false"
      :brand="workspaceMissing ? 'app' : 'municipality'"
      :workspace="frameWorkspace"
    >
      <div
        class="text-center"
        data-testid="error-page-main"
      >
        <UIcon
          :name="errorIcon"
          class="text-6xl mb-6 block mx-auto text-(--ui-text-dimmed)"
        />

        <h1 class="text-2xl font-bold mb-2">
          {{ errorTitle }}
        </h1>

        <p class="text-(--ui-text-muted) mb-8">
          {{ errorDescription }}
        </p>

        <div class="flex flex-wrap items-center justify-center gap-3">
          <UButton
            icon="i-lucide-home"
            data-testid="error-page-home"
            @click="handleError"
          >
            {{ homeLabel }}
          </UButton>

          <UButton
            v-if="error.statusCode === 401"
            :to="loginPath"
            variant="soft"
            icon="i-lucide-log-in"
          >
            {{ t('common.login') }}
          </UButton>
        </div>

        <p class="text-xs text-muted mt-8">
          {{ t('errors.errorCode', { code: error.statusCode }) }}
        </p>
      </div>
    </CitizenPage>
  </UApp>
</template>
