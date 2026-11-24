<script setup lang="ts">
import { computed, ref, useId } from 'vue';

/**
 * A shared disclosure that starts closed.
 *
 * Built as `AppCard` and `InspectorGroup` do: the trigger is a quiet framework button BEFORE the collapsible (not its
 * first slot element, which `UCollapsible` would make the trigger), carrying `aria-expanded`, `aria-controls`,
 * `data-state` and the click; `UCollapsible` only shows the content.
 *
 * The content stays mounted while closed (`unmount-on-hide="false"`): reka then hides it with
 * `hidden="until-found"`, so the browser's find-in-page still finds text in a closed part and opens it, as a native
 * `<details>` did; `v-model:open` brings that opening back to the trigger. Form fields inside keep their state.
 * Mounted content is measured once by reka when it mounts, so this is for a handful per page, not for long lists.
 */
const props = withDefaults(defineProps<{
    /** The trigger's text: the part's name, with a count in the label slot when it has one. */
    label?: string
    /** Stable id of the content (`aria-controls`); generated when not given. */
    contentId?: string
    /** Classes of the trigger beyond the pattern (a muted label, a heading's weight). */
    triggerClass?: string
    /** Classes of the content box (spacing below the trigger). */
    contentClass?: string
    /**
     * The trigger's framework size: `md` in the staff UI, `lg` inside `main` of a citizen page, as the
     * other buttons of that place.
     */
    size?: 'md' | 'lg'
    /**
     * Further attributes of the trigger, such as a test id (`data-test`, `data-testid`); the component's own attributes
     * go to its root.
     */
    triggerAttrs?: Record<string, string>
}>(), {
    label: '',
    contentId: '',
    triggerClass: '',
    contentClass: 'pt-3',
    size: 'md',
    triggerAttrs: () => ({})
});

const open = defineModel<boolean>('open', { default: false });
const generatedId = useId();
const id = computed(() => props.contentId || `disclosure-${generatedId}`);
/*
 * The chevron stands on the content's start edge: the negative margin is the size's own padding (`md` px-2.5, `lg`
 * px-3). `text-start`: a label that wraps starts under its first line, as the `<summary>` did (a browser centres
 * button text, `AppCard` does the same).
 */
/*
 * Opened by the browser (find-in-page, a jump to an anchor inside): the browser has already shown the content and the
 * match. Animating from zero height would hide the match again. The disclosure
 * can still animate when the person opens it directly.
 */
const revealedByBrowser = ref(false);
const contentUi = computed(() => ({ content: revealedByBrowser.value ? 'animate-none!' : 'motion-reduce:animate-none!' }));

function toggle() {
    revealedByBrowser.value = false;
    open.value = !open.value;
}

/*
 * `items-start` with the icon 2 px down (`mt-0.5`: a 20 px line, a 16 px icon): the chevron stands at the first line of
 * a wrapped label, not between the lines.
 */
const triggerBaseClass = computed(() => `group items-start text-start ${props.size === 'lg' ? '-ms-3' : '-ms-2.5'}`);
</script>

<template>
  <div
    data-disclosure
    @beforematch.capture="revealedByBrowser = true"
  >
    <UButton
      color="neutral"
      variant="ghost"
      icon="i-lucide-chevron-right"
      v-bind="triggerAttrs"
      :size="size"
      :class="[triggerBaseClass, triggerClass]"
      :ui="{ leadingIcon: 'mt-0.5 transition-transform motion-reduce:transition-none group-data-[state=open]:rotate-90' }"
      :aria-expanded="open ? 'true' : 'false'"
      :aria-controls="id"
      :data-state="open ? 'open' : 'closed'"
      data-disclosure-trigger
      @click="toggle"
    >
      <slot name="label">
        {{ label }}
      </slot>
    </UButton>
    <!-- The framework's reduced-motion block leaves the height animation of `collapsible-*` on;
         the project switches it off, as the slide-over that holds the analysis panel does. -->
    <UCollapsible
      v-model:open="open"
      :unmount-on-hide="false"
      :ui="contentUi"
    >
      <template #content>
        <div
          :id="id"
          :class="contentClass"
          data-disclosure-content
        >
          <slot />
        </div>
      </template>
    </UCollapsible>
  </div>
</template>
