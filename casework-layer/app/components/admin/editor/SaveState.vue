<script setup lang="ts">
import type { Ref } from 'vue';
import { VIEWPORT_BOUND_UI } from '../../../utils/viewport-bound-content';

/**
 * One notion of saving in the form editor. The editor saves
 * by itself after every change; this is where the button "Speichern" stood, and it says the
 * truth about the last change:
 * - `saved`: "Gespeichert 06:03";
 * - `saving`: a change waits for its save or is being sent ("Speichert …");
 * - `pending`: a change is not sent yet and nothing is on its way ("Nicht gespeichert");
 * - `failed`: the request did not get through (network); "erneut versuchen" can work;
 * - `conflict`: the form was changed elsewhere; only reloading helps, and the change is lost;
 * - `forbidden`: the server refused the change; the reason, no retry;
 * - `invalid`: a setting blocks every save (e.g. the retention value); the way to it.
 *
 * Screen readers hear one sentence per event: the live region holds the time of the last
 * save (it changes at most once a minute) or the failure, never "Speichert …".
 */
type SaveStateKind = 'saved' | 'saving' | 'pending' | 'failed' | 'conflict' | 'forbidden' | 'invalid';

const props = defineProps<{
    state?: SaveStateKind
    /** The time of the last save in this session, already formatted; empty before the first. */
    savedAt?: string
    /**
     * The editor's own state, read here and not by the page. "Speichert …" and
     * "Gespeichert" then render this component only, not the editor page or the form.
     */
    source?: { state: Readonly<Ref<SaveStateKind>>, savedAt: Readonly<Ref<string>> }
    /** The retry of a failed save is running; the button stays in place with its spinner. */
    retrying?: boolean
    /**
     * Where the one action of an "invalid" state leads: the form settings or the refused field's
     * condition. or the label of the field without one; the button names that place.
     */
    invalidTarget?: 'settings' | 'condition' | 'label'
    /** Why the save was refused (forbidden, invalid). */
    reason?: string
}>();

const emit = defineEmits<{
    'retry': []
    'reload': []
    'open-settings': []
}>();

const { t } = useI18n();

const status = ref<HTMLElement | null>(null);
const retryButton = ref<{ $el?: Element } | null>(null);

const currentState = computed<SaveStateKind>(() => props.source?.state.value ?? props.state ?? 'saved');
const currentSavedAt = computed(() => props.source?.savedAt.value ?? props.savedAt ?? '');

const savedText = computed(() => currentSavedAt.value ? t('admin.forms.saveState.savedAt', { time: currentSavedAt.value }) : t('admin.forms.saveState.saved'));

/** The one announcement: the save time, or what went wrong. */
const announcement = computed(() => {
    switch (currentState.value) {
        case 'failed': return t('admin.forms.saveState.failed');
        case 'conflict': return t('admin.forms.saveState.conflict');
        case 'forbidden': return t('admin.forms.saveState.forbidden', { reason: props.reason ?? '' });
        case 'invalid': return t(props.invalidTarget === 'condition' || props.invalidTarget === 'label' ? 'admin.forms.saveState.notSavedReason' : 'admin.forms.saveState.invalid', { reason: props.reason ?? '' });
        default: return currentSavedAt.value ? savedText.value : '';
    }
});

const visibleText = computed(() => {
    if (currentState.value === 'saving') return t('admin.forms.saveState.saving');
    if (currentState.value === 'pending') return t('admin.forms.saveState.pending');
    return savedText.value;
});

const visibleIcon = computed(() => {
    if (currentState.value === 'saving') return 'i-lucide-loader-circle';
    if (currentState.value === 'pending') return 'i-lucide-clock';
    return 'i-lucide-check';
});

/*
 * "erneut versuchen" disables itself while it runs (loading), so the browser
 * drops the focus on the page before the state changes. The button remembers where the focus came
 * from: after a retry that worked the focus goes back there (else to the state); after one that
 * failed again, back to the button.
 */
