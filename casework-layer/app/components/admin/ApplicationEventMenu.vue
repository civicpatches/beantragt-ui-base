<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui';
import type { AdminApplicationEventKind } from '~/types';
import type { APPLICATION_EVENTS } from '~/utils/application-events';

const props = defineProps<{ items: ReadonlyArray<typeof APPLICATION_EVENTS[number] & { count: number }> }>();
const emit = defineEmits<{ select: [kind: AdminApplicationEventKind] }>();
const { t } = useI18n();
const open = ref(false);
let jumping = false;

const total = computed(() => props.items.reduce((sum, item) => sum + item.count, 0));
const menuItems = computed<DropdownMenuItem[]>(() => props.items.map(item => ({
    label: t(`admin.table.events.${item.kind}`, { count: item.count }, item.count),
    icon: item.icon,
    color: item.color,
    onSelect: () => {
        jumping = true;
        open.value = false;
        void nextTick(() => emit('select', item.kind));
    }
})));

function closeAutoFocus(event: Event) {
    if (jumping) event.preventDefault();
    jumping = false;
}
</script>

<template>
  <UDropdownMenu
    v-if="total > 0"
    v-model:open="open"
    :items="menuItems"
    :modal="false"
    :content="{ align: 'end', onCloseAutoFocus: closeAutoFocus }"
  >
    <UButton
      color="neutral"
      variant="outline"
      trailing-icon="i-lucide-chevron-down"
      :label="t('admin.detail.eventWidget.newCount', { count: total })"
      data-testid="application-event-menu"
    />
  </UDropdownMenu>
</template>
