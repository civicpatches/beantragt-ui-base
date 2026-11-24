<script setup lang="ts">
import { useCaseLayoutMedia, useCaseLayoutResize } from '../../composables/useCaseLayoutViewport';
import { ref, computed, useTemplateRef, useId, nextTick, watch, onMounted } from 'vue';

const props = defineProps<{ leftSize: number }>();
const emit = defineEmits<{ resizeEnd: [size: number] }>();
const { t } = useI18n();
const root = ref<HTMLElement | null>(null);
const splitter = useTemplateRef('splitter');
const isDesktop = useCaseLayoutMedia('(min-width: 1024px)');
const containerWidth = ref(0);
const handleWidth = ref(8);
const ready = ref(false);
const instanceId = `case-split-${useId()}`;
const labelId = `${instanceId}-resize-label`;

// The dashboard navigation also consumes viewport width. Limit against the
// actual form width, reserving the default 8px handle, not the viewport.
const minSize = computed(() => containerWidth.value > 0
    ? Math.min(50, Math.max(30, 280 / Math.max(1, containerWidth.value - handleWidth.value) * 100))
    : 30);
const items = computed(() => [
    { id: `${instanceId}-content`, slot: 'left', defaultSize: 66.67, minSize: minSize.value, maxSize: 100 - minSize.value },
    { id: `${instanceId}-actions`, slot: 'right', defaultSize: 33.33, minSize: minSize.value, maxSize: 100 - minSize.value }
]);

async function applySize() {
    if (!isDesktop.value || containerWidth.value <= 0) return;
    await nextTick();
    const panel = splitter.value?.panelsRef[0];
    if (!panel) return;
    panel.resize(Math.max(minSize.value, Math.min(100 - minSize.value, props.leftSize)));
    ready.value = true;
}

function saveSize() {
    if (!isDesktop.value || !ready.value) return;
    const size = splitter.value?.panelsRef[0]?.getSize();
    if (typeof size === 'number' && Number.isFinite(size)) emit('resizeEnd', size);
}

function onDragging(_index: number, dragging: boolean) {
    if (!dragging) saveSize();
}

function onKeyup(event: KeyboardEvent) {
    if (!(event.target instanceof HTMLElement) || !event.target.hasAttribute('data-resize-handle')) return;
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) saveSize();
}

function labelHandle() {
    // Nuxt UI 4.11 does not yet forward attributes to its resize handle.
    const handle = root.value?.querySelector<HTMLElement>('[data-resize-handle]');
    if (handle) handle.hidden = !isDesktop.value;
    handle?.setAttribute('aria-labelledby', labelId);
    handle?.setAttribute('aria-orientation', 'vertical');
    handle?.setAttribute('aria-disabled', String(!isDesktop.value));
    handle?.setAttribute('tabindex', isDesktop.value ? '0' : '-1');
}

useCaseLayoutResize(root, ([entry]) => {
    if (!entry || entry.contentRect.width === containerWidth.value) return;
    handleWidth.value = root.value?.querySelector<HTMLElement>('[data-resize-handle]')?.offsetWidth || 8;
    containerWidth.value = entry.contentRect.width;
    void applySize();
});
watch(() => props.leftSize, applySize, { flush: 'post' });
watch(isDesktop, () => {
    labelHandle();
    void applySize();
}, { flush: 'post' });
onMounted(labelHandle);
</script>

<template>
  <div
    ref="root"
    class="case-split-split-layout min-w-0"
    @keyup="onKeyup"
  >
    <span
      :id="labelId"
      class="sr-only"
    >{{ t('admin.caseLayout.resize') }}</span>
    <USplitter
      :id="instanceId"
      ref="splitter"
      :items="items"
      :disabled="!isDesktop"
      :keyboard-resize-by="1"
      :ui="{ root: 'case-split-splitter min-w-0', panel: 'case-split-splitter-panel block min-w-0' }"
      @dragging="onDragging"
    >
      <template #left>
        <slot name="left" />
      </template>
      <template #right>
        <slot name="right" />
      </template>
    </USplitter>
  </div>
</template>

<style scoped>
/* Reka's default overflow:hidden creates a scroll container and breaks the
   existing sticky actions column. The form remains part of the page scroll. */
.case-split-split-layout :deep(.case-split-splitter),
.case-split-split-layout :deep(.case-split-splitter-panel) {
  overflow: visible !important;
}

.case-split-split-layout :deep(.case-split-splitter) {
  height: auto !important;
}

@media (max-width: 1023px) {
  .case-split-split-layout :deep(.case-split-splitter) {
    flex-direction: column !important;
    gap: 1.5rem;
  }

  .case-split-split-layout :deep(.case-split-splitter-panel) {
    flex: none !important;
    width: 100%;
  }
}
</style>
