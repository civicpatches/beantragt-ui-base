<script lang="ts">
/** One tool of the head's second row ("Bescheide", "Formular-Einstellungen", "Chat", …). */
</script>

<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router';
import WorkPageHeader from '../WorkPageHeader.vue';
import type { DropdownMenuItem } from '@nuxt/ui';
import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue';
import { useEditorRowRoom, useEditorWideLayout } from '~~/casework-layer/app/composables/useEditorWideLayout';

export interface EditorHeadTool {
    key: string
    label: string
    /** The panel this tool opens is open: `aria-expanded` and the quiet mark. */
    expanded?: boolean
    disabled?: boolean
    /**
     * Disabled while this is true (a save in progress). Read here, so a save renders
     * the head and not the editor page with a new list of tools.
     */
    busy?: Readonly<Ref<boolean>>
    /** A link instead of an action (the public view of a published form). */
    to?: string
    external?: boolean
    iconOnly?: boolean
    icon?: string
    /** `data-*` and `aria-*` attributes the editor and the tours address the tool by. */
    attrs?: Record<string, string>
    /** A state with two values (an entry of "Mehr" with a check mark). */
    checked?: boolean
    /** Only offered through the compact menu. */
    menuOnly?: boolean
    onSelect?: () => void
}

/** Status, save state and open points share the navbar. The mobile mode tabs have a separate row. */
const props = defineProps<{
    tools: EditorHeadTool[]
    back?: { to: RouteLocationRaw, label: string, attrs?: Record<string, string> }
}>();

const emit = defineEmits<{
    /** The width the answer's place has right now (0 below sm, where it is not shown). */
    'answer-room': [width: number]
}>();

const { t } = useI18n();

/*
 * At 640 px the place had 26 px, so after a delete neither the text
 * nor "Wiederherstellen" showed, and the toast came only below sm. The head reports the place's real
 * width; the editor decides by it whether the answer stands in the row or is the toast.
 */
const answerPlace = ref<HTMLElement | null>(null);
let answerPlaceObserver: ResizeObserver | null = null;
onMounted(() => {
    const place = answerPlace.value;
    // The observer reports the first width as soon as it observes (and every change after).
    if (!place || typeof ResizeObserver === 'undefined') return;
    answerPlaceObserver = new ResizeObserver((entries) => {
        const entry = entries[entries.length - 1];
        if (entry) emit('answer-room', entry.contentRect.width);
    });
    answerPlaceObserver.observe(place);
});
onBeforeUnmount(() => answerPlaceObserver?.disconnect());

function toolDisabled(tool: EditorHeadTool): boolean {
    return Boolean(tool.disabled || tool.busy?.value);
}

const wide = useEditorWideLayout();
const menuTools = computed(() => props.tools.filter(tool => !wide.value || tool.menuOnly));
const moreItems = computed<DropdownMenuItem[][]>(() => [menuTools.value.map(tool => ({
    ...tool.attrs,
    label: tool.label,
    icon: tool.icon,
    disabled: toolDisabled(tool),
    ...(tool.checked !== undefined ? { type: 'checkbox' as const, checked: tool.checked } : {}),
    ...(tool.to ? { to: tool.to, target: tool.external ? '_blank' : undefined } : {}),
    onSelect: tool.onSelect
}))]);
const hasRowRoom = useEditorRowRoom();

/** The tools that stand in the row from `xl` (a menu-only entry never does). */
const rowTools = computed(() => props.tools.filter(tool => !tool.menuOnly));
</script>

<template>
  <header
    class="shrink-0 bg-default"
    data-test="editor-head"
  >
    <WorkPageHeader
      :back="back"
      data-test="editor-head-row"
      data-row="1"
    >
      <template #left>
        <div class="min-w-0 sm:flex sm:items-center sm:gap-2">
          <div class="flex min-w-0 items-center gap-1">
            <slot name="title" />
          </div>
          <div class="flex items-center gap-2">
            <slot name="status" />
            <slot
              v-if="!hasRowRoom"
              name="save"
            />
          </div>
        </div>
      </template>
      <template #right>
        <slot
          v-if="hasRowRoom"
          name="save"
        />
        <slot name="signals" />
        <slot name="reason" />
        <slot
          v-if="hasRowRoom"
          name="actions"
        />
      </template>
    </WorkPageHeader>

    <UDashboardToolbar
      data-test="editor-head-row"
      data-row="2"
    >
      <slot name="undo" />
      <slot
        v-if="hasRowRoom"
        name="mode"
      />
      <!-- Reserve free space for undo feedback. On small screens the page announces it in a toast. -->
      <div
        ref="answerPlace"
        class="relative hidden h-8 min-w-0 sm:block sm:grow"
        data-test="editor-head-answer"
      >
        <div class="absolute inset-0 flex items-center overflow-hidden">
          <slot name="answer" />
        </div>
      </div>
      <div class="flex items-center gap-1">
        <slot
          v-if="!hasRowRoom"
          name="actions"
        />
        <div
          class="hidden items-center gap-1 xl:flex"
          data-test="editor-head-tools"
        >
          <UTooltip
            v-for="tool in rowTools"
            :key="tool.key"
            :text="tool.label"
            :disabled="!tool.iconOnly"
          >
            <UButton
              size="sm"
              color="neutral"
              variant="ghost"
              :icon="tool.icon"
              :to="tool.to"
              :target="tool.to && tool.external ? '_blank' : undefined"
              :rel="tool.to && tool.external ? 'noopener' : undefined"
              :disabled="toolDisabled(tool)"
              :active="tool.expanded"
              active-variant="soft"
              :aria-label="tool.label"
              :aria-expanded="tool.to ? undefined : tool.expanded"
              v-bind="tool.attrs"
              @mousedown="tool.iconOnly && $event.preventDefault()"
              @click="tool.onSelect?.()"
            >
              <template
                v-if="!tool.iconOnly"
                #default
              >
                {{ tool.label }}
              </template>
            </UButton>
          </UTooltip>
        </div>
        <UDropdownMenu
          v-if="menuTools.length"
          :items="moreItems"
          :content="{ align: 'end' }"
        >
          <UTooltip
            :text="t('admin.forms.editorHead.more')"
            :disabled="hasRowRoom"
          >
            <UButton
              size="sm"
              color="neutral"
              variant="ghost"
              icon="i-lucide-ellipsis"
              :aria-label="t('admin.forms.editorHead.more')"
              data-test="editor-head-more"
            >
              <span class="max-[359px]:sr-only">{{ t('admin.forms.editorHead.more') }}</span>
            </UButton>
          </UTooltip>
        </UDropdownMenu>
      </div>
    </UDashboardToolbar>
    <UDashboardToolbar
      v-if="!hasRowRoom && $slots.mode"
      data-test="editor-head-row"
      data-row="3"
    >
      <slot name="mode" />
    </UDashboardToolbar>
  </header>
</template>
