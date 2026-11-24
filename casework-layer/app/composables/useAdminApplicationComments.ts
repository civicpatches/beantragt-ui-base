import type { ComputedRef, Ref } from 'vue';
import type { Comment, CommentAddedResult } from '~/components/CommentThread.vue';

interface CommentsApplicationState {
    id: string
    /** `bulk` for cases from batch processing: the backend sends them no citizen mail. */
    origin?: string | null
    statusFlags?: string[]
    statusLabel?: string | null
}

/** A status the application may move to next, with its flags (from the page's status map). */
export interface CommentsNextStatus {
    label?: string | null
    semanticFlags?: string[]
}

type MaybeComputedRef<T> = Ref<T> | ComputedRef<T>;

export function useAdminApplicationComments(options: {
    application: MaybeComputedRef<CommentsApplicationState | null>
    workspaceKey?: MaybeComputedRef<string | null | undefined>
    beginSectionLoad?: () => () => void
    /** The page's refresh after a status change (case, history, transfers). */
    refreshAfterStatusChange?: () => Promise<unknown>
    /** Refresh attachments only when the sent message contained files. */
    refreshAttachments?: () => Promise<unknown>
    /**
     * The statuses this application may move to now (Drupal's own transition check). A public message
     * moves it to the request-info status only along such a transition, so the help line names it from here.
     */
    allowedNextStatuses?: MaybeComputedRef<CommentsNextStatus[]>
}) {
    const { t } = useI18n();
    const beginSectionLoad = () => options.beginSectionLoad?.() ?? (() => {});
    const toast = useToast();
    const comments = ref<Comment[]>([]);
    const commentsLoading = ref(false);
    /**
     * True once the list of the open application has loaded. A later reload
     * (after sending) keeps the thread mounted, so the composer keeps its mode
     * and draft; only a first load or another application shows the skeleton.
     */
    const commentsLoaded = ref(false);
    const commentsLoadFailed = ref(false);
    let generation = 0;

    async function fetchComments() {
        const applicationId = options.application.value?.id;
        if (!applicationId) return;

        const rendered = beginSectionLoad();
        const current = ++generation;
        commentsLoading.value = true;
        commentsLoadFailed.value = false;
        try {
            const data = await $fetch<Comment[]>(
                `/api/comments/${applicationId}`
            );
            if (current !== generation || options.application.value?.id !== applicationId) return;
            comments.value = Array.isArray(data) ? data : [];
            rendered();
        } catch {
            if (current !== generation || options.application.value?.id !== applicationId) return;
            comments.value = [];
            commentsLoadFailed.value = true;
        } finally {
            if (current === generation && options.application.value?.id === applicationId) {
                commentsLoading.value = false;
                commentsLoaded.value = true;
            }
        }
    }

    onMounted(() => {
        if (options.application.value) {
            fetchComments();
        }
    });

    watch(
        [() => options.application.value?.id, () => options.workspaceKey?.value],
        ([id]) => {
            generation += 1;
            commentsLoadFailed.value = false;
            comments.value = [];
            commentsLoaded.value = false;
            if (id) {
                fetchComments();
            } else {
                commentsLoading.value = false;
            }
        }
    );

    /** A batch case belongs to the uploading staff account and carries no applicant address: nobody can read a reply. */
    const fromBatch = computed(() => options.application.value?.origin === 'bulk');

    /**
     * The request-info status a public message would move the case to (CommentApiController::add),
     * only when the transition is allowed: the backend saves through the transition check and keeps
     * the status otherwise. Several candidates: the backend picks by weight, so the line names none.
     */
    const requestInfoTarget = computed<{ label: string | null } | null>(() => {
        const application = options.application.value;
        if (!application || application.statusFlags?.includes('request_info')) return null;
        const targets = (options.allowedNextStatuses?.value ?? []).filter(status => status.semanticFlags?.includes('request_info'));
        if (targets.length === 0) return null;
        return { label: targets.length === 1 ? targets[0]!.label?.trim() || null : null };
    });

    /**
     * What a public message does besides showing up for the applicant,
     * said before sending, in sentences the page can decide: who reads it, that a mail is at most a
     * notice (template and address are not known here), and the status only when it will move.
     */
    const commentPublicHint = computed(() => {
        const application = options.application.value;
        if (!application) return undefined;
        const reader = fromBatch.value ? t('comments.publicNoMailHint') : t('comments.publicMailHint');
        const target = requestInfoTarget.value;
        const status = target
            ? (target.label ? t('comments.statusHint', { status: target.label }) : t('comments.statusHintUnnamed'))
            : '';
        return [reader, status].filter(Boolean).join(' ');
    });

    /** Batch case: start in "Interne Notiz", and the public mode does not claim to send. */
    const commentInitialVisibility = computed<'public' | 'internal'>(() => fromBatch.value ? 'internal' : 'public');
    const commentPublicSendLabel = computed(() => fromBatch.value ? t('comments.sendPublicBatch') : undefined);

    /**
     * After sending: reload the list, and after a public message the case too, so a
     * moved status shows at once. The toast repeats what happened (plan 4.2);
     * it makes no mail promise, the answer does not say whether a mail left.
     */
    async function onCommentAdded(result: CommentAddedResult) {
        const refreshCase = result.visibility === 'public' && result.statusChanged !== false;
        await Promise.all([
            fetchComments(),
            refreshCase && options.refreshAfterStatusChange
                ? options.refreshAfterStatusChange()
                : result.attachmentCount > 0 && options.refreshAttachments
                    ? options.refreshAttachments()
                    : Promise.resolve()
        ]);
        if (result.visibility === 'internal') {
            toast.add({ title: t('comments.savedInternalToast'), color: 'success' });
            return;
        }
        const statusLabel = options.application.value?.statusLabel;
        toast.add({
            title: t(fromBatch.value ? 'comments.savedPublicBatchToast' : 'comments.sentPublicToast'),
            ...(result.statusChanged === true
                ? {
                    description: statusLabel
                        ? t('comments.statusChangedToast', { status: statusLabel })
                        : t('comments.statusChangedToastUnknown')
                }
                : {}),
            color: 'success'
        });
    }

    return {
        comments,
        commentsLoading,
        commentsLoaded,
        commentsLoadFailed,
        commentPublicHint,
        commentInitialVisibility,
        commentPublicSendLabel,
        fetchComments,
        onCommentAdded
    };
}
