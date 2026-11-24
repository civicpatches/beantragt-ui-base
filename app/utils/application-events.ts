import { shallowRef } from 'vue';
import type { AdminApplicationEventCounts, AdminApplicationEventKind, AdminApplicationEvents } from '~/types/admin';

export const APPLICATION_MESSAGE_COMPOSER = 'application-message-composer';

/** Shared order and targets keep the list and the detail header consistent. */
export const APPLICATION_EVENTS: ReadonlyArray<{ kind: AdminApplicationEventKind, icon: string, sectionId: string, color: 'error' | 'warning' | 'neutral' }> = [
    { kind: 'transfer', color: 'error', icon: 'i-lucide-send', sectionId: 'application-transfers' },
    { kind: 'scan', color: 'warning', icon: 'i-lucide-scan-search', sectionId: 'application-attachments' },
    { kind: 'release', color: 'warning', icon: 'i-lucide-stamp', sectionId: 'docgen-panel' },
    { kind: 'message', color: 'neutral', icon: 'i-lucide-message-circle', sectionId: 'application-messages' },
    { kind: 'documents', color: 'neutral', icon: 'i-lucide-paperclip', sectionId: 'application-nachreichung' },
    { kind: 'reply', color: 'neutral', icon: 'i-lucide-reply', sectionId: 'application-responses' },
    { kind: 'assigned', color: 'neutral', icon: 'i-lucide-user-plus', sectionId: 'application-assignment' }
];

/** Layers register only kinds for which they provide a reachable section. */
const kindRegistrations = shallowRef<ReadonlyArray<readonly AdminApplicationEventKind[]>>([]);
export function registerApplicationEventKinds(kinds: readonly AdminApplicationEventKind[]): () => void {
    kindRegistrations.value = [...kindRegistrations.value, kinds];
    return () => {
        kindRegistrations.value = kindRegistrations.value.filter(entry => entry !== kinds);
    };
}
export function registeredApplicationEvents() {
    const kinds = new Set(kindRegistrations.value.flat());
    return APPLICATION_EVENTS.filter(event => kinds.has(event.kind));
}

/** A proxy accepts only known kinds with positive integral counts. */
export function normalizeApplicationEvents(value: unknown): AdminApplicationEventCounts {
    const result: AdminApplicationEventCounts = {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
    for (const { kind } of APPLICATION_EVENTS) {
        const count = (value as Record<string, unknown>)[kind];
        if (typeof count === 'number' && Number.isSafeInteger(count) && count > 0) result[kind] = count;
    }
    return result;
}

export function applicationEventItems(counts?: AdminApplicationEventCounts | null) {
    const normalized = normalizeApplicationEvents(counts);
    return registeredApplicationEvents().flatMap(event => normalized[event.kind] ? [{ ...event, count: normalized[event.kind]! }] : []);
}

/** The server snapshot identifies messages to label Neu during this visit. */
export function isNewApplicantMessage(
    comment: { uuid?: string, authorRole: string, visibility?: string },
    snapshot?: AdminApplicationEvents | null
): boolean {
    return comment.authorRole === 'citizen'
      && comment.visibility === 'public'
      && Boolean(comment.uuid && snapshot?.newMessageIds.includes(comment.uuid));
}

/** Bound and project a detail snapshot before it reaches browser state. */
export function normalizeApplicationEventSnapshot(value: unknown): AdminApplicationEvents | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const source = value as Record<string, unknown>;
    const result: AdminApplicationEvents = {
        counts: normalizeApplicationEvents(source.counts), previousSeenAt: {}, seenAt: {},
        newMessageIds: [], ...(source.newEventIds ? { newEventIds: {} } : {}), ...(source.seenTokens ? { seenTokens: {} } : {})
    };
    const record = (candidate: unknown): Record<string, unknown> => candidate && typeof candidate === 'object' && !Array.isArray(candidate) ? candidate as Record<string, unknown> : {};
    const boundedStrings = (candidate: unknown, expression: RegExp): string[] => Array.isArray(candidate)
        ? [...new Set(candidate.slice(0, 10000).filter((id): id is string => typeof id === 'string' && expression.test(id)))]
        : [];
    const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
    result.newMessageIds = boundedStrings(source.newMessageIds, uuid);
    for (const { kind } of APPLICATION_EVENTS) {
        const ids = record(source.newEventIds)[kind];
        if (result.newEventIds && ids !== undefined) result.newEventIds[kind] = boundedStrings(ids, kind === 'assigned' ? /^assignment:[a-f0-9]{64}$/ : uuid);
        if (kind === 'transfer' || kind === 'release') continue;
        for (const field of ['previousSeenAt', 'seenAt'] as const) {
            const time = record(source[field])[kind];
            if (time === null || (typeof time === 'number' && Number.isSafeInteger(time) && time >= 0)) result[field][kind] = time;
        }
        const tokens = record(source.seenTokens)[kind];
        if (result.seenTokens && tokens !== undefined) {
            const targetIds = ids ?? (kind === 'message' ? source.newMessageIds : undefined);
            if (Array.isArray(targetIds) && Array.isArray(tokens)) {
                // Exact-element receipts rely on this positional pairing. Never
                // compact either side independently after dropping invalid data.
                const validIds: string[] = [];
                const validTokens: string[] = [];
                const seenIds = new Set<string>();
                const seenTokens = new Set<string>();
                const idPattern = kind === 'assigned' ? /^assignment:[a-f0-9]{64}$/ : uuid;
                for (let index = 0; index < Math.min(targetIds.length, tokens.length, 10000); index++) {
                    const id = targetIds[index];
                    const token = tokens[index];
                    if (typeof id !== 'string' || !idPattern.test(id) || typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) continue;
                    if (seenIds.has(id) || seenTokens.has(token)) continue;
                    seenIds.add(id);
                    seenTokens.add(token);
                    validIds.push(id);
                    validTokens.push(token);
                }
                if (result.newEventIds && ids !== undefined) result.newEventIds[kind] = validIds;
                if (kind === 'message') result.newMessageIds = validIds;
                result.seenTokens[kind] = validTokens;
            } else {
                result.seenTokens[kind] = boundedStrings(tokens, /^[a-f0-9]{64}$/);
            }
        }
    }
    return result;
}

/** How long the ring after a jump from the application list stays, matching the CSS animation. */
export const EVENT_FLASH_MS = 2000;
const flashTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

/**
 * Marks the element a jump from the application list landed on. A programmatic focus after a
 * mouse click shows no focus ring, so `[data-event-flash]` draws one that fades out.
 */
export function flashEventTarget(element: HTMLElement) {
    clearTimeout(flashTimers.get(element));
    element.removeAttribute('data-event-flash');
    // Restart the animation when the same element is the target again.
    void element.offsetWidth;
    element.setAttribute('data-event-flash', '');
    flashTimers.set(element, setTimeout(() => {
        element.removeAttribute('data-event-flash');
        flashTimers.delete(element);
    }, EVENT_FLASH_MS));
}
