<script setup lang="ts">
const props = withDefaults(defineProps<{
    decorative?: boolean
    mark?: boolean
    showText?: boolean
    size?: 'xs' | 'sm' | 'md' | 'lg'
}>(), {
    decorative: false,
    showText: false,
    size: 'md'
});

const logoClass = computed(() => {
    if (props.mark) return 'h-[1em] w-auto aspect-[45.2/25.54]';
    switch (props.size) {
        case 'xs':
            return 'size-8 max-w-full';
        case 'sm':
            return 'h-4 w-28';
        case 'lg':
            return 'h-7 w-44';
        default:
            return 'h-5 w-36';
    }
});

const textClass = computed(() => {
    switch (props.size) {
        case 'sm':
            return 'text-xs';
        case 'lg':
            return 'text-sm';
        default:
            return 'text-xs';
    }
});

const isImageDecorative = computed(() => props.decorative || props.showText);
</script>

<template>
  <span class="inline-flex items-center gap-2 min-w-0">
    <UColorModeImage
      :light="mark ? '/brand/beantragt-mark.svg' : '/brand/beantragt-logo.svg'"
      :dark="mark ? '/brand/beantragt-mark-dark.svg' : '/brand/beantragt-logo-dark.svg'"
      :alt="isImageDecorative ? '' : 'beantragt.ai'"
      :aria-hidden="isImageDecorative ? 'true' : undefined"
      class="shrink-0 object-contain"
      :class="logoClass"
    />
    <span
      v-if="showText"
      class="sr-only font-semibold truncate text-current"
      :class="textClass"
    >
      beantragt.ai
    </span>
  </span>
</template>
