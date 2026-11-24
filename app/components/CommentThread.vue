<script setup lang="ts">
import { formatDateTime } from '~/composables/useFormatters';
import { resolveComponent, useId } from 'vue';
import { parseSystemNote, type SystemNote } from '~/utils/comment-system-notes';
import type { AdminApplicationEvents } from '~/types';
import { APPLICATION_MESSAGE_COMPOSER, isNewApplicantMessage } from '~/utils/application-events';
import CommentLogEntry from './CommentLogEntry.vue';

export interface Comment {
    id: string
    uuid?: string
    body: string
    authorRole: 'citizen' | 'staff'
    visibility?: 'public' | 'internal'
    createdAt: string
    attachments?: { id?: string, url?: string, filename: string, size?: number }[]
}

type CommentAttachment = NonNullable<Comment['attachments']>[number];

const props = withDefaults(defineProps<{
    comments: Comment[]
    /** Snapshot from opening the staff detail, preserved while this visit stays open. */
    events?: AdminApplicationEvents | null
    canReply: boolean
    applicationId: string
    authorRole?: 'citizen' | 'staff'
    allowAttachments?: boolean
    allowInternal?: boolean
    variant?: 'chat' | 'log'
    /**
     * Staff composer only: the help line of the mode "Nachricht an antragstellende
     * Person" (who reads it, whether a mail goes out, what happens to the status).
     * The parent words it from the application; without it the general mail sentence shows.
     */
    publicHint?: string
    /**
     * Staff composer only: the mode it starts in. A case that the applicant can never read online
     * (batch processing) starts as an internal note; the mode last used still wins afterwards.
     */
    initialVisibility?: 'public' | 'internal'
    /** Staff composer only: send button text of the public mode, when "senden" would promise a recipient. */
    publicSendLabel?: string
    previewFileIds?: string[]
}>(), {
    events: undefined,
    authorRole: 'citizen',
    allowAttachments: true,
    allowInternal: false,
    variant: 'chat',
    publicHint: undefined,
    initialVisibility: 'public',
    publicSendLabel: undefined
});

/** What the server did with the message: the parent refreshes the case when its status moved. */
export interface CommentAddedResult {
    visibility: 'public' | 'internal'
    attachmentCount: number
    /** `true` when sending moved the application to the request-info status; `null` when the answer did not say. */
    statusChanged: boolean | null
}

const emit = defineEmits<{
    commentAdded: [result: CommentAddedResult]
    attachment: [attachment: CommentAttachment, commentId: string]
}>();

const { t, locale } = useI18n();
const { user } = useAuth();
// Nuxt UI resolves the platform after mount: Cmd on macOS, Ctrl elsewhere.
const { macOS } = useKbd();
const { resolveApiErrorMessage } = useApiErrorMessage();

// Perspective of the person looking at the thread: own messages are
// right-aligned and labelled "you", the counterpart is named by role.
const viewerRole = computed(() => props.authorRole ?? 'citizen');
const isLogVariant = computed(() => props.variant === 'log');

// Only internal staff notes can be audit notes; a citizen cannot fake one.
function systemNote(comment: Comment): SystemNote | null {
    return comment.authorRole === 'staff' && comment.visibility === 'internal' ? parseSystemNote(comment.body) : null;
}

function systemNoteLine(note: SystemNote): string {
    if (note.kind === 'assignment') {
        return t('comments.system.assignmentLine', {
            by: note.by,
            target: note.targetUser && note.targetUser === user.value?.uuid ? t('comments.system.assignmentYou') : note.target
        });
    }
    return t(note.by ? 'comments.system.delegationLineBy' : 'comments.system.delegationLine', { source: note.source, target: note.target, by: note.by });
}

function isOwnComment(comment: Comment): boolean {
    return comment.authorRole === viewerRole.value;
}

function authorLabel(comment: Comment): string {
    if (isOwnComment(comment)) {
        return t('comments.authorYou');
    }
    return comment.authorRole === 'staff'
        ? t('comments.authorStaff')
        : t('comments.authorCitizen');
}

const replyBody = ref('');
/**
 * Staff composer mode. It stays on the mode last used, also after sending and
 * after the list reloads: a second internal note must never go out as mail.
 */
