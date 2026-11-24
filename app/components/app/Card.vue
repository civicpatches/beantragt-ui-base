<script setup lang="ts">
/**
 * Staff and citizen pages share this outlined `UCard`. It uses one heading
 * style and omits the shadow and the divider between heading and body.
 *
 * Heading row, in this order: optional icon, the heading (`as`, default
 * `h2`), a plain count (hidden at 0), `#badge` (at most one badge), the info button of the standing explanation, and `#actions` at
 * the right end (below `sm` under the heading, left aligned). Without a
 * `title` the card has no header (a card that only holds the page's table).
 *
 * The body takes blocks with `space-y-4`. `#footer` is the save row of a form
 * card, left aligned; `stickyFooter` keeps it at the bottom of the viewport
 * while a long form scrolls (the root clips with `overflow-clip` instead of
 * `overflow-hidden`, so `sticky` follows; give the fields `scroll-mb-20`).
 *
 * `collapsible` makes the heading the trigger of the disclosure pattern
 * (`v-model:open`, closed by default) around the body; count, badge, info and
 * actions stay visible, and `#lead` holds one sentence under the heading that
 * stays visible while the card is closed. The body stays mounted while
 * closed, so fields keep their values; the page opens the card when a field
 * inside it is invalid.
 *
 * `region` renders the root as a `section` named by the card's heading
 * (`aria-labelledby`), for cards the page or a test addresses as a region.
 */
import { ref, useId } from 'vue';

defineOptions({ name: 'AppCard' });

export type AppCardHeading = 'h2' | 'h3' | 'h4';

export interface AppCardInfo {
    /** Accessible name of the info button, e.g. "Hinweise zu Bescheiden". */
    label: string
    text: string
}

const props = withDefaults(defineProps<{
    title?: string
    as?: AppCardHeading
    /** Lucide icon left of the title. Per page: all cards carry one or none does. */
    icon?: string
    /** Number of entries, shown after the title; hidden when 0 or absent. */
    count?: number
    info?: AppCardInfo
    /** The footer sticks to the bottom of the viewport (form longer than the screen). */
    stickyFooter?: boolean
    /** The heading opens and closes the body (needs a `title`). */
    collapsible?: boolean
    /** The root is a `section` named by the heading (a landmark region). */
    region?: boolean
    /**
     * The actions stay at the right end of the heading row at every width; the heading shrinks and wraps
     * instead. For a lone icon-only action (refresh), which would otherwise drop onto a line of its own below
     * `sm`. Default off: a labelled action keeps going under the heading on narrow screens.
     */
    inlineActions?: boolean
}>(), {
    title: undefined,
    as: 'h2',
    icon: undefined,
    count: undefined,
    info: undefined,
    stickyFooter: false,
    collapsible: false,
    inlineActions: false,
    region: false
});

const open = defineModel<boolean>('open', { default: false });
/** Disable height animation under reduced motion because the framework still animates collapsible content. */
const COLLAPSIBLE_UI = { content: 'motion-reduce:animate-none!' };
/**
 * Opened by the browser (find-in-page, a jump to an anchor inside): the browser has already shown the content and the
 * match. Animating from zero height would hide the match again. The disclosure
 * can still animate when the person opens it directly.
 */
const COLLAPSIBLE_UI_REVEALED = { content: 'animate-none!' };
const revealedByBrowser = ref(false);
/**
 * The title trigger's chevron: with `items-start` on the trigger it sits 4 px down (`mt-1`, a 16 px icon on the title's
 * 24 px line), so a wrapped title keeps it at its first line, as `AppDisclosure`. A
 * script constant, not a template comment, so the card's markup carries no comment.
 */
const TOGGLE_UI = { leadingIcon: 'mt-1 transition-transform motion-reduce:transition-none group-data-[state=open]:rotate-90' };

const slots = defineSlots<{
    default?(): unknown
    actions?(): unknown
    badge?(): unknown
    lead?(): unknown
    footer?(): unknown
}>();

const uid = useId();
const contentId = `app-card-content-${uid}`;
const titleId = `app-card-title-${uid}`;

const hasHeader = computed(() => !!props.title);
const isCollapsible = computed(() => props.collapsible && hasHeader.value);
const showCount = computed(() => !!props.count);

