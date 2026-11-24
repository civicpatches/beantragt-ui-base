<script setup lang="ts">
/**
 * The one question before publishing. The same content is used in two containers:
 *
 * - inline (default): the guided setup review, which is a fullscreen modal
 *   already. A named group whose title and description are read once;
 * - `dialog`: a `UModal` on the form page and in
 *   the form editor, opened with `v-model:open`.
 *
 * One look in both: no icon, buttons of size
 * md, "Abbrechen" quiet and "Jetzt veröffentlichen" filled.
 *
 * Both say who can reach the form from then on and who receives the
 * applications, with the same title, sentences and button names. The focus
 * starts on "Abbrechen", never on the confirming button, so Enter twice does
 * not publish. The caller owns the publish: it listens to
 * `confirm` and `cancel`, passes `publishing` while the request runs and
 * closes the dialog itself (`open` false) when it is done. In dialog mode the
 * component does not move the focus on close; it emits `closed` once the
 * dialog is gone, and the caller puts the focus back on the control that
 * opened it (or where its result points).
 */
import type { ModalProps } from '@nuxt/ui';
import { nextTick, onMounted, ref, useId } from 'vue';

defineOptions({ inheritAttrs: false });

const props = defineProps<{
    /** The form's title as the page shows it. */
    formTitle: string
    /** `field_publication_scope`, null when unknown. */
    scope: 'internet' | 'intranet' | string | null
    /** "Zuständig für die Anträge: …" or the municipality sentence (`usePublishRule().receiverText`). */
    receiverText: string
    /** One more sentence the page needs said, for example unsaved changes that a publish drops. */
    note?: string
    publishing?: boolean
    /** Render as a `UModal` (form page, editor) instead of inline (guided setup). */
    dialog?: boolean
}>();

/** Dialog mode only: whether the dialog is open. */
const open = defineModel<boolean>('open', { default: false });
const emit = defineEmits<{ confirm: [], cancel: [], closed: [] }>();
const { t } = useI18n();
const id = useId();
const titleId = `${id}-title`;
const descriptionId = `${id}-description`;
const cancelButton = ref<{ $el?: HTMLElement } | null>(null);

// Describe who can see the form based on its known scope.
// Intranet forms are unavailable on the internet.
const reach = computed(() => {
    const title = props.formTitle;
    if (props.scope === 'internet') return t('admin.setup.review.publishConfirmInternet', { title });
    if (props.scope === 'intranet') return t('admin.setup.review.publishConfirmIntranet', { title });
    return t('admin.setup.review.publishConfirmUnknown', { title });
});
const title = computed(() => t('admin.setup.review.publishConfirmTitle', { title: props.formTitle }));

function focusCancel() {
    const element = cancelButton.value?.$el;
    (element instanceof HTMLElement ? element : document.querySelector<HTMLElement>(`[data-publish-confirm-cancel="${id}"]`))?.focus();
}

function onOpenAutoFocus(event: Event) {
    event.preventDefault();
    void nextTick(focusCancel);
}

// The caller returns the focus once the dialog is gone (`closed`).
function onCloseAutoFocus(event: Event) {
    event.preventDefault();
}

// The test id rides on the dialog element itself; `DialogContentProps` has
// no key for plain attributes, so the object is widened for it.
const dialogContent: NonNullable<ModalProps['content']> & Record<string, unknown> = {
    'data-test': 'publish-confirm',
    onOpenAutoFocus,
    onCloseAutoFocus
};

onMounted(async () => {
    if (props.dialog) return;
    await nextTick();
    focusCancel();
});
</script>

<template>
  <UModal
    v-if="dialog"
    v-model:open="open"
    :title="title"
    :dismissible="!publishing"
    :close="!publishing"
    :ui="{ description: 'mt-2 max-w-prose text-sm text-default' }"
    :content="dialogContent"
    @after:leave="emit('closed')"
  >
    <template #description>
      <span
        :id="descriptionId"
        class="block"
      >{{ reach }} {{ receiverText }}</span>
      <span
        v-if="note"
        class="mt-2 block"
        data-test="publish-confirm-note"
      >{{ note }}</span>
    </template>
    <template #footer>
      <div class="flex w-full flex-wrap justify-end gap-2">
        <UButton
          ref="cancelButton"
          :data-publish-confirm-cancel="id"
          color="neutral"
          variant="ghost"
          :disabled="publishing"
          @click="emit('cancel')"
        >
          {{ t('common.cancel') }}
        </UButton>
        <UButton
          data-publish-confirm-submit
          :aria-describedby="descriptionId"
          :loading="publishing"
          @click="emit('confirm')"
        >
          {{ t('admin.setup.review.publishConfirmSubmit') }}
        </UButton>
      </div>
    </template>
  </UModal>
  <UAlert
    v-else
    icon="i-lucide-info"
    data-test="publish-confirm"
    role="group"
    :aria-labelledby="titleId"
    orientation="vertical"
    v-bind="$attrs"
  >
    <template #title>
      <span :id="titleId">{{ title }}</span>
    </template>
    <template #description>
      <span :id="descriptionId">{{ reach }} {{ receiverText }}<template v-if="note"> {{ note }}</template></span>
    </template>
    <template #actions>
      <UButton
        data-publish-confirm-submit
        :aria-describedby="descriptionId"
        :loading="publishing"
        @click="emit('confirm')"
      >
        {{ t('admin.setup.review.publishConfirmSubmit') }}
      </UButton>
      <UButton
        ref="cancelButton"
        :data-publish-confirm-cancel="id"
        color="neutral"
        variant="ghost"
        :disabled="publishing"
        @click="emit('cancel')"
      >
        {{ t('common.cancel') }}
      </UButton>
    </template>
  </UAlert>
</template>
