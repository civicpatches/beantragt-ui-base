<script setup lang="ts">
import Draggable from 'vuedraggable';
import { shallowReactive, ref, computed, watch, nextTick, useId, onMounted, onBeforeUnmount } from 'vue';
import { useCaseLayoutMedia, useCaseLayoutResize } from '../../composables/useCaseLayoutViewport';
import CaseSplitLayout from './CaseSplitLayout.vue';
import {
    CASE_SECTION_IDS, copyCaseLayout, defaultCaseLayout, isCaseLayout, moveCaseSection,
    type CaseColumn, type CaseSectionId, type CaseLayout
} from '../../utils/case-layout';

const props = withDefaults(defineProps<{
    layout: CaseLayout
    leftSize: number
    reorder?: boolean
    disabled?: boolean
    labels?: Partial<Record<CaseSectionId, string>>
    visibleSections?: readonly CaseSectionId[]
}>(), { reorder: false, disabled: false, labels: () => ({}), visibleSections: () => CASE_SECTION_IDS });
const emit = defineEmits<{
    'resizeEnd': [size: number]
    'update:layout': [layout: CaseLayout]
    'dragging': [active: boolean]
    'menuOpen': [open: boolean]
}>();
const { t } = useI18n();
const root = ref<HTMLElement | null>(null);
const isDesktop = useCaseLayoutMedia('(min-width: 1024px)');
const bodies = shallowReactive<Record<string, HTMLElement>>({});
const renderedSections = ref<CaseSectionId[]>([]);
let bodyObserver: MutationObserver | undefined;
let visibilityQueued = false;
function refreshVisibility() {
    if (visibilityQueued) return;
    visibilityQueued = true;
    void nextTick(() => {
        visibilityQueued = false;
        // Read only after Teleport has settled, never from its temporarily empty source host.
        if (moving.value) return;
        const rendered = CASE_SECTION_IDS.filter(id => (bodies[id]?.childElementCount ?? 0) > 0);
        if (rendered.join() !== renderedSections.value.join()) renderedSections.value = rendered;
    });
}
onMounted(() => {
    bodyObserver = new MutationObserver(refreshVisibility);
    Object.values(bodies).forEach(body => bodyObserver!.observe(body, { childList: true, subtree: true }));
    refreshVisibility();
});
onBeforeUnmount(() => bodyObserver?.disconnect());
const liveLayout = ref(copyCaseLayout(props.layout));
const moving = ref(false);
const reducedMotion = useCaseLayoutMedia('(prefers-reduced-motion: reduce)');
const rightFits = ref(false);
function measureRail() {
    const rail = root.value?.querySelector<HTMLElement>('[data-case-column="right"]');
    let height = window.innerHeight;
    for (let parent = root.value?.parentElement; parent; parent = parent.parentElement) {
        if (/(auto|scroll)/u.test(getComputedStyle(parent).overflowY)) {
            height = parent.clientHeight || height;
            break;
        }
    }
    rightFits.value = !!rail && rail.getBoundingClientRect().height <= height - 32;
}
useCaseLayoutResize(root, measureRail, '[data-case-column="right"]');
watch(() => props.layout, () => nextTick(measureRail), { flush: 'post' });
onMounted(() => window.addEventListener('resize', measureRail));
onBeforeUnmount(() => window.removeEventListener('resize', measureRail));
const announcement = ref('');
const activeMenu = ref<CaseSectionId | null>(null);
const keyboardHintId = `case-layout-help-${useId()}`;
let ignoreClickUntil = 0;
const dragGroup = `case-layout-${useId()}`;
const columnIds = ['left', 'right'] as const;
let beforeDrag = defaultCaseLayout();
const columns = { left: modelColumn('left'), right: modelColumn('right') };
const labelFor = (id: CaseSectionId) => props.labels[id] || id;
const shown = (id: CaseSectionId) => props.visibleSections.includes(id) && renderedSections.value.includes(id);
const visible = (column: CaseColumn) => liveLayout.value[column].filter(shown);

function modelColumn(column: CaseColumn) {
    return computed({
        get: () => liveLayout.value[column].filter(id => props.visibleSections.includes(id)),
        set: (ids: CaseSectionId[]) => {
            // Keep dormant layer IDs in saved layouts without rendering their hosts.
            const pending = [...ids];
            const ordered: CaseSectionId[] = [];
            for (const id of liveLayout.value[column]) {
                if (!props.visibleSections.includes(id)) ordered.push(id);
                else if (pending.length) ordered.push(pending.shift()!);
            }
            ordered.push(...pending);
            liveLayout.value = { ...liveLayout.value, [column]: ordered };
        }
    });
}

