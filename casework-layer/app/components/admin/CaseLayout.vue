<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import CaseSectionLayout from './CaseSectionLayout.vue';
import { usePersonalCaseLayout } from '../../composables/usePersonalCaseLayout';
import { CASE_SECTION_IDS, copyCaseLayout, defaultCaseLayout, type CaseSectionId, type CaseLayout } from '../../utils/case-layout';

const props = defineProps<{
    contextKey: string
    query: Record<string, string>
    visibleSections: CaseSectionId[]
}>();
const emit = defineEmits<{ arranging: [value: boolean] }>();
const { t } = useI18n();
const toast = useToast();
const preferences = usePersonalCaseLayout(computed(() => props.contextKey), computed(() => props.query));
const arranging = ref(false);
const dragging = ref(false);
const resetRequested = ref(false);
const draft = ref(defaultCaseLayout());
const leftSize = ref(66.67);
const root = ref<HTMLElement | null>(null);
const trigger = ref<{ $el?: HTMLElement } | null>(null);
const labels = computed(() => Object.fromEntries(CASE_SECTION_IDS.map(id => [id, t(`admin.caseLayout.sections.${id}`)])));
const displayed = computed(() => arranging.value ? draft.value : preferences.layout.value);
watch(arranging, value => emit('arranging', value));
watch(() => props.contextKey, () => {
    arranging.value = false;
    leftSize.value = 66.67;
    try {
        const stored = Number(localStorage.getItem(`case-width:${props.contextKey}`));
        if (stored >= 30 && stored <= 70) leftSize.value = stored;
    } catch { /* Storage may be disabled. */ }
}, { immediate: true });
async function begin() {
    draft.value = copyCaseLayout(preferences.layout.value);
    resetRequested.value = false;
    arranging.value = true;
    await nextTick();
    root.value?.querySelector<HTMLButtonElement>('[data-section-control]')?.focus();
}
async function finish() {
    arranging.value = false;
    await nextTick();
    trigger.value?.$el?.focus();
}
function change(layout: CaseLayout) {
    draft.value = layout;
    resetRequested.value = false;
}
function reset() {
    draft.value = copyCaseLayout(preferences.baseline.value);
    resetRequested.value = true;
}
async function save(workspace = false) {
    if (await preferences.save(resetRequested.value && !workspace ? null : draft.value, workspace)) {
        await finish();
        toast.add({ title: t(workspace ? 'admin.caseLayout.workspaceSaved' : 'admin.caseLayout.saved'), color: 'success' });
    }
}
function resize(size: number) {
    leftSize.value = size;
    try {
        localStorage.setItem(`case-width:${props.contextKey}`, String(size));
    } catch { /* Optional preference. */ }
}
</script>

<template>
  <div
    ref="root"
    class="min-w-0"
  >
    <div
      class="mb-4 flex flex-wrap items-center gap-2"
      role="group"
      :aria-label="t('admin.caseLayout.title')"
    >
      <template v-if="arranging">
        <UButton
          :label="t('common.save')"
          :loading="preferences.saving.value"
          :disabled="dragging"
          @click="save()"
        />
        <UButton
          :label="t('common.cancel')"
          color="neutral"
          variant="ghost"
          :disabled="preferences.saving.value || dragging"
          @click="finish"
        />
        <UButton
          :label="t('admin.caseLayout.reset')"
          color="neutral"
          variant="outline"
          :disabled="preferences.saving.value || dragging"
          @click="reset"
        />
        <UButton
          v-if="preferences.workspaceDefaultWritable.value"
          :label="t('admin.caseLayout.saveWorkspace')"
          color="neutral"
          variant="outline"
          :disabled="preferences.saving.value || dragging"
          @click="save(true)"
        />
        <p class="basis-full text-sm text-muted">
          {{ t('admin.caseLayout.instructions') }}
        </p>
      </template>
      <UButton
        v-else
        ref="trigger"
        icon="i-lucide-panels-top-left"
        :label="t('admin.caseLayout.change')"
        color="neutral"
        variant="ghost"
        :loading="preferences.loading.value"
        :disabled="!preferences.writable.value"
        @click="begin"
      />
    </div>
    <UAlert
      v-if="preferences.error.value"
      role="status"
      icon="i-lucide-triangle-alert"
      class="mb-4"
      color="warning"
      :title="t(`admin.caseLayout.${preferences.error.value}Error`)"
      :actions="preferences.error.value === 'load' ? [{ label: t('common.retry'), onClick: preferences.load }] : []"
    />
    <CaseSectionLayout
      :layout="displayed"
      :left-size="leftSize"
      :labels="labels"
      :visible-sections="visibleSections"
      :reorder="arranging"
      :disabled="preferences.saving.value"
      @update:layout="change"
      @resize-end="resize"
      @dragging="dragging = $event"
    >
      <template
        v-for="id in CASE_SECTION_IDS"
        :key="id"
        #[id]
      >
        <slot :name="id" />
      </template>
    </CaseSectionLayout>
  </div>
</template>
