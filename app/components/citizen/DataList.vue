<script setup lang="ts">
/**
 * Description list for the citizen data overview (Meine Daten).
 *
 * One layout for every card: label one third, value two thirds of the
 * card from `sm`, rows separated by a hairline.
 */
export interface DataListItem {
    key: string
    label: string
    value?: string | number | null
    testId?: string
}

defineProps<{
    items: DataListItem[]
}>();

defineSlots<{
    value?: (props: { item: DataListItem }) => unknown
}>();

function hasValue(value: DataListItem['value']): boolean {
    return value !== null && value !== undefined && value !== '';
}
</script>

<template>
  <!--
    Facts list of the lead designer at citizen size: rows between hairlines, label in a third, value in two
    thirds, so values start at the same x in every block of the page.
    Below `sm` each label sits above its value.
  -->
  <dl data-slot="data-list">
    <div
      v-for="item in items"
      :key="item.key"
      class="grid gap-1 border-t border-default py-2.5 first:border-t-0 first:pt-0 sm:grid-cols-3 sm:gap-4"
      data-testid="data-list-row"
    >
      <dt class="text-base break-words text-muted sm:col-span-1">
        {{ item.label }}
      </dt>
      <dd
        class="text-base break-words text-default sm:col-span-2"
        :data-testid="item.testId"
      >
        <slot
          name="value"
          :item="item"
        >
          {{ hasValue(item.value) ? item.value : '-' }}
        </slot>
      </dd>
    </div>
  </dl>
</template>
