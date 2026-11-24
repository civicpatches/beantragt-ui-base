<script lang="ts">
/** One status as a row of the editor, in the order the page passes them. */
</script>

<script setup lang="ts">
/**
 * Allowed transitions as one line per status: the status at the left, the
 * statuses that may come next as chips at the right. Fully controlled: the
 * page owns the data and decides when a change is stored; the editor only
 * emits what a person asked for. Focus and the live region follow the
 * transitions the page passes back, so a save that fails on the server moves
 * nothing and announces nothing.
 */
import { computed, nextTick, ref, useId, watch } from 'vue';
import type { DropdownMenuItem } from '@nuxt/ui';

export interface WorkflowTransitionsEditorStatus {
    /** What a transition refers to: a machine name on the form page, an id in the catalogue. */
    key: string
    label: string
    color?: string
    isTerminal: boolean
    /** The status an application starts in. */
    isStart?: boolean
    /** Nothing in this row can be changed (no add, no remove), for example a final status in the catalogue. */
    locked?: boolean
}

export interface WorkflowTransitionsEditorTransition {
    from: string
    to: string
    condition?: string
    /** Fields the status dialog asks for on this transition (form page; imported, not edited here). */
    attributes?: unknown[]
}

const props = withDefaults(defineProps<{
    statuses: WorkflowTransitionsEditorStatus[]
    transitions: WorkflowTransitionsEditorTransition[]
    readOnly?: boolean
    /** Show and edit the "Bedingung/Hinweis" of a transition. */
    conditions?: boolean
    /** Key of the status whose row is being saved; its controls ignore input until it is done. */
    busyFrom?: string | null
    /**
     * When a change is stored: `immediate` saves each
     * chip at once (settings), `deferred` keeps it until "Speichern" (form
     * page). The editor says so under the heading and in its announcements.
     */
    saveMode?: 'immediate' | 'deferred' | null
    /** Deferred mode: the page has changes that are not saved yet. */
    unsaved?: boolean
}>(), {
    readOnly: false,
    conditions: false,
    busyFrom: null,
    saveMode: null,
    unsaved: false
});

const emit = defineEmits<{
    'add': [from: string, to: string]
    'remove': [from: string, to: string]
    'update-condition': [from: string, to: string, value: string]
}>();

defineSlots<{
    /** Extra lines under the status name, for example its description. */
    'status-details'?: (props: { status: WorkflowTransitionsEditorStatus }) => unknown
}>();

const { t } = useI18n();
const idBase = useId();
const root = ref<HTMLElement | null>(null);

interface Chip {
    transition: WorkflowTransitionsEditorTransition
    label: string
    color?: string
}

interface Row {
    status: WorkflowTransitionsEditorStatus
    index: number
    chips: Chip[]
    addable: WorkflowTransitionsEditorStatus[]
    canAdd: boolean
    canRemove: boolean
}

const statusIndex = computed(() => new Map(props.statuses.map((status, index) => [status.key, index])));

function statusLabel(key: string): string {
    const index = statusIndex.value.get(key);
    return index === undefined ? key : props.statuses[index]!.label;
}

const rows = computed<Row[]>(() => props.statuses.map((status, index) => {
    const seen = new Set<string>();
    const outgoing = props.transitions
        .filter((transition) => {
            if (transition.from !== status.key || seen.has(transition.to)) return false;
            seen.add(transition.to);
            return true;
        })
        // Catalogue order; a target the list does not know goes last.
        .sort((a, b) => (statusIndex.value.get(a.to) ?? Number.MAX_SAFE_INTEGER) - (statusIndex.value.get(b.to) ?? Number.MAX_SAFE_INTEGER));
    const canAdd = !props.readOnly && !status.locked && !status.isTerminal;
    return {
        status,
        index,
        chips: outgoing.map((transition) => {
            const targetIndex = statusIndex.value.get(transition.to);
            const target = targetIndex === undefined ? undefined : props.statuses[targetIndex];
            return { transition, label: target?.label ?? transition.to, color: target?.color };
        }),
        addable: canAdd ? props.statuses.filter(item => item.key !== status.key && !seen.has(item.key)) : [],
        canAdd,
        canRemove: !props.readOnly && !status.locked
    };
}));

