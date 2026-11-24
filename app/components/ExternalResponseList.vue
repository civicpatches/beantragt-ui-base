<script setup lang="ts">
import { formatDateTime } from '~/composables/useFormatters';
import { useApplicationEvents } from '~/composables/useApplicationEvents';
import ApplicationSectionEventPill from '~/components/ApplicationSectionEventPill.vue';
import type { DeliveryPreview } from '~/types/delivery';
import type { ExternalResponse, ExternalResponsesPayload } from '~/types/external-response';

const { isNew: isNewEvent, beginSectionLoad } = useApplicationEvents();
const props = withDefaults(defineProps<{
    applicationId: string
    staff?: boolean
}>(), { staff: false });
/** After this list's own release: the staff page refreshes the delivery card. */
const emit = defineEmits<{ released: [] }>();

const { t, locale } = useI18n();
const responses = ref<ExternalResponse[]>([]);
const canRelease = ref(false);
const canReadProtected = ref(false);
const loading = ref(true);
const loadError = ref(false);
const actionError = ref('');
const releaseSuccess = ref('');
const heading = ref<HTMLElement | null>(null);
const releasing = ref(false);
const downloading = ref<string | null>(null);
const releaseTarget = ref<ExternalResponse | null>(null);
const confirmationOpen = ref(false);
/** What a release would do (`meta.delivery`, only with `canRelease`). */
const deliveryPreview = ref<DeliveryPreview | null>(null);
let loadSequence = 0;

// Backend is the access authority; citizen presentation also hides drafts.
const visibleResponses = computed(() => props.staff
    ? responses.value
    : responses.value.filter(response => response.status === 'released'));
const title = computed(() => t(props.staff ? 'externalResponses.staffTitle' : 'externalResponses.citizenTitle'));
/** Staff page: no response yet takes one line. The citizen page keeps its card. */
const compact = computed(() => props.staff && !loading.value && !loadError.value && !actionError.value && visibleResponses.value.length === 0);

// A filing receipt stays with staff: never offered for release.
function isFilingReceipt(response: ExternalResponse): boolean {
    return response.kind === 'filing_receipt';
}

/**
 * A response provided on route post is a copy in the portal.
 * The decision wording never appears on a communication.
 */
function copyNote(response: ExternalResponse): string {
    if (response.status !== 'released' || response.deliveryRoute !== 'postal') return '';
    return t(response.isDecision === true ? 'externalResponses.decisionCopy' : 'externalResponses.postalCopy');
}

function previewRoute(value: unknown): DeliveryPreview | null {
    if (!value || typeof value !== 'object') return null;
    const preview = value as Partial<Record<'decision' | 'communication', { route?: unknown } | null>>;
    return typeof preview.decision?.route === 'string' && typeof preview.communication?.route === 'string' ? value as DeliveryPreview : null;
}

/** The release of this response goes by post: texts name the copy and the postal duty. */
const releaseIsPostal = computed(() => {
    const target = releaseTarget.value;
    const preview = deliveryPreview.value;
    if (!target || !preview) return false;
    return preview[target.isDecision === true ? 'decision' : 'communication'].route === 'postal';
});

function formatDate(timestamp: number): string {
    return formatDateTime(new Date(timestamp * 1000).toISOString(), locale?.value);
}

async function loadResponses() {
    const rendered = beginSectionLoad('reply');
    const sequence = ++loadSequence;
    loading.value = true;
    loadError.value = false;
    try {
        const payload = await $fetch<ExternalResponsesPayload>(`/api/applications/${props.applicationId}/responses`);
        if (sequence !== loadSequence) return;
        responses.value = payload.data;
        rendered();
        canRelease.value = payload.meta.canRelease === true;
        canReadProtected.value = payload.meta.canReadProtected === true;
        deliveryPreview.value = canRelease.value ? previewRoute(payload.meta.delivery) : null;
    } catch {
        if (sequence !== loadSequence) return;
        responses.value = [];
        canRelease.value = false;
        canReadProtected.value = false;
        deliveryPreview.value = null;
        loadError.value = true;
    } finally {
        if (sequence === loadSequence) loading.value = false;
    }
}

// Staff without the protected-data permission cannot download such a copy
// (the backend answers 403); say why instead of offering a failing button.
function protectedLocked(response: ExternalResponse): boolean {
    return props.staff && response.containsProtected === true && !canReadProtected.value;
}

function confirmRelease(response: ExternalResponse) {
    releaseSuccess.value = '';
    releaseTarget.value = response;
    confirmationOpen.value = true;
    actionError.value = '';
}

async function release() {
    if (!props.staff || !canRelease.value || !releaseTarget.value || releasing.value) return;
    releasing.value = true;
    actionError.value = '';
    // Decided from the preview shown in the dialog, before the reload.
    const postal = releaseIsPostal.value;
    try {
        await $fetch(`/api/applications/${props.applicationId}/responses/${releaseTarget.value.id}/release`, {
            method: 'POST'
        });
        releaseSuccess.value = t(postal ? 'externalResponses.releaseSuccessPostal' : 'externalResponses.releaseSuccess');
        confirmationOpen.value = false;
        releaseTarget.value = null;
        await loadResponses();
        await nextTick();
        focusAfterRelease();
        emit('released');
    } catch {
        actionError.value = t('externalResponses.releaseError');
    } finally {
        releasing.value = false;
    }
}

