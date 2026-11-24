<template>
  <NuxtPage v-if="$route.params.id" />
  <CitizenPage
    v-else
    main-id="my-applications-main"
    :back-to="false"
    :title="t('citizen.myApplications.title')"
  >
    <!--
      The page is about the applications. One filled action in the
      head ("Neuer Antrag", not while the empty state offers its own); the
      way to "Meine Daten" is a link in the line under the title.
    -->
    <template
      v-if="!showEmptyState"
      #actions
    >
      <UButton
        :to="startPath"
        size="xl"
        icon="i-lucide-plus"
        class="w-full justify-center sm:w-auto"
        data-testid="my-applications-new"
      >
        {{ t('citizen.myApplications.newApplication') }}
      </UButton>
    </template>

    <template #meta>
      <p>
        {{ myDataHintParts[0] }}<ULink
          :to="myDataPath"
          class="font-medium text-default underline underline-offset-2"
          data-testid="my-applications-my-data"
        >{{ t('citizen.myData.title') }}</ULink>{{ myDataHintParts[1] }}
      </p>
    </template>

    <!-- Loading: rows in row height. -->
    <div
      v-if="applicationsLoading"
      class="space-y-2"
    >
      <USkeleton
        v-for="i in 5"
        :key="i"
        class="h-16 w-full"
      />
    </div>

    <!-- A failed load is no empty list: say so and offer the retry. -->
    <UAlert
      v-else-if="applicationsError"
      color="error"
      icon="i-lucide-circle-x"
      :title="applicationsError"
      :actions="retryActions"
      data-testid="my-applications-error"
    />

    <!--
      Empty State. The list shows an application only once its e-mail
      address is confirmed (backend list), so the page says that
      instead of claiming nothing was ever submitted.
    -->
    <UEmpty
      v-else-if="showEmptyState"
      icon="i-lucide-inbox"
      :title="t('citizen.myApplications.empty')"
      :description="`${t('citizen.myApplications.emptyDescription')} ${t('citizen.myApplications.confirmationHint')}`"
      :actions="[{ to: startPath, size: 'xl', icon: 'i-lucide-plus', label: t('citizen.myApplications.firstApplication') }]"
      data-testid="my-applications-empty"
    />

    <!-- Applications List -->
    <template v-else>
      <!-- From ten applications on, a filter by state keeps the list short on a phone. -->
      <div
        v-if="showStatusFilter"
        class="mb-4"
        data-testid="my-applications-status-filter"
      >
        <UFormField
          :label="t('citizen.myApplications.filterLabel')"
          name="status-filter"
          size="xl"
        >
          <USelect
            v-model="statusFilter"
            :items="statusFilterItems"
            size="xl"
            class="w-full sm:w-72"
          />
        </UFormField>
        <p
          class="sr-only"
          role="status"
          aria-live="polite"
        >
          {{ statusFilter === STATUS_FILTER_ALL ? '' : t('citizen.myApplications.filterCount', { count: visibleApplications.length }, visibleApplications.length) }}
        </p>
      </div>

      <!-- One list of rows between hairlines, as the framework's list of link cards (UPageList, UPageCard with `to`): hover, focus ring, padding and
           corners come from the theme. The card's link is named by the title and described by reference, date
           and status; the heading keeps the title for heading navigation. -->
      <UPageList
        as="ul"
        divide
        class="border-y border-default"
        data-testid="my-applications-list"
      >
        <li
          v-for="application in pagedApplications"
          :key="application.id"
          class="py-1"
          data-testid="my-applications-card"
        >
          <UPageCard
            :to="applicationPath(application.id)"
            variant="ghost"
            :ui="applicationCardUi"
            :aria-describedby="`my-application-meta-${application.id} my-application-status-${application.id}`"
            data-testid="my-applications-card-link"
          >
            <template #title>
              <h2 class="text-base font-medium break-words text-highlighted">
                {{ application.formTitle || t('citizen.myApplications.application') }}
              </h2>
            </template>
            <template #description>
              <p
                :id="`my-application-meta-${application.id}`"
                class="mt-1 text-sm break-words text-muted"
              >
                <span class="font-mono break-all">{{ application.referenceNumber }}</span>
                · {{ t('citizen.myApplications.submittedAt') }} {{ formatDate(application.createdAt) }}
              </p>
            </template>
            <!-- Below sm the badge stands under the meta line; a long status name wraps inside it. -->
            <div
              :id="`my-application-status-${application.id}`"
              class="order-last min-w-0 max-w-full basis-full sm:order-none sm:max-w-56 sm:shrink-0 sm:basis-auto"
            >
              <StatusBadge
                :status="application.status"
                :label="application.statusLabel"
                :color="application.statusColor"
                :icon="application.statusIcon"
              />
            </div>
            <UIcon
              name="i-lucide-chevron-right"
              class="size-5 shrink-0 text-muted"
              aria-hidden="true"
            />
          </UPageCard>
        </li>
      </UPageList>

      <!-- From 26 applications on: 25 per page. -->
      <div
        v-if="pageCount > 1"
        class="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
        data-testid="my-applications-paging"
      >
        <p class="text-sm text-muted">
          {{ t('citizen.myApplications.pageSummary', { from: pageFrom, to: pageTo, total: visibleApplications.length }) }}
        </p>
        <AppPagination
          v-model:page="page"
          :total="visibleApplications.length"
          :items-per-page="PAGE_SIZE"
        />
      </div>

      <p
        class="mt-4 max-w-prose text-sm text-muted"
        data-testid="my-applications-confirmation-hint"
      >
        {{ t('citizen.myApplications.confirmationHint') }}
      </p>
    </template>
  </CitizenPage>
