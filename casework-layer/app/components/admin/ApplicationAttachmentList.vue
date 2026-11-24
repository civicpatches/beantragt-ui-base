<script setup lang="ts">
import { useApplicationEvents } from '~/composables/useApplicationEvents';
import ApplicationSectionEventPill from '~/components/ApplicationSectionEventPill.vue';
import { useId } from 'vue';
import { formatDateTime } from '~/composables/useFormatters';
import { TEXT_LINK_CLASS } from '~/utils/text-link';
import type { AdminApplicationAttachment } from '~/types';
import type {
    AttachmentListGroup,
    AttachmentListSummary,
    AttachmentRowState
} from '~~/casework-layer/app/composables/useAdminApplicationAttachments';

/**
 * The attachments of an application as one calm list: grouped by file field, one row per attachment with
 * its type, its name, its state and the download. A click on a row opens the slide-over at that attachment; a
 * finding shows its sentence below the row without a click. A required field without a document stays visible as
 * "Kein Dokument" with "Fehlt". Files the staff member may not load stay named, with today's notice.
 *
 * The row is a fixed line (name, state cell, download) as soon as its column is 24rem wide (a container query on
 * the rows, so the open sidebar and the right rail count); below that it breaks into exactly two lines: the name,
 * then state and download. The field label stands left of its rows once the block is 32rem wide.
 */
const { isNew: isNewEvent } = useApplicationEvents();
const props = defineProps<{
    groups: AttachmentListGroup[]
    summary: AttachmentListSummary
    loadFailed: boolean
    messagesLoading?: boolean
    rowState: (attachment: AdminApplicationAttachment) => AttachmentRowState
    fileKind: (attachment: AdminApplicationAttachment) => 'pdf' | 'image' | 'other'
    formatAttachmentSize: (size: number | undefined) => string
    isQuarantinedAttachment: (attachment: AdminApplicationAttachment) => boolean
}>();

const emit = defineEmits<{ open: [attachment: AdminApplicationAttachment], message: [id: string] }>();

const { t, locale } = useI18n();
const headingId = `attachment-list-${useId()}`;
/**
 * The look of `AppCard`. The card keeps its own `UCard` because its heading
 * carries an id and takes the focus (`data-attachment-list-heading`); `AppCard` offers neither (reported gap).
 */
// The rows extend 8px into the body padding and their event surface another
// 14px; 24px keeps that surface inside the card even on a narrow screen.
const cardUi = { root: 'divide-y-0', header: 'px-4 pt-4 pb-0 sm:px-6 sm:pt-5', body: 'px-6 pt-2 pb-4 sm:px-6 sm:pb-6 sm:pt-2' };
const fileIcons = { pdf: 'i-lucide-file-text', image: 'i-lucide-image', other: 'i-lucide-file' } as const;

/** The number next to the heading counts what the list names: loaded attachments and stored references. */
const total = computed(() => props.groups.reduce((sum, group) => sum + group.attachments.length + group.storedReferences.length, 0));
const completeness = computed(() => {
    const required = props.summary.required;
    return required ? t('admin.detail.attachmentList.requiredPresent', { present: props.summary.present, total: required }) : '';
});
const hasSummary = computed(() => Boolean(completeness.value) || props.summary.attention > 0 || props.summary.quarantined > 0);

/**
 * State and download form one group at the row's end: the state is as wide as
 * its content. A row whose state is the check alone (or nothing) never wraps; a longer state goes with the
 * download under the name when the column is narrow.
 */
function shortState(attachment: AdminApplicationAttachment): boolean {
    const kind = props.rowState(attachment).kind;
    return kind === 'clean' || kind === 'none';
}
/** The extension stays whole when a long file name wraps ("....p" / "df" at 1280 was the defect). */
function fileNameParts(name: string): [string, string] {
    const dot = name.lastIndexOf('.');
    if (dot <= 0 || name.length - dot > 6) return [name, ''];
    return [name.slice(0, dot), name.slice(dot)];
}

