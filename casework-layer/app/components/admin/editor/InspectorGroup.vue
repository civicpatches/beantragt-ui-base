<script setup lang="ts">
/**
 * One named, collapsible group of the field inspector, built on the
 * framework's `UCollapsible`. The inspector decides whether it is open: when something in
 * it is set or missing, or when a jump from the head's findings leads here. Its content
 * stays mounted while closed, so drafts and checks inside keep working.
 *
 * `UCollapsible` made the FIRST element of its slot the
 * trigger, here the heading `h3`, not the button in it. The state (`aria-expanded`, `data-state`)
 * landed on the heading, the chevron (which follows the button's state) never turned, and an open
 * group looked closed (WCAG 4.1.2). Built as `AppCard` does (`Card.vue`): the heading and its button
 * stand before the collapsible, the button carries `aria-expanded`, `aria-controls`, `data-state`
 * and the click itself; `UCollapsible` only shows the content.
 */
const props = defineProps<{
    title: string
    /** Stable name: `data-inspector-group` and the test ids of the group. */
    name: string
}>();

const open = defineModel<boolean>('open', { default: false });
const contentId = computed(() => `field-inspector-group-content-${props.name}`);
</script>

<template>
  <div
    class="border-t border-default pt-2"
    :data-inspector-group="name"
    :data-testid="`field-inspector-disclosure-${name}`"
  >
    <h3 class="text-sm font-semibold text-highlighted">
      <!-- The heading's weight on the button's text (the button brings its own weight and colour). -->
      <UButton
        color="neutral"
        variant="ghost"
        icon="i-lucide-chevron-right"
        class="group -ms-2.5 text-sm font-semibold text-highlighted"
        :ui="{ leadingIcon: 'transition-transform group-data-[state=open]:rotate-90' }"
        :aria-expanded="open ? 'true' : 'false'"
        :aria-controls="contentId"
        :data-state="open ? 'open' : 'closed'"
        :data-testid="`field-inspector-group-${name}`"
        @click="open = !open"
      >
        {{ title }}
      </UButton>
    </h3>
    <UCollapsible
      :open="open"
      :unmount-on-hide="false"
    >
      <template #content>
        <div
          :id="contentId"
          class="space-y-4 pb-2 pt-3"
          data-inspector-group-content
        >
          <slot />
        </div>
      </template>
    </UCollapsible>
  </div>
</template>
