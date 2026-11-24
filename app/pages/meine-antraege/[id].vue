<template>
  <CitizenPage
    main-id="my-application-main"
    main-test-id="my-application-main"
    :back-to="false"
  >
    <!-- This page renders its own heading and back link within the text-width layout. -->
    <div class="max-w-3xl">
      <ULink
        :to="applicationsPath"
        class="mb-4 inline-flex min-h-6 items-center gap-1.5 text-sm text-muted hover:text-default"
        data-testid="my-application-back"
      >
        <UIcon
          name="i-lucide-arrow-left"
          class="size-4 shrink-0"
          aria-hidden="true"
        />
        {{ t('citizen.applicationDetail.backToList') }}
      </ULink>

      <!-- Loading -->
      <div
        v-if="loading"
        class="space-y-4"
      >
        <USkeleton class="h-8 w-48" />
        <USkeleton class="h-64 w-full rounded-lg" />
        <USkeleton class="h-32 w-full rounded-lg" />
      </div>

      <!-- Error -->
      <div
        v-else-if="error"
        class="max-w-lg mx-auto p-8 mt-12 text-center"
      >
        <UIcon
          name="i-lucide-alert-triangle"
          class="text-5xl mb-4 block mx-auto text-dimmed"
        />
        <h2 class="text-xl font-semibold text-highlighted mb-2">
          {{ error }}
        </h2>
        <div class="flex justify-center gap-3">
          <UButton
            variant="soft"
            icon="i-lucide-refresh-cw"
            @click="fetchApplication"
          >
            {{ t('common.refresh') }}
          </UButton>
          <UButton
            :to="applicationsPath"
            color="neutral"
            variant="ghost"
            icon="i-lucide-arrow-left"
          >
            {{ t('citizen.myApplications.title') }}
          </UButton>
        </div>
      </div>

      <!-- Detail View -->
      <div v-else-if="application">
        <!-- Header Card -->
        <div class="bg-default rounded-lg border border-default p-4 sm:p-6 mb-6">
          <!--
              The badge moves below the title when both do not fit side by
              side: at 390 px it never sticks out over the card edge.
            -->
          <div
            class="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 mb-4"
            data-testid="my-application-head"
          >
            <div class="min-w-0 flex-1 basis-56">
              <p class="text-sm font-mono break-all text-muted mb-1">
                {{ application.referenceNumber }}
              </p>
              <h1 class="text-xl font-bold break-words text-highlighted">
                {{ application.formTitle || t('citizen.myApplications.application') }}
              </h1>
            </div>
            <div class="max-w-full shrink-0">
              <StatusBadge
                :status="application.status"
                :label="application.statusLabel"
                :color="application.statusColor"
                :icon="application.statusIcon"
                size="md"
              />
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div>
              <span class="text-muted">{{ t('citizen.applicationDetail.submittedAt') }}</span>
              <p class="font-medium text-highlighted">
                {{ formatDateTime(application.createdAt) }}
              </p>
            </div>
            <div v-if="application.updatedAt && application.updatedAt !== application.createdAt">
              <span class="text-muted">{{ t('citizen.applicationDetail.lastUpdated') }}</span>
              <p class="font-medium text-highlighted">
                {{ formatDateTime(application.updatedAt) }}
              </p>
            </div>
          </div>

          <!--
              Share + Public Status actions. Outlined, not filled: the status
              above is what the page is about, not the link to it.
            -->
          <div class="flex flex-wrap gap-2 mt-4 pt-4 border-t border-default">
            <UButton
              color="neutral"
              variant="outline"
              icon="i-lucide-share-2"
              @click="copyStatusLink"
            >
              {{ linkCopied ? t('common.copied') : t('citizen.applicationDetail.copyStatusLookup') }}
            </UButton>
            <UButton
              color="neutral"
              variant="ghost"
              icon="i-lucide-external-link"
              :to="statusLookupPath"
            >
              {{ t('citizen.applicationDetail.openStatusLookup') }}
            </UButton>
          </div>
        </div>

        <!-- Timeline -->
        <div
          v-if="timelineEntries.length"
          class="bg-default rounded-lg border border-default p-6 mb-6"
        >
          <div class="flex items-center gap-2 mb-4">
            <UIcon
              name="i-lucide-git-branch"
              class="size-4 text-muted"
            />
            <h2 class="text-lg font-semibold text-highlighted">
              {{ t('statusPage.timeline.title') }}
            </h2>
          </div>

          <StatusTimeline :entries="timelineEntries" />
        </div>

        <ExternalResponseList
          :application-id="application.id"
          class="mb-6"
        />

        <!-- Comments / Messages -->
        <div
          v-if="application"
          class="bg-default rounded-lg border border-default p-6 mb-6"
        >
          <div class="flex items-center gap-2 mb-4">
            <UIcon
              name="i-lucide-message-circle"
              class="size-4 text-muted"
            />
            <h2 class="text-lg font-semibold text-highlighted">
              {{ t('comments.title') }}
            </h2>
            <UBadge
              v-if="comments.length > 0"
            >
              {{ comments.length }}
            </UBadge>
          </div>

          <div
            v-if="commentsLoading"
            class="space-y-3"
          >
            <USkeleton class="h-16 w-3/4" />
            <USkeleton class="h-16 w-2/3 ml-auto" />
          </div>

          <!--
              A failed load is no empty conversation: no "Noch keine
              Nachrichten", no message box that suggests one, but the retry.
            -->
          <UAlert
            v-else-if="commentsError"
            color="error"
            icon="i-lucide-circle-x"
            :title="t('citizen.applicationDetail.commentsLoadErrorTitle')"
            :description="t('citizen.applicationDetail.commentsLoadErrorDescription')"
            :actions="commentRetryActions"
            data-testid="my-application-comments-error"
          />

          <CommentThread
            v-else
            :comments="comments"
            :can-reply="true"
            :application-id="application.id"
            author-role="citizen"
            @comment-added="fetchComments"
          />
        </div>

        <!-- Submitted Data -->
        <div class="bg-default rounded-lg border border-default p-6">
          <h2 class="text-lg font-semibold text-highlighted mb-4">
            {{ t('citizen.applicationDetail.submittedData') }}
          </h2>

          <div
            v-if="application.data && Object.keys(application.data).length > 0"
            class="divide-y divide-default"
          >
            <div
              v-for="(value, key) in application.data"
              :key="key"
              class="py-3 flex flex-col sm:flex-row sm:items-baseline gap-1"
            >
              <span class="text-sm text-muted sm:w-1/3 shrink-0">
                {{ submittedFieldLabel(String(key)) }}
              </span>
              <span class="text-sm font-medium text-highlighted">
                {{ submittedFieldValue(value) }}
              </span>
            </div>
          </div>

          <p
            v-else
            class="text-muted text-sm"
          >
            {{ t('citizen.applicationDetail.noData') }}
          </p>
        </div>
      </div>
    </div>
  </CitizenPage>
