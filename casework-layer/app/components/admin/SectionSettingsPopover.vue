<script setup lang="ts">
import type { FormSection } from '~/types/form';

/**
 * Description of a section, edited at its header in the editor. The title is
 * changed in place in the section's head (`AdminEditorSectionTitle`); this popover keeps the longer description.
 *
 * One notion of saving: the text is typed into a local draft, so the
 * canvas does not re-render on every keystroke, and it is kept when the popover closes
 * (a click outside, Tab out). "Abbrechen" and Escape discard it (Escape saved, though
 * "Abbrechen" stood beside it). The editor turns each
 * kept change into one undo step and saves it by itself. The current title travels with
 * it unchanged.
 */
const props = defineProps<{
    section: FormSection
    disabled?: boolean
}>();

const emit = defineEmits<{
    update: [patch: { title: string, description?: string }]
}>();

const { t } = useI18n();

const MAX_DESCRIPTION_LENGTH = 2000;

const open = ref(false);
const descriptionDraft = ref('');
const idBase = computed(() => `section-settings-${props.section.id}`);
const hasTranslations = computed(() => Boolean(props.section.i18n && Object.keys(props.section.i18n).length > 0));

/** Set by "Abbrechen" and by Escape: that close discards the draft. */
let discarding = false;

function onEscapeKeyDown() {
    discarding = true;
}

watch(open, (value) => {
    if (value) {
        descriptionDraft.value = props.section.description ?? '';
        return;
    }
    if (discarding) {
        discarding = false;
        return;
    }
    keep();
});

function cancel() {
    discarding = true;
    open.value = false;
}

function keep() {
    const description = descriptionDraft.value.trim();
    if (description === (props.section.description ?? '').trim()) return;
    emit('update', { title: props.section.title ?? '', ...(description ? { description } : {}) });
}
</script>

<template>
  <UPopover
    v-model:open="open"
    :content="{ align: 'end', side: 'bottom', onEscapeKeyDown }"
  >
    <UButton
      color="neutral"
      variant="ghost"
      :disabled="disabled"
      :aria-label="t('admin.forms.structure.sectionSettings.openNamed', { title: section.title })"
      data-structure-action="section-edit"
      :data-section-id="section.id"
    >
      {{ t('admin.forms.structure.sectionSettings.open') }}
    </UButton>

    <template #content>
      <form
        class="w-80 max-w-full space-y-3 p-4"
        :aria-label="t('admin.forms.structure.sectionSettings.formLabel')"
        data-testid="section-settings-form"
        @submit.prevent="open = false"
      >
        <UFormField
          :label="t('admin.forms.structure.sectionSettings.description')"
          :help="t('admin.forms.structure.sectionSettings.descriptionHelp')"
          :name="`${idBase}-description`"
        >
          <UTextarea
            v-model="descriptionDraft"
            class="w-full"
            :rows="3"
            :maxlength="MAX_DESCRIPTION_LENGTH"
            data-testid="section-settings-description"
          />
        </UFormField>
        <p
          v-if="hasTranslations"
          class="text-sm text-(--ui-text-muted)"
          data-testid="section-settings-translations"
        >
          {{ t('admin.forms.structure.sectionSettings.translationsUnchanged') }}
        </p>
        <div class="flex justify-end">
          <UButton
            color="neutral"
            variant="ghost"
            data-testid="section-settings-cancel"
            @click="cancel"
          >
            {{ t('common.cancel') }}
          </UButton>
        </div>
      </form>
    </template>
  </UPopover>
</template>