const visibility = ref<'public' | 'internal'>(props.allowInternal && props.initialVisibility === 'internal' ? 'internal' : 'public');
const isInternal = computed(() => props.allowInternal && visibility.value === 'internal');
const modeItems = computed(() => [
    { value: 'public', label: t('comments.modePublic') },
    { value: 'internal', label: t('comments.internalToggle') }
]);
const replyLabel = computed(() => t(isInternal.value ? 'comments.noteLabel' : 'comments.replyLabel'));
const replyHelp = computed(() => isInternal.value
    ? t('comments.internalToggleDescription')
    : (props.publicHint || t('comments.publicMailHint')));
const sendLabel = computed(() => isInternal.value
    ? t('comments.sendInternal')
    : (props.allowInternal && props.publicSendLabel) || t('comments.sendPublic'));
const shortcutLabel = computed(() => t(isInternal.value ? 'comments.shortcutSave' : 'comments.shortcutSend'));
const modifierKey = computed(() => macOS.value ? 'meta' : t('comments.ctrlKey'));
/** The shortcut is read in the send button's tooltip; `meta` alone would read "Ctrl", not "Strg". */
const sendKbds = computed(() => [modifierKey.value, 'Enter']);

function updateVisibility(value: unknown) {
    visibility.value = value === 'internal' ? 'internal' : 'public';
}
const submitting = ref(false);
const uploading = ref(false);
const submitError = ref<string | null>(null);
const threadContainer = ref<HTMLElement | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const uploadedAttachments = ref<{ id: number, filename: string }[]>([]);

const sortedComments = computed(() => {
    return [...props.comments].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
});

/**
 * Staff log: no inner scroll area. With more than six entries the older ones are
 * folded behind "Ältere Nachrichten anzeigen"; the newest six are always open and form the live log.
 */
const LOG_OPEN_ENTRIES = 6;
const olderOpen = ref(false);
const olderComments = computed(() =>
    isLogVariant.value && sortedComments.value.length > LOG_OPEN_ENTRIES
        ? sortedComments.value.slice(0, sortedComments.value.length - LOG_OPEN_ENTRIES)
        : []
);
const recentComments = computed(() =>
    olderComments.value.length > 0 ? sortedComments.value.slice(olderComments.value.length) : sortedComments.value
);

function isNew(comment: Comment): boolean {
    return viewerRole.value === 'staff' && isNewApplicantMessage(comment, props.events);
}
// A new applicant reply must not be hidden among older entries after later staff notes.
watch(() => olderComments.value.some(isNew), (hasNew) => {
    if (hasNew) olderOpen.value = true;
}, { immediate: true });

const charCount = computed(() => replyBody.value.length);
const maxChars = 5000;
const maxAttachments = 5;
/** Five attachments are the limit: the reason stands beside the disabled button, not only in its tooltip. */
const attachmentLimitId = `comment-attachment-limit-${useId()}`;
const attachmentLimitReached = computed(() => uploadedAttachments.value.length >= maxAttachments);
const canUploadMore = computed(() =>
    props.allowAttachments && uploadedAttachments.value.length < maxAttachments && !uploading.value && !submitting.value
);
const canSubmit = computed(() =>
    (replyBody.value.trim().length > 0 || uploadedAttachments.value.length > 0)
    && charCount.value <= maxChars
    && !uploading.value
    && !submitting.value
);

function formatRelativeTime(timestamp: string): string {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHours = Math.floor(diffMin / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSec < 60) return t('comments.justNow');
    if (diffMin < 60) return t('comments.minutesAgo', { count: diffMin }, diffMin);
    if (diffHours < 24) return t('comments.hoursAgo', { count: diffHours }, diffHours);
    if (diffDays < 7) return t('comments.daysAgo', { count: diffDays }, diffDays);

    return formatAbsoluteTime(timestamp);
}

function formatAbsoluteTime(timestamp: string): string {
    if (!timestamp) return '';
    return formatDateTime(timestamp, locale?.value);
}

function formatMachineTime(timestamp: string): string {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? timestamp : date.toISOString();
}

function scrollToBottom() {
    nextTick(() => {
        if (threadContainer.value) {
            threadContainer.value.scrollTop = threadContainer.value.scrollHeight;
        }
    });
}

function chooseFiles() {
    fileInput.value?.click();
}

