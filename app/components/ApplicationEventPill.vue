<script setup lang="ts">
import { useAttrs } from 'vue';
import type { RouteLocationRaw } from 'vue-router';
import type { AdminApplicationEventKind } from '~/types';
import { APPLICATION_EVENTS } from '~/utils/application-events';

defineOptions({ inheritAttrs: false });
const props = defineProps<{ kind: AdminApplicationEventKind, count: number, messageTotal?: number, to?: RouteLocationRaw, ariaSuffix?: string, iconOnly?: boolean }>();
const { t } = useI18n();
const event = computed(() => APPLICATION_EVENTS.find(event => event.kind === props.kind)!);
const unreadLabel = computed(() => t(`admin.table.events.${props.kind}`, { count: props.count }, props.count));
const meaning = computed(() => props.messageTotal === undefined
    ? unreadLabel.value
    : t('admin.detail.eventWidget.messageTotal', { total: props.messageTotal, unread: unreadLabel.value }));
const attrs = useAttrs();
const linkAttrs = computed(() => ({
    ...attrs,
    'aria-label': props.ariaSuffix ? `${meaning.value}: ${props.ariaSuffix}` : meaning.value,
    'data-test': attrs['data-test'] ?? 'section-event-pill',
    'data-event-kind': props.kind,
    'class': ['inline-flex min-h-6 min-w-6 shrink-0 items-center justify-center whitespace-nowrap rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary', attrs.class]
}));
const isAction = computed(() => event.value.color !== 'neutral');
const iconClass = computed(() => event.value.color === 'error' ? 'text-error' : 'text-warning');
</script>

<template>
  <UTooltip
    :text="meaning"
    :content="{ side: 'top' }"
    :ui="{ content: 'h-auto max-w-sm', text: 'whitespace-normal text-clip [overflow-wrap:anywhere]' }"
  >
    <ULink
      v-bind="linkAttrs"
      :to="to ?? `#${event.sectionId}`"
      :external="!to"
      raw
    >
      <!-- Owner 17.11.: one shape for every kind, small, no ring; only the icon colour carries the meaning. -->
      <!-- eslint-disable beantragt/nuxt-ui-literal-variants -->
      <UBadge
        color="neutral"
        variant="soft"
        size="sm"
        :label="iconOnly ? undefined : messageTotal ?? (count > 1 ? count : undefined)"
        class="rounded-full whitespace-nowrap"
        aria-hidden="true"
      >
        <template #leading>
          <UIcon
            :name="event.icon"
            class="size-3.5 shrink-0"
            :class="isAction ? iconClass : 'text-muted'"
          />
        </template>
      </UBadge>
      <!-- eslint-enable beantragt/nuxt-ui-literal-variants -->
    </ULink>
  </UTooltip>
</template>
