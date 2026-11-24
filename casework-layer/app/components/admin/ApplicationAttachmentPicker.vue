<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue';
import type { AdminApplicationAttachment } from '~/types';
import type { AttachmentListGroup, AttachmentRowState } from '~~/casework-layer/app/composables/useAdminApplicationAttachments';

/**
 * The attachments of the slide-over's left column, grouped by file field like the list on the page. A small
 * sibling of the batch review's SichtungFiles: that selector has no field groups and carries batch-only parts
 * ("gesehen", proof pages). One Tab stop (roving tabindex): the arrow keys, Home and End move the focus between
 * the attachments, Enter or Space shows the focused one as a native button. The shown attachment carries
 * `aria-current`. A missing required field stays visible as an entry that cannot be selected.
 */
const props = defineProps<{
    groups: AttachmentListGroup[]
    currentId: string | null
    rowState: (attachment: AdminApplicationAttachment) => AttachmentRowState
    fileKind: (attachment: AdminApplicationAttachment) => 'pdf' | 'image' | 'other'
}>();
const emit = defineEmits<{ select: [attachment: AdminApplicationAttachment] }>();
const { t } = useI18n();
const root = ref<HTMLElement | null>(null);
const idPrefix = `attachment-picker-${useId()}`;
const fileIcons = { pdf: 'i-lucide-file-text', image: 'i-lucide-image', other: 'i-lucide-file' } as const;
const visibleGroups = computed(() => props.groups.filter(group => group.attachments.length || group.missing));
const selectable = computed(() => visibleGroups.value.flatMap(group => group.attachments.map(attachment => attachment.id)));
// The entry holding the Tab stop: the one the person moved to, else the shown one, else the first.
const moved = ref<string | null>(null);
const stop = computed(() => {
    if (moved.value && selectable.value.includes(moved.value)) return moved.value;
    return selectable.value.find(id => id === props.currentId) ?? selectable.value[0] ?? null;
});
watch(() => props.currentId, () => {
    if (!root.value?.contains(document.activeElement)) moved.value = null;
});
const KEYS = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];
function buttons() {
    return [...(root.value?.querySelectorAll<HTMLElement>('button[data-attachment-pick]') ?? [])];
}
function keydown(event: KeyboardEvent) {
    if (!KEYS.includes(event.key) || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const list = buttons();
    const index = list.indexOf(event.target as HTMLElement);
    if (index < 0 || !list.length) return;
    event.preventDefault();
    const last = list.length - 1;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? last : ['ArrowRight', 'ArrowDown'].includes(event.key) ? (index === last ? 0 : index + 1) : (index === 0 ? last : index - 1);
    list[next]!.focus();
}
/** Moves the focus to the shown attachment (on opening the slide-over). */
function focusCurrent() {
    const list = buttons();
    (list.find(button => button.dataset.attachmentPick === props.currentId) ?? list[0])?.focus();
}
defineExpose({ focusCurrent });
</script>

<template>
  <div
    ref="root"
    role="group"
    :aria-label="t('admin.detail.attachments')"
    data-testid="attachment-picker"
    @keydown="keydown"
  >
    <template
      v-for="(group, groupIndex) in visibleGroups"
      :key="group.key"
    >
      <p
        :id="`${idPrefix}-${groupIndex}`"
        class="mx-2 mb-1 mt-3 break-words text-xs font-medium text-muted first:mt-1"
      >
        {{ group.label }}
      </p>
      <ul
        role="list"
        :aria-labelledby="`${idPrefix}-${groupIndex}`"
        class="grid gap-0.5"
      >
        <li
          v-for="attachment in group.attachments"
          :key="attachment.id"
        >
          <!-- The framework's button (ghost, `active` for the shown one): hover, focus ring, padding and corners
               come from the theme. The roving tab stop and aria-current stay ours. -->
          <UButton
            color="neutral"
            variant="ghost"
            :active="attachment.id === currentId"
            active-color="primary"
            active-variant="subtle"
            class="min-h-10 w-full min-w-0 flex-wrap justify-start gap-x-2 gap-y-1 text-left font-normal"
            :tabindex="attachment.id === stop ? 0 : -1"
            :data-attachment-pick="attachment.id"
            :aria-current="attachment.id === currentId ? 'true' : undefined"
            @focus="moved = attachment.id"
            @click="emit('select', attachment)"
          >
            <span class="flex min-w-0 flex-1 basis-40 items-center gap-2">
              <UIcon
                :name="fileIcons[fileKind(attachment)]"
                class="size-4 shrink-0 text-muted"
                aria-hidden="true"
              />
              <span class="sr-only">{{ t(`admin.detail.attachmentList.fileType.${fileKind(attachment)}`) }},</span>
              <span class="min-w-0 break-words">{{ attachment.filename }}</span>
            </span>
            <AdminApplicationAttachmentState :state="rowState(attachment)" />
          </UButton>
        </li>
        <li
          v-if="group.missing && !group.attachments.length"
          class="flex min-h-10 items-center justify-between gap-2 px-2 py-1.5 text-sm text-muted"
          data-testid="attachment-picker-missing"
        >
          <span>{{ t('admin.detail.attachmentList.noDocument') }}</span>
          <UBadge
            color="error"
            size="sm"
          >
            {{ t('admin.bulk.sichtung.proof.missing') }}
          </UBadge>
        </li>
      </ul>
    </template>
  </div>
</template>