function setBody(id: CaseSectionId, element: unknown) {
    // Ignore the source host's null ref while a group crosses columns. The
    // detached old target keeps its field DOM alive until the new ref arrives.
    // A single, stable Teleport moves those same widgets into the new target.
    if (element instanceof HTMLElement && bodies[id] !== element) {
        bodies[id] = element;
        bodyObserver?.observe(element, { childList: true, subtree: true });
        refreshVisibility();
    }
}

function beginDrag() {
    activeMenu.value = null;
    beforeDrag = copyCaseLayout(liveLayout.value);
    moving.value = true;
    emit('dragging', true);
}

async function endDrag(event: { item?: HTMLElement }) {
    await nextTick();
    if (!isCaseLayout(liveLayout.value)) {
        liveLayout.value = beforeDrag;
        emit('update:layout', copyCaseLayout(beforeDrag));
    }
    emit('update:layout', copyCaseLayout(liveLayout.value));
    moving.value = false;
    refreshVisibility();
    ignoreClickUntil = Date.now() + 250;
    emit('dragging', false);
    const id = event.item?.dataset.caseSection as CaseSectionId | undefined;
    if (id) {
        announce(id);
        await nextTick();
        root.value?.querySelector<HTMLButtonElement>(`[data-section-control="${id}"]`)?.focus({ preventScroll: true });
    }
}

function announce(id: CaseSectionId) {
    const column = liveLayout.value.left.includes(id) ? 'left' : 'right';
    announcement.value = isDesktop.value
        ? `${labelFor(id)}: ${t(`admin.caseLayout.${column}`)}, ${visible(column).indexOf(id) + 1}`
        : `${labelFor(id)}: ${[...visible('left'), ...visible('right')].indexOf(id) + 1}`;
}

async function move(id: CaseSectionId, from: CaseColumn, direction: 'up' | 'down' | 'column') {
    if (!props.reorder || props.disabled || moving.value) return;
    activeMenu.value = null;
    let target: CaseColumn = direction === 'column' ? (from === 'left' ? 'right' : 'left') : from;
    const shown = isDesktop.value ? visible(from) : [...visible('left'), ...visible('right')];
    const neighbor = shown[shown.indexOf(id) + (direction === 'up' ? -1 : 1)];
    if (direction !== 'column' && !neighbor) return;
    if (neighbor && direction !== 'column') target = liveLayout.value.left.includes(neighbor) ? 'left' : 'right';
    let index = direction === 'column' ? liveLayout.value[target].length : liveLayout.value[target].indexOf(neighbor!);
    if (target !== from && direction === 'down') index++;
    liveLayout.value = moveCaseSection(liveLayout.value, id, target, index);
    emit('update:layout', copyCaseLayout(liveLayout.value));
    announce(id);
    await nextTick();
    root.value?.querySelector<HTMLButtonElement>(`[data-section-control="${id}"]`)?.focus({ preventScroll: true });
}

function handleMoveKey(event: KeyboardEvent, id: CaseSectionId, column: CaseColumn) {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    // Consume navigation only on this focused handle, never inside form fields.
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'ArrowUp') void move(id, column, 'up');
    else if (event.key === 'ArrowDown') void move(id, column, 'down');
    else {
        if (!isDesktop.value) return;
        const left = root.value?.querySelector<HTMLElement>('[data-case-column="left"]')?.getBoundingClientRect();
        const right = root.value?.querySelector<HTMLElement>('[data-case-column="right"]')?.getBoundingClientRect();
        const leftIsOnLeft = left && right && Math.abs(left.left - right.left) > 1
            ? left.left < right.left
            : !root.value || getComputedStyle(root.value).direction !== 'rtl';
        const target = event.key === 'ArrowLeft'
            ? (leftIsOnLeft ? 'left' : 'right')
            : (leftIsOnLeft ? 'right' : 'left');
        if (target !== column) void move(id, column, 'column');
    }
}

function guardDragClick(event: MouseEvent) {
    if (moving.value || Date.now() < ignoreClickUntil) {
        event.preventDefault();
        event.stopPropagation();
    }
}

watch(() => props.reorder, () => {
    activeMenu.value = null;
});

// The form listens for Escape on window to leave reorder mode. Reka closes the
// move menu on the same keystroke, so the form needs to know a menu is open.
watch(activeMenu, (id) => {
    emit('menuOpen', id !== null);
});

watch(() => props.layout, async (layout) => {
    const focused = typeof document !== 'undefined' ? document.activeElement : null;
    liveLayout.value = copyCaseLayout(layout);
    await nextTick();
    if (focused instanceof HTMLElement && focused.isConnected && document.activeElement !== focused) focused.focus({ preventScroll: true });
}, { flush: 'sync' });
</script>

