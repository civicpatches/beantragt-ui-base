<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui';
import { useTemplateRef, type Directive } from 'vue';
import type { FormSection } from '~/types/form';
import { EDIT_ICON } from '~/utils/action-icons';
import { splitFieldLabel } from '../../../utils/field-label-parts';
import IssueList, { type EditorIssueGroup, type IssueEntry } from './IssueList.vue';

export interface FormBlocker {
    id: string
    text: string
    action?: { label: string, run: () => void }
}

const props = defineProps<{
    sections: FormSection[]
    office: string
    groups: EditorIssueGroup[]
    reasons: FormBlocker[]
    blockers: number
    hints: number
    viewOnly: boolean
    locked: boolean
    busy: boolean
}>();
const emit = defineEmits<{ jump: [field: Pick<IssueEntry, 'fieldId' | 'sectionId' | 'code'>, group?: string] }>();
const { t, locale } = useI18n();
const root = useTemplateRef('root');
const heading = useTemplateRef('heading');
const points = useTemplateRef('points');
const tab = ref('outline');
const expanded = ref<string[]>([]);
const tabs = computed(() => [
    { value: 'outline', slot: 'outline', label: t('admin.forms.overview.outline'), icon: 'i-lucide-list-tree' },
    { value: 'issues', slot: 'issues', label: t('admin.forms.overview.points'), icon: 'i-lucide-circle-alert', badge: props.blockers + props.hints }
]);
const vTablistLabel: Directive<HTMLElement, string> = (el, { value }) => {
    el.querySelector('[role="tablist"]')?.setAttribute('aria-label', value);
};
const fields = computed(() => props.sections.flatMap(section => section.fields));
const files = computed(() => fields.value.filter(field => field.type === 'file').length);
const outline = computed<NavigationMenuItem[]>(() => {
    const counts = new Map<string, number>();
    for (const group of props.groups) {
        for (const { sectionId } of group.issues) {
            if (sectionId) counts.set(sectionId, (counts.get(sectionId) ?? 0) + 1);
        }
    }
    return props.sections.map((section) => {
        const labels = section.fields.map(field => field.i18n?.[locale.value]?.label || field.label || t('admin.fieldInspector.untitledField'));
        const shortNames = labels.map(label => splitFieldLabel(label).name);
        const seen = new Set<string>();
        const duplicates = new Set<string>();
        for (const name of shortNames) {
            if (seen.has(name)) duplicates.add(name);
            seen.add(name);
        }
        return {
            value: section.id,
            label: section.i18n?.[locale.value]?.title || section.title || section.id,
            icon: 'i-lucide-folder',
            badge: counts.has(section.id) ? { label: counts.get(section.id), variant: 'outline', color: 'neutral' } : undefined,
            children: section.fields.map((field, index) => ({
                label: duplicates.has(shortNames[index]!) ? labels[index] : shortNames[index],
                title: labels[index],
                icon: EDIT_ICON,
                disabled: props.locked || props.busy || props.viewOnly,
                onSelect: () => jump({ fieldId: field.id, sectionId: section.id })
            }))
        };
    });
});

let trigger: HTMLElement | null = null;
let returnScroll = 0;
function rememberTrigger(event: Event) {
    if (event.target instanceof Element) trigger = event.target.closest<HTMLElement>('button, a, [role="button"]');
}
function jump(issue: Pick<IssueEntry, 'fieldId' | 'sectionId' | 'code'>, group?: string) {
    returnScroll = root.value?.scrollTop ?? 0;
    emit('jump', issue, group);
}
function restoreFocus() {
    if (root.value) root.value.scrollTop = returnScroll;
    (trigger?.isConnected ? trigger : heading.value)?.focus({ preventScroll: true });
}
const focusPoints = ref(false);
function showIssues() {
    tab.value = 'issues';
    focusPoints.value = true;
}
// Reka mounts the tab panel after the model changes. Focus its content once it exists.
watchEffect(() => {
    if (!focusPoints.value || !root.value || !points.value) return;
    focusPoints.value = false;
    const panel = root.value.getBoundingClientRect();
    const top = points.value.getBoundingClientRect().top;
    if (top < panel.top || top > panel.bottom - 64) root.value.scrollTop += top - panel.top;
    points.value.focus({ preventScroll: true });
}, { flush: 'post' });
defineExpose({ restoreFocus, showIssues });
</script>

<template>
  <section
    ref="root"
    class="min-h-0 flex-1 space-y-3 overflow-y-auto p-4"
    data-test="editor-overview"
    @click.capture="rememberTrigger"
    @focusin="rememberTrigger"
  >
    <h2
      ref="heading"
      class="font-semibold"
      tabindex="-1"
    >
      {{ t('admin.forms.overview.title') }}
    </h2>
    <div class="flex flex-wrap items-center gap-2">
      <span class="text-sm text-muted">
        {{ t('admin.forms.overview.fields', { count: fields.length }, fields.length) }} ·
        {{ t('admin.forms.overview.files', { count: files }, files) }}
      </span>
    </div>
    <p
      class="text-sm"
      data-test="overview-office"
    >
      {{ office }}
    </p>
    <p
      class="text-sm"
      data-test="overview-counts"
    >
      {{ t('admin.forms.overview.blockers', { count: blockers }, blockers) }} ·
      {{ t('admin.forms.overview.hints', { count: hints }, hints) }}
    </p>
    <slot />
    <UTabs
      v-model="tab"
      v-tablist-label="t('admin.forms.overview.title')"
      :items="tabs"
      color="neutral"
      variant="link"
      size="sm"
    >
      <template #outline>
        <UNavigationMenu
          v-model="expanded"
          :items="outline"
          orientation="vertical"
          color="neutral"
          :aria-label="t('admin.forms.overview.outline')"
        />
      </template>
      <template #issues>
        <div
          ref="points"
          class="space-y-3"
          role="region"
          :aria-label="t('admin.forms.overview.points')"
          tabindex="-1"
          data-test="overview-points"
        >
          <p
            v-if="!blockers && !hints"
            class="text-sm text-muted"
          >
            {{ t('admin.forms.overview.clear') }}
          </p>
          <div
            v-for="reason in reasons"
            :key="reason.id"
          >
            <UAlert
              :title="reason.text"
              color="error"
              icon="i-lucide-circle-x"
            />
            <UButton
              v-if="reason.action"
              color="neutral"
              variant="outline"
              size="sm"
              @click="reason.action.run()"
            >
              {{ reason.action.label }}
            </UButton>
          </div>
          <section
            v-for="group in groups"
            :key="group.id"
            :data-issue-group="group.id"
            :data-issue-list="group.id"
            data-test="authoring-issue-group"
          >
            <UAlert
              :color="group.tone"
              :icon="group.tone === 'error' ? 'i-lucide-circle-x' : 'i-lucide-triangle-alert'"
              :role="group.tone === 'warning' ? 'status' : undefined"
              :title="group.label"
            >
              <template #description>
                {{ group.tone === 'error' ? t('admin.forms.overview.blocksPublish') : t('admin.forms.overview.hint') }}
                <span
                  v-if="group.note"
                  data-test="authoring-issue-note"
                >{{ group.note }}</span>
              </template>
            </UAlert>
            <IssueList
              :issues="group.issues"
              :disabled="busy"
              :locked="locked || viewOnly"
              @jump="jump($event, group.inspectorGroup)"
            />
          </section>
        </div>
      </template>
    </UTabs>
  </section>
</template>