/** The whole line opens the slide-over; the download keeps its own action, the sentence below stays selectable. */
function rowClick(event: MouseEvent, attachment: AdminApplicationAttachment) {
    const target = event.target as HTMLElement | null;
    if (target?.closest('[data-row-action]') || target?.closest('[data-testid="attachment-sentence"]')) return;
    emit('open', attachment);
}

/**
 * A row is the framework's clickable card (UPageCard, ghost, with `onClick`): hover and corners come from the
 * theme. Only the row's layout is set here; the file name stays the button for the keyboard.
 */
/*
 * `min-w-0`: the container is a flex item of the card's root, and without it it cannot get narrower than its longest
 * unbreakable word; a long file name then pushed state and download past the row's edge. With it the name wraps inside its column (`break-words`), the extension stays whole.
 */
const rowCardUi = { container: 'block min-w-0 p-0 sm:p-0 lg:block' };

function messageContext(attachment: AdminApplicationAttachment): string {
    const message = attachment.comment;
    if (!message) return '';
    return [
        t(message.authorRole === 'citizen' ? 'admin.detail.attachmentList.fromCitizen' : 'admin.detail.attachmentList.fromStaff'),
        message.visibility === 'internal' ? t('admin.detail.attachmentList.internalNote') : '',
        formatDateTime(message.createdAt, locale?.value)
    ].filter(Boolean).join(', ');
}

function rowId(groupIndex: number, rowIndex: number, part: 'type' | 'state' | 'sentence') {
    return `${headingId}-${groupIndex}-${rowIndex}-${part}`;
}
/** Type, state and finding sentence describe the row's button; its name stays the file name. */
function describedBy(attachment: AdminApplicationAttachment, groupIndex: number, rowIndex: number) {
    const state = props.rowState(attachment);
    return [
        rowId(groupIndex, rowIndex, 'type'),
        state.kind !== 'none' ? rowId(groupIndex, rowIndex, 'state') : '',
        state.sentence ? rowId(groupIndex, rowIndex, 'sentence') : ''
    ].filter(Boolean).join(' ');
}
</script>

