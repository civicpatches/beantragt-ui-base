<script setup lang="ts">
import { splitFieldLabel } from '../../../utils/field-label-parts';

export interface IssueEntry {
    fieldId: string
    sectionId?: string
    fieldLabel: string
    sectionTitle: string
    description?: string
    code?: string
}

export interface EditorIssueGroup {
    id: string
    tone: 'error' | 'warning'
    icon: string
    label: string
    markText: string
    note?: string
    inspectorGroup: string
    issues: IssueEntry[]
}

const props = defineProps<{
    issues: IssueEntry[]
    locked?: boolean
    disabled?: boolean
}>();

const emit = defineEmits<{
    jump: [issue: IssueEntry]
}>();

/** Sections in the order the fields come, each with its fields. */
const sections = computed(() => {
    const groups: Array<{ title: string, issues: IssueEntry[] }> = [];
    for (const issue of props.issues) {
        const last = groups[groups.length - 1];
        if (last && last.title === issue.sectionTitle) last.issues.push(issue);
        else groups.push({ title: issue.sectionTitle, issues: [issue] });
    }
    return groups;
});

function parts(issue: IssueEntry) {
    const split = splitFieldLabel(issue.fieldLabel);
    return { name: split.name || issue.fieldLabel, context: split.context };
}
</script>

<template>
  <div
    class="space-y-3"
    data-test="authoring-issue-list"
  >
    <section
      v-for="(group, groupIndex) in sections"
      :key="`${group.title}-${groupIndex}`"
      :aria-label="group.title || undefined"
      data-test="authoring-issue-section"
    >
      <p
        v-if="group.title"
        class="px-2.5 pb-1 text-xs font-medium text-muted"
        aria-hidden="true"
      >
        {{ group.title }}
      </p>
      <ul>
        <li
          v-for="issue in group.issues"
          :key="issue.fieldId"
        >
          <UButton
            v-if="!locked"
            variant="ghost"
            color="neutral"
            :title="issue.fieldLabel"
            :disabled="disabled"
            :data-issue-field="issue.fieldId"
            data-test="authoring-issue-list-item"
            @click="emit('jump', issue)"
          >
            <span class="block min-w-0 flex-1">
              <span
                class="block break-words font-medium text-highlighted"
                data-test="authoring-issue-name"
              >{{ parts(issue).name }}</span>
              <span
                v-if="parts(issue).context"
                class="block truncate text-sm font-normal text-muted"
                data-test="authoring-issue-context"
              >{{ parts(issue).context }}</span>
            </span>
          </UButton>
          <p
            v-else
            class="px-2.5 py-1.5 text-sm"
            :title="issue.fieldLabel"
            data-test="authoring-issue-list-item"
          >
            <span
              class="block break-words text-default"
              data-test="authoring-issue-name"
            >{{ parts(issue).name }}</span>
            <span
              v-if="parts(issue).context"
              class="block truncate text-muted"
              data-test="authoring-issue-context"
            >{{ parts(issue).context }}</span>
          </p>
          <p
            v-if="issue.description"
            class="text-sm text-muted"
          >
            {{ issue.description }}
          </p>
        </li>
      </ul>
    </section>
  </div>
</template>
