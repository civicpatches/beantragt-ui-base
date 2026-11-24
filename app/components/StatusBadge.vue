<script setup lang="ts">
import { getStatusColor } from '~/composables/useFormatters';
import { DEFAULT_WORKFLOW_STATUS_ICON } from '~/utils/workflow-status-icon';

const props = withDefaults(defineProps<{
    status: string
    /** 'application' uses workflow status maps, 'schema' uses schema status maps */
    type?: 'application' | 'schema'
    size?: 'xs' | 'sm' | 'md' | 'lg'
    /** Backend-provided display label (per-group workflow_status). */
    label?: string
    /** Backend-provided hex colour (e.g. "#f59e0b"). Renders a tinted badge. */
    color?: string
    /** Backend-provided Lucide icon name (e.g. "i-lucide-search"). */
    icon?: string
    /** Allow long status names to wrap inside fixed table columns. */
    wrap?: boolean
}>(), {
    type: 'application',
    size: 'md'
});

const { t, te } = useI18n();

/** Whether a backend hex colour was supplied (drives the custom tinted badge). */
const isHex = computed(() => typeof props.color === 'string' && /^#([0-9a-fA-F]{6})$/.test(props.color));

const badgeColor = computed(() => {
    if (props.type === 'schema') {
        const s = props.status;
        if (s === 'published' || s === 'active') return 'success' as const;
        return 'neutral' as const;
    }
    return getStatusColor(props.status);
});

// Label, then a translated product status, then a generic text. Never the
// machine name: internal process steps must not reach applicants.
const badgeLabel = computed(() => {
    if (props.label) return props.label;
    const key = `status.${props.status}`;
    if (te(key)) return t(key);
    return t('status.unknown');
});
const badgeIcon = computed(() => {
    const icon = props.icon?.trim();
    if (icon) return icon;
    return props.type === 'application' ? DEFAULT_WORKFLOW_STATUS_ICON : '';
});

// Mirrors the UBadge size variants (Nuxt UI theme `badge.ts`), so a hex
// badge renders exactly like a UBadge of the same size.
const sizeClass = computed(() => ({
    xs: 'text-[8px]/3 px-1 py-0.5 gap-1 rounded-sm',
    sm: 'text-[10px]/3 px-1.5 py-1 gap-1 rounded-sm',
    md: 'text-xs px-2 py-1 gap-1 rounded-md',
    lg: 'text-sm px-2 py-1 gap-1.5 rounded-md'
}[props.size]));

const iconSizeClass = computed(() => ({
    xs: 'size-3',
    sm: 'size-3',
    md: 'size-4',
    lg: 'size-5'
}[props.size]));
</script>

<template>
  <span
    v-if="isHex"
    class="inline-flex items-center ring ring-inset font-medium text-(--ui-text-highlighted) whitespace-nowrap"
    :class="[sizeClass, { 'max-w-full min-w-0': wrap }]"
    :style="{ 'backgroundColor': `${color}22`, '--tw-ring-color': `${color}66` }"
  >
    <!-- No dot: tint and ring carry the colour, the icon stays the municipality's sign. -->
    <UIcon
      v-if="badgeIcon"
      :name="badgeIcon"
      :class="[iconSizeClass, 'shrink-0']"
    />
    <span :class="{ 'min-w-0 whitespace-normal wrap-anywhere': wrap }">{{ badgeLabel }}</span>
  </span>
  <UBadge
    v-else
    :color="badgeColor"
    :size="size"
    :icon="badgeIcon || undefined"
    :class="{ 'max-w-full min-w-0': wrap }"
  >
    <span :class="{ 'min-w-0 whitespace-normal wrap-anywhere': wrap }">{{ badgeLabel }}</span>
  </UBadge>
</template>