// Transitions out of a final status no longer apply (the backend allows
// nothing after a final status), so they are not counted as allowed.
const transitionCount = computed(() => rows.value.reduce((sum, row) => sum + (row.status.isTerminal ? 0 : row.chips.length), 0));
const summary = computed(() => t('admin.workflowTransitions.summary', {
    statuses: t('admin.workflowTransitions.statusCount', { count: props.statuses.length }),
    transitions: t('admin.workflowTransitions.transitionCount', { count: transitionCount.value })
}));

function nameId(row: Row): string {
    return `${idBase}-status-${row.index}`;
}

function nextId(row: Row): string {
    return `${idBase}-next-${row.index}`;
}

function conditionId(row: Row, chipIndex: number): string {
    return `${idBase}-condition-${row.index}-${chipIndex}`;
}

// A final status without chips says so in the right column ("Endstatus,
// danach nichts"); with stale chips its role line says "Endstatus" and the
// chips stand under a sentence that they no longer apply.
function roleLine(row: Row): string {
    if (row.status.isTerminal && row.chips.length) return t('admin.workflowTransitions.terminalRole');
    return row.status.isStart ? t('admin.forms.workflowDefault') : '';
}

function nextLead(row: Row): string {
    return row.status.isTerminal && row.chips.length
        ? t('admin.workflowTransitions.staleLead')
        : t('admin.workflowTransitions.next');
}

const saveHint = computed(() => {
    if (props.readOnly || !props.saveMode) return '';
    return t(props.saveMode === 'immediate' ? 'admin.workflowTransitions.saveImmediate' : 'admin.workflowTransitions.saveDeferred');
});

function emptyText(row: Row): string {
    return row.status.isTerminal
        ? t('admin.workflowTransitions.terminalNone')
        : t('admin.workflowTransitions.noNext');
}

function transitionName(from: string, to: string): string {
    return t('admin.workflowTransitions.transition', { from: statusLabel(from), to: statusLabel(to) });
}

function removeName(from: string, to: string): string {
    return t('admin.workflowTransitions.remove', { from: statusLabel(from), to: statusLabel(to) });
}

function isBusy(row: Row): boolean {
    return props.busyFrom !== null && props.busyFrom === row.status.key;
}

// ── Change requests, focus and announcement ─────────────────────────
interface PendingChange {
    kind: 'add' | 'remove'
    from: string
    to: string
    /** Position of the removed chip in its row. */
    chipIndex: number
    /** A removed transition had a condition or fields; captured at the request, the transition is gone by then. */
    hadDetails?: boolean
}

const pending = ref<PendingChange | null>(null);
const announcement = ref('');

function hasTransition(from: string, to: string): boolean {
    return props.transitions.some(transition => transition.from === from && transition.to === to);
}

function requestAdd(row: Row, target: WorkflowTransitionsEditorStatus) {
    if (!row.canAdd || isBusy(row) || target.key === row.status.key || hasTransition(row.status.key, target.key)) return;
    pending.value = { kind: 'add', from: row.status.key, to: target.key, chipIndex: -1 };
    emit('add', row.status.key, target.key);
    void settleIfIgnored();
}

function requestRemove(row: Row, chip: Chip, chipIndex: number) {
    if (!row.canRemove || isBusy(row)) return;
    openChip.value = null;
    const hadDetails = Boolean(chip.transition.condition) || (chip.transition.attributes?.length ?? 0) > 0;
    pending.value = { kind: 'remove', from: row.status.key, to: chip.transition.to, chipIndex, hadDetails };
    emit('remove', row.status.key, chip.transition.to);
    void settleIfIgnored();
}

/** A page that refused the change synchronously and is not saving: forget the request. */
async function settleIfIgnored() {
    const request = pending.value;
    await nextTick();
    if (pending.value === request && request && props.busyFrom !== request.from) {
        pending.value = null;
    }
}

function addMenuItems(row: Row): DropdownMenuItem[][] {
    return [row.addable.map(target => ({
        label: target.label,
        onSelect: () => requestAdd(row, target)
    }))];
}

function focusables(): HTMLElement[] {
    return root.value ? [...root.value.querySelectorAll<HTMLElement>('[data-transition-focus]')] : [];
}

