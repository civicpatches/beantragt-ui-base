import { computed, onMounted, onScopeDispose, ref, shallowRef, watch } from 'vue';
import type { Ref } from 'vue';
import type { AdminApplicationEventCounts, AdminApplicationEventKind, AdminApplicationEvents } from '~/types';
import { APPLICATION_EVENTS, flashEventTarget, registeredApplicationEvents } from '~/utils/application-events';

interface Target {
    kind: AdminApplicationEventKind
    id: string
    element: HTMLElement
    visible: boolean
}
interface Options {
    root: Ref<HTMLElement | null>
    counts: Ref<AdminApplicationEventCounts>
    snapshot: Ref<AdminApplicationEvents | null>
    scope: Ref<string | null | undefined>
    acknowledge: (kind: AdminApplicationEventKind, id: string) => Promise<boolean>
}
const stateKind = (kind: AdminApplicationEventKind) => kind === 'transfer' || kind === 'release' || kind === 'scan';

/** One registry for exact event elements, visibility, focus and per-element reading receipts. */
export function useApplicationEventTargets(options: Options) {
    const targets = shallowRef<Target[]>([]);
    const seen = ref(new Set<string>());
    const cursor = ref<Partial<Record<AdminApplicationEventKind, string>>>({});
    const failed = new Set<string>();
    const reading = ref(new Set<string>());
    const timers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();
    let interacted = false;
    let generation = 0;
    let observer: IntersectionObserver | undefined;
    let mutations: MutationObserver | undefined;
    let scrollRoot: HTMLElement | null = null;
    let frame = 0;
    function ids(kind: AdminApplicationEventKind) {
        return options.snapshot.value?.newEventIds?.[kind] ?? (kind === 'message' ? options.snapshot.value?.newMessageIds : []) ?? [];
    }
    function key(target: Pick<Target, 'kind' | 'id'>) {
        const index = ids(target.kind).indexOf(target.id);
        const token = stateKind(target.kind) ? '' : options.snapshot.value?.seenTokens?.[target.kind]?.[index] ?? '';
        return `${target.kind}:${target.id}:${token}`;
    }
    function eligible(target: Target) {
        return registeredApplicationEvents().some(event => event.kind === target.kind) && Boolean(options.counts.value[target.kind]) && ids(target.kind).includes(target.id) && !seen.value.has(key(target));
    }
    function bounds() {
        const rect = scrollRoot?.getBoundingClientRect();
        return { top: Math.max(0, rect?.top ?? 0), bottom: Math.min(window.innerHeight, rect?.bottom ?? window.innerHeight) };
    }
    function next(kind: AdminApplicationEventKind) {
        const candidates = targets.value.filter(target => target.kind === kind && eligible(target));
        const outside = candidates.filter(target => !target.visible);
        const ordered = (outside.length ? outside : candidates).sort((a, b) => a.element.getBoundingClientRect().top - b.element.getBoundingClientRect().top);
        const last = stateKind(kind) ? cursor.value[kind] : undefined;
        if (last && ordered.length > 1) {
            const current = ordered.findIndex(target => target.id === last);
            if (current >= 0) return ordered[(current + 1) % ordered.length];
        }
        return ordered.find(target => target.element.getBoundingClientRect().top >= bounds().top) ?? ordered[0];
    }
    const items = computed(() => registeredApplicationEvents().flatMap((event) => {
        const count = options.counts.value[event.kind] ?? 0;
        if (!count) return [];
        const candidates = targets.value.filter(target => target.kind === event.kind && eligible(target));
        // A pending section load still has a pill. A fully read kind does not.
        if (!candidates.length && ids(event.kind).length && ids(event.kind).every(id => seen.value.has(key({ kind: event.kind, id }))) && [...reading.value].some(version => version.startsWith(`${event.kind}:`))) return [];
        return [{ ...event, count: candidates.length || count }];
    }));
    function clearTimer(element: HTMLElement) {
        clearTimeout(timers.get(element));
        timers.delete(element);
    }
    async function read(target: Target) {
        if (stateKind(target.kind) || !eligible(target)) return;
        clearTimer(target.element);
        const version = key(target);
        const requestGeneration = generation;
        seen.value = new Set([...seen.value, version]);
        reading.value = new Set([...reading.value, version]);
        if (!await options.acknowledge(target.kind, target.id) && requestGeneration === generation) {
            failed.add(version);
            seen.value = new Set([...seen.value].filter(value => value !== version));
        }
        if (requestGeneration === generation) reading.value = new Set([...reading.value].filter(value => value !== version));
    }
    function schedule(target: Target) {
        clearTimer(target.element);
        if (!interacted || document.hidden || !target.visible || !eligible(target) || stateKind(target.kind) || failed.has(key(target))) return;
        const version = key(target);
        timers.set(target.element, setTimeout(() => {
            timers.delete(target.element);
            if (target.visible && target.element.isConnected && !document.hidden && key(target) === version) void read(target);
        }, 1000));
    }
    function scan() {
        if (!options.root.value || !observer) return;
        const previous = new Map(targets.value.map(target => [target.element, target]));
        const found: Target[] = [];
        for (const element of options.root.value.querySelectorAll<HTMLElement>('[data-event-target]')) {
            if (element.closest('[data-event-ready="false"]')) continue;
            const value = element.dataset.eventTarget ?? '';
            const split = value.indexOf(':');
            const kind = value.slice(0, split) as AdminApplicationEventKind;
            const id = value.slice(split + 1);
            if (split < 1 || !APPLICATION_EVENTS.some(event => event.kind === kind) || !id) continue;
            const existing = previous.get(element);
            const target = existing?.id === id && existing.kind === kind ? existing : { element, kind, id, visible: false };
            found.push(target);
            if (target !== existing) {
                clearTimer(element);
                observer.unobserve(element);
                observer.observe(element);
            }
            previous.delete(element);
        }
        for (const target of previous.values()) {
            clearTimer(target.element);
            observer.unobserve(target.element);
        }
        if (found.length !== targets.value.length || found.some((target, index) => target !== targets.value[index])) targets.value = found;
    }
    function onInteraction() {
        interacted = true;
        failed.clear();
        for (const target of targets.value) if (!timers.has(target.element)) schedule(target);
    }
    function updateGeometry() {
        const viewport = bounds();
        let changed = false;
        for (const target of targets.value) {
            const rect = target.element.getBoundingClientRect();
            let top = Math.max(rect.top, viewport.top);
            let bottom = Math.min(rect.bottom, viewport.bottom);
            for (let parent = target.element.parentElement; parent && parent !== scrollRoot; parent = parent.parentElement) {
                if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(parent).overflowY)) {
                    const clip = parent.getBoundingClientRect();
                    top = Math.max(top, clip.top);
                    bottom = Math.min(bottom, clip.bottom);
                }
            }
            const visible = rect.width > 0 && rect.height > 0 && bottom - top >= Math.min(48, rect.height);
            if (visible !== target.visible) {
                changed = true;
                target.visible = visible;
                schedule(target);
            }
        }
        if (changed) targets.value = [...targets.value];
    }
    function onScroll() {
        if (!frame) frame = requestAnimationFrame(() => {
            frame = 0;
            updateGeometry();
        });
    }
    function onVisibility() {
        if (!document.hidden) updateGeometry();
        for (const target of targets.value) schedule(target);
    }
    function focus(kind: AdminApplicationEventKind) {
        scan();
        const target = next(kind);
        if (!target) return false;
        interacted = true;
        cursor.value = { ...cursor.value, [kind]: target.id };
        target.element.setAttribute('tabindex', '-1');
        target.element.focus({ preventScroll: true });
        // Scroll only as far as needed, so the case header stays in view when it can.
        target.element.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
        flashEventTarget(target.element);
        // Clicking a pill is an explicit read of this element only.
        void read(target);
        return true;
    }
    watch(options.scope, () => {
        generation++;
        interacted = false;
        seen.value = new Set();
        reading.value = new Set();
        cursor.value = {};
        failed.clear();
        for (const target of targets.value) {
            clearTimer(target.element);
            target.visible = false;
        }
        observer?.disconnect();
        targets.value = [];
        scan();
    }, { flush: 'post' });
    watch(options.snapshot, () => {
        scan();
        for (const target of targets.value) schedule(target);
    }, { flush: 'post' });
    onMounted(() => {
        let parent = options.root.value?.parentElement;
        while (parent) {
            if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) {
                scrollRoot = parent;
                break;
            }
            parent = parent.parentElement;
        }
        observer = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                const target = targets.value.find(target => target.element === entry.target);
                if (!target) continue;
                target.visible = entry.isIntersecting && entry.intersectionRect.height >= Math.min(48, entry.boundingClientRect.height);
                schedule(target);
            }
            targets.value = [...targets.value];
        }, { root: scrollRoot, threshold: [0, 0.1, 0.5, 1] });
        mutations = new MutationObserver(() => {
            scan();
            onScroll();
        });
        if (options.root.value) mutations.observe(options.root.value, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-event-target', 'data-event-ready'] });
        scan();
        onScroll();
        window.addEventListener('resize', onScroll);
        for (const type of ['wheel', 'touchmove', 'keydown', 'pointerdown', 'click']) document.addEventListener(type, onInteraction, { capture: true, passive: true });
        document.addEventListener('scroll', onScroll, { capture: true, passive: true });
        document.addEventListener('visibilitychange', onVisibility);
    });
    onScopeDispose(() => {
        generation++;
        observer?.disconnect();
        mutations?.disconnect();
        cancelAnimationFrame(frame);
        for (const target of targets.value) clearTimer(target.element);
        for (const type of ['wheel', 'touchmove', 'keydown', 'pointerdown', 'click']) document.removeEventListener(type, onInteraction, true);
        document.removeEventListener('scroll', onScroll, true);
        window.removeEventListener('resize', onScroll);
        document.removeEventListener('visibilitychange', onVisibility);
    });
    return { items, focus };
}
