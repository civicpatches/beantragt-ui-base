<script setup lang="ts">
import { getStatusColor } from '~/composables/useFormatters';

export interface TimelineEntry {
    status: string
    timestamp: string
    actor?: string
    label?: string
    color?: string
    icon?: string
}

const props = defineProps<{
    entries: TimelineEntry[]
}>();

const { t, te, locale } = useI18n();

// Dot, ring and icon say what the status means, from the same map as the status badge
// (`getStatusColor`, useFormatters.ts), so the timeline and the badge always agree. The
// colours are the theme's state tokens, not fixed shades.
// A dot is a non-text mark (WCAG 1.4.11, 3:1 against the page): neutral is the muted text
// token (4.8:1 on white, 6.8:1 on slate-900), not the dimmed one (2.6:1 on white). The state
// itself is also given as text and icon next to the dot, so the colour is never its only carrier.
type StatusTone = ReturnType<typeof getStatusColor>;
const TONE_CLASSES: Record<StatusTone, { dot: string, ring: string, text: string }> = {
    success: { dot: 'bg-success', ring: 'ring-success/30', text: 'text-success' },
    warning: { dot: 'bg-warning', ring: 'ring-warning/30', text: 'text-warning' },
    error: { dot: 'bg-error', ring: 'ring-error/30', text: 'text-error' },
    info: { dot: 'bg-info', ring: 'ring-info/30', text: 'text-info' },
    neutral: { dot: 'bg-(--ui-text-muted)', ring: 'ring-(--ui-text-muted)/30', text: 'text-muted' }
};

const STATUS_ICONS: Record<string, string> = {
    new: 'i-lucide-plus-circle',
    in_review: 'i-lucide-search',
    approved: 'i-lucide-check-circle',
    rejected: 'i-lucide-x-circle',
    returned: 'i-lucide-undo-2',
    completed: 'i-lucide-check-check',
    archived: 'i-lucide-archive'
};

const ACTOR_KEYS: Record<string, string> = {
    system: 'statusPage.timeline.actorSystem',
    citizen: 'statusPage.timeline.actorCitizen',
    staff: 'statusPage.timeline.actorStaff'
};

function getDotColor(status: string): string {
    return TONE_CLASSES[getStatusColor(status)].dot;
}

function getRingColor(status: string): string {
    return TONE_CLASSES[getStatusColor(status)].ring;
}

function getTextColor(status: string): string {
    return TONE_CLASSES[getStatusColor(status)].text;
}

function isHexColor(color: string | undefined): boolean {
    return typeof color === 'string' && /^#([0-9a-fA-F]{6})$/.test(color);
}

function getDotStyle(entry: TimelineEntry): Record<string, string> {
    return isHexColor(entry.color) ? { backgroundColor: entry.color! } : {};
}

function getTextStyle(entry: TimelineEntry): Record<string, string> {
    return isHexColor(entry.color) ? { color: entry.color! } : {};
}

function getIcon(entry: TimelineEntry): string {
    return entry.icon?.trim() || STATUS_ICONS[entry.status] || 'i-lucide-circle';
}

// Label, then a translated product status, then a generic text; never the machine name.
function getStatusLabel(entry: TimelineEntry): string {
    if (entry.label) return entry.label;
    const key = `status.${entry.status}`;
    return te(key) ? t(key) : t('status.unknown');
}

function getActorLabel(actor?: string): string | undefined {
    if (!actor) return undefined;
    const key = ACTOR_KEYS[actor];
    return key ? t(key) : actor;
}

function formatRelativeTime(timestamp: string): string {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHours = Math.floor(diffMin / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSec < 60) return t('statusPage.timeline.justNow');
    if (diffMin < 60) return t('statusPage.timeline.minutesAgo', { count: diffMin }, diffMin);
    if (diffHours < 24) return t('statusPage.timeline.hoursAgo', { count: diffHours }, diffHours);
    if (diffDays < 7) return t('statusPage.timeline.daysAgo', { count: diffDays }, diffDays);

    return date.toLocaleDateString(locale.value, {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function formatAbsoluteTime(timestamp: string): string {
    if (!timestamp) return '';
    return new Date(timestamp).toLocaleDateString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

const sortedEntries = computed(() => {
    return [...props.entries].sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
});
</script>

<template>
  <div class="relative">
    <div
      v-for="(entry, index) in sortedEntries"
      :key="`${entry.status}-${entry.timestamp}`"
      class="relative flex gap-4 pb-8 last:pb-0"
    >
      <!-- Vertical line -->
      <div class="flex flex-col items-center">
        <!-- Dot -->
        <div
          class="relative z-10 flex items-center justify-center shrink-0"
          :class="index === sortedEntries.length - 1 ? 'size-5' : 'size-3.5'"
        >
          <!-- Pulsing ring on current (last) entry -->
          <div
            v-if="index === sortedEntries.length - 1"
            class="absolute inset-0 rounded-full ring-4 animate-pulse"
            :class="[getDotColor(entry.status), getRingColor(entry.status)]"
            :style="getDotStyle(entry)"
          />
          <div
            class="rounded-full"
            :class="[
              getDotColor(entry.status),
              index === sortedEntries.length - 1 ? 'size-5' : 'size-3.5',
            ]"
            :style="getDotStyle(entry)"
          />
        </div>
        <!-- Connector line -->
        <div
          v-if="index < sortedEntries.length - 1"
          class="w-px grow bg-(--ui-border)"
        />
      </div>

      <!-- Content -->
      <div class="pt-0 min-w-0">
        <div class="flex items-center gap-2 flex-wrap">
          <UIcon
            :name="getIcon(entry)"
            :class="getTextColor(entry.status)"
            :style="getTextStyle(entry)"
            class="size-4 shrink-0"
          />
          <span
            class="font-medium text-sm"
            :class="index === sortedEntries.length - 1 ? 'text-(--ui-text)' : 'text-(--ui-text-muted)'"
          >
            {{ getStatusLabel(entry) }}
          </span>
          <span
            v-if="getActorLabel(entry.actor)"
            class="text-xs text-muted bg-(--ui-bg-elevated) rounded-full px-2 py-0.5"
          >
            {{ getActorLabel(entry.actor) }}
          </span>
        </div>
        <p
          class="text-xs text-muted mt-0.5"
          :title="formatAbsoluteTime(entry.timestamp)"
        >
          {{ formatRelativeTime(entry.timestamp) }}
        </p>
      </div>
    </div>

    <!-- Empty state -->
    <div
      v-if="!sortedEntries.length"
      class="text-sm text-muted"
    >
      {{ t('statusPage.timeline.empty') }}
    </div>
  </div>
</template>