<template>
  <UCard
    as="section"
    :data-event-ready="!loadFailed"
    class="mb-6"
    :ui="cardUi"
    :aria-labelledby="headingId"
    data-testid="attachment-list"
  >
    <template #header>
      <div class="flex min-h-8 flex-wrap items-center gap-2">
        <UIcon
          name="i-lucide-paperclip"
          class="size-4 shrink-0 text-muted"
          aria-hidden="true"
        />
        <h2
          :id="headingId"
          tabindex="-1"
          class="min-w-0 break-words text-base font-semibold text-highlighted focus:outline-none"
          data-attachment-list-heading
        >
          {{ t('admin.detail.attachments') }}
          <span
            v-if="total"
            class="ms-1 text-sm font-normal text-muted tabular-nums"
          >{{ total }}</span>
        </h2>
        <ApplicationSectionEventPill
          kind="scan"
          :card-total="total"
        />
      </div>
    </template>

    <UAlert
      v-if="loadFailed"
      role="status"
      class="mb-4"
      color="warning"
      icon="i-lucide-triangle-alert"
      :title="t('admin.detail.attachmentLoadFailedTitle')"
      :description="t('admin.detail.attachmentLoadFailedDescription')"
    />

    <p
      v-if="hasSummary"
      class="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
      data-testid="attachment-summary"
    >
      <span
        v-if="completeness"
        class="text-muted"
      >{{ completeness }}</span>
      <UBadge
        v-if="summary.quarantined > 0"
        color="error"
        size="sm"
      >
        {{ t('admin.detail.attachmentList.quarantinedCount', { count: summary.quarantined }) }}
      </UBadge>
      <UBadge
        v-if="summary.attention > 0"
        color="warning"
        size="sm"
      >
        {{ t('admin.detail.attachmentList.attentionCount', { count: summary.attention }) }}
      </UBadge>
    </p>

    <div
      v-if="groups.length"
      class="@container/list divide-y divide-default"
    >
      <div
        v-for="(group, groupIndex) in groups"
        :key="group.key"
        class="grid min-w-0 gap-x-4 py-1.5 @lg/list:grid-cols-3"
        data-testid="attachment-group"
      >
        <p
          :id="`${headingId}-${groupIndex}`"
          class="min-w-0 break-words pt-2 text-sm text-muted @lg/list:py-2.5"
        >
          {{ group.label }}
          <UBadge
            v-if="group.proof && (group.proof.status === 'needs_review' || group.proof.status === 'illegible' || (group.proof.status === 'missing' && group.attachments.length))"
            class="ms-1"
            color="warning"
            size="sm"
          >
            {{ t(`admin.detail.attachmentList.proofStatus.${group.proof.status}`) }}
          </UBadge>
          <span v-else-if="group.proof?.status === 'missing' && !group.proof.required && !group.attachments.length">
            · {{ t('admin.detail.attachmentList.proofStatus.optionalMissing') }}
          </span>
        </p>
        <div class="@container/rows min-w-0 @lg/list:col-span-2">
          <!-- The rows keep 8 px inside for their hover; -mx-2 puts the file icon on the line of the values below
               ("Antragsdaten", "Zustellung"). -->
          <ul
            role="list"
            class="-mx-2"
            :aria-labelledby="`${headingId}-${groupIndex}`"
          >
            <UPageCard
              v-for="(attachment, rowIndex) in group.attachments"
              :key="attachment.id"
              class="application-event-entry"
              :data-event-target="isNewEvent('scan', attachment.id) ? `scan:${attachment.id}` : undefined"
              as="li"
              variant="ghost"
              :ui="rowCardUi"
              :on-click="(event: MouseEvent) => rowClick(event, attachment)"
              data-testid="attachment-row"
            >
              <div
                class="flex min-h-10 min-w-0 cursor-pointer items-center gap-x-3 px-2 py-1"
                :class="rowState(attachment).separateLine ? 'flex-wrap' : shortState(attachment) ? 'flex-nowrap' : 'flex-wrap @sm/rows:flex-nowrap'"
                data-testid="attachment-row-line"
              >
                <span
                  class="flex min-w-0 flex-1 items-center gap-2 py-1"
                  :class="rowState(attachment).separateLine ? 'basis-full' : shortState(attachment) ? undefined : 'basis-full @sm/rows:basis-auto'"
                  data-testid="attachment-row-name"
                >
                  <UIcon
                    :name="fileIcons[fileKind(attachment)]"
                    class="size-4 shrink-0 text-muted"
                    aria-hidden="true"
                  />
                  <span
                    :id="rowId(groupIndex, rowIndex, 'type')"
                    class="sr-only"
                  >{{ t(`admin.detail.attachmentList.fileType.${fileKind(attachment)}`) }}</span>
                  <!-- Framework button: the file name wraps like text (`inline`, name and
                       extension in one flow), `py-0.5` makes a 24 px target; the framework's focus ring. The look is the
                       shared text link, underlined at rest (`TEXT_LINK_CLASS`). -->
                  <UButton
                    color="neutral"
                    variant="link"
                    class="inline min-w-0 break-words px-0 py-0.5 text-left text-sm"
                    :class="TEXT_LINK_CLASS"
                    data-attachment-open
                    :data-attachment-id="attachment.id"
                    :aria-describedby="describedBy(attachment, groupIndex, rowIndex)"
                  >
                    {{ fileNameParts(attachment.filename)[0] }}<span class="whitespace-nowrap">{{ fileNameParts(attachment.filename)[1] }}</span>
                  </UButton>
                  <UBadge
                    v-if="isNewEvent('scan', attachment.id)"
                    data-test="event-new"
                  >
                    {{ t('comments.new') }}
                  </UBadge>
                </span>
                <span
                  class="ms-auto flex min-w-0 shrink-0 items-center justify-end gap-2"
                  :class="rowState(attachment).separateLine ? 'max-w-full' : undefined"
                  data-testid="attachment-row-end"
                >
                  <span
                    v-if="rowState(attachment).kind !== 'none'"
                    :id="rowId(groupIndex, rowIndex, 'state')"
                    class="flex min-h-8 min-w-0 items-center justify-end"
                    data-testid="attachment-row-state"
                  >
                    <AdminApplicationAttachmentState :state="rowState(attachment)" />
                  </span>
                  <span class="flex size-8 shrink-0 items-center justify-center">
                    <UButton
                      v-if="!isQuarantinedAttachment(attachment) && attachment.url"
                      :to="attachment.url"
                      target="_blank"
                      rel="noopener noreferrer"
                      color="neutral"
                      variant="ghost"
                      icon="i-lucide-download"
                      data-row-action
                      :title="t('admin.detail.openAttachment')"
                      :aria-label="t('admin.detail.openAttachmentNamed', { filename: attachment.filename })"
                    />
                  </span>
                </span>
              </div>
              <p
                v-if="attachment.comment"
                class="flex flex-wrap items-center gap-x-2 px-2 pb-2 ps-8 text-sm text-muted"
                data-row-action
              >
                <span>{{ messageContext(attachment) }}</span>
                <ULink
                  :to="`#application-message-${attachment.comment.id}`"
                  :disabled="messagesLoading"
                  @click.prevent.stop="emit('message', attachment.comment.id)"
                >{{ t('admin.detail.attachmentList.toMessage') }}</ULink>
              </p>
              <p
                v-if="rowState(attachment).sentence"
                :id="rowId(groupIndex, rowIndex, 'sentence')"
                class="break-words pe-2 pb-2 ps-8 text-sm text-default"
                data-testid="attachment-sentence"
              >
                {{ rowState(attachment).sentence }}
              </p>
            </UPageCard>
            <li
              v-for="reference in group.storedReferences"
              :key="reference.attachmentId"
              class="flex min-h-10 min-w-0 flex-wrap items-center gap-x-3 px-2 py-1 @sm/rows:flex-nowrap"
              data-testid="attachment-stored-reference"
            >
              <span class="flex min-w-0 basis-full items-center gap-2 py-1 @sm/rows:flex-1 @sm/rows:basis-auto">
                <UIcon
                  name="i-lucide-paperclip"
                  class="size-4 shrink-0 text-muted"
                  aria-hidden="true"
                />
                <span class="min-w-0 break-words text-sm text-default">{{ reference.filename }}</span>
              </span>
              <span class="ms-auto min-w-0 ps-6 text-sm text-muted @sm/rows:ps-0 @sm/rows:text-end">
                {{ t('admin.detail.attachmentStoredReference') }}, {{ reference.size ? formatAttachmentSize(reference.size) : t('admin.detail.attachmentStoredReferenceDescription') }}
              </span>
              <span
                class="size-8 shrink-0"
                aria-hidden="true"
              />
            </li>
            <li
              v-if="group.missing && !group.attachments.length"
              class="flex min-h-10 min-w-0 items-center gap-x-3 px-2 py-1"
              data-testid="attachment-missing"
            >
              <span class="min-w-0 flex-1 ps-6 text-sm text-muted">{{ t('admin.detail.attachmentList.noDocument') }}</span>
              <span class="ms-auto flex shrink-0 items-center">
                <UBadge
                  color="error"
                  size="sm"
                >
                  {{ t('admin.bulk.sichtung.proof.missing') }}
                </UBadge>
              </span>
              <span
                class="size-8 shrink-0"
                aria-hidden="true"
              />
            </li>
          </ul>
          <UAlert
            v-if="group.protectedNotice"
            class="my-2"
            icon="i-lucide-lock"
            :title="t('admin.detail.protectedAttachmentsHiddenTitle')"
            :description="group.protectedNotice"
          />
        </div>
      </div>
    </div>
  </UCard>
</template>
