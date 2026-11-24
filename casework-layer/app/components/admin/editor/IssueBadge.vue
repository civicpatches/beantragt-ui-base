<script setup lang="ts">
import type { EditorIssueGroup } from './IssueList.vue';

defineProps<{ groups: EditorIssueGroup[], count: number }>();
const emit = defineEmits<{ open: [] }>();
const { t } = useI18n();
</script>

<template>
  <div data-test="authoring-issues">
    <span
      v-for="group in groups"
      :id="group.id"
      :key="group.id"
      class="sr-only"
      :role="group.tone === 'error' ? 'alert' : 'status'"
    >{{ group.label }}</span>
    <UTooltip :text="t('admin.forms.overview.showPoints', { count }, count)">
      <UButton
        color="warning"
        variant="soft"
        size="xs"
        icon="i-lucide-shield-alert"
        :aria-label="t('admin.forms.overview.showPoints', { count }, count)"
        data-test="authoring-issue-all"
        @click="emit('open')"
      >
        {{ count }}
      </UButton>
    </UTooltip>
  </div>
</template>
