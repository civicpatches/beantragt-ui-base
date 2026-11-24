<script setup lang="ts">
import { useId } from 'vue';
import { isDeliveryRoute, type DeliveryRoute } from '~/types/delivery';

/**
 * Citizen choice of how the authority replies. Shared by the
 * public form page and the assistant's submit surfaces. useFormSubmission
 * decides visibility (more than one offered route, no staff session) and
 * preselects the form default. One fieldset: the legend asks, one radio per
 * offered route, the hint says that decisions always go by post.
 */
const props = defineProps<{
    routes: DeliveryRoute[]
    visible: boolean
    disabled?: boolean
}>();
const route = defineModel<DeliveryRoute | null>('route', { required: true });
const { t } = useI18n();
const hintId = useId();
const items = computed(() => props.routes.map(value => ({ value, label: t(`delivery.route.${value}`) })));

function choose(value: unknown) {
    if (isDeliveryRoute(value) && props.routes.includes(value)) route.value = value;
}
</script>

<template>
  <div
    v-if="visible && routes.length > 1"
    class="space-y-2"
    data-testid="delivery-route-choice"
  >
    <URadioGroup
      :model-value="route ?? undefined"
      :items="items"
      value-key="value"
      :legend="t('form.delivery.title')"
      :disabled="disabled"
      :aria-describedby="hintId"
      :ui="{ legend: 'mb-2 text-sm font-medium text-highlighted' }"
      data-testid="delivery-route-options"
      @update:model-value="choose"
    />
    <p
      :id="hintId"
      class="text-sm text-muted"
      data-testid="delivery-route-hint"
    >
      {{ t('form.delivery.decisionsByPost') }}
    </p>
  </div>
</template>