function focusChip(from: string, to: string): boolean {
    const element = focusables().find(item => item.dataset.transitionFrom === from && item.dataset.transitionTo === to && item.dataset.transitionFocus === 'chip');
    element?.focus();
    return Boolean(element);
}

function focusAddControl(from: string): boolean {
    const element = focusables().find(item => item.dataset.transitionFrom === from && item.dataset.transitionFocus === 'add');
    element?.focus();
    return Boolean(element);
}

async function announce(text: string) {
    // Clearing first lets the same sentence be read again.
    announcement.value = '';
    await nextTick();
    announcement.value = text;
}

/**
 * Whether the focus is still with the editor: in the list, in the closing add
 * menu or condition popover (both render outside it), or lost with a removed
 * control. A person who moved on elsewhere while the page saved keeps their place.
 */
function focusIsOurs(): boolean {
    const active = document.activeElement;
    if (!active || active === document.body) return true;
    return Boolean(root.value?.contains(active) || active.closest('[role="menu"], [role="dialog"]'));
}

function settle() {
    const request = pending.value;
    if (!request) return;
    const exists = hasTransition(request.from, request.to);
    const names = { from: statusLabel(request.from), to: statusLabel(request.to) };
    if (request.kind === 'add' && exists) {
        pending.value = null;
        void announce(t(changeKey('added'), names));
        if (focusIsOurs() && !focusAddControl(request.from)) focusChip(request.from, request.to);
        return;
    }
    if (request.kind === 'remove' && !exists) {
        pending.value = null;
        void announce(t(request.hadDetails && props.saveMode === 'deferred' ? 'admin.workflowTransitions.removedPendingDetails' : changeKey('removed'), names));
        if (!focusIsOurs()) return;
        const row = rows.value.find(item => item.status.key === request.from);
        const chips = row?.chips ?? [];
        const next = chips[Math.min(request.chipIndex, chips.length - 1)];
        if (!(next && focusChip(request.from, next.transition.to))) focusAddControl(request.from);
    }
}

/** The announcement says whether the change is stored. */
function changeKey(kind: 'added' | 'removed'): string {
    if (props.saveMode === 'immediate') return `admin.workflowTransitions.${kind}Saved`;
    if (props.saveMode === 'deferred') return `admin.workflowTransitions.${kind}Pending`;
    return `admin.workflowTransitions.${kind}`;
}

const rowsSignature = computed(() =>
    rows.value.map(row => `${row.status.key}>${row.chips.map(chip => chip.transition.to).join(',')}`).join('|')
);

watch(rowsSignature, settle, { flush: 'post' });
// A save that ended without the change (an error on the server) keeps the
// focus where it is and announces nothing.
watch(() => props.busyFrom, (busy) => {
    if (busy === null && pending.value) pending.value = null;
}, { flush: 'post' });

// ── Condition popover ───────────────────────────────────────────────
const openChip = ref<string | null>(null);

function chipKey(row: Row, chip: Chip): string {
    return `${row.status.key}>${chip.transition.to}`;
}

function setChipOpen(row: Row, chip: Chip, open: boolean) {
    if (open) {
        openChip.value = chipKey(row, chip);
    } else if (openChip.value === chipKey(row, chip)) {
        openChip.value = null;
    }
}

const popoverContent = {
    align: 'start' as const,
    // Escape or a close from inside: Reka returns the focus to the chip (a
    // click elsewhere keeps it there). While a removal is under way the chip
    // is about to disappear; settle() moves the focus to the next one.
    onCloseAutoFocus: (event: Event) => {
        if (pending.value?.kind === 'remove') event.preventDefault();
    }
};
</script>