async function uploadFiles(event: Event) {
    const input = event.target as HTMLInputElement;
    const selectedFiles = Array.from(input.files ?? []);
    const remainingSlots = Math.max(0, maxAttachments - uploadedAttachments.value.length);
    const files = selectedFiles.slice(0, remainingSlots);
    input.value = '';
    if (selectedFiles.length > files.length) {
        submitError.value = t('comments.attachmentLimitExceeded', { count: maxAttachments });
    }
    if (files.length === 0 || uploading.value) return;

    uploading.value = true;
    if (selectedFiles.length === files.length) {
        submitError.value = null;
    }
    try {
        for (const file of files) {
            const formData = new FormData();
            formData.append('file', file);
            const response = await $fetch<{ id: number, filename: string }>(
                `/api/comments/${props.applicationId}/upload`,
                {
                    method: 'POST',
                    credentials: 'include',
                    body: formData
                }
            );
            uploadedAttachments.value.push({
                id: response.id,
                filename: response.filename || file.name
            });
        }
    } catch (e: unknown) {
        submitError.value = resolveApiErrorMessage(e, 'errors.attachments.uploadFailed');
    } finally {
        uploading.value = false;
    }
}

function removeUploadedAttachment(id: number) {
    uploadedAttachments.value = uploadedAttachments.value.filter(attachment => attachment.id !== id);
}

