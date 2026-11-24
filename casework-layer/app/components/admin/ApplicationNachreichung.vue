<script setup lang="ts">
import AppDocumentPreview from '~/components/app/DocumentPreview.vue';
import { useApplicationEvents } from '~/composables/useApplicationEvents';
import ApplicationSectionEventPill from '~/components/ApplicationSectionEventPill.vue';
import type { RouteLocationRaw } from 'vue-router';
import { TEXT_LINK_CLASS } from '~/utils/text-link';
/**
 * Nachreichungen of one application (step 1): the requests ("Nachforderungen")
 * with their printed deadline, the cover sheets with origin and state,
 * "Deckblatt drucken" (every print is a new cover sheet with its own code)
 * and "Deckblatt sperren" with a reason. Step 2: the receipts ("Eingänge")
 * with the result per proof and their attachments, "Frist der Nachforderung
 * verlängern", "Vom Antrag entfernen" and "Neu zuordnen".
 *
 * Drupal decides who sees the card (404 hides it; 403 leaves one line that
 * says the role cannot use it), whether printing is possible (`canPrint`, `printBlocker`) and who may
 * revoke (`canRevoke`). The card never receives an identifier; the code is
 * only on the printed sheet. The page keys this card on `nachreichungVersion`,
 * so a released request letter shows its open request at once.
 */
import type { NachreichungCard, NachreichungCardResponse, NachreichungCover, NachreichungEntry, NachreichungEntryResult, NachreichungRequest } from '../../types/nachreichung';
import {
    NACHREICHUNG_DEADLINE_REASONS, NACHREICHUNG_REVOKE_REASONS, isNachreichungDeadlineReason, isNachreichungRevokeReason,
    type NachreichungDeadlineReason, type NachreichungRevokeReason
} from '~/utils/nachreichung-codes';
import { personLabelText } from '../../utils/nachreichung-person';
import { formatDate, formatIsoDate } from '~/composables/useFormatters';
import { staffFetch } from '~~/casework-layer/app/composables/api/useStaffSessionFetch';
import { postStaffFile } from '../../utils/docgen';
import { focusPageSection } from '~~/casework-layer/app/utils/function-search';

const { isNew: isNewEvent, beginSectionLoad } = useApplicationEvents();
const props = defineProps<{
    applicationId: string
    /**
     * Where a Nachforderung is written, reported by the Bescheide card: `available` with a released
     * template of purpose "Nachforderung", `missing` without one, `null` while unknown (no sentence then).
     */
    requestWay?: 'available' | 'missing' | null
    /** Where a template for requests is set up (the editor's panel "Bescheide"); only for roles that may open it. */
    setupTo?: RouteLocationRaw | null
}>();
const { t, locale } = useI18n();
const { withWorkspaceQuery, selectedWorkspaceKey } = useWorkspaceContext();
const { resolveApiErrorMessage } = useApiErrorMessage();

const card = shallowRef<NachreichungCard | null>(null);
const loading = ref(false);
/** No Nachreichung module or no such case (404): the card stays out of the way. */
const hidden = ref(false);
/** 403: the role may not see Nachreichungen; the card says so in one line instead of vanishing. */
const forbidden = ref(false);
const loadError = ref('');
const actionError = ref('');
const success = ref('');
const pending = ref<string | null>(null);
/** The printed sheet shown in the dialog; its blob URL is revoked when the dialog closes. */
const printed = shallowRef<{ url: string, blob: Blob, filename: string } | null>(null);
const revokeTarget = shallowRef<NachreichungCover | null>(null);
const revokeReason = ref<NachreichungRevokeReason | null>(null);
/** "Frist der Nachforderung verlängern": the request, the new date and the reason. */
const extendTarget = shallowRef<NachreichungRequest | null>(null);
const extendDeadline = ref('');
const extendReason = ref<NachreichungDeadlineReason | null>(null);
/** "Vom Antrag entfernen" or "Neu zuordnen" waiting for its confirmation. */
const revertTarget = shallowRef<{ entry: NachreichungEntry, mode: 'remove' | 'reassign' } | null>(null);
let sequence = 0;

