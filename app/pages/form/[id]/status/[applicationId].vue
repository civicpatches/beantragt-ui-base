<script setup lang="ts">
import CitizenPage from '~/components/citizen/Page.vue';
/**
 * Application Status Tracking Page
 *
 * Public page at /form/{schemaId}/status/{statusToken}
 * Shows the current processing status and reference number.
 * Works in both standalone and embed mode.
 *
 * No authentication required. A random public status token serves as
 * the bearer secret. Only exposes minimal info:
 * reference number, status, and timestamps.
 */

import { formatDateTime } from '~/composables/useFormatters';
import {
    publicFormPath,
    publicHomePath,
    publicWorkspaceFromRoute
} from '~/utils/public-form-path';

definePageMeta({
    layout: false
});

const { t } = useI18n();
const route = useRoute();
const schemaId = route.params.id as string;
const statusToken = route.params.applicationId as string;
const routePublicWorkspace = computed(() => publicWorkspaceFromRoute(route));

function routeParam(value: string | string[] | undefined): string | undefined {
    return Array.isArray(value) ? value[0] : value;
}

const routeJurisdictionSlug = routeParam(route.params.workspace as string | string[] | undefined);
const routeOrganisationSlug = routeParam(route.params.organisation as string | string[] | undefined);
const formPath = computed(() => publicFormPath({
    id: schemaId,
    jurisdictionSlug: routeJurisdictionSlug,
    organisationSlug: routeOrganisationSlug
}));
const homePath = computed(() => publicHomePath(routePublicWorkspace.value));

const { isEmbed, applyTheme, cleanupTheme } = useEmbed();

onMounted(() => {
    applyTheme();
});

onBeforeUnmount(() => {
    cleanupTheme();
});

// Status data shape from server API
interface ApplicationStatusData {
    referenceNumber: string
    formTitle: string
    status: string
    statusLabel?: string
    statusColor?: string
    statusIcon?: string
    createdAt: string
    updatedAt: string
}

const { data: statusData, status: fetchStatus, error: fetchError, refresh } = await useFetch<{
    application: ApplicationStatusData
}>(`/api/application-status/${statusToken}`, {
    key: `application-status-${schemaId}-${routeJurisdictionSlug || 'global'}-${routeOrganisationSlug || 'none'}-${statusToken}`,
    query: {
        schemaId,
        jurisdiction: routeJurisdictionSlug,
        organisation: routeOrganisationSlug
    }
});

const application = computed(() => statusData.value?.application ?? null);

function statusCodeFromError(error: unknown): number | null {
    if (!error || typeof error !== 'object') return null;
    const directStatus = (error as { statusCode?: unknown }).statusCode;
    if (typeof directStatus === 'number') return directStatus;
    const status = (error as { status?: unknown }).status;
    if (typeof status === 'number') return status;
    const nestedStatus = (error as { data?: { statusCode?: unknown } }).data?.statusCode;
    return typeof nestedStatus === 'number' ? nestedStatus : null;
}

const statusErrorCode = computed(() => statusCodeFromError(fetchError.value));
const isNotFoundError = computed(() => !fetchError.value || statusErrorCode.value === 404);
const statusErrorIcon = computed(() => isNotFoundError.value ? 'i-lucide-search-x' : 'i-lucide-alert-triangle');
const statusErrorTitle = computed(() => isNotFoundError.value ? t('statusPage.notFound') : t('statusPage.loadError'));

function refreshStatus() {
    void refresh();
}

// Terminal statuses that will not change further
const terminalStatuses = new Set(['approved', 'rejected']);

const isTerminal = computed(() => {
    return application.value ? terminalStatuses.has(application.value.status) : false;
});

// Auto-refresh every 60 seconds, stop for terminal statuses
let refreshInterval: ReturnType<typeof setInterval> | undefined;

onMounted(() => {
    if (!isTerminal.value) {
        refreshInterval = setInterval(() => {
            refresh();
            // Stop polling once a terminal status is reached
            if (isTerminal.value) {
                clearInterval(refreshInterval);
                refreshInterval = undefined;
            }
        }, 60_000);
    }
});

onBeforeUnmount(() => {
    clearInterval(refreshInterval);
});

useHead({
    title: computed(() => t('statusPage.title'))
});
</script>

