import { computed, onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue';
import type { AdminApplicationsResponse, ApplicationRow } from '~/types';
import { buildStatusMap, type ResolvedStatus } from '~/utils/workflow-status';
import { staffFetch } from './api/useStaffSessionFetch';
import { applicationListFormLabels, applicationListRows } from '../utils/application-list-rows';

function invalidCursor(error: unknown): boolean {
    const data = (error as { data?: { code?: string, data?: { code?: string } } } | null)?.data;
    return (data?.data?.code ?? data?.code) === 'pagination.cursor_invalid';
}

export function useUnreadApplications(options: {
    ready: Ref<boolean>
    active: Ref<boolean>
    scope: Ref<string>
    query: Ref<Record<string, string>>
    hasListedMessage: Ref<boolean>
    formId?: Ref<string | undefined>
}) {
    const { ready, active, scope, query, hasListedMessage, formId } = options;
    const availableScope = ref<string>();
    const available = computed(() => hasListedMessage.value || availableScope.value === scope.value);
    const rows = shallowRef<ApplicationRow[]>([]);
    const statuses = shallowRef(new Map<string, ResolvedStatus>());
    const labels = shallowRef<Record<string, string>>({});
    const nextCursor = ref<string>();
    const loading = ref(false);
    const failed = ref(false);
    let resultRequest: AbortController | undefined;

    async function seek(
        baseQuery: Record<string, string>,
        limit: number,
        signal: AbortSignal,
        after?: string,
        includeSubmittedData = false,
        onRestart?: () => void
    ) {
        let cursor = after;
        let restarted = false;
        for (;;) {
            let response;
            try {
                response = await staffFetch<AdminApplicationsResponse>('/api/admin/applications', {
                    query: {
                        ...baseQuery,
                        unreadMessages: 'true',
                        limit,
                        ...(cursor !== undefined && { after: cursor }),
                        ...(includeSubmittedData && { include: 'submittedData' })
                    },
                    retry: 0,
                    signal
                });
            } catch (error) {
                if (signal.aborted || !cursor || restarted || !invalidCursor(error)) throw error;
                restarted = true;
                cursor = undefined;
                onRestart?.();
                continue;
            }
            const page = response.meta?.page;
            if (!page || (page.hasMore && (!page.nextCursor || page.nextCursor === cursor))) {
                throw new Error('Unread message pagination is missing a continuation');
            }
            cursor = page.hasMore ? page.nextCursor : undefined;
            if (signal.aborted || response.data.length || !cursor) return { response, cursor };
        }
    }

    function clearResults() {
        rows.value = [];
        statuses.value = new Map();
        labels.value = {};
        nextCursor.value = undefined;
    }

    async function loadMore() {
        if (!ready.value || !active.value || loading.value) return;
        const request = new AbortController();
        resultRequest = request;
        const lookupScope = scope.value;
        const baseQuery = query.value;
        const includeSubmittedData = Boolean(formId?.value);
        loading.value = true;
        failed.value = false;

        try {
            const result = await seek(baseQuery, 25, request.signal, nextCursor.value, includeSubmittedData, clearResults);
            if (request.signal.aborted || scope.value !== lookupScope || !ready.value || !active.value) return;
            const { response, cursor } = result;
            const mergedRows = new Map(rows.value.map(row => [row.id, row]));
            for (const row of applicationListRows(response, formId?.value)) mergedRows.set(row.id, row);
            rows.value = [...mergedRows.values()];
            statuses.value = new Map([...statuses.value, ...buildStatusMap(response.included as Parameters<typeof buildStatusMap>[0])]);
            labels.value = { ...labels.value, ...applicationListFormLabels(response.included) };
            nextCursor.value = cursor;
        } catch {
            if (!request.signal.aborted) failed.value = true;
        } finally {
            if (resultRequest === request) {
                loading.value = false;
                resultRequest = undefined;
            }
        }
    }

    watch([ready, active, scope], () => {
        resultRequest?.abort();
        loading.value = false;
        failed.value = false;
        clearResults();
        void loadMore();
    }, { immediate: true, flush: 'sync' });

    watch([ready, active, scope, hasListedMessage], async ([isReady, isActive, lookupScope, listed], _previous, onCleanup) => {
        if (!isReady || isActive || listed) return;
        const request = new AbortController();
        onCleanup(() => request.abort());
        try {
            const result = await seek(query.value, 1, request.signal);
            if (request.signal.aborted) return;
            if (result.response.data.length) availableScope.value = lookupScope;
            else if (availableScope.value === lookupScope) availableScope.value = undefined;
        } catch {
            // The regular list remains usable if the optional probe fails.
        }
    }, { immediate: true });

    onScopeDispose(() => resultRequest?.abort());
    return { available, rows, statuses, labels, loading, failed, nextCursor, loadMore };
}