function focusAfterRelease() {
    if (releaseSuccess.value) heading.value?.focus();
}

async function download(responseId: string, fileId: string, filename: string) {
    if (downloading.value) return;
    downloading.value = fileId;
    actionError.value = '';
    try {
        // Build a same-origin path; never follow a URL supplied by a document.
        const blob = await $fetch<Blob>(`/api/applications/${props.applicationId}/responses/${responseId}/documents/${fileId}/download`, {
            responseType: 'blob'
        });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
        actionError.value = t('externalResponses.downloadError');
    } finally {
        downloading.value = null;
    }
}

watch(() => props.applicationId, () => {
    responses.value = [];
    canRelease.value = false;
    deliveryPreview.value = null;
    confirmationOpen.value = false;
    releaseTarget.value = null;
    actionError.value = '';
    releaseSuccess.value = '';
    void loadResponses();
}, { immediate: true });
</script>

<template>
  <!-- Staff: the look of AppCard; the card keeps its section because it is a named
       region the tours wait on and its heading takes the focus, which AppCard does not offer (reported gap). -->
  <section
    class="rounded-lg"
    :class="staff
      ? 'bg-default p-4 ring ring-default sm:px-6 sm:pt-5 sm:pb-6'
      : 'border border-default bg-default p-4 sm:p-6'"
    :aria-label="title"
    :aria-busy="loading"
    :data-event-ready="!loading && !loadError"
    :data-compact="compact ? 'true' : undefined"
  >
    <!-- Staff page: the heading of every card of the application page (icon, heading, plain count, info button). -->
    <div
      v-if="staff"
      class="flex min-h-8 flex-wrap items-center gap-2"
      :class="compact ? '' : 'mb-2'"
    >
      <UIcon
        name="i-lucide-inbox"
        class="size-4 shrink-0 text-muted"
        aria-hidden="true"
      />
      <h2
        ref="heading"
        tabindex="-1"
        class="-ms-2.5 min-w-0 border-s-2 border-transparent ps-2 break-words text-base font-semibold text-highlighted outline-none focus-visible:border-primary"
      >
        {{ title }}
      </h2>
      <span
        v-if="visibleResponses.length"
        class="text-sm text-muted tabular-nums"
        data-testid="external-responses-count"
      >{{ visibleResponses.length }}</span>
      <ApplicationSectionEventPill
        kind="reply"
        :card-total="visibleResponses.length"
      />
      <UPopover :content="{ align: 'start', side: 'bottom' }">
        <UButton
          color="neutral"
          variant="ghost"
          size="sm"
          icon="i-lucide-info"
          :aria-label="t('externalResponses.explain')"
          data-testid="card-explanation"
        />
        <template #content>
          <p class="max-w-sm p-3 text-sm text-default">
            {{ t('externalResponses.staffEmptyHint') }}
          </p>
        </template>
      </UPopover>
    </div>
    <h2
      v-else
      ref="heading"
      tabindex="-1"
      class="mb-4 text-lg font-semibold text-highlighted"
    >
      {{ title }}
    </h2>
    <p
      v-if="compact"
      class="mt-2 max-w-prose text-sm text-muted"
      data-testid="external-responses-compact-text"
    >
      {{ t('externalResponses.staffEmpty') }}
    </p>
    <p
      role="status"
      aria-live="polite"
      class="text-sm text-success"
      :class="releaseSuccess || !staff ? 'mb-3' : ''"
    >
      {{ releaseSuccess }}
    </p>
    <p
      v-if="loading"
      role="status"
      class="text-sm text-muted"
    >
      {{ t('common.loading') }}
    </p>
    <div v-else-if="loadError">
      <p
        role="alert"
        class="mb-3 text-sm text-error"
      >
        {{ t('externalResponses.loadError') }}
      </p>
      <UButton
        color="neutral"
        variant="outline"
        @click="loadResponses"
      >
        {{ t('common.retry') }}
      </UButton>
    </div>
    <p
      v-else-if="!visibleResponses.length && !compact"
      class="text-sm text-muted"
    >
      {{ t(staff ? 'externalResponses.staffEmpty' : 'externalResponses.citizenEmpty') }}
    </p>
    <ul v-else>
      <li
        v-for="response in visibleResponses"
        :id="`external-response-${response.id}`"
        :key="response.id"
        :data-event-target="isNewEvent('reply', response.id) ? `reply:${response.id}` : undefined"
        class="application-event-entry space-y-3 border-t border-default pt-4 first:border-t-0 first:pt-0"
      >
        <div class="flex flex-wrap items-start justify-between gap-2">
          <h3 class="min-w-0 break-words font-medium text-highlighted">
            {{ response.title || t('externalResponses.documentTitle') }}
            <UBadge
              v-if="isNewEvent('reply', response.id)"
              data-test="event-new"
            >
              {{ t('comments.new') }}
            </UBadge>
            <span
              v-if="staff && isFilingReceipt(response)"
              data-test="filing-receipt-hint"
              class="block text-sm font-normal text-muted"
            >{{ t('externalResponses.filingReceiptHint') }}</span>
            <span
              v-if="copyNote(response)"
              data-test="response-copy-note"
              class="block text-sm font-normal text-muted"
            >{{ copyNote(response) }}</span>
          </h3>
          <div class="flex flex-wrap gap-2">
            <UBadge
              v-if="staff && response.outcome"
              data-test="response-outcome"
              :color="response.outcome === 'approved' ? 'success' : response.outcome === 'rejected' ? 'error' : 'neutral'"
            >
              {{ response.outcomeLabel || t(`externalResponses.outcome.${response.outcome}`) }}
            </UBadge>
            <UBadge
              v-if="!isFilingReceipt(response)"
              :color="response.status === 'released' ? 'success' : 'warning'"
            >
              {{ t(`externalResponses.${response.status}`) }}
            </UBadge>
          </div>
        </div>
        <dl class="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <dt class="text-muted">
              {{ t('externalResponses.source') }}
            </dt>
            <dd>{{ response.source === 'docgen' ? t('externalResponses.sources.docgen') : response.source }}</dd>
          </div>
          <div v-if="staff && response.externalReference">
            <dt class="text-muted">
              {{ t(response.source === 'docgen' ? 'externalResponses.templateReference' : 'externalResponses.externalReference') }}
            </dt>
            <dd class="break-words">
              {{ response.externalReference }}
            </dd>
          </div>
          <div v-if="staff && response.status === 'released'">
            <dt class="text-muted">
              {{ t('externalResponses.notificationTitle') }}
            </dt>
            <dd :class="response.notificationState === 'failed' ? 'text-error' : ''">
              {{ t(`externalResponses.notification.${response.notificationState === 'not_applicable' ? 'notApplicable' : response.notificationState || 'pending'}`) }}
            </dd>
          </div>
          <div v-if="staff">
            <dt class="text-muted">
              {{ t('externalResponses.receivedAt') }}
            </dt>
            <dd>{{ formatDate(response.receivedAt) }}</dd>
          </div>
          <div v-if="response.availableAt">
            <dt class="text-muted">
              {{ t('externalResponses.availableAt') }}
            </dt>
            <dd>{{ formatDate(response.availableAt) }}</dd>
          </div>
          <div v-if="staff && response.retrievedAt">
            <dt class="text-muted">
              {{ t('externalResponses.retrievedAt') }}
            </dt>
            <dd>{{ formatDate(response.retrievedAt) }}</dd>
          </div>
        </dl>
        <p
          v-if="staff && response.containsProtected"
          class="text-sm text-muted"
        >
          {{ t(protectedLocked(response) ? 'externalResponses.protectedLocked' : 'externalResponses.protectedLogged') }}
        </p>
        <ul class="space-y-2">
          <li
            v-for="file in response.documents"
            :key="file.id"
          >
            <UButton
              class="w-full justify-start text-left sm:w-auto"
              color="neutral"
              variant="outline"
              icon="i-lucide-download"
              :aria-label="t('externalResponses.download', { filename: file.filename })"
              :loading="downloading === file.id"
              :disabled="downloading !== null || protectedLocked(response)"
              @click="download(response.id, file.id, file.filename)"
            >
              <span class="min-w-0 break-all whitespace-normal">{{ file.filename }}</span>
            </UButton>
          </li>
        </ul>
        <UButton
          v-if="staff && canRelease && response.status === 'pending' && !isFilingReceipt(response)"
          class="w-full justify-center sm:w-auto"
          @click="confirmRelease(response)"
        >
          {{ t('externalResponses.release') }}
        </UButton>
      </li>
    </ul>
    <p
      v-if="actionError && !confirmationOpen"
      role="alert"
      class="mt-4 text-sm text-error"
    >
      {{ actionError }}
    </p>
    <UModal
      v-model:open="confirmationOpen"
      :title="t('externalResponses.confirmTitle')"
      :description="t(releaseIsPostal ? 'externalResponses.confirmDescriptionPostal' : 'externalResponses.confirmDescription')"
      :dismissible="!releasing"
      :close="!releasing"
      @after:leave="focusAfterRelease"
    >
      <template #body>
        <p class="break-words font-medium">
          {{ releaseTarget?.title }}
        </p>
        <p
          v-if="actionError"
          role="alert"
          class="mt-3 text-sm text-error"
        >
          {{ actionError }}
        </p>
      </template>
      <template #footer>
        <div class="flex w-full flex-wrap justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            :disabled="releasing"
            @click="confirmationOpen = false"
          >
            {{ t('common.cancel') }}
          </UButton>
          <UButton
            :loading="releasing"
            :disabled="releasing"
            @click="release"
          >
            {{ t('externalResponses.release') }}
          </UButton>
        </div>
      </template>
    </UModal>
  </section>
</template>