<template>
  <CitizenPage
    width="narrow"
    :back-to="false"
    :embed="isEmbed"
    :class="{ 'embed-mode': isEmbed }"
  >
    <!-- The narrow layout hides its header and footer in embed mode. This page renders its own heading. -->
    <!-- Loading -->
    <div
      v-if="fetchStatus === 'pending'"
      class="space-y-4"
    >
      <USkeleton class="h-16 w-16 rounded-full mx-auto" />
      <USkeleton class="h-6 w-2/3 mx-auto" />
      <USkeleton class="h-4 w-1/2 mx-auto" />
      <USkeleton class="h-32 w-full rounded-lg" />
    </div>

    <!-- Error -->
    <div
      v-else-if="fetchError || !application"
      class="text-center"
    >
      <UIcon
        :name="statusErrorIcon"
        class="text-5xl mb-4 block mx-auto text-(--ui-text-muted)"
      />
      <h2 class="text-xl font-semibold mb-2">
        {{ statusErrorTitle }}
      </h2>
      <p
        v-if="isNotFoundError"
        class="text-muted mb-6"
      >
        {{ t('statusPage.notFoundDescription') }}
      </p>
      <UButton
        v-if="!isNotFoundError"
        variant="soft"
        icon="i-lucide-refresh-cw"
        class="mr-2"
        @click="refreshStatus"
      >
        {{ t('common.refresh') }}
      </UButton>
      <UButton
        v-if="!isEmbed"
        :to="homePath"
        :color="isNotFoundError ? 'primary' : 'neutral'"
        :variant="isNotFoundError ? 'soft' : 'ghost'"
        icon="i-lucide-arrow-left"
      >
        {{ t('common.backToHome') }}
      </UButton>
    </div>

    <!-- Status display -->
    <UCard v-else>
      <div
        class="text-center py-4"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <!-- Status via StatusBadge (large, centered) -->
        <div class="mb-4 flex justify-center">
          <StatusBadge
            :status="application.status"
            :label="application.statusLabel"
            :color="application.statusColor"
            :icon="application.statusIcon"
            type="application"
            size="lg"
          />
        </div>

        <!-- Form title -->
        <p class="text-sm text-(--ui-text-muted) mb-1">
          {{ application.formTitle }}
        </p>

        <!-- Reference number -->
        <div class="bg-(--ui-bg-elevated) rounded-lg p-4 mb-6">
          <p class="text-sm text-(--ui-text-muted) mb-1">
            {{ t('statusPage.referenceNumber') }}
          </p>
          <p class="text-2xl font-bold font-mono tracking-normal sm:tracking-wide break-words [overflow-wrap:anywhere]">
            {{ application.referenceNumber }}
          </p>
        </div>

        <!-- Timestamps -->
        <div class="grid grid-cols-2 gap-4 text-sm border-t border-(--ui-border) pt-4">
          <div>
            <p class="text-muted mb-1">
              {{ t('statusPage.submittedAt') }}
            </p>
            <p class="text-(--ui-text)">
              {{ formatDateTime(application.createdAt) }}
            </p>
          </div>
          <div>
            <p class="text-muted mb-1">
              {{ t('statusPage.lastUpdated') }}
            </p>
            <p class="text-(--ui-text)">
              {{ formatDateTime(application.updatedAt) }}
            </p>
          </div>
        </div>
      </div>
    </UCard>

    <!-- Refresh hint (only for non-terminal statuses) -->
    <p
      v-if="application && !isTerminal"
      class="text-center text-xs text-muted mt-4"
    >
      <UIcon
        name="i-lucide-refresh-cw"
        class="size-3 inline-block mr-1"
      />
      {{ t('statusPage.autoRefresh') }}
    </p>

    <!-- Back link (not in embed mode) -->
    <div
      v-if="!isEmbed && application"
      class="text-center mt-6"
    >
      <NuxtLink
        :to="formPath"
        class="text-sm text-(--ui-primary) hover:underline inline-flex items-center gap-1"
      >
        <UIcon
          name="i-lucide-file-text"
          class="size-4"
        />
        {{ t('statusPage.newApplication') }}
      </NuxtLink>
    </div>
  </CitizenPage>
</template>
