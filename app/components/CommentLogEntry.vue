<script setup lang="ts">
import { resolveComponent } from 'vue';
/**
 * One entry of the staff message log in `CommentThread` with `variant="log"`. A row of a divided list, no frame. Head line:
 * author as text, the time, and for an internal note ONE grey badge
 * "Intern" at the right end. Messages to the applicant carry no badge.
 *
 * Used twice by the thread, for the folded older entries and for the newest
 * ones, so both look the same.
 */
import type { Comment } from './CommentThread.vue';
import type { SystemNote } from '~/utils/comment-system-notes';

type CommentAttachment = NonNullable<Comment['attachments']>[number];

const props = defineProps<{
    comment: Comment
    isNew?: boolean
    authorLabel: string
    relativeTime: string
    absoluteTime: string
    machineTime: string
    systemNote: SystemNote | null
    previewFileIds?: string[]
    attachmentHref: (attachment: CommentAttachment) => string | undefined
}>();

function canPreview(attachment: CommentAttachment): boolean {
    return Boolean(attachment.id && props.previewFileIds?.includes(attachment.id));
}

const emit = defineEmits<{ attachment: [attachment: CommentAttachment] }>();

const { t, locale } = useI18n();
const { user } = useAuth();
/**
 * The time follows "author ·" in the middle of a line, so it starts in lower case ("vor 11 Stunden");
 * a date ("12.11.2026, 10:00") starts with a digit and stays as it is.
 */
const timeInLine = computed(() => {
    const text = props.relativeTime;
    return text ? text.charAt(0).toLocaleLowerCase(locale.value) + text.slice(1) : text;
});
</script>

<template>
  <li
    :id="`application-message-${comment.id}`"
    :data-comment-id="comment.id"
    :data-event-target="isNew && comment.uuid ? `message:${comment.uuid}` : undefined"
    tabindex="-1"
    class="application-event-entry py-3"
    data-testid="comment-log-entry"
  >
    <div class="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <span class="font-medium text-highlighted">{{ authorLabel }}</span>
      <span
        class="text-muted"
        aria-hidden="true"
      >·</span>
      <time
        class="text-muted"
        :datetime="machineTime"
        :title="absoluteTime"
      >
        {{ timeInLine }}
      </time>
      <UBadge
        v-if="isNew"
        data-testid="comment-new"
      >
        {{ t('comments.new') }}
      </UBadge>
      <UBadge
        v-if="comment.visibility === 'internal'"
        color="neutral"
        icon="i-lucide-lock"
        class="ms-auto"
        data-testid="comment-internal-badge"
      >
        {{ t('comments.internalBadge') }}
      </UBadge>
    </div>

    <!-- Body: audit notes in the UI language, everything else verbatim -->
    <div
      v-if="systemNote"
      class="text-sm leading-relaxed text-default"
      data-testid="comment-system-note"
    >
      <p class="font-medium">
        {{ t(systemNote.kind === 'assignment' ? 'comments.system.assignmentTitle' : 'comments.system.delegationTitle') }}
      </p>
      <p>
        {{ systemNote.kind === 'assignment'
          ? t('comments.system.assignmentLine', { by: systemNote.by, target: systemNote.targetUser && systemNote.targetUser === user?.uuid ? t('comments.system.assignmentYou') : systemNote.target })
          : systemNote.by
            ? t('comments.system.delegationLineBy', { source: systemNote.source, target: systemNote.target, by: systemNote.by })
            : t('comments.system.delegationLine', { source: systemNote.source, target: systemNote.target }) }}
      </p>
      <p
        v-if="systemNote.note"
        class="whitespace-pre-wrap break-words"
      >
        {{ t('comments.system.delegationNote', { note: systemNote.note }) }}
      </p>
    </div>
    <p
      v-else-if="comment.body"
      class="max-w-prose whitespace-pre-wrap break-words text-sm leading-relaxed text-default"
    >
      {{ comment.body }}
    </p>

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
        @click="canPreview(attachment) && emit('attachment', attachment)"
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
  </li>
</template>