let focusBeforeRetry: HTMLElement | null = null;
let retryStarted = false;

function onRetryFocusIn(event: FocusEvent) {
    const previous = event.relatedTarget;
    if (previous instanceof HTMLElement && !previous.closest('[data-test="editor-save-state"]')) focusBeforeRetry = previous;
}

function onRetry() {
    retryStarted = true;
    emit('retry');
}

watch(() => [currentState.value, props.retrying] as const, ([state, retrying], [before, wasRetrying]) => {
    if (!retryStarted) return;
    if (state === 'failed' && wasRetrying && !retrying) {
        retryStarted = false;
        void nextTick(() => (retryButton.value?.$el as HTMLElement | undefined)?.focus());
        return;
    }
    if (before === 'failed' && state !== 'failed') {
        retryStarted = false;
        const target = focusBeforeRetry?.isConnected ? focusBeforeRetry : null;
        focusBeforeRetry = null;
        void nextTick(() => (target ?? status.value)?.focus());
    }
});
</script>

<template>
  <div
    class="flex min-h-8 items-center"
    data-test="editor-save-state"
    :data-state="currentState"
  >
    <span
      class="sr-only"
      role="status"
      aria-live="polite"
      data-test="editor-save-announcement"
    >{{ announcement }}</span>

    <UButton
      v-if="currentState === 'failed'"
      ref="retryButton"
      size="xs"
      icon="i-lucide-circle-alert"
      color="error"
      variant="link"
      :loading="retrying"
      :aria-label="t('admin.forms.saveState.failed')"
      data-test="editor-save-retry"
      @focusin="onRetryFocusIn"
      @click="onRetry"
    >
      <span class="max-[359px]:hidden">{{ t('admin.forms.saveState.failed') }}</span>
      <span
        class="min-[360px]:hidden"
        aria-hidden="true"
      >{{ t('admin.forms.saveState.retryShort') }}</span>
    </UButton>

    <!-- Conflict, refusal, invalid setting: what is true, and the one action that can work. -->
    <!-- No wider than the screen, like every floating text of the editor's head. -->
    <UPopover
      v-else-if="currentState === 'conflict' || currentState === 'forbidden' || currentState === 'invalid'"
      :content="{ align: 'end' }"
      :ui="VIEWPORT_BOUND_UI"
    >
      <UButton
        color="neutral"
        variant="outline"
        size="xs"
        icon="i-lucide-circle-alert"
        data-test="editor-save-problem"
      >
        {{ t('admin.forms.saveState.notSaved') }}
      </UButton>
      <template #content>
        <div
          class="max-w-sm space-y-3 p-4 text-sm"
          data-test="editor-save-problem-text"
        >
          <p>{{ announcement }}</p>
          <UButton
            v-if="currentState === 'conflict'"
            color="neutral"
            variant="outline"
            data-test="editor-save-reload"
            @click="emit('reload')"
          >
            {{ t('admin.forms.saveState.reload') }}
          </UButton>
          <UButton
            v-else-if="currentState === 'invalid'"
            color="neutral"
            variant="outline"
            data-test="editor-save-open-settings"
            @click="emit('open-settings')"
          >
            {{ invalidTarget === 'label' ? t('admin.forms.saveState.toLabel') : invalidTarget === 'condition' ? t('admin.forms.saveState.toCondition') : t('admin.forms.formSettings') }}
          </UButton>
        </div>
      </template>
    </UPopover>

    <div
      v-else
      ref="status"
      tabindex="-1"
      data-test="editor-save-text"
    >
      <span class="inline-flex items-center gap-1 whitespace-nowrap text-xs text-muted">
        <UIcon
          :name="visibleIcon"
          aria-hidden="true"
          data-test="editor-save-icon"
        />
        {{ visibleText }}
      </span>
    </div>
  </div>
</template>