function attachmentHref(attachment: CommentAttachment): string | undefined {
    if (!attachment.url) return undefined;
    if (/^https?:\/\//i.test(attachment.url)) return attachment.url;
    const path = attachment.url.replace(/^\/+/, '').replace(/^(de|en)\/api\//, 'api/');
    return `/${path}`;
}

async function submitReply() {
    if (!canSubmit.value) return;

    submitting.value = true;
    submitError.value = null;

    const sentVisibility = props.allowInternal ? visibility.value : 'public';
    const sentAttachmentCount = uploadedAttachments.value.length;
    try {
        const response = await $fetch<{ data?: { statusChanged?: unknown } } | null>(`/api/comments/${props.applicationId}`, {
            method: 'POST',
            credentials: 'include',
            body: {
                body: replyBody.value.trim(),
                ...(props.allowInternal ? { visibility: visibility.value } : {}),
                ...(uploadedAttachments.value.length
                    ? { attachmentIds: uploadedAttachments.value.map(attachment => attachment.id) }
                    : {})
            }
        });

        // The mode is kept on purpose.
        replyBody.value = '';
        uploadedAttachments.value = [];
        const statusChanged = response?.data?.statusChanged;
        emit('commentAdded', {
            visibility: sentVisibility,
            attachmentCount: sentAttachmentCount,
            statusChanged: typeof statusChanged === 'boolean' ? statusChanged : null
        });
        scrollToBottom();
    } catch (e: unknown) {
        submitError.value = resolveApiErrorMessage(e, 'comments.sendError');
    } finally {
        submitting.value = false;
    }
}

function canPreview(attachment: CommentAttachment): boolean {
    return Boolean(attachment.id && props.previewFileIds?.includes(attachment.id));
}

async function focusComment(id: string) {
    if (olderComments.value.some(comment => String(comment.id) === String(id))) olderOpen.value = true;
    await nextTick();
    const element = document.getElementById(`application-message-${id}`);
    element?.scrollIntoView({ block: 'center', behavior: 'instant' });
    element?.focus({ preventScroll: true });
}

const staffComposer = ref<{ textareaRef?: HTMLTextAreaElement } | null>(null);
function focusComposer() {
    const textarea = staffComposer.value?.textareaRef;
    if (!textarea?.isConnected || textarea.disabled) return false;
    textarea.scrollIntoView({ block: 'center', behavior: 'instant' });
    textarea.focus({ preventScroll: true });
    return document.activeElement === textarea;
}

defineExpose({ focusComment, focusComposer });

// Auto-scroll on initial mount and when comments change
watch(
    () => props.comments.length,
    () => scrollToBottom()
);

onMounted(() => {
    scrollToBottom();
});
</script>

<template>
  <div class="flex flex-col">
    <!-- Staff log: a divided list, no frames, no inner scroll; older entries folded. -->
    <div
      v-if="isLogVariant"
      class="space-y-1"
    >
      <UCollapsible
        v-if="olderComments.length > 0"
        v-model:open="olderOpen"
        :unmount-on-hide="false"
        data-testid="comment-older"
      >
        <UButton
          color="neutral"
          variant="link"
          class="px-0"
          data-testid="comment-older-toggle"
        >
          {{ olderOpen ? t('comments.hideOlder') : t('comments.showOlder', { count: olderComments.length }) }}
        </UButton>
        <template #content>
          <ol
            class="divide-y divide-default border-b border-default"
            :aria-label="t('comments.olderListLabel')"
            data-testid="comment-older-list"
          >
            <CommentLogEntry
              v-for="comment in olderComments"
              :key="comment.id"
              :comment="comment"
              :is-new="isNew(comment)"
              :author-label="authorLabel(comment)"
              :relative-time="formatRelativeTime(comment.createdAt)"
              :absolute-time="formatAbsoluteTime(comment.createdAt)"
              :machine-time="formatMachineTime(comment.createdAt)"
              :system-note="systemNote(comment)"
              :attachment-href="attachmentHref"
              :preview-file-ids="previewFileIds"
              @attachment="emit('attachment', $event, String(comment.id))"
            />
          </ol>
        </template>
      </UCollapsible>
      <div
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        :aria-label="t('comments.title')"
      >
        <p
          v-if="sortedComments.length === 0"
          class="max-w-prose text-sm text-muted"
        >
          {{ t('comments.empty') }}
        </p>
        <ol
          v-else
          class="divide-y divide-default"
          data-testid="comment-log-list"
        >
          <CommentLogEntry
            v-for="comment in recentComments"
            :key="comment.id"
            :comment="comment"
            :is-new="isNew(comment)"
            :author-label="authorLabel(comment)"
            :relative-time="formatRelativeTime(comment.createdAt)"
            :absolute-time="formatAbsoluteTime(comment.createdAt)"
            :machine-time="formatMachineTime(comment.createdAt)"
            :system-note="systemNote(comment)"
            :attachment-href="attachmentHref"
            :preview-file-ids="previewFileIds"
            @attachment="emit('attachment', $event, String(comment.id))"
          />
        </ol>
      </div>
    </div>

    <!-- Citizen messages: chat bubbles, unchanged. -->
    <div
      v-else
      ref="threadContainer"
      class="max-h-96 overflow-y-auto px-4 py-3 scroll-smooth"
      :class="{ 'min-h-24': sortedComments.length > 0 }"
      role="log"
      aria-live="polite"
      aria-relevant="additions text"
      :aria-label="t('comments.title')"
    >
      <!-- Empty state -->
      <div
        v-if="sortedComments.length === 0"
        class="text-center py-8"
      >
        <UIcon
          name="i-lucide-message-circle"
          class="size-8 text-(--ui-text-dimmed) mx-auto mb-2"
        />
        <p class="text-sm text-muted">
          {{ t('comments.empty') }}
        </p>
      </div>

      <!-- Messages -->
      <div
        v-for="comment in sortedComments"
        :id="`application-message-${comment.id}`"
        :key="comment.id"
        :data-event-target="isNew(comment) && comment.uuid ? `message:${comment.uuid}` : undefined"
        :data-comment-id="comment.id"
        tabindex="-1"
        :class="['application-event-entry flex', isOwnComment(comment) ? 'justify-end' : 'justify-start']"
      >
        <div
          class="px-4 py-3"
          :class="
            isOwnComment(comment)
              ? 'max-w-[80%] rounded-xl rounded-br-sm border border-(--ui-primary)/40 bg-(--ui-primary)/10 sm:max-w-[70%]'
              : 'max-w-[80%] rounded-xl rounded-bl-sm border border-(--ui-border) bg-(--ui-bg-elevated) sm:max-w-[70%]'
          "
        >
          <!-- Author badge -->
          <div class="flex items-center gap-2 mb-1.5">
            <UBadge
              :color="isOwnComment(comment) ? 'primary' : 'neutral'"
            >
              <UIcon
                :name="comment.authorRole === 'staff' ? 'i-lucide-building-2' : 'i-lucide-user'"
                class="size-3 mr-0.5"
              />
              {{ authorLabel(comment) }}
            </UBadge>
            <UBadge
              v-if="isNew(comment)"
              data-testid="comment-new"
            >
              {{ t('comments.new') }}
            </UBadge>
            <UBadge
              v-if="comment.visibility === 'internal'"
              color="warning"
            >
              <UIcon
                name="i-lucide-lock"
                class="size-3 mr-0.5"
              />
              {{ t('comments.internalBadge') }}
            </UBadge>
            <time
              class="text-xs text-muted"
              :datetime="formatMachineTime(comment.createdAt)"
              :title="formatAbsoluteTime(comment.createdAt)"
            >
              {{ formatRelativeTime(comment.createdAt) }}
            </time>
          </div>

          <!-- Body: audit notes in the UI language, everything else verbatim -->
          <div
            v-if="systemNote(comment)"
            class="text-sm text-(--ui-text) leading-relaxed"
            data-testid="comment-system-note"
          >
            <p class="font-medium">
              {{ t(systemNote(comment)!.kind === 'assignment' ? 'comments.system.assignmentTitle' : 'comments.system.delegationTitle') }}
            </p>
            <p>
              {{ systemNoteLine(systemNote(comment)!) }}
            </p>
            <p
              v-if="systemNote(comment)!.note"
              class="whitespace-pre-wrap break-words"
            >
              {{ t('comments.system.delegationNote', { note: systemNote(comment)!.note }) }}
            </p>
          </div>
          <p
            v-else-if="comment.body"
            class="text-sm text-(--ui-text) whitespace-pre-wrap break-words leading-relaxed"
          >
            {{ comment.body }}
          </p>

          <!-- Attachments -->
          <div
            v-if="comment.attachments?.length"
            class="mt-2 space-y-1"
          >
            <component
              :is="canPreview(attachment) ? resolveComponent('UButton') : attachment.url ? 'a' : 'span'"
              v-for="attachment in comment.attachments"
              :key="attachment.url || attachment.id || attachment.filename"
              :href="canPreview(attachment) ? undefined : attachmentHref(attachment)"
              :type="canPreview(attachment) ? 'button' : undefined"
              :variant="canPreview(attachment) ? 'link' : undefined"
              :color="canPreview(attachment) ? 'neutral' : undefined"
              :data-message-file="attachment.id"
              :target="!canPreview(attachment) && attachment.url ? '_blank' : undefined"
              :rel="attachment.url ? 'noopener noreferrer' : undefined"
              class="flex max-w-full items-center gap-1.5 text-sm text-(--ui-primary) hover:underline"
              @click="canPreview(attachment) && emit('attachment', attachment, String(comment.id))"
            >
              <UIcon
                name="i-lucide-paperclip"
                class="size-3 shrink-0"
              />
              <span
                class="min-w-0 truncate"
                :title="attachment.filename"
              >
                {{ attachment.filename }}
              </span>
            </component>
          </div>
        </div>
      </div>
    </div>

    <!-- Reply form -->
    <div
      v-if="canReply"
      id="comments"
      class="mt-4 pt-4 border-t border-(--ui-border)"
    >
      <!-- Error: one framework alert for both composers. The citizen's stays polite, as before. -->
      <UAlert
        v-if="submitError"
        class="mb-3"
        color="error"
        icon="i-lucide-circle-x"
        role="alert"
        :aria-live="allowInternal ? undefined : 'polite'"
        :title="submitError"
        data-testid="comment-error"
      />

      <!-- Staff: two labelled modes; the mode decides whether the applicant is notified. -->
      <URadioGroup
        v-if="allowInternal"
        :model-value="visibility"
        :items="modeItems"
        :legend="t('comments.modeLegend')"
        orientation="horizontal"
        :disabled="submitting"
        class="mb-3"
        :ui="{ fieldset: 'flex-wrap gap-x-6 gap-y-2', legend: 'mb-2 text-sm font-medium text-(--ui-text-muted)' }"
        data-testid="comment-mode"
        @update:model-value="updateVisibility"
      />

      <div
        v-if="uploadedAttachments.length"
        class="mb-3 flex flex-wrap gap-2"
      >
        <UBadge
          v-for="attachment in uploadedAttachments"
          :key="attachment.id"
          color="neutral"
          class="gap-1"
        >
          <UIcon
            name="i-lucide-paperclip"
            class="size-3"
          />
          <span class="max-w-48 truncate">{{ attachment.filename }}</span>
          <!-- Use an xs button with a 24 px target and a 16 px icon. The negative block margin keeps the chip 24 px high.
               The button name and tooltip identify the file removal action. -->
          <UTooltip :text="t('comments.removeAttachment', { filename: attachment.filename })">
            <UButton
              color="neutral"
              variant="ghost"
              size="xs"
              icon="i-lucide-x"
              class="-my-1"
              :aria-label="t('comments.removeAttachment', { filename: attachment.filename })"
              :disabled="submitting"
              data-testid="comment-attachment-remove"
              @click="removeUploadedAttachment(attachment.id)"
            />
          </UTooltip>
        </UBadge>
      </div>

      <!-- Staff composer: labelled field, help line per mode, send button with text. -->
      <template v-if="allowInternal">
        <UFormField
          :id="APPLICATION_MESSAGE_COMPOSER"
          :label="replyLabel"
          :hint="t('comments.charCount', { count: charCount, max: maxChars })"
          :help="replyHelp"
          :ui="{ help: 'max-w-prose text-sm', hint: charCount > maxChars ? 'text-error' : undefined }"
          data-testid="comment-reply-field"
        >
          <UTextarea
            ref="staffComposer"
            v-model="replyBody"
            :rows="2"
            autoresize
            :maxrows="6"
            class="w-full"
            :disabled="submitting"
            aria-keyshortcuts="Meta+Enter Control+Enter"
            @keydown.meta.enter.prevent="submitReply"
            @keydown.ctrl.enter.prevent="submitReply"
          />
        </UFormField>
        <!-- One row, left aligned: the filled send button first, then attachments. -->
        <div class="mt-3 flex flex-wrap items-center gap-2">
          <!-- Same hidden picker as in the citizen row; only one branch is rendered. -->
          <input
            ref="fileInput"
            type="file"
            class="sr-only"
            accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
            multiple
            tabindex="-1"
            aria-hidden="true"
            @change="uploadFiles"
          >
          <UTooltip
            :text="shortcutLabel"
            :kbds="sendKbds"
          >
            <UButton
              :loading="submitting"
              :disabled="!canSubmit"
              data-testid="comment-send"
              @click="submitReply"
            >
              {{ sendLabel }}
            </UButton>
          </UTooltip>
          <UTooltip
            v-if="allowAttachments"
            :text="t('comments.attachmentTooltip', { count: maxAttachments })"
          >
            <UButton
              color="neutral"
              variant="outline"
              icon="i-lucide-paperclip"
              :loading="uploading"
              :disabled="!canUploadMore"
              :aria-describedby="attachmentLimitReached ? attachmentLimitId : undefined"
              data-testid="comment-attach"
              @click="chooseFiles"
            >
              {{ t('comments.uploadAttachment') }}
            </UButton>
          </UTooltip>
          <p
            v-if="allowAttachments && attachmentLimitReached"
            :id="attachmentLimitId"
            class="text-sm text-muted"
            data-testid="comment-attachment-limit"
          >
            {{ t('comments.attachmentLimitExceeded', { count: maxAttachments }) }}
          </p>
        </div>
      </template>

      <!-- Citizen composer: unchanged. -->
      <div
        v-else
        class="flex gap-2"
      >
        <UTextarea
          v-model="replyBody"
          :placeholder="t('comments.replyPlaceholder')"
          :rows="2"
          autoresize
          :maxrows="6"
          class="flex-1"
          :disabled="submitting"
          @keydown.meta.enter.prevent="submitReply"
          @keydown.ctrl.enter.prevent="submitReply"
        />
        <input
          ref="fileInput"
          type="file"
          class="sr-only"
          accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
          multiple
          tabindex="-1"
          aria-hidden="true"
          @change="uploadFiles"
        >
        <UButton
          v-if="allowAttachments"
          color="neutral"
          variant="soft"
          icon="i-lucide-paperclip"
          :loading="uploading"
          :disabled="!canUploadMore"
          class="self-end"
          :aria-label="t('comments.uploadAttachment')"
          :title="t('comments.uploadAttachment')"
          @click="chooseFiles"
        >
          <span class="sr-only">{{ t('comments.uploadAttachment') }}</span>
        </UButton>
        <UButton
          data-testid="comment-send"
          icon="i-lucide-send"
          :loading="submitting"
          :disabled="!canSubmit"
          class="self-end"
          @click="submitReply"
        >
          <span class="sr-only">{{ t('comments.send') }}</span>
        </UButton>
      </div>
      <p
        v-if="!allowInternal"
        class="text-sm mt-1.5"
        :class="charCount > maxChars ? 'text-error' : 'text-muted'"
      >
        {{ charCount }} / {{ maxChars }} {{ t('comments.characters') }}
        <span class="hidden sm:inline"> &middot; {{ t('comments.sendHint') }}</span>
        <span v-if="allowAttachments"> &middot; {{ t('comments.attachmentHint', { count: maxAttachments }) }}</span>
      </p>
    </div>
  </div>
</template>