<template>
  <div
    ref="root"
    class="space-y-3"
  >
    <p
      class="text-sm text-muted"
      data-test="workflow-transitions-summary"
    >
      {{ summary }}
    </p>
    <p
      v-if="saveHint"
      class="flex flex-wrap items-center gap-2 text-sm text-muted"
      data-test="workflow-transitions-save-hint"
    >
      <span>{{ saveHint }}</span>
      <UBadge
        v-if="saveMode === 'deferred' && unsaved"
        color="warning"
        icon="i-lucide-circle-dot"
        data-test="workflow-transitions-unsaved"
      >
        {{ t('admin.workflowTransitions.unsaved') }}
      </UBadge>
    </p>

    <!-- Column labels once; when the rows stack on narrow screens each row carries its own lead. -->
    <div
      class="hidden gap-6 text-sm text-muted sm:flex"
      aria-hidden="true"
    >
      <span class="w-52 shrink-0">{{ t('admin.table.status') }}</span>
      <span>{{ t('admin.workflowTransitions.next') }}</span>
    </div>

    <ul
      class="divide-y divide-default"
      data-test="workflow-transitions-list"
    >
      <li
        v-for="row in rows"
        :key="row.status.key"
        :aria-labelledby="nameId(row)"
        :aria-busy="isBusy(row) || undefined"
        class="flex min-w-0 flex-col gap-1.5 py-2.5 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:gap-6"
        data-test="workflow-transition-row"
        :data-status="row.status.key"
      >
        <div class="min-w-0 sm:w-52 sm:shrink-0">
          <div class="flex min-w-0 items-center gap-2">
            <span
              class="size-3 shrink-0 rounded-full ring-1 ring-accented"
              :style="{ backgroundColor: row.status.color || 'var(--ui-text-muted)' }"
              aria-hidden="true"
            />
            <span
              :id="nameId(row)"
              class="min-w-0 break-words font-medium text-highlighted"
            >{{ row.status.label }}</span>
          </div>
          <p
            v-if="roleLine(row)"
            class="mt-0.5 ps-5 text-sm text-muted"
            data-test="workflow-transition-role"
          >
            {{ roleLine(row) }}
          </p>
          <div
            v-if="$slots['status-details']"
            class="ps-5"
          >
            <slot
              name="status-details"
              :status="row.status"
            />
          </div>
        </div>

        <div class="min-w-0 flex-1">
          <template v-if="row.chips.length || row.addable.length">
            <span
              :id="nextId(row)"
              class="mb-1 block text-sm text-muted"
              :class="row.status.isTerminal && row.chips.length ? undefined : 'sm:hidden'"
              data-test="workflow-transition-lead"
            >{{ nextLead(row) }}</span>
            <ul
              class="flex min-w-0 flex-wrap items-center gap-1.5"
              :aria-labelledby="`${nameId(row)} ${nextId(row)}`"
            >
              <li
                v-if="!row.chips.length"
                class="text-sm text-muted"
                data-test="workflow-transition-empty"
              >
                {{ emptyText(row) }}
              </li>
              <li
                v-for="(chip, chipIndex) in row.chips"
                :key="chip.transition.to"
                class="flex min-w-0 max-w-full flex-col gap-0.5"
                data-test="workflow-transition-chip"
                :data-to="chip.transition.to"
              >
                <!-- Editable with conditions: the chip opens the condition, the X removes it. -->
                <UBadge
                  v-if="row.canRemove && conditions"
                  color="neutral"
                  variant="outline"
                  class="max-w-full gap-0 p-0.5"
                >
                  <UPopover
                    :open="openChip === chipKey(row, chip)"
                    :content="popoverContent"
                    @update:open="(open: boolean) => setChipOpen(row, chip, open)"
                  >
                    <UButton
                      color="neutral"
                      variant="ghost"
                      size="xs"
                      class="min-w-0 text-sm font-medium"
                      :aria-label="transitionName(row.status.key, chip.transition.to)"
                      :aria-describedby="chip.transition.condition ? conditionId(row, chipIndex) : undefined"
                      data-transition-focus="chip"
                      :data-transition-from="row.status.key"
                      :data-transition-to="chip.transition.to"
                    >
                      <span
                        class="size-2 shrink-0 rounded-full ring-1 ring-accented"
                        :style="{ backgroundColor: chip.color || 'var(--ui-text-muted)' }"
                        aria-hidden="true"
                      />
                      <span class="min-w-0 break-words text-start">{{ chip.label }}</span>
                      <UTooltip
                        v-if="chip.transition.condition"
                        :text="chip.transition.condition"
                        :disabled="openChip === chipKey(row, chip)"
                      >
                        <UIcon
                          name="i-lucide-sticky-note"
                          class="size-4 shrink-0 text-muted"
                          data-test="workflow-transition-condition-icon"
                        />
                      </UTooltip>
                    </UButton>

                    <template #content>
                      <div
                        class="w-72 max-w-full space-y-3 p-3"
                        data-test="workflow-transition-popover"
                      >
                        <p class="text-sm font-medium text-highlighted">
                          {{ transitionName(row.status.key, chip.transition.to) }}
                        </p>
                        <UFormField
                          :label="t('admin.forms.workflowTransitionConditionLabel')"
                          :name="`condition-${row.index}-${chipIndex}`"
                        >
                          <UInput
                            :model-value="chip.transition.condition || ''"
                            :placeholder="t('admin.forms.workflowTransitionCondition')"
                            class="w-full"
                            data-test="workflow-transition-condition-input"
                            @update:model-value="(value: string | number) => emit('update-condition', row.status.key, chip.transition.to, String(value))"
                          />
                        </UFormField>
                        <UButton
                          color="neutral"
                          variant="outline"
                          size="sm"
                          icon="i-lucide-x"
                          data-test="workflow-transition-popover-remove"
                          @click="requestRemove(row, chip, chipIndex)"
                        >
                          {{ t('admin.workflowTransitions.removeShort') }}
                        </UButton>
                      </div>
                    </template>
                  </UPopover>
                  <UButton
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    square
                    icon="i-lucide-x"
                    class="shrink-0"
                    :aria-label="removeName(row.status.key, chip.transition.to)"
                    data-test="workflow-transition-remove"
                    @click="requestRemove(row, chip, chipIndex)"
                  />
                </UBadge>

                <!-- Editable without conditions, or read-only: the chip is text, the X (if any) removes it. -->
                <UBadge
                  v-else
                  color="neutral"
                  variant="outline"
                  class="max-w-full"
                  :class="row.canRemove ? 'py-0.5 pe-0.5' : undefined"
                >
                  <span
                    class="size-2 shrink-0 rounded-full ring-1 ring-accented"
                    :style="{ backgroundColor: chip.color || 'var(--ui-text-muted)' }"
                    aria-hidden="true"
                  />
                  <span class="min-w-0 break-words text-start">{{ chip.label }}</span>
                  <UButton
                    v-if="row.canRemove"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    square
                    icon="i-lucide-x"
                    class="shrink-0"
                    :aria-label="removeName(row.status.key, chip.transition.to)"
                    data-transition-focus="chip"
                    :data-transition-from="row.status.key"
                    :data-transition-to="chip.transition.to"
                    data-test="workflow-transition-remove"
                    @click="requestRemove(row, chip, chipIndex)"
                  />
                </UBadge>

                <span
                  v-if="conditions && chip.transition.condition"
                  :id="conditionId(row, chipIndex)"
                  :class="row.canRemove ? 'sr-only' : 'break-words ps-1 text-sm text-muted'"
                  data-test="workflow-transition-condition"
                >{{ row.canRemove ? t('admin.workflowTransitions.conditionDescription', { condition: chip.transition.condition }) : chip.transition.condition }}</span>
              </li>
              <li v-if="row.addable.length">
                <UDropdownMenu
                  :items="addMenuItems(row)"
                  :content="{ align: 'start' }"
                >
                  <UButton
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    icon="i-lucide-plus"
                    :aria-label="t('admin.workflowTransitions.addFor', { status: row.status.label })"
                    data-transition-focus="add"
                    :data-transition-from="row.status.key"
                    data-test="workflow-transition-add"
                  >
                    {{ t('admin.workflowTransitions.addNext') }}
                  </UButton>
                </UDropdownMenu>
              </li>
            </ul>
          </template>
          <span
            v-else
            class="text-sm text-muted"
            data-test="workflow-transition-empty"
          >{{ emptyText(row) }}</span>
        </div>
      </li>
    </ul>

    <!-- With a save mode the last change also stays visible, saying whether it is stored. -->
    <p
      :class="saveMode && !readOnly ? 'text-sm text-muted' : 'sr-only'"
      role="status"
      aria-live="polite"
      data-test="workflow-transitions-live"
    >
      {{ announcement }}
    </p>
  </div>
</template>
