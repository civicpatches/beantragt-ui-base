<script setup lang="ts">
/**
 * The title of a section in the editor, changed where it stands: a click
 * on the title turns it into an input; Enter or leaving the input keeps the text, Escape
 * keeps the old one. There is no "Übernehmen": the editor saves the change by itself, as
 * every other change. An empty title is not kept.
 */
const props = defineProps<{
    title: string
    sectionId: string
    disabled?: boolean
}>();

const emit = defineEmits<{
    update: [title: string]
}>();

const { t } = useI18n();

const MAX_TITLE_LENGTH = 255;

const editing = ref(false);
const draft = ref('');
const inputId = computed(() => `section-title-input-${props.sectionId}`);

async function startEditing(options: { select?: boolean } = {}) {
    if (props.disabled) return;
    draft.value = props.title;
    editing.value = true;
    await nextTick();
    const input = document.getElementById(inputId.value) as HTMLInputElement | null;
    input?.focus();
    if (options.select !== false) input?.select();
}

let finishing = false;

const emptyError = ref(false);

/**
 * Enter and Escape end the edit from the keyboard, so the focus goes back to the title.
 * Leaving the input (a click elsewhere, Tab) keeps the text and leaves the focus where the
 * person put it. An empty title is not kept: Enter keeps the input open and says why;
 * leaving it puts the old title back.
 */
async function finish(keep: boolean, options: { refocus?: boolean } = {}) {
    if (!editing.value || finishing) return;
    const title = draft.value.trim();
    if (keep && !title && options.refocus) {
        emptyError.value = true;
        return;
    }
    finishing = true;
    emptyError.value = false;
    editing.value = false;
    if (keep && title && title !== props.title) emit('update', title);
    await nextTick();
    if (options.refocus) {
        document.querySelector<HTMLElement>(`[data-section-title-button="${CSS.escape(props.sectionId)}"]`)?.focus();
    }
    finishing = false;
}

function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
        event.preventDefault();
        void finish(true, { refocus: true });
    } else if (event.key === 'Escape') {
        event.preventDefault();
        void finish(false, { refocus: true });
    }
}

defineExpose({ startEditing });
</script>

<template>
  <div class="min-w-0 flex-1">
    <h2
      v-if="!editing"
      class="min-w-0"
      data-test="draft-section-title"
    >
      <!-- The heading's name is the title; the button says what a click does to screen readers.
           `-ms-2.5` lines the title's text up with the card's edge, where
           the title stands first (its own row below 640 px). From 640 px the section's grip stands before it
           in the head (`gap-1`), and the button reached 10 - 4 = 6 px back under the grip (164 to 196, the
           button from 190 at 1440 px). From 640 px it has no negative margin: 4 px between grip and button. -->
      <UButton
        color="neutral"
        variant="ghost"
        class="-ms-2.5 max-w-full text-base font-semibold text-highlighted sm:ms-0"
        :disabled="disabled"
        :data-section-title-button="sectionId"
        @click="startEditing({ select: false })"
      >
        <span class="min-w-0 break-words text-start">{{ title }}</span>
        <span class="sr-only">{{ t('admin.forms.sectionTitle.editHint') }}</span>
      </UButton>
    </h2>
    <UFormField
      v-else
      :error="emptyError ? t('admin.forms.sectionTitle.required') : undefined"
      class="max-w-md"
    >
      <UInput
        :id="inputId"
        v-model="draft"
        class="w-full"
        :maxlength="MAX_TITLE_LENGTH"
        :aria-label="t('admin.forms.sectionTitle.label')"
        name="section-title"
        autocomplete="off"
        data-test="draft-section-title-input"
        @keydown="onKeydown"
        @blur="finish(true)"
      />
    </UFormField>
  </div>
</template>
