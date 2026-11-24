<script setup lang="ts">
import type { AdminApplicationEventKind } from '~/types';
import ApplicationEventPill from '~/components/ApplicationEventPill.vue';
import { useApplicationEvents } from '~/composables/useApplicationEvents';
import { APPLICATION_EVENTS } from '~/utils/application-events';

const props = defineProps<{ kind: AdminApplicationEventKind, cardTotal?: number }>();
const { count } = useApplicationEvents();
const value = computed(() => count(props.kind));
const visible = computed(() =>
    value.value > 0 && (value.value !== props.cardTotal || APPLICATION_EVENTS.some(event => event.kind === props.kind && event.color !== 'neutral'))
);
</script>

<template>
  <ApplicationEventPill
    v-if="visible"
    :kind="kind"
    :count="value"
    :icon-only="cardTotal !== undefined"
  />
</template>
