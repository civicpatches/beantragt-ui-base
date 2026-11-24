import type { ComputedRef, Ref } from 'vue';
import { localDateKey } from '../utils/local-date-key';
import { deadlineDateKey, isDeadlineOverdue } from '../utils/application-deadline';

interface DeadlineApplicationState {
    changed: string
    dueDate: string
    statusFlags?: readonly string[]
}

type DeadlineQuery = Record<string, unknown>;
type MaybeComputedRef<T> = Ref<T> | ComputedRef<T>;

function errorStatusCode(error: unknown): number | null {
    const statusCode = (error as { statusCode?: unknown })?.statusCode;
    if (typeof statusCode === 'number') return statusCode;
    const status = (error as { status?: unknown })?.status;
    if (typeof status === 'number') return status;
    const responseStatus = (error as { response?: { status?: unknown } })?.response?.status;
    return typeof responseStatus === 'number' ? responseStatus : null;
}

function isDeadlineConflict(error: unknown): boolean {
    const code = (error as { data?: { code?: unknown } })?.data?.code;
    const statusCode = errorStatusCode(error);
    return code === 'errors.admin.deadlineConflict' || statusCode === 409 || statusCode === 428;
}

export function useAdminApplicationDeadline(options: {
    applicationId: string
    application: MaybeComputedRef<DeadlineApplicationState | null>
    applicationQuery: MaybeComputedRef<DeadlineQuery>
    refreshApplication: () => Promise<unknown>
    today?: () => Date
}) {
    const { t } = useI18n();
    const toast = useToast();
    const { resolveApiErrorMessage } = useApiErrorMessage();

    const dueDateInput = ref('');
    const isSavingDueDate = ref(false);
    /** A past date waits for one confirmation inside the card. */
    const dueDatePastPending = ref(false);
    /** The case changed meanwhile; the card offers "Neu laden" and keeps the typed date. */
    const dueDateConflict = ref(false);
    const dueDateChanged = computed(() => (options.application.value?.dueDate || '') !== dueDateInput.value);
    const applicationOverdue = computed(() =>
        isDeadlineOverdue(options.application.value, deadlineDateKey(options.today?.() ?? new Date()))
    );

    /**
     * Sync rule: the field follows the stored deadline only when that deadline
     * changes (own save, clear, a colleague's change). Any other refresh of the
     * page (status, assignment, a message) leaves a typed date alone.
     */
    watch(() => (options.application.value ? options.application.value.dueDate || '' : null), (next) => {
        dueDateInput.value = next ?? '';
    }, { immediate: true });

    // A new date is a new question. Synchronous, so a deferred run never clears a question just asked.
    watch(dueDateInput, () => {
        dueDatePastPending.value = false;
    }, { flush: 'sync' });

    async function saveApplicationDueDate(nextDueDate = dueDateInput.value || null, saveOptions: { confirmedPast?: boolean } = {}) {
        if (!options.application.value || isSavingDueDate.value) return;

        // Compared at save time, so a page left open overnight still asks. Clearing never asks.
        const todayAtSave = localDateKey(options.today?.() ?? new Date());
        if (nextDueDate && nextDueDate < todayAtSave && !saveOptions.confirmedPast) {
            dueDatePastPending.value = true;
            return;
        }
        dueDatePastPending.value = false;
        dueDateConflict.value = false;

        isSavingDueDate.value = true;
        try {
            await $fetch(`/api/admin/applications/${options.applicationId}/deadline`, {
                method: 'PATCH',
                query: options.applicationQuery.value,
                body: {
                    dueDate: nextDueDate,
                    expectedChanged: options.application.value.changed
                }
            });
            await options.refreshApplication();
            toast.add({ title: t('admin.detail.dueDateSaved'), color: 'success' });
        } catch (e: unknown) {
            if (isDeadlineConflict(e)) {
                // Shown in the card with "Neu laden"; a toast would take the action away with it.
                dueDateConflict.value = true;
                return;
            }
            toast.add({
                title: t('admin.detail.dueDateSaveError'),
                description: resolveApiErrorMessage(e, 'admin.detail.dueDateSaveError'),
                color: 'error'
            });
        } finally {
            isSavingDueDate.value = false;
        }
    }

    function confirmPastDueDate() {
        return saveApplicationDueDate(dueDateInput.value || null, { confirmedPast: true });
    }

    function cancelPastDueDate() {
        dueDatePastPending.value = false;
    }

    /** Loads the current case and puts the typed date back into the field. */
    async function reloadAfterDueDateConflict() {
        const typed = dueDateInput.value;
        await options.refreshApplication();
        await nextTick();
        dueDateInput.value = typed;
        dueDateConflict.value = false;
    }

    return {
        dueDateInput,
        isSavingDueDate,
        dueDateChanged,
        applicationOverdue,
        dueDatePastPending,
        dueDateConflict,
        saveApplicationDueDate,
        confirmPastDueDate,
        cancelPastDueDate,
        reloadAfterDueDateConflict
    };
}
