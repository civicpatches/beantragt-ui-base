<script setup lang="ts">
import { useApplicationEvents } from '~/composables/useApplicationEvents';
import ApplicationSectionEventPill from '~/components/ApplicationSectionEventPill.vue';
import { useId } from 'vue';
import AppCard from '~/components/app/Card.vue';
import type { AdminAssignmentInlineError } from '~~/casework-layer/app/composables/useAdminApplicationAssignment';

const { count: eventCount, eventIds } = useApplicationEvents();
const props = withDefaults(defineProps<{
    status: string
    hasError: boolean
    displayLabel: string
    hasCandidates: boolean
    canChange: boolean
    personalAssignmentEnabled?: boolean
    isSaving: boolean
    hasDelegationTargets?: boolean
    /**
     * The role may change the responsible office here (backend `can_delegate`).
     * `false` shows who can; `undefined` (not known) shows nothing.
     */
    canDelegate?: boolean
    currentResponsibilityLabel?: string | null
    isDelegating?: boolean
    /** "Mir zuweisen" is possible: the own account is a candidate and not yet assigned. */
    canAssignSelf?: boolean
    /** Failure of "Mir zuweisen"; the dialog shows its own errors. */
    selfAssignError?: AdminAssignmentInlineError | null
    /** Who holds the case when "Mir zuweisen" would take it over (empty name: not available); `null` when unassigned. */
    selfAssignTakesOverFrom?: { name: string, team: boolean } | null
}>(), { personalAssignmentEnabled: true, canDelegate: undefined, canAssignSelf: false, selfAssignError: null, selfAssignTakesOverFrom: null });

const emit = defineEmits<{
    (event: 'retry' | 'open-assign' | 'open-delegation' | 'assign-self' | 'reload'): void
}>();

const { t } = useI18n();
const delegationReasonId = `assignment-delegation-reason-${useId()}`;

/** Taking a case over from someone else asks first; an unassigned case stays one click. */
const takeOverPending = ref(false);
const takeOverText = computed(() => {
    const holder = props.selfAssignTakesOverFrom;
    if (!holder?.name) return t('admin.detail.assignment.takeOverQuestionUnknown');
    return t(holder.team ? 'admin.detail.assignment.takeOverQuestionTeam' : 'admin.detail.assignment.takeOverQuestion', { name: holder.name });
});
function requestSelfAssign() {
    if (props.selfAssignTakesOverFrom !== null) {
        takeOverPending.value = true;
        return;
    }
    startSelfAssign();
}
const takeOverActions = computed(() => [
    { label: t('admin.detail.assignment.takeOverConfirm'), color: 'warning' as const, variant: 'solid' as const, onClick: () => startSelfAssign() },
    { label: t('common.cancel'), color: 'neutral' as const, variant: 'ghost' as const, onClick: cancelTakeOver }
]);
watch(() => props.selfAssignTakesOverFrom, (holder) => {
    if (holder === null) takeOverPending.value = false;
});

/**
 * "Mir zuweisen" disappears after it worked. Once the card stands again (no skeleton,
 * not saving), focus goes to "Zuweisung ändern", else to the card heading; on a failure back to "Mir zuweisen".
 */
const selfAssignRequested = ref(false);
const selfAssignButton = ref<{ $el?: HTMLElement } | null>(null);
const changeButton = ref<{ $el?: HTMLElement } | null>(null);
/** `AppCard` has no heading ref: the named card root takes the focus instead. */
const card = ref<{ $el?: HTMLElement } | null>(null);
function startSelfAssign() {
    takeOverPending.value = false;
    selfAssignRequested.value = true;
    emit('assign-self');
}
function cancelTakeOver() {
    takeOverPending.value = false;
    nextTick(() => focusElement(selfAssignButton.value?.$el));
}
function focusElement(element: unknown): boolean {
    if (!(element instanceof HTMLElement)) return false;
    element.focus();
    return document.activeElement === element;
}
watch(() => [props.isSaving, props.status, props.canAssignSelf, props.selfAssignError] as const, ([saving, status, canAssign, error]) => {
    if (!selfAssignRequested.value || saving || status === 'pending') return;
    selfAssignRequested.value = false;
    // Failure: "Mir zuweisen" is still there (after "Übernehmen" the question, and its focused button, are gone).
    if (error || canAssign) {
        nextTick(() => focusElement(selfAssignButton.value?.$el));
        return;
    }
    nextTick(() => {
        if (!focusElement(changeButton.value?.$el)) focusElement(card.value?.$el);
    });
});
</script>