const base = computed(() => `/api/admin/applications/${props.applicationId}`);
const requests = computed(() => card.value?.nachforderungen ?? []);
const covers = computed(() => card.value?.deckblaetter ?? []);
const entries = computed(() => card.value?.eingaenge ?? []);
const limit = computed(() => card.value?.activeLimit || 10);
const visible = computed(() => !hidden.value && (forbidden.value || loadError.value !== '' || card.value !== null));
/** Nothing requested, received or printed yet: one line with the way to start. */
const compact = computed(() => forbidden.value || (card.value !== null && !loadError.value && requests.value.length === 0 && covers.value.length === 0 && entries.value.length === 0));
const printDisabled = computed(() => pending.value !== null || !card.value?.canPrint);
const printBlockerText = computed(() => card.value?.printBlocker ? t(card.value.printBlocker, { limit: limit.value }) : '');
const reasonItems = computed(() => NACHREICHUNG_REVOKE_REASONS.map(value => ({ value, label: t(`admin.nachreichung.reason.${value}`) })));
const printOpen = computed({
    get: () => printed.value !== null,
    set: (open: boolean) => {
        if (!open) closePrint();
    }
});
const revokeOpen = computed({
    get: () => revokeTarget.value !== null,
    set: (open: boolean) => {
        if (!open && pending.value !== 'revoke') revokeTarget.value = null;
    }
});
const extendReasonItems = computed(() => NACHREICHUNG_DEADLINE_REASONS.map(value => ({ value, label: t(`admin.nachreichung.extendReason.${value}`) })));
const extendOpen = computed({
    get: () => extendTarget.value !== null,
    set: (open: boolean) => {
        if (!open && pending.value !== 'extend') extendTarget.value = null;
    }
});
const revertOpen = computed({
    get: () => revertTarget.value !== null,
    set: (open: boolean) => {
        if (!open && pending.value !== 'revert') revertTarget.value = null;
    }
});
const liveText = computed(() => pending.value === 'print' ? t('admin.nachreichung.printing') : success.value);

function statusOf(error: unknown): number | undefined {
    return (error as { statusCode?: number, status?: number } | null)?.statusCode ?? (error as { status?: number } | null)?.status;
}

function dayText(value: string | null): string {
    return value ? formatIsoDate(value, locale?.value) ?? '' : '';
}

function timestampText(seconds: number | null): string {
    return seconds ? formatDate(new Date(seconds * 1000).toISOString(), locale?.value) : '';
}

function deadlineText(request: NachreichungRequest): string {
    const date = dayText(request.deadline ?? request.deadlinePrinted);
    if (!date) return '';
    return t(request.extended ? 'admin.nachreichung.deadlineExtended' : 'admin.nachreichung.deadline', { date });
}

/** "Gesperrt am TT.MM.JJJJ, Grund". */
function revokedText(cover: NachreichungCover): string {
    const text = t('admin.nachreichung.revokedOn', { date: timestampText(cover.revokedAt) });
    return cover.revokeReason ? `${text}, ${t(`admin.nachreichung.reason.${cover.revokeReason}`)}` : text;
}

/** "Antragsteller: liegt bei", "Lohnabrechnung · Haushaltsmitglied 2: reicht nicht, Nicht lesbar". */
function resultText(result: NachreichungEntryResult): string {
    const person = personLabelText(t, result.personLabel);
    const subject = [result.label, person].filter(Boolean).join(' · ');
    const reason = result.reason ? `, ${t(`admin.bulk.nachreichung.reason.${result.reason}`)}` : '';
    const criteria = result.criteria.length ? `: ${result.criteria.join('; ')}` : '';
    return `${subject}: ${t(`admin.bulk.nachreichung.proof.${result.status}`)}${reason}${criteria}`;
}

function attachmentUrl(attachmentId: string): string {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(withWorkspaceQuery())) {
        if (typeof value === 'string' && value) query.set(key, value);
    }
    const path = `${base.value}/attachments/${attachmentId}/preview`;
    const search = query.toString();
    return search ? `${path}?${search}` : path;
}

function requestColor(state: NachreichungRequest['state']): 'warning' | 'success' | 'neutral' {
    if (state === 'open' || state === 'partly_answered') return 'warning';
    if (state === 'answered') return 'success';
    return 'neutral';
}

function coverColor(state: NachreichungCover['state']): 'success' | 'error' | 'neutral' {
    return state === 'active' ? 'success' : state === 'revoked' ? 'error' : 'neutral';
}

function closePrint() {
    const current = printed.value;
    if (current) URL.revokeObjectURL(current.url);
    printed.value = null;
}

