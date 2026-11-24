<script setup lang="ts">
import AppCard from '~/components/app/Card.vue';
import type { AdminApplicationEvents } from '~/types';
import type { Comment, CommentAddedResult } from '~/components/CommentThread.vue';

const props = withDefaults(defineProps<{
    comments: Comment[]
    events?: AdminApplicationEvents | null
    previewFileIds?: string[]
    loading: boolean
    loadFailed?: boolean
    /** The list has loaded once. Reloads after that keep the composer mounted. */
    loaded?: boolean
    applicationId: string
    /** Help line of the mode "Nachricht an antragstellende Person" (mail and status). */
    publicHint?: string
    /** Mode the composer starts in: "Interne Notiz" for a batch case nobody can read online. */
    initialVisibility?: 'public' | 'internal'
    /** Send button of the public mode when "senden" would promise a recipient. */
    publicSendLabel?: string
}>(), { events: undefined, loaded: undefined, publicHint: undefined, initialVisibility: 'public', publicSendLabel: undefined });

const emit = defineEmits<{
    (event: 'comment-added', result: CommentAddedResult): void
    (event: 'attachment', attachment: NonNullable<Comment['attachments']>[number], commentId: string): void
}>();

/** Skeleton only before the first load: unmounting the thread would reset the composer mode. */
const showSkeleton = computed(() => props.loading && props.loaded !== true);

const { t } = useI18n();
const thread = ref<{ focusComment: (id: string) => Promise<void>, focusComposer: () => boolean } | null>(null);
defineExpose({
    focusComment: (id: string) => thread.value?.focusComment(id),
    focusComposer: () => thread.value?.focusComposer() ?? false
});
</script>

<template>
  <!-- The count is a plain number after the heading, not a badge. -->
  <AppCard
    region
    :data-event-ready="!loading && !showSkeleton && !loadFailed"
    tabindex="-1"
    class="mb-6 scroll-mt-4"
    :title="t('comments.title')"
    icon="i-lucide-message-circle"
    :count="comments.length"
  >
    <div
      v-if="showSkeleton"
      class="space-y-3"
    >
      <USkeleton class="h-16 w-3/4" />
      <USkeleton class="h-16 w-2/3 ml-auto" />
    </div>

    <CommentThread
      v-else
      ref="thread"
      :preview-file-ids="previewFileIds"
      :comments="comments"
      :events="events"
      :can-reply="true"
      :application-id="applicationId"
      author-role="staff"
      allow-internal
      variant="log"
      :public-hint="publicHint"
      :initial-visibility="initialVisibility"
      :public-send-label="publicSendLabel"
      @attachment="(attachment, commentId) => emit('attachment', attachment, commentId)"
      @comment-added="(result: CommentAddedResult) => emit('comment-added', result)"
    />
  </AppCard>
</template>