</template>

<script setup lang="ts">
import CitizenPage from '~/components/citizen/Page.vue';
import type { TimelineEntry } from '~/components/StatusTimeline.vue';
import type { Comment } from '~/components/CommentThread.vue';
import { formatSubmittedFieldValue } from '~/utils/submitted-field-value';
import {
    publicApplicationsPath,
    publicStatusLookupPath,
    publicWorkspaceFromRoute
} from '~/utils/public-form-path';

definePageMeta({
    layout: false,
    middleware: 'auth'
});

const { t, locale } = useI18n();
const route = useRoute();
const publicWorkspace = computed(() => publicWorkspaceFromRoute(route));
const applicationsPath = computed(() => publicApplicationsPath(publicWorkspace.value));
const statusLookupPath = computed(() => application.value?.referenceNumber
    ? publicStatusLookupPath({
        ...publicWorkspace.value,
        referenceNumber: application.value.referenceNumber
    })
    : publicStatusLookupPath(publicWorkspace.value));

interface ApplicationDetail {
    id: string
    referenceNumber: string
    formTitle: string
    status: string
    statusLabel?: string
    statusColor?: string
    statusIcon?: string
    createdAt: string
    updatedAt?: string
    timeline?: TimelineEntry[]
    data: Record<string, unknown>
    /** Form labels in the request language, keyed by field id. */
    fieldLabels?: Record<string, string>
}