<template>
  <div
    ref="root"
    :class="{ 'case-reorder-mode': reorder }"
  >
    <CaseSplitLayout
      :left-size="leftSize"
      @resize-end="$emit('resizeEnd', $event)"
    >
      <template
        v-for="column in columnIds"
        :key="column"
        #[column]
      >
        <p
          v-if="reorder && isDesktop"
          class="mb-3 text-sm font-semibold"
        >
          {{ t(`admin.caseLayout.${column}`) }}
        </p>
        <Draggable
          v-model="columns[column].value"
          tag="div"
          :data-case-column="column"
          :item-key="(id: string) => id"
          :group="dragGroup"
          handle=".case-section-grip"
          :force-fallback="true"
          :fallback-on-body="true"
          filter="button:not(.case-section-handle), a, input, textarea, select"
          :prevent-on-filter="false"
          :disabled="!reorder || disabled || !isDesktop"
          :animation="reducedMotion ? 0 : 150"
          ghost-class="opacity-30"
          :class="['flex min-w-0 flex-col gap-6', { 'min-h-32': reorder, 'lg:sticky lg:top-4': column === 'right' && !reorder && rightFits }]"
          @start="beginDrag"
          @end="endDrag"
        >
          <template #item="{ element: id }">
            <div
              :data-case-section="id"
              class="case-layout-group min-w-0"
              :class="{ 'rounded-lg ring-1 ring-primary/30': reorder }"
            >
              <div
                v-if="reorder && shown(id)"
                class="case-section-grip flex select-none flex-wrap items-center gap-2 rounded-t-lg bg-primary/5 px-2 py-1 lg:cursor-grab lg:touch-none lg:active:cursor-grabbing"
              >
                <UPopover
                  :open="activeMenu === id"
                  :modal="false"
                  :content="{ side: 'bottom', align: 'start' }"
                  @update:open="activeMenu = $event ? id : null"
                >
                  <UButton
                    type="button"
                    icon="i-lucide-move"
                    color="neutral"
                    variant="ghost"
                    class="case-section-handle min-h-11 min-w-11 lg:cursor-grab lg:touch-none lg:active:cursor-grabbing"
                    :data-section-control="id"
                    :disabled="disabled"
                    :aria-label="`${t('admin.caseLayout.move')}: ${labelFor(id)}`"
                    :aria-describedby="keyboardHintId"
                    :title="t('admin.caseLayout.keyboard_hint')"
                    @keydown="handleMoveKey($event, id, column)"
                    @click.capture="guardDragClick"
                  />
                  <template #content>
                    <div class="flex min-w-44 flex-col p-1">
                      <UButton
                        type="button"
                        color="neutral"
                        variant="ghost"
                        :disabled="disabled || moving || (isDesktop ? visible(column) : [...visible('left'), ...visible('right')]).indexOf(id) <= 0"
                        @click="move(id, column, 'up')"
                      >
                        {{ t('admin.caseLayout.move_up') }}
                      </UButton>
                      <UButton
                        type="button"
                        color="neutral"
                        variant="ghost"
                        :disabled="disabled || moving || (isDesktop ? visible(column) : [...visible('left'), ...visible('right')]).at(-1) === id"
                        @click="move(id, column, 'down')"
                      >
                        {{ t('admin.caseLayout.move_down') }}
                      </UButton>
                      <UButton
                        v-if="isDesktop"
                        type="button"
                        color="neutral"
                        variant="ghost"
                        :disabled="disabled || moving"
                        @click="move(id, column, 'column')"
                      >
                        {{ t('admin.caseLayout.move_column') }}
                      </UButton>
                    </div>
                  </template>
                </UPopover>
                <span class="min-w-0 flex-1 text-sm font-semibold">{{ labelFor(id) }}</span>
              </div>
              <div
                :ref="el => setBody(id, el)"
                class="case-section-body"
                :inert="reorder || undefined"
                :class="{ 'pointer-events-none': reorder }"
              />
            </div>
          </template>
        </Draggable>
      </template>
    </CaseSplitLayout>
    <Teleport
      v-for="id in CASE_SECTION_IDS"
      :key="id"
      :to="bodies[id] || 'body'"
      :disabled="!bodies[id]"
    >
      <slot :name="id" />
    </Teleport>
    <p
      v-if="reorder"
      :id="keyboardHintId"
      class="sr-only"
    >
      {{ t('admin.caseLayout.keyboard_hint') }}
    </p>
    <p
      v-if="reorder"
      role="status"
      aria-live="polite"
      class="sr-only"
    >
      {{ announcement }}
    </p>
  </div>
</template>

<style>
.case-section-body > * { margin-bottom: 0 !important; }
.case-layout-group:not(:has(> .case-section-body > *)) { display: none; }
</style>