async function load() {
    const rendered = beginSectionLoad('documents');
    const current = ++sequence;
    loading.value = true;
    loadError.value = '';
    try {
        const result = await staffFetch<NachreichungCardResponse>(`${base.value}/nachreichung`, { query: withWorkspaceQuery() });
        if (current !== sequence) return;
        card.value = result.data;
        rendered();
        hidden.value = false;
        forbidden.value = false;
    } catch (error) {
        if (current !== sequence) return;
        card.value = null;
        const status = statusOf(error);
        // Hide on 404, explain on 403.
        hidden.value = status === 404;
        forbidden.value = status === 403;
        if (status === 403 || status === 404) return;
        loadError.value = resolveApiErrorMessage(error);
    } finally {
        if (current === sequence) loading.value = false;
    }
}

async function print() {
    if (printDisabled.value) return;
    pending.value = 'print';
    actionError.value = '';
    success.value = '';
    const workspace = selectedWorkspaceKey.value;
    const applicationId = props.applicationId;
    const stale = () => workspace !== selectedWorkspaceKey.value || applicationId !== props.applicationId;
    try {
        const { blob, filename } = await postStaffFile(`${base.value}/cover-sheet`, withWorkspaceQuery(), {}, 'deckblatt.pdf');
        if (stale()) return;
        closePrint();
        printed.value = { url: URL.createObjectURL(new Blob([blob], { type: 'application/pdf' })), blob, filename };
        success.value = t('admin.nachreichung.printed');
        // The new sheet is listed as valid; the active count moves.
        await load();
    } catch (error) {
        if (stale()) return;
        actionError.value = resolveApiErrorMessage(error);
        // Limit reached or switched off meanwhile: show what Drupal says.
        if (statusOf(error) === 409 || statusOf(error) === 422) await load();
    } finally {
        pending.value = null;
    }
}

function openRevoke(cover: NachreichungCover) {
    if (pending.value !== null || !card.value?.canRevoke || cover.state !== 'active') return;
    actionError.value = '';
    success.value = '';
    revokeReason.value = null;
    revokeTarget.value = cover;
}

function chooseReason(value: unknown) {
    if (isNachreichungRevokeReason(value)) revokeReason.value = value;
}

async function confirmRevoke() {
    const cover = revokeTarget.value;
    const reason = revokeReason.value;
    if (!cover || !reason || pending.value !== null) return;
    pending.value = 'revoke';
    actionError.value = '';
    const workspace = selectedWorkspaceKey.value;
    const applicationId = props.applicationId;
    try {
        const result = await staffFetch<NachreichungCardResponse>(`${base.value}/cover-sheets/${cover.id}/revoke`, {
            method: 'POST',
            query: withWorkspaceQuery(),
            body: { reason }
        });
        if (workspace !== selectedWorkspaceKey.value || applicationId !== props.applicationId) return;
        card.value = result.data;
        revokeTarget.value = null;
        success.value = t('admin.nachreichung.revoked');
    } catch (error) {
        if (workspace !== selectedWorkspaceKey.value || applicationId !== props.applicationId) return;
        actionError.value = resolveApiErrorMessage(error);
        // Revoked meanwhile or gone: the list behind the dialog shows the current state.
        if (statusOf(error) === 409 || statusOf(error) === 404) await load();
    } finally {
        pending.value = null;
    }
}

function openExtend(request: NachreichungRequest) {
    if (pending.value !== null || !request.canExtend) return;
    actionError.value = '';
    success.value = '';
    extendDeadline.value = '';
    extendReason.value = null;
    extendTarget.value = request;
}

function chooseExtendReason(value: unknown) {
    if (isNachreichungDeadlineReason(value)) extendReason.value = value;
}

async function confirmExtend() {
    const request = extendTarget.value;
    const deadline = extendDeadline.value;
    const reason = extendReason.value;
    if (!request || !reason || !/^\d{4}-\d{2}-\d{2}$/u.test(deadline) || pending.value !== null) return;
    pending.value = 'extend';
    actionError.value = '';
    const workspace = selectedWorkspaceKey.value;
    const applicationId = props.applicationId;
    try {
        const result = await staffFetch<NachreichungCardResponse>(`${base.value}/nachforderung/${request.id}/deadline`, {
            method: 'POST',
            query: withWorkspaceQuery(),
            body: { deadline, reason }
        });
        if (workspace !== selectedWorkspaceKey.value || applicationId !== props.applicationId) return;
        card.value = result.data;
        extendTarget.value = null;
        success.value = t('admin.nachreichung.extended', { date: dayText(deadline) });
    } catch (error) {
        if (workspace !== selectedWorkspaceKey.value || applicationId !== props.applicationId) return;
        actionError.value = resolveApiErrorMessage(error);
        if (statusOf(error) === 409 || statusOf(error) === 404) await load();
    } finally {
        pending.value = null;
    }
}