const application = ref<ApplicationDetail | null>(null);
const timelineEntries = ref<TimelineEntry[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const linkCopied = ref(false);
const comments = ref<Comment[]>([]);
const commentsLoading = ref(false);
const commentsError = ref(false);

async function fetchComments() {
    if (!application.value) return;
    commentsLoading.value = true;
    commentsError.value = false;
    try {
        const data = await $fetch<Comment[]>(
            `/api/comments/${application.value.id}`
        );
        comments.value = Array.isArray(data) ? data : [];
    } catch {
        // A question of the office may be among them: say that they are
        // missing instead of showing an empty conversation.
        comments.value = [];
        commentsError.value = true;
    } finally {
        commentsLoading.value = false;
    }
}

const commentRetryActions = computed(() => [{
    label: t('common.retry'),
    icon: 'i-lucide-refresh-cw',
    color: 'neutral' as const,
    variant: 'outline' as const,
    onClick: () => {
        void fetchComments();
    }
}]);

function formatDateTime(dateString: string): string {
    if (!dateString) return '';
    return new Date(dateString).toLocaleDateString(locale.value, {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function submittedFieldValue(value: unknown): string {
    return formatSubmittedFieldValue(value, locale.value, { yes: t('common.yes'), no: t('common.no') });
}

/**
 * Form label for a submitted key; identity keys live outside the schema.
 */
function submittedFieldLabel(key: string): string {
    const formLabel = application.value?.fieldLabels?.[key];
    if (formLabel) return formLabel;
    if (key === 'applicant_full_name') return t('citizen.applicationDetail.applicantFullName');
    if (key === 'applicant_email') return t('citizen.applicationDetail.applicantEmail');
    return formatFieldLabel(key);
}

function formatFieldLabel(key: string): string {
    return key
        .replace(/([A-Z])/g, ' $1')
        .replace(/[_-]/g, ' ')
        .replace(/^\w/, c => c.toUpperCase())
        .trim();
}

async function fetchApplication() {
    loading.value = true;
    error.value = null;

    try {
        const data = await $fetch<{ application: ApplicationDetail }>(
            `/api/applications/${route.params.id}`,
            {
                query: {
                    jurisdiction: publicWorkspace.value.jurisdictionSlug || undefined,
                    organisation: publicWorkspace.value.organisationSlug || undefined,
                    lang: locale.value
                }
            }
        );
        application.value = data.application;
        timelineEntries.value = data.application.timeline?.length
            ? data.application.timeline
            : buildFallbackTimeline(data.application);
        fetchComments();
    } catch {
        error.value = t('citizen.applicationDetail.loadError');
    } finally {
        loading.value = false;
    }
}

/**
 * Build a minimal timeline from status and timestamps
 */
function buildFallbackTimeline(data: { status: string, createdAt: string, updatedAt?: string }): TimelineEntry[] {
    const timestamp = data.updatedAt || data.createdAt;
    return timestamp ? [{ status: data.status, timestamp }] : [];
}

/**
 * Copy the public status URL to clipboard
 */
async function copyStatusLink() {
    if (!application.value?.referenceNumber) return;
    const url = new URL(statusLookupPath.value, window.location.origin);
    try {
        await navigator.clipboard.writeText(url.toString());
        linkCopied.value = true;
        setTimeout(() => {
            linkCopied.value = false;
        }, 2000);
    } catch {
        // Clipboard API not available, ignore silently
    }
}

onMounted(() => {
    fetchApplication();
});

useHead({
    title: computed(() =>
        application.value
            ? `${application.value.referenceNumber} - ${t('citizen.applicationDetail.title')}`
            : t('citizen.applicationDetail.title')
    )
});
</script>
