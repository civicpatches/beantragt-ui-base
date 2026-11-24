import { computed, ref, watch } from 'vue';
import type { Ref } from 'vue';
import type { AdminApplicationDetailResponse, AdminApplicationEvents, AdminApplicationSinceSeenKind } from '~/types';

/** Count refreshes never claim that a section has rendered their versions. */
export function useAdminApplicationEvents(workspaceKey: Ref<string | null | undefined>) {
    let generation = 0;
    let acknowledgement = 0;
    const entryEvents = ref<AdminApplicationEvents | null>(null);
    const latestEvents = ref<AdminApplicationEvents | null>(null);
    const renderedEvents = ref<AdminApplicationEvents | null>(null);
    const targetEvents = computed(() => renderedEvents.value
        ? {
            ...renderedEvents.value,
            newEventIds: { ...renderedEvents.value.newEventIds, transfer: latestEvents.value?.newEventIds?.transfer ?? [], release: latestEvents.value?.newEventIds?.release ?? [] }
        }
        : null);
    const sectionCounts = computed(() => {
        const counts = { ...entryEvents.value?.counts };
        for (const kind of ['transfer', 'release'] as const) {
            Reflect.deleteProperty(counts, kind);
            if (latestEvents.value?.counts[kind]) counts[kind] = latestEvents.value.counts[kind];
        }
        return counts;
    });
    const eventCounts = computed(() => ({ ...latestEvents.value?.counts }));
    watch(workspaceKey, () => {
        generation += 1;
        acknowledgement = 0;
        entryEvents.value = null;
        latestEvents.value = null;
        renderedEvents.value = null;
    }, { flush: 'sync' });
    function receive(response: Pick<AdminApplicationDetailResponse, 'meta'> | null | undefined, requestGeneration = generation, requestAcknowledgement = acknowledgement) {
        if (requestGeneration !== generation || requestAcknowledgement !== acknowledgement) return false;
        const incoming = response?.meta?.events;
        latestEvents.value = incoming ?? null;
        if (incoming && !entryEvents.value) {
            entryEvents.value = JSON.parse(JSON.stringify(incoming)) as AdminApplicationEvents;
            renderedEvents.value = JSON.parse(JSON.stringify(incoming)) as AdminApplicationEvents;
        }
        return true;
    }
    /** Capture BEFORE loading a section; commit only after that exact load succeeds. */
    function beginSectionLoad(kind: AdminApplicationSinceSeenKind) {
        const requestGeneration = generation;
        const snapshot = latestEvents.value ? JSON.parse(JSON.stringify(latestEvents.value)) as AdminApplicationEvents : null;
        return () => {
            if (requestGeneration !== generation || !snapshot || !entryEvents.value) return;
            if (renderedEvents.value) renderedEvents.value = {
                ...renderedEvents.value,
                newEventIds: { ...renderedEvents.value.newEventIds, [kind]: snapshot.newEventIds?.[kind] ?? (kind === 'message' ? snapshot.newMessageIds : []) },
                newMessageIds: kind === 'message' ? snapshot.newMessageIds : renderedEvents.value.newMessageIds,
                seenTokens: { ...renderedEvents.value.seenTokens, [kind]: snapshot.seenTokens?.[kind] ?? [] }
            };
            const previous = entryEvents.value;
            entryEvents.value = {
                ...previous,
                counts: { ...previous.counts, [kind]: snapshot.counts[kind] ?? 0 },
                newEventIds: { ...previous.newEventIds, [kind]: [...new Set([...(previous.newEventIds?.[kind] ?? []), ...(snapshot.newEventIds?.[kind] ?? [])])] },
                seenTokens: { ...previous.seenTokens, [kind]: snapshot.seenTokens?.[kind] ?? [] },
                newMessageIds: kind === 'message' ? [...new Set([...previous.newMessageIds, ...snapshot.newMessageIds])] : previous.newMessageIds
            };
        };
    }
    function markSeen(kind: AdminApplicationSinceSeenKind, requestGeneration = generation, response?: Pick<AdminApplicationDetailResponse, 'meta'>, postedTokens: string[] = entryEvents.value?.seenTokens?.[kind] ?? []) {
        if (generation !== requestGeneration) return;
        acknowledgement += 1;
        const incoming = response?.meta?.events;
        const current = latestEvents.value;
        if (!current) return;
        // The POST returns its pre-write snapshot. Remove exactly the accepted
        // versions, keeping arrivals the user has not rendered/acknowledged.
        const accepted = new Set(postedTokens);
        const responseTokens = incoming?.seenTokens?.[kind];
        const responseIds = incoming?.newEventIds?.[kind] ?? (kind === 'message' ? incoming?.newMessageIds : undefined);
        const remaining = responseTokens?.filter(token => !accepted.has(token));
        const remainingIds = responseIds?.filter((_id, index) => !accepted.has(responseTokens?.[index] ?? ''));
        const count = remaining?.length ?? Math.max(0, (incoming?.counts[kind] ?? current.counts[kind] ?? 0) - postedTokens.length);
        const counts = { ...current.counts };
        if (count) counts[kind] = count;
        else Reflect.deleteProperty(counts, kind);
        latestEvents.value = {
            ...current, counts,
            ...(incoming
                ? {
                    newMessageIds: kind === 'message' ? remainingIds ?? [] : current.newMessageIds,
                    newEventIds: { ...current.newEventIds, [kind]: remainingIds ?? [] },
                    seenTokens: { ...current.seenTokens, [kind]: remaining ?? [] }
                }
                : {})
        };
    }
    return { entryEvents, targetEvents, eventCounts, sectionCounts, receive, markSeen, beginSectionLoad, requestGeneration: () => generation, requestAcknowledgement: () => acknowledgement };
}
