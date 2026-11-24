import { inject, provide } from 'vue';
import type { ComputedRef, InjectionKey, Ref } from 'vue';
import type { AdminApplicationEventCounts, AdminApplicationEvents, AdminApplicationSinceSeenKind } from '~/types';

export interface ApplicationEventContext {
    counts: ComputedRef<AdminApplicationEventCounts>
    snapshot: Ref<AdminApplicationEvents | null>
    targets?: Ref<AdminApplicationEvents | null>
    refresh: () => Promise<void>
    beginSectionLoad?: (kind: AdminApplicationSinceSeenKind) => () => void
}
export const APPLICATION_EVENT_CONTEXT: InjectionKey<ApplicationEventContext> = Symbol('application-events');
export function provideApplicationEvents(context: ApplicationEventContext) {
    provide(APPLICATION_EVENT_CONTEXT, context);
}
export function useApplicationEvents() {
    const context = inject(APPLICATION_EVENT_CONTEXT, null);
    function isNew(kind: AdminApplicationSinceSeenKind, id: string) {
        const snapshot = context?.snapshot.value;
        const ids = kind === 'message' ? snapshot?.newMessageIds : snapshot?.newEventIds?.[kind];
        return ids?.includes(id) ?? false;
    }
    const eventIds = (kind: AdminApplicationSinceSeenKind) => (context?.targets ?? context?.snapshot)?.value?.newEventIds?.[kind] ?? [];
    return { eventIds, beginSectionLoad: (kind: AdminApplicationSinceSeenKind) => context?.beginSectionLoad?.(kind) ?? (() => {}), refreshEvents: () => context?.refresh(), count: (kind: keyof AdminApplicationEventCounts) => context?.counts.value[kind] ?? 0, isNew };
}
