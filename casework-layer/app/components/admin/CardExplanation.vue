<script setup lang="ts">
/**
 * The standing explanation of a card behind an info control: the card
 * shows heading and state, the paragraph opens on demand. State that changes
 * per application (hints, reasons, errors) never goes in here.
 */
defineProps<{
    /** Accessible name of the info button, e.g. "Hinweise zu Bescheiden". */
    label: string
    text: string
}>();
</script>

<template>
  <UPopover :content="{ align: 'start', side: 'bottom' }">
    <UButton
      color="neutral"
      variant="ghost"
      size="sm"
      icon="i-lucide-info"
      :aria-label="label"
      data-testid="card-explanation"
    />
    <template #content>
      <p class="max-w-sm p-3 text-sm text-default">
        {{ text }}
      </p>
    </template>
  </UPopover>
</template>
