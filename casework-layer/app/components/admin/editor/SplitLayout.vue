<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, ref, useId, useTemplateRef, watch } from 'vue';

const props = defineProps<{ wide: boolean, account?: number, workspace?: string | null }>();
const { t } = useI18n();
const id = `editor-split-${useId()}`;
const frame = useTemplateRef('frame');
const splitter = useTemplateRef('splitter');
// Panel percentages share the editor body after the navigation and the default 8 px handle.
const inspectorMin = 384;
const canvasMin = 400;
const room = ref(1024);
const inspectorMax = computed(() => Math.max(inspectorMin, Math.min(640, room.value - canvasMin)));
const preferred = ref(inspectorMin);
function bounded(width: number) {
    return Math.min(inspectorMax.value, Math.max(inspectorMin, width));
}
const share = (width: number) => 100 * width / room.value;
// Keep both panels mounted when the split changes direction.
const items = computed(() => {
    const canvas = { id: `${id}-canvas`, slot: 'canvas', minSize: props.wide ? 100 - share(inspectorMax.value) : 0 };
    if (!props.wide) return [
        { ...canvas, minSize: 30 },
        { id: `${id}-inspector`, slot: 'inspector', minSize: 15, maxSize: 70, defaultSize: 30 }
    ];
    return [canvas, {
        id: `${id}-inspector`,
        slot: 'inspector',
        minSize: share(inspectorMin),
        maxSize: share(inspectorMax.value),
        defaultSize: share(bounded(preferred.value))
    }];
});

const storageKey = computed(() => props.account && props.workspace ? `editor-width:${props.account}:${props.workspace}` : null);
function restorePreference() {
    let width = inspectorMin;
    try {
        const stored = storageKey.value ? localStorage.getItem(storageKey.value) : null;
        if (stored?.trim() && Number.isFinite(Number(stored))) width = Number(stored);
    } catch {
        // The editor remains resizable when browser storage is unavailable.
    }
    preferred.value = Math.max(inspectorMin, Math.min(640, width));
}

function savePreference(reset = false) {
    if (!props.wide) {
        if (reset) splitter.value?.panelsRef[1]?.resize(30);
        return;
    }
    const size = splitter.value?.panelsRef[1]?.getSize();
    if (typeof size !== 'number' || !Number.isFinite(size)) return;
    preferred.value = reset ? inspectorMin : bounded(Math.round(room.value * size / 100));
    if (reset) splitter.value?.panelsRef[1]?.resize(share(inspectorMin));
    if (!storageKey.value) return;
    try {
        if (reset) localStorage.removeItem(storageKey.value);
        else localStorage.setItem(storageKey.value, String(preferred.value));
    } catch {
        // The preference still applies for this session.
    }
}

function onHandleKeyup(event: KeyboardEvent) {
    if (event.target instanceof HTMLElement && event.target.hasAttribute('data-resize-handle')
      && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) savePreference();
}

function applyPreference() {
    const panel = splitter.value?.panelsRef[1];
    if (!panel) return;
    panel.resize(props.wide ? share(bounded(preferred.value)) : 30);
    // Nuxt UI 4.11 exposes the handle's content but no attributes for its separator.
    const handle = frame.value?.querySelector('[data-resize-handle]');
    handle?.setAttribute('aria-labelledby', `${id}-label`);
    handle?.setAttribute('aria-orientation', props.wide ? 'vertical' : 'horizontal');
}

defineExpose({ resetWidth: () => savePreference(true) });

let observer: ResizeObserver | undefined;
onMounted(() => {
    function measure() {
        const width = frame.value?.clientWidth;
        const handleWidth = frame.value?.querySelector<HTMLElement>('[data-resize-handle]')?.offsetWidth || 8;
        if (width) room.value = Math.max(inspectorMin + canvasMin, width - handleWidth);
    }
    measure();
    if (frame.value && typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(measure);
        observer.observe(frame.value);
    }
});
onBeforeUnmount(() => observer?.disconnect());
watch(storageKey, restorePreference, { immediate: true });
watch([splitter, () => props.wide ? room.value : 0, storageKey, () => props.wide], () => void nextTick(applyPreference), { flush: 'post' });
</script>

<template>
  <div
    ref="frame"
    class="flex min-h-0 min-w-0 flex-1"
    @keyup="onHandleKeyup"
  >
    <span
      :id="`${id}-label`"
      class="sr-only"
    >{{ t(wide ? 'admin.forms.editorHead.resize' : 'admin.forms.editorHead.resizeHeight') }}</span>
    <USplitter
      :id="id"
      ref="splitter"
      :items="items"
      :orientation="wide ? 'horizontal' : 'vertical'"
      :keyboard-resize-by="1"
      :ui="{ root: 'min-h-0 min-w-0 flex-1', panel: 'min-h-0 min-w-0 flex-col' }"
      @dragging="(_index, dragging) => { if (!dragging) savePreference(); }"
    >
      <template #canvas>
        <slot />
      </template>
      <template #inspector>
        <slot name="inspector" />
      </template>
    </USplitter>
  </div>
</template>