function openRevert(entry: NachreichungEntry, mode: 'remove' | 'reassign') {
    if (pending.value !== null || (mode === 'remove' ? !entry.canRemove : !entry.canReassign)) return;
    actionError.value = '';
    success.value = '';
    revertTarget.value = { entry, mode };
}

async function confirmRevert() {
    const target = revertTarget.value;
    if (!target || pending.value !== null) return;
    pending.value = 'revert';
    actionError.value = '';
    const workspace = selectedWorkspaceKey.value;
    const applicationId = props.applicationId;
    try {
        const result = await staffFetch<NachreichungCardResponse>(`${base.value}/nachreichung/${target.entry.id}/${target.mode}`, {
            method: 'POST',
            query: withWorkspaceQuery(),
            body: {}
        });
        if (workspace !== selectedWorkspaceKey.value || applicationId !== props.applicationId) return;
        card.value = result.data;
        revertTarget.value = null;
        success.value = t(target.mode === 'remove' ? 'admin.nachreichung.removed' : 'admin.nachreichung.reassigned');
    } catch (error) {
        if (workspace !== selectedWorkspaceKey.value || applicationId !== props.applicationId) return;
        actionError.value = resolveApiErrorMessage(error);
        // Removed meanwhile or the batch files are gone: the list behind the dialog shows the current state.
        if (statusOf(error) === 409 || statusOf(error) === 404) await load();
    } finally {
        pending.value = null;
    }
}

watch(revokeTarget, (target) => {
    if (!target && pending.value !== 'revoke') actionError.value = '';
});

watch([extendTarget, revertTarget], ([extend, revert]) => {
    if (!extend && !revert && pending.value !== 'extend' && pending.value !== 'revert') actionError.value = '';
});

watch([() => props.applicationId, selectedWorkspaceKey], () => {
    closePrint();
    revokeTarget.value = null;
    extendTarget.value = null;
    revertTarget.value = null;
    card.value = null;
    hidden.value = false;
    forbidden.value = false;
    success.value = '';
    actionError.value = '';
    void load();
}, { immediate: true });

onUnmounted(() => {
    sequence++;
    closePrint();
});

/**
 * "Zu den Bescheiden": the same jump as the function search, focus on the card heading. A button, not a hash
 * link: `#docgen-panel` in the URL would pull scroll and focus to Bescheide after every reload of that card.
 */
function jumpToDecisions() {
    if (typeof document === 'undefined') return;
    const reducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    focusPageSection(document, 'docgen-panel', { reducedMotion });
}

defineExpose({ reload: load });
</script>