<template>
  <!-- Two facts, each with its action; outline buttons of natural width, no icons. -->
  <AppCard
    ref="card"
    :data-event-ready="status !== 'pending' && !hasError"
    :title="t('admin.detail.assignmentTitle')"
    icon="i-lucide-user-check"
    role="region"
    :aria-label="t('admin.detail.assignmentTitle')"
    tabindex="-1"
    class="outline-none focus-visible:ring-2 focus-visible:ring-primary"
  >
    <template #badge>
      <ApplicationSectionEventPill kind="assigned" />
    </template>
    <div
      v-if="status === 'pending'"
      class="space-y-3"
    >
      <USkeleton class="h-4 w-2/3" />
      <USkeleton class="h-8 w-40" />
    </div>
    <UAlert
      v-else-if="hasError"
      role="status"
      color="warning"
      icon="i-lucide-triangle-alert"
      :title="t('admin.detail.assigneesLoadFailed')"
      :actions="[{ label: t('common.retry'), color: 'neutral', variant: 'outline', onClick: () => emit('retry') }]"
    />
    <template v-else>
      <div>
        <p class="text-sm text-muted">
          {{ t('admin.detail.currentAssignee') }}
        </p>
        <p
          class="break-words text-sm font-medium text-default"
          data-testid="assignment-current"
        >
          {{ displayLabel }}
          <UBadge
            v-if="eventCount('assigned') > 0 && !eventIds('assigned').length"
            data-test="event-new"
          >
            {{ t('comments.new') }}
          </UBadge>
        </p>
      </div>
      <ul
        v-if="eventIds('assigned').length"
        class="text-sm text-default"
        :aria-label="t('admin.detail.eventWidget.assignments')"
      >
        <li
          v-for="(id, index) in eventIds('assigned')"
          :key="id"
          :data-event-target="`assigned:${id}`"
          class="application-event-entry rounded px-1 py-2"
        >
          {{ t('admin.detail.eventWidget.assignmentEntry', { number: index + 1 }) }}
          <UBadge data-test="event-new">
            {{ t('comments.new') }}
          </UBadge>
        </li>
      </ul>
      <div
        v-if="canAssignSelf || canChange"
        class="flex flex-wrap gap-2"
      >
        <UButton
          v-if="canAssignSelf"
          ref="selfAssignButton"
          color="neutral"
          variant="outline"
          :loading="isSaving"
          :disabled="status !== 'success' || isSaving"
          data-testid="assign-self"
          @click="requestSelfAssign"
        >
          {{ t('admin.detail.assignment.assignSelf') }}
        </UButton>
        <UButton
          v-if="canChange"
          ref="changeButton"
          color="neutral"
          variant="outline"
          :loading="isSaving && !canAssignSelf"
          :disabled="status !== 'success' || isSaving"
          data-testid="assignment-change"
          @click="emit('open-assign')"
        >
          {{ t('admin.detail.assignment.triggerLabel') }}
        </UButton>
      </div>
      <UAlert
        v-if="takeOverPending && canAssignSelf"
        role="status"
        color="warning"
        icon="i-lucide-triangle-alert"
        :title="takeOverText"
        :actions="takeOverActions"
        data-testid="assign-self-take-over"
      />
      <UAlert
        v-if="selfAssignError"
        :role="selfAssignError.kind === 'conflict' ? 'status' : 'alert'"
        :color="selfAssignError.kind === 'conflict' ? 'warning' : 'error'"
        :icon="selfAssignError.kind === 'conflict' ? 'i-lucide-triangle-alert' : 'i-lucide-circle-x'"
        :title="selfAssignError.message"
        :description="selfAssignError.detail"
        :actions="selfAssignError.kind === 'conflict'
          ? [{ label: t('admin.detail.assignment.reloadAction'), color: 'neutral', variant: 'outline', onClick: () => emit('reload') }]
          : undefined"
        data-testid="assign-self-error"
      />
      <p
        v-if="personalAssignmentEnabled === false"
        class="max-w-prose text-sm text-muted"
      >
        {{ t('admin.detail.assignment.personalAssignmentDisabled') }}
      </p>
      <p
        v-if="!hasCandidates"
        class="max-w-prose text-sm text-muted"
      >
        {{ t(personalAssignmentEnabled === false ? 'admin.detail.assignment.teamsEmpty' : 'admin.detail.assigneesEmpty') }}
      </p>
      <!-- Every role sees which office owns the case; only roles with the right get the button. -->
      <div
        v-if="currentResponsibilityLabel || hasDelegationTargets || canDelegate === false"
        class="space-y-2 border-t border-default pt-4"
        data-testid="assignment-responsibility"
      >
        <div v-if="currentResponsibilityLabel">
          <p class="text-sm text-muted">
            {{ t('admin.detail.delegation.currentResponsibilityLabel') }}
          </p>
          <p
            class="break-words text-sm font-medium text-default"
            data-testid="assignment-responsibility-value"
          >
            {{ currentResponsibilityLabel }}
          </p>
        </div>
        <AccessReason
          v-if="!hasDelegationTargets && canDelegate === false"
          :id="delegationReasonId"
          class="mt-1"
          :text="t('admin.detail.delegation.adminOnly')"
        />
        <UButton
          v-if="hasDelegationTargets"
          color="neutral"
          variant="outline"
          :loading="isDelegating"
          :disabled="isSaving || isDelegating"
          @click="emit('open-delegation')"
        >
          {{ t('admin.detail.delegation.triggerLabel') }}
        </UButton>
      </div>
    </template>
  </AppCard>
</template>
