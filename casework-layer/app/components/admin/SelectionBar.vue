<script setup lang="ts">
/**
 * The selection bar appears between the toolbar and table when at least one row is selected.
 * The default slot puts the filled action first, followed by outlined actions and the clear button.
 * The `#end` slot places the destructive action on the far edge. Callers can add a separator in this slot.
 */
import { adminSelectionBarClass, adminSelectionCountClass } from '../../utils/admin-table';

const props = defineProps<{
    count: number
    /** Name of the group; defaults to "Aktionen für die Auswahl". */
    label?: string
    /** Disables "Auswahl aufheben" while an action of the bar runs. */
    busy?: boolean
}>();

const emit = defineEmits<{
    clear: []
}>();

const slots = defineSlots<{
    default?(): unknown
    end?(): unknown
}>();

const { t } = useI18n();

const groupLabel = computed(() => props.label || t('admin.table.selectionActions'));
</script>

<template>
  <div
    v-if="count > 0"
    role="group"
    :aria-label="groupLabel"
    :class="adminSelectionBarClass"
    data-test="selection-bar"
  >
    <span
      role="status"
      :class="adminSelectionCountClass"
      data-test="selection-count"
    >{{ t('admin.table.selectedCount', { count }) }}</span>
    <slot />
    <UButton
      color="neutral"
      variant="ghost"
      :label="t('admin.table.clearSelection')"
      :disabled="busy"
      data-test="selection-clear"
      @click="emit('clear')"
    />
    <div
      v-if="slots.end"
      class="ms-auto flex flex-wrap items-center gap-2"
      data-test="selection-end"
    >
      <slot name="end" />
    </div>
  </div>
</template>