<template>
  <section
    v-if="visible"
    class="mb-6 min-w-0 rounded-lg bg-default p-4 ring ring-default sm:px-6 sm:pt-5 sm:pb-6 [overflow-wrap:anywhere]"
    :aria-label="t('admin.detail.attachmentList.followUpGroup')"
    :aria-busy="loading || pending !== null"
    :data-event-ready="!loading && !loadError"
    :data-compact="compact ? 'true' : undefined"
    data-testid="nachreichung-card"
  >
    <div class="flex min-h-8 flex-wrap items-center gap-2">
      <UIcon
        name="i-lucide-file-input"
        class="size-4 shrink-0 text-muted"
        aria-hidden="true"
      />
      <h2 class="min-w-0 break-words text-base font-semibold text-highlighted">
        {{ t('admin.detail.attachmentList.followUpGroup') }}
      </h2>
      <ApplicationSectionEventPill kind="documents" />
      <!-- Standing explanation behind the info button. -->
      <AdminCardExplanation
        :label="t('admin.nachreichung.explain')"
        :text="`${t('admin.nachreichung.description')} ${t('admin.nachreichung.printHint', { limit })}`"
      />
    </div>
    <AccessReason
      v-if="forbidden"
      :id="`nachreichung-forbidden-${applicationId}`"
      class="mt-1"
      :text="t('admin.nachreichung.forbidden')"
    />
    <p
      role="status"
      aria-live="polite"
      class="text-sm"
      :class="[pending === 'print' ? 'text-muted' : 'text-success', liveText ? 'my-2' : '']"
      data-testid="nachreichung-status"
    >
      {{ liveText }}
    </p>

    <div
      v-if="loadError"
      role="alert"
    >
      <p class="mb-3 text-sm text-error">
        {{ t('admin.nachreichung.loadError') }} {{ loadError }}
      </p>
      <UButton
        color="neutral"
        variant="outline"
        :disabled="loading"
        @click="load"
      >
        {{ t('common.retry') }}
      </UButton>
    </div>

    <template v-else-if="card && compact">
      <p
        class="mt-2 max-w-prose text-sm text-muted"
        data-testid="nachreichung-compact-text"
      >
        {{ t('admin.nachreichung.empty') }}
        <template v-if="requestWay === 'available'">
          {{ t('admin.nachreichung.requestWay') }}
          <!-- The pattern's text-link look from the shared constant; inside a sentence. -->
          <UButton
            color="neutral"
            variant="link"
            class="p-0 align-baseline"
            :class="TEXT_LINK_CLASS"
            data-testid="nachreichung-request-way"
            @click="jumpToDecisions"
          >
            {{ t('admin.nachreichung.requestWayLink') }}
          </UButton>
        </template>
        <!-- No template for requests: the way to set one up for admins, a reason line for everyone else. -->
        <ULink
          v-else-if="requestWay === 'missing' && setupTo"
          :to="setupTo"
          class="font-medium text-default underline underline-offset-2"
          data-testid="nachreichung-setup-link"
        >{{ t('admin.nachreichung.setupLink') }}</ULink>
      </p>
      <AccessReason
        v-if="requestWay === 'missing' && !setupTo"
        :id="`nachreichung-setup-reason-${applicationId}`"
        class="mt-1"
        reason="admin"
      />
      <div
        v-if="card.coverSheet"
        class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1"
      >
        <UButton
          color="neutral"
          variant="outline"
          icon="i-lucide-printer"
          :loading="pending === 'print'"
          :disabled="printDisabled"
          :aria-describedby="[printBlockerText ? `nachreichung-print-help-${applicationId}` : '', `nachreichung-print-count-${applicationId}`].filter(Boolean).join(' ')"
          data-testid="nachreichung-print"
          @click="print"
        >
          {{ t('admin.nachreichung.print') }}
        </UButton>
        <!-- The count is an item of its own that does not shrink: the row's wrap takes it under the button at 390 px
             instead of letting it run out of the card. -->
        <p
          :id="`nachreichung-print-count-${applicationId}`"
          class="shrink-0 whitespace-nowrap text-sm text-muted"
          data-testid="nachreichung-active-count"
        >
          {{ t('admin.nachreichung.activeCount', { count: card.activeCount, limit }) }}
        </p>
        <p
          v-if="printBlockerText"
          :id="`nachreichung-print-help-${applicationId}`"
          class="basis-full text-sm text-warning"
          data-testid="nachreichung-print-blocker"
        >
          {{ printBlockerText }}
        </p>
      </div>
      <p
        v-if="actionError && !revokeTarget && !extendTarget && !revertTarget"
        role="alert"
        class="mt-3 text-sm text-error"
        data-testid="nachreichung-error"
      >
        {{ actionError }}
      </p>
    </template>

    <template v-else-if="card">
      <h3 class="mt-2 text-sm font-semibold">
        {{ t('admin.nachreichung.requests') }}
      </h3>
      <template v-if="!requests.length">
        <p
          class="mt-1 text-sm text-muted"
        >
          {{ t('admin.nachreichung.noRequests') }}
          <template v-if="requestWay === 'available'">
            {{ t('admin.nachreichung.requestWay') }}
            <!-- The pattern's text-link look from the shared constant; inside a sentence. -->
            <UButton
              color="neutral"
              variant="link"
              class="p-0 align-baseline"
              :class="TEXT_LINK_CLASS"
              data-testid="nachreichung-request-way"
              @click="jumpToDecisions"
            >
              {{ t('admin.nachreichung.requestWayLink') }}
            </UButton>
          </template>
          <!-- No template for requests: the way to set one up for admins, a reason line for everyone else. -->
          <ULink
            v-else-if="requestWay === 'missing' && setupTo"
            :to="setupTo"
            class="font-medium text-default underline underline-offset-2"
            data-testid="nachreichung-setup-link"
          >{{ t('admin.nachreichung.setupLink') }}</ULink>
        </p>
        <AccessReason
          v-if="requestWay === 'missing' && !setupTo"
          :id="`nachreichung-setup-reason-${applicationId}`"
          class="mt-1"
          reason="admin"
        />
      </template>
      <ul
        v-else
        class="mt-2 space-y-3"
      >
        <li
          v-for="request in requests"
          :key="request.id"
          class="space-y-1 border-t border-default pt-3 text-sm first:border-t-0 first:pt-0"
          :data-state="request.state"
          data-testid="nachreichung-request"
        >
          <UBadge
            :color="requestColor(request.state)"
          >
            {{ t(`admin.nachreichung.requestState.${request.state}`) }}
          </UBadge>
          <p
            v-if="request.releasedAt"
            class="text-muted"
          >
            {{ t('admin.nachreichung.sentOn', { date: timestampText(request.releasedAt) }) }}
          </p>
          <p
            v-if="deadlineText(request)"
            class="font-medium text-highlighted"
            data-testid="nachreichung-deadline"
          >
            {{ deadlineText(request) }}
          </p>
          <p
            v-if="request.extended && request.deadlineReason"
            class="text-muted"
          >
            {{ t(`admin.nachreichung.extendReason.${request.deadlineReason}`) }}
          </p>
          <UButton
            v-if="request.canExtend"
            color="neutral"
            variant="outline"
            icon="i-lucide-calendar-plus"
            :disabled="pending !== null"
            data-testid="nachreichung-extend"
            @click="openExtend(request)"
          >
            {{ t('admin.nachreichung.extend') }}
          </UButton>
        </li>
      </ul>

      <h3 class="mt-5 text-sm font-semibold">
        {{ t('admin.nachreichung.entries') }}
      </h3>
      <p
        v-if="!entries.length"
        class="mt-1 text-sm text-muted"
      >
        {{ t('admin.nachreichung.noEntries') }}
      </p>
      <ul
        v-else
        class="mt-2"
      >
        <li
          v-for="entry in entries"
          :key="entry.id"
          :data-event-target="isNewEvent('documents', entry.id) ? `documents:${entry.id}` : undefined"
          class="application-event-entry min-w-0 space-y-1 border-t border-default pt-3 text-sm first:border-t-0 first:pt-0"
          :data-decision="entry.decision"
          data-testid="nachreichung-entry"
        >
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-medium text-highlighted">{{ t('admin.nachreichung.entryTitle', { date: dayText(entry.receivedOn) }) }}</span>
            <UBadge
              v-if="isNewEvent('documents', entry.id)"
              data-test="event-new"
            >
              {{ t('comments.new') }}
            </UBadge>
            <UBadge
              :color="entry.reverted ? 'neutral' : entry.decision === 'take_over' ? 'success' : entry.decision === 'request_again' ? 'warning' : 'neutral'"
            >
              {{ t(`admin.nachreichung.decision.${entry.decision}`) }}
            </UBadge>
          </div>
          <ul
            v-if="entry.results.length"
            class="space-y-0.5"
          >
            <li
              v-for="result in entry.results"
              :key="result.key"
            >
              {{ resultText(result) }}
            </li>
          </ul>
          <ul
            v-if="entry.attachments.length && !entry.reverted"
            class="flex flex-wrap gap-x-3 gap-y-1"
          >
            <li
              v-for="(attachment, index) in entry.attachments"
              :key="attachment.id"
            >
              <a
                :href="attachmentUrl(attachment.id)"
                target="_blank"
                rel="noopener"
                class="text-primary underline"
                data-testid="nachreichung-attachment"
              >{{ t('admin.nachreichung.attachment', { number: index + 1 }) }}</a>
              <span
                v-for="page in attachment.coverPages"
                :key="page"
                class="text-muted"
              > ({{ t('admin.nachreichung.containsCover', { page }) }})</span>
            </li>
          </ul>
          <p
            v-if="entry.reverted"
            class="text-muted"
            data-testid="nachreichung-entry-reverted"
          >
            {{ t('admin.nachreichung.reverted', { date: timestampText(entry.reverted.at) }) }}
          </p>
          <div
            v-if="entry.canRemove || entry.canReassign"
            class="flex flex-wrap gap-2 pt-1"
          >
            <UButton
              v-if="entry.canRemove"
              color="error"
              variant="ghost"
              icon="i-lucide-file-x"
              :disabled="pending !== null"
              data-testid="nachreichung-remove"
              @click="openRevert(entry, 'remove')"
            >
              {{ t('admin.nachreichung.remove') }}
            </UButton>
            <UButton
              v-if="entry.canReassign"
              color="neutral"
              variant="ghost"
              icon="i-lucide-undo-2"
              :disabled="pending !== null"
              data-testid="nachreichung-reassign"
              @click="openRevert(entry, 'reassign')"
            >
              {{ t('admin.nachreichung.reassign') }}
            </UButton>
          </div>
        </li>
      </ul>

      <h3 class="mt-5 text-sm font-semibold">
        {{ t('admin.nachreichung.covers') }}
      </h3>
      <p
        v-if="!covers.length"
        class="mt-1 text-sm text-muted"
      >
        {{ t('admin.nachreichung.noCovers') }}
      </p>
      <ul
        v-else
        class="mt-2 space-y-3"
      >
        <li
          v-for="cover in covers"
          :key="cover.id"
          class="flex flex-wrap items-start justify-between gap-2 border-t border-default pt-3 text-sm first:border-t-0 first:pt-0"
          :data-state="cover.state"
          data-testid="nachreichung-cover"
        >
          <div
            :id="`nachreichung-cover-${cover.id}`"
            class="min-w-0 space-y-1"
          >
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-medium text-highlighted">{{ t(`admin.nachreichung.origin.${cover.origin}`) }}</span>
              <UBadge
                :color="coverColor(cover.state)"
              >
                {{ t(`admin.nachreichung.coverState.${cover.state}`) }}
              </UBadge>
            </div>
            <p
              v-if="cover.createdAt"
              class="text-muted"
            >
              {{ t('admin.nachreichung.createdOn', { date: timestampText(cover.createdAt) }) }}
            </p>
            <p
              v-if="cover.state === 'revoked' && cover.revokedAt"
              class="text-muted"
              data-testid="nachreichung-revoked-on"
            >
              {{ revokedText(cover) }}
            </p>
          </div>
          <UButton
            v-if="cover.state === 'active' && card.canRevoke"
            color="error"
            variant="ghost"
            icon="i-lucide-ban"
            :disabled="pending !== null"
            :aria-describedby="`nachreichung-cover-${cover.id}`"
            data-testid="nachreichung-revoke"
            @click="openRevoke(cover)"
          >
            {{ t('admin.nachreichung.revoke') }}
          </UButton>
        </li>
      </ul>

      <div class="mt-5 space-y-2 rounded-lg bg-elevated/50 p-3 sm:p-4">
        <UButton
          color="neutral"
          variant="outline"
          icon="i-lucide-printer"
          :loading="pending === 'print'"
          :disabled="printDisabled"
          :aria-describedby="`nachreichung-print-help-${applicationId}`"
          data-testid="nachreichung-print"
          @click="print"
        >
          {{ t('admin.nachreichung.print') }}
        </UButton>
        <div
          :id="`nachreichung-print-help-${applicationId}`"
          class="space-y-1 text-sm"
        >
          <p
            v-if="printBlockerText"
            class="text-warning"
            data-testid="nachreichung-print-blocker"
          >
            {{ printBlockerText }}
          </p>
          <!-- The count is text beside the button, not a badge in the heading. -->
          <p
            v-if="card.coverSheet"
            class="whitespace-nowrap text-muted"
            data-testid="nachreichung-active-count"
          >
            {{ t('admin.nachreichung.activeCount', { count: card.activeCount, limit }) }}
          </p>
        </div>
      </div>

      <p
        v-if="actionError && !revokeTarget && !extendTarget && !revertTarget"
        role="alert"
        class="mt-3 text-sm text-error"
        data-testid="nachreichung-error"
      >
        {{ actionError }}
      </p>
    </template>

    <!-- Printed sheet: shown once, the blob URL ends with the dialog. -->
    <UModal
      v-model:open="printOpen"
      :title="t('admin.nachreichung.printTitle')"
      :description="t('admin.nachreichung.printText')"
    >
      <template #body>
        <div
          v-if="printed"
          class="space-y-3"
          data-testid="nachreichung-print-dialog"
        >
          <div class="flex flex-wrap gap-2">
            <UButton
              :href="printed.url"
              target="_blank"
              rel="noopener"
              color="neutral"
              variant="outline"
              icon="i-lucide-external-link"
              data-testid="nachreichung-open-tab"
            >
              {{ t('admin.nachreichung.openNewTab') }}
            </UButton>
            <UButton
              :href="printed.url"
              :download="printed.filename"
              icon="i-lucide-file-down"
              data-testid="nachreichung-download"
            >
              {{ t('admin.nachreichung.download') }}
            </UButton>
          </div>
          <AppDocumentPreview
            :preview="{ ...printed, title: t('admin.nachreichung.frameTitle') }"
            class="h-[28rem]"
            hide-actions
          />
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end">
          <UButton
            color="neutral"
            variant="ghost"
            data-testid="nachreichung-print-close"
            @click="closePrint"
          >
            {{ t('common.close') }}
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- Extend the deadline of a waiting request with a date and a reason -->
    <UModal
      v-model:open="extendOpen"
      :title="t('admin.nachreichung.extend')"
      :description="t('admin.nachreichung.extendHelp')"
      :dismissible="pending !== 'extend'"
      :close="pending !== 'extend'"
    >
      <template #body>
        <form
          class="space-y-4"
          data-testid="nachreichung-extend-form"
          @submit.prevent="confirmExtend"
        >
          <UFormField
            :label="t('admin.nachreichung.newDeadline')"
            required
          >
            <UInput
              v-model="extendDeadline"
              type="date"
              :min="extendTarget?.deadline ?? undefined"
              required
              :disabled="pending === 'extend'"
              data-testid="nachreichung-extend-date"
            />
          </UFormField>
          <URadioGroup
            :model-value="extendReason ?? undefined"
            :items="extendReasonItems"
            value-key="value"
            :legend="t('admin.nachreichung.extendReasonLabel')"
            required
            :disabled="pending === 'extend'"
            data-testid="nachreichung-extend-reason"
            @update:model-value="chooseExtendReason"
          />
          <p
            v-if="actionError"
            role="alert"
            class="text-sm text-error"
          >
            {{ actionError }}
          </p>
        </form>
      </template>
      <template #footer>
        <div class="flex w-full flex-wrap justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            :disabled="pending === 'extend'"
            @click="extendOpen = false"
          >
            {{ t('common.cancel') }}
          </UButton>
          <UButton
            :loading="pending === 'extend'"
            :disabled="pending !== null || !extendReason || !extendDeadline"
            data-testid="nachreichung-extend-confirm"
            @click="confirmExtend"
          >
            {{ t('common.save') }}
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- Remove a receipt from the application, or remove it and send its envelope back to the Sichtung -->
    <UModal
      v-model:open="revertOpen"
      :title="revertTarget ? t(`admin.nachreichung.${revertTarget.mode}`) : ''"
      :description="revertTarget ? t(revertTarget.mode === 'remove' ? 'admin.nachreichung.removeConfirm' : 'admin.nachreichung.reassignConfirm') : ''"
      :dismissible="pending !== 'revert'"
      :close="pending !== 'revert'"
    >
      <template #body>
        <p
          v-if="actionError"
          role="alert"
          class="text-sm text-error"
        >
          {{ actionError }}
        </p>
      </template>
      <template #footer>
        <div class="flex w-full flex-wrap justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            :disabled="pending === 'revert'"
            @click="revertOpen = false"
          >
            {{ t('common.cancel') }}
          </UButton>
          <UButton
            color="error"
            :loading="pending === 'revert'"
            :disabled="pending !== null"
            data-testid="nachreichung-revert-confirm"
            @click="confirmRevert"
          >
            {{ revertTarget ? t(`admin.nachreichung.${revertTarget.mode}`) : '' }}
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- Revoke with a required reason -->
    <UModal
      v-model:open="revokeOpen"
      :title="t('admin.nachreichung.revokeTitle')"
      :description="t('admin.nachreichung.revokeText')"
      :dismissible="pending !== 'revoke'"
      :close="pending !== 'revoke'"
    >
      <template #body>
        <form
          class="space-y-4"
          data-testid="nachreichung-revoke-form"
          @submit.prevent="confirmRevoke"
        >
          <URadioGroup
            :model-value="revokeReason ?? undefined"
            :items="reasonItems"
            value-key="value"
            :legend="t('admin.nachreichung.revokeReason')"
            required
            :disabled="pending === 'revoke'"
            data-testid="nachreichung-revoke-reason"
            @update:model-value="chooseReason"
          />
          <p
            v-if="actionError"
            role="alert"
            class="text-sm text-error"
          >
            {{ actionError }}
          </p>
        </form>
      </template>
      <template #footer>
        <div class="flex w-full flex-wrap justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            :disabled="pending === 'revoke'"
            @click="revokeOpen = false"
          >
            {{ t('common.cancel') }}
          </UButton>
          <UButton
            color="error"
            icon="i-lucide-ban"
            :loading="pending === 'revoke'"
            :disabled="pending !== null || !revokeReason"
            data-testid="nachreichung-revoke-confirm"
            @click="confirmRevoke"
          >
            {{ t('admin.nachreichung.revokeConfirm') }}
          </UButton>
        </div>
      </template>
    </UModal>
  </section>
</template>
