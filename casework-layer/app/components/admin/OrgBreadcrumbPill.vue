<script setup lang="ts">
import type { OrgBreadcrumbItem } from '~~/casework-layer/app/utils/org-breadcrumb';

/**
 * The "cool" org-scope trigger pill: a bordered pill of git-branch icon + a code
 * breadcrumb (`VIII / 23 / 232`) + a platform-aware Cmd/Ctrl+K hint, used to open the search palette.
 *
 * Presentation + interaction only. The parent owns navigation/scoping:
 * - clicking the git-branch icon or the ⌘K hint emits `open` (open the palette);
 * - clicking a non-current breadcrumb segment emits `select` with its slug
 *   (re-scope to that ancestor). The trailing segment is the current scope and
 *   is rendered as plain, non-interactive text.
 *
 * Reused by the admin `DashboardWorkspaceSwitcher` trigger. (Citizens get the
 * org name + forms in the `OrgContextSidebar` instead — no breadcrumb.)
 */
withDefaults(defineProps<{
    items: OrgBreadcrumbItem[]
    /** Accessible name describing the active scope, for the icon button. */
    changeLabel: string
    /** Show the trailing Cmd/Ctrl+K hint (hidden on small / collapsed contexts). */
    showShortcut?: boolean
    /** Give long organisation paths enough room in the dashboard header. */
    wide?: boolean
}>(), {
    showShortcut: true,
    wide: false
});

const { t } = useI18n();
// Nuxt UI resolves `meta` per platform after mount: ⌘ on macOS, Ctrl elsewhere.
const { macOS } = useKbd();
const shortcutAria = computed(() => (macOS.value ? 'Meta+K' : 'Control+K'));

const emit = defineEmits<{
    open: []
    select: [slug: string]
}>();

function itemVisibilityClass(item: OrgBreadcrumbItem, index: number): string {
    if (!item.isCurrent) {
        return 'max-sm:!hidden sm:!inline-flex';
    }
    return index > 0 ? '!inline-flex' : '!inline-flex';
}

function separatorVisibilityClass(index: number): string {
    return index > 0 ? 'max-sm:!hidden sm:!inline' : '';
}

/**
 * The ancestor segment's name holds its visible text, the code, before the full name (WCAG 2.5.3, label in name): "Wechseln zu: MS Musterstadt".
 */
function segmentName(item: OrgBreadcrumbItem): string {
    const target = item.label && item.label !== item.code ? `${item.code} ${item.label}` : item.code;
    return `${t('orgSwitcher.scopeTo')}: ${target}`;
}

function segmentText(item: OrgBreadcrumbItem): string {
    if (!item.isCurrent || item.label === item.code) {
        return item.code;
    }
    return `${item.code} ${item.label}`;
}
</script>

<template>
  <!-- The pill clips (`overflow-hidden`), so its three buttons draw the 3 px focus ring inside their own box
       (`focus-visible:-outline-offset-3`, as Nuxt UI does for table rows); outside it was cut to one or two bars. -->
  <div
    class="flex min-w-0 items-stretch overflow-hidden rounded-md border border-(--ui-border) bg-(--ui-bg-elevated)"
    :class="wide ? 'max-w-full xl:max-w-[64rem]' : 'max-w-[9rem] sm:max-w-[20rem]'"
  >
    <UButton
      type="button"
      color="neutral"
      variant="ghost"
      icon="i-lucide-git-branch"
      class="shrink-0 rounded-none focus-visible:-outline-offset-3"
      :aria-label="changeLabel"
      :title="changeLabel"
      @click="emit('open')"
    />

    <nav
      :aria-label="t('orgSwitcher.breadcrumbLabel')"
      class="flex min-w-0 items-center gap-1 truncate px-1 text-sm"
    >
      <template
        v-for="(item, index) in items"
        :key="`${item.code}-${index}`"
      >
        <span
          v-if="index > 0"
          class="shrink-0 text-(--ui-text-dimmed)"
          :class="separatorVisibilityClass(index)"
          aria-hidden="true"
        >/</span>

        <span
          v-if="item.isCurrent"
          class="inline-flex min-h-6 items-center self-stretch truncate px-1 font-medium text-(--ui-text-highlighted)"
          :class="itemVisibilityClass(item, index)"
          :title="item.label"
          aria-current="location"
        >
          {{ segmentText(item) }}
        </span>
        <!-- Framework button in today's look: the muted code with its dotted underline,
             normal weight, highlighted on hover; the framework's focus ring instead of a hand-made outline. -->
        <UButton
          v-else
          color="neutral"
          variant="link"
          :label="item.code"
          class="min-h-6 min-w-6 justify-center self-stretch rounded px-1.5 py-1 font-normal underline decoration-(--ui-text-dimmed) decoration-dotted underline-offset-2 hover:text-highlighted hover:decoration-solid focus-visible:-outline-offset-3"
          :class="itemVisibilityClass(item, index)"
          :title="item.label"
          :aria-label="segmentName(item)"
          data-testid="org-breadcrumb-segment"
          @click.stop.prevent="emit('select', item.slug)"
        />
      </template>
    </nav>

    <!-- Framework button, in the pill's own look: muted, a darker hover than the pill's elevated ground. -->
    <UButton
      v-if="showShortcut"
      color="neutral"
      variant="ghost"
      class="hidden shrink-0 rounded-none border-l border-(--ui-border) px-1.5 text-[10px] leading-none text-muted hover:bg-(--ui-bg-accented) focus-visible:-outline-offset-3 lg:inline-flex"
      :aria-keyshortcuts="shortcutAria"
      data-testid="org-breadcrumb-shortcut"
      @click="emit('open')"
    >
      <span
        class="inline-flex items-center gap-0.5"
        aria-hidden="true"
      >
        <UKbd
          value="meta"
          size="sm"
        />
        <UKbd
          value="K"
          size="sm"
        />
      </span>
      <span class="sr-only">{{ t('orgSwitcher.openPalette') }}</span>
    </UButton>
  </div>
</template>