</template>

<script setup lang="ts">
import CitizenPage from '~/components/citizen/Page.vue';
import {
    publicApplicationPath,
    publicMyDataPath,
    publicStartPath,
    publicWorkspaceFromRoute
} from '~/utils/public-form-path';

definePageMeta({
    layout: false,
    middleware: 'auth'
});

// Application summary (matches what the server proxy returns)
interface ApplicationSummary {
    id: string
    referenceNumber: string
    formTitle: string
    status: string
    statusLabel?: string
    statusColor?: string
    statusIcon?: string
    createdAt: string
}

const applications = ref<ApplicationSummary[]>([]);
const applicationsLoading = ref(true);
const applicationsError = ref<string | null>(null);

const { t, locale } = useI18n();
const route = useRoute();
const publicWorkspace = computed(() => publicWorkspaceFromRoute(route));
const startPath = computed(() => publicStartPath(publicWorkspace.value));
const myDataPath = computed(() => publicMyDataPath(publicWorkspace.value));

function applicationPath(applicationId: string): string {
    return publicApplicationPath({
        ...publicWorkspace.value,
        applicationId
    });
}

/** From this many applications on, the list offers a filter by state. */
const STATUS_FILTER_MIN_APPLICATIONS = 10;
const STATUS_FILTER_ALL = 'all';
const statusFilter = ref<string>(STATUS_FILTER_ALL);

// The states as the citizen reads them, from the list itself; nothing is
// named in code (the status names are tenant data).
function statusKey(application: ApplicationSummary): string {
    return application.statusLabel?.trim() || application.status;
}

const showStatusFilter = computed(() => applications.value.length >= STATUS_FILTER_MIN_APPLICATIONS);

const statusFilterItems = computed(() => {
    const counts = new Map<string, number>();
    for (const application of applications.value) {
        const key = statusKey(application);
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [
        {
            label: t('citizen.myApplications.filterAll', { count: applications.value.length }),
            value: STATUS_FILTER_ALL
        },
        ...[...counts.entries()]
            .sort(([a], [b]) => a.localeCompare(b, locale.value))
            .map(([label, count]) => ({ label: `${label} (${count})`, value: label }))
    ];
});

const visibleApplications = computed(() => statusFilter.value === STATUS_FILTER_ALL
    ? applications.value
    : applications.value.filter(application => statusKey(application) === statusFilter.value));

watch(applications, () => {
    if (!statusFilterItems.value.some(item => item.value === statusFilter.value)) {
        statusFilter.value = STATUS_FILTER_ALL;
    }
});

const retryActions = computed(() => [{
    label: t('common.retry'),
    icon: 'i-lucide-refresh-cw',
    color: 'neutral' as const,
    variant: 'outline' as const,
    onClick: () => {
        void fetchApplications();
    }
}]);

const showEmptyState = computed(() =>
    !applicationsLoading.value && !applicationsError.value && applications.value.length === 0
);

// "Ihre gespeicherten Daten finden Sie unter {link}.": the sentence around the link.
const LINK_MARKER = '\u0000';
const myDataHintParts = computed(() => {
    const [before = '', after = ''] = t('citizen.myApplications.myDataHint', { link: LINK_MARKER }).split(LINK_MARKER);
    return [before, after] as const;
});

/** From 26 applications on, 25 per page. */
const PAGE_SIZE = 25;
const page = ref(1);
const pageCount = computed(() => Math.max(1, Math.ceil(visibleApplications.value.length / PAGE_SIZE)));
const pagedApplications = computed(() =>
    visibleApplications.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE)
);
const pageFrom = computed(() => visibleApplications.value.length === 0 ? 0 : (page.value - 1) * PAGE_SIZE + 1);
const pageTo = computed(() => Math.min(page.value * PAGE_SIZE, visibleApplications.value.length));
// A new filter starts on the first page.
watch(statusFilter, () => {
    page.value = 1;
});

async function fetchApplications() {
    applicationsLoading.value = true;
    applicationsError.value = null;

    try {
        const applicationData = await $fetch<{
            applications: ApplicationSummary[]
        }>('/api/applications/mine', {
            query: {
                jurisdiction: publicWorkspace.value.jurisdictionSlug || undefined,
                organisation: publicWorkspace.value.organisationSlug || undefined
            }
        });

        applications.value = applicationData.applications || [];
    } catch {
        applicationsError.value = t('citizen.myApplications.loadError');
    } finally {
        applicationsLoading.value = false;
    }
}

function formatDate(dateString: string): string {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString(locale.value, {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
}

onMounted(() => {
    fetchApplications();
});

useHead({
    title: computed(() => `${t('citizen.myApplications.title')} - beantragt.ai`)
});

/**
 * One application as the framework's link card (UPageCard, ghost): title and meta, the status badge and the
 * chevron in one wrapping row. Only layout and the row's padding are set here, never hover, focus or corners.
 */
const applicationCardUi = {
    container: 'flex-row flex-wrap items-start gap-x-3 gap-y-2 p-3 sm:p-3 lg:flex',
    wrapper: 'min-w-0 flex-1',
    description: 'mt-0'
};
</script>
