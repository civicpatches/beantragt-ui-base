import { nextTick, onBeforeUnmount, onMounted, ref, type Ref } from 'vue';

export function useCaseLayoutMedia(query: string) {
    const matches = ref(false);
    let media: MediaQueryList | undefined;
    const update = () => {
        matches.value = media?.matches ?? false;
    };
    onMounted(() => {
        media = window.matchMedia(query);
        update();
        media.addEventListener('change', update);
    });
    onBeforeUnmount(() => media?.removeEventListener('change', update));
    return matches;
}

export function useCaseLayoutResize(root: Ref<HTMLElement | null>, callback: ResizeObserverCallback, selector?: string) {
    let observer: ResizeObserver | undefined;
    onMounted(async () => {
        await nextTick();
        observer = new ResizeObserver(callback);
        if (root.value) {
            observer.observe(root.value);
            const child = selector && root.value.querySelector(selector);
            if (child) observer.observe(child);
        }
    });
    onBeforeUnmount(() => observer?.disconnect());
}
