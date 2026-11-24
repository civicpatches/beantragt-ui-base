<script setup lang="ts">
/**
 * One reason line for "not available for your role or level".
 *
 * Shown next to a control that is disabled or absent for the current role or
 * workspace level. The disabled control points to it with
 * `aria-describedby="<id>"`, so a screen reader reads the reason with the
 * control, and sighted people see it without hovering (a tooltip on a
 * disabled button reaches nobody on a keyboard).
 *
 * Pass `reason` for the shared role and level texts (`access.reasons.*`, the
 * same texts the function search shows), or `text` for a sentence that names
 * the concrete right. The server stays the authority: this line only explains
 * a rule the interface already applies.
 *
 * The default slot holds a way out (a link) that belongs to the sentence:
 * it is rendered inside the text column after the message, so it wraps to
 * the sentence's edge, not under the lock.
 *
 * Align the reason with the text it belongs to.
 * Locked by the state of a row: the last line of the row's text column, with
 * `class="mt-1"`. Locked card action: the first line of the card body. Locked
 * header action or a role: one line under the page description. The sentence
 * itself is never wider than `max-w-prose`.
 */
export type AccessReasonKind = 'staff' | 'admin' | 'platformAdmin' | 'municipality' | 'organisation';

const props = defineProps<{
    id: string
    reason?: AccessReasonKind
    text?: string
}>();

const { t } = useI18n();

const message = computed(() => props.text || (props.reason ? t(`access.reasons.${props.reason}`) : ''));
</script>

<template>
  <p
    v-if="message"
    :id="id"
    class="flex items-start gap-1.5 text-sm text-(--ui-text-muted)"
    data-testid="access-reason"
  >
    <UIcon
      name="i-lucide-lock"
      class="mt-0.5 size-3.5 shrink-0"
      aria-hidden="true"
    />
    <!-- wrap-anywhere: a word wider than the column (a long status name
         in a reason) breaks instead of overflowing; normal words still wrap
         at spaces. -->
    <span
      class="min-w-0 max-w-prose wrap-anywhere"
      data-testid="access-reason-text"
    >{{ message }}<template v-if="$slots.default">{{ ' ' }}<slot /></template></span>
  </p>
</template>