// The footer continues the body's side padding and leaves 24 px under the last block. A card with a heading only keeps its bottom padding. A
// collapsible card puts the body padding on its content, so a closed card has
// no empty padded body.
// A function, not a computed: slots are no reactive source, a computed would
// keep the paddings of the first render when a slot appears later.
function cardUi() {
    const hasBody = !!slots.default;
    let header = 'px-4 pt-4 pb-0 sm:px-6 sm:pt-5';
    if (isCollapsible.value || (!hasBody && !slots.footer)) header = 'px-4 py-4 sm:px-6 sm:py-5';

    // The heading row is 32 px high with or without a button (min-h-8), so the body starts 8 px closer
    let body = hasHeader.value ? 'px-4 pt-2 pb-4 sm:px-6 sm:pb-6 sm:pt-2' : 'p-4 sm:p-6';
    // `sm:p-0` too: the theme's `sm:p-6` survives a plain `p-0` (tailwind-merge keeps other variants),
    // which left a closed card with an empty 48 px body.
    if (isCollapsible.value) body = 'p-0 sm:p-0';

    let footer = 'px-4 pt-0 pb-4 sm:px-6 sm:pb-6';
    if (props.stickyFooter) footer = 'sticky bottom-0 z-10 border-t border-default bg-default px-4 py-3 sm:px-6';
    else if (!hasBody && hasHeader.value && !isCollapsible.value) footer = 'px-4 pt-2 pb-4 sm:px-6 sm:pb-6 sm:pt-2';
    else if (!hasBody && !hasHeader.value) footer = 'p-4 sm:p-6';

    return {
        root: props.stickyFooter ? 'divide-y-0 overflow-clip' : 'divide-y-0',
        header,
        body,
        footer
    };
}

function toggle() {
    revealedByBrowser.value = false;
    open.value = !open.value;
}
</script>

<template>
  <UCard
    :as="region ? 'section' : undefined"
    :aria-labelledby="region && hasHeader ? titleId : undefined"
    :ui="cardUi()"
    data-testid="app-card"
  >
    <template
      v-if="hasHeader"
      #header
    >
      <div
        class="flex min-h-8 items-center gap-2"
        :class="inlineActions ? 'flex-nowrap' : 'flex-wrap'"
        data-testid="app-card-heading-row"
      >
        <UIcon
          v-if="icon"
          :name="icon"
          class="size-4 shrink-0 text-muted"
          aria-hidden="true"
        />
        <component
          :is="as"
          :id="titleId"
          class="min-w-0 break-words text-base font-semibold text-highlighted"
          data-testid="app-card-title"
        >
          <UButton
            v-if="isCollapsible"
            color="neutral"
            variant="ghost"
            icon="i-lucide-chevron-right"
            class="group -ms-2.5 items-start text-base font-semibold text-highlighted"
            :ui="TOGGLE_UI"
            :aria-expanded="open ? 'true' : 'false'"
            :aria-controls="contentId"
            :data-state="open ? 'open' : 'closed'"
            data-testid="app-card-toggle"
            @click="toggle"
          >
            <span class="break-words text-start">{{ title }}</span>
            <span
              v-if="showCount"
              class="font-normal text-muted tabular-nums"
              data-testid="app-card-count"
            >{{ count }}</span>
          </UButton>
          <template v-else>
            {{ title }}
          </template>
        </component>
        <span
          v-if="showCount && !isCollapsible"
          class="text-sm text-muted tabular-nums"
          data-testid="app-card-count"
        >{{ count }}</span>
        <slot name="badge" />
        <UPopover
          v-if="info"
          :content="{ align: 'start', side: 'bottom' }"
        >
          <UButton
            color="neutral"
            variant="ghost"
            size="sm"
            icon="i-lucide-info"
            :aria-label="info.label"
            data-testid="card-explanation"
          />
          <template #content>
            <p class="max-w-sm p-3 text-sm text-default">
              {{ info.text }}
            </p>
          </template>
        </UPopover>
        <div
          v-if="slots.actions"
          class="flex items-center gap-2"
          :class="inlineActions ? 'ms-auto shrink-0' : 'w-full flex-wrap sm:ms-auto sm:w-auto'"
          data-testid="app-card-actions"
        >
          <slot name="actions" />
        </div>
      </div>
      <div
        v-if="isCollapsible && slots.lead"
        class="mt-1 max-w-prose text-sm text-muted"
        data-testid="app-card-lead"
      >
        <slot name="lead" />
      </div>
    </template>

    <template
      v-if="slots.default"
      #default
    >
      <UCollapsible
        v-if="isCollapsible"
        v-model:open="open"
        :unmount-on-hide="false"
        :ui="revealedByBrowser ? COLLAPSIBLE_UI_REVEALED : COLLAPSIBLE_UI"
        @beforematch.capture="revealedByBrowser = true"
      >
        <template #content>
          <div
            :id="contentId"
            class="space-y-4 px-4 pb-4 sm:px-6 sm:pb-6"
            data-testid="app-card-body"
          >
            <slot />
          </div>
        </template>
      </UCollapsible>
      <div
        v-else
        class="space-y-4"
        data-testid="app-card-body"
      >
        <slot />
      </div>
    </template>

    <template
      v-if="slots.footer"
      #footer
    >
      <div
        class="flex flex-wrap items-center gap-2"
        data-testid="app-card-footer"
      >
        <slot name="footer" />
      </div>
    </template>
  </UCard>
</template>
