<script setup lang="ts">
import type { CommandPaletteGroup, CommandPaletteItem } from '@nuxt/ui';
import type {
    AdminApplicationAssignee,
    AdminApplicationDelegationTarget
} from '~/types';
import type {
    AdminAssignmentInlineError,
    AdminAssignmentSelection
} from '~~/casework-layer/app/composables/useAdminApplicationAssignment';
import type { PublicOrgNode } from '~/types/org-catalog';
import {
    assignmentSelectionValue,
    parseAssignmentSelection,
    UNASSIGNED_ASSIGNEE_VALUE
} from '~~/casework-layer/app/composables/useAdminApplicationAssignment';
import {
    buildDelegationOrgPath,
    filterDelegationTargets,
    joinTargetsWithCatalog,
    type DelegationTargetWithCatalog
} from '~~/casework-layer/app/utils/delegation-palette';
import {
    filterPersonCandidates,
    teamCandidateToDelegationTarget
} from '~~/casework-layer/app/utils/assignment-palette';
import { normalizeSearchValue } from '~~/casework-layer/app/utils/org-catalog-palette';

type AssignmentTargetKind = 'user' | 'team' | 'none';

type SelectedAssignmentTarget = {
    kind: AssignmentTargetKind
    id: string | null
    label: string
    value: string
};

type AssignmentPaletteItem = CommandPaletteItem & {
    id: string
    slot: 'unassigned' | 'person' | 'org' | 'target' | 'out-of-scope' | 'empty-candidates'
    value: string
    kind: AssignmentTargetKind
    label: string
    ariaLabel: string
    displayLabel: string
    description?: string
    icon?: string
    candidate?: AdminApplicationAssignee
    delegationTarget?: AdminApplicationDelegationTarget
    node?: PublicOrgNode | null
    path: string[]
    current: boolean
    /** The signed-in account. */
    self?: boolean
    disabled?: boolean
};

const props = withDefaults(defineProps<{
    open: boolean
    currentAssignee: AdminApplicationAssignee | null
    candidates: AdminApplicationAssignee[]
    teamCandidates: AdminApplicationAssignee[]
    displayLabel: string
    hasCandidates: boolean
    personalAssignmentEnabled?: boolean
    currentAssigneeOutOfScope: boolean
    currentResponsibilityLabel?: string | null
    /** The role has "Zuständigkeit ändern" on this case; otherwise the footer says who has it. */
    delegationAvailable?: boolean
    jurisdictionSlug?: string | null
    isSaving?: boolean
    error?: AdminAssignmentInlineError | null
}>(), {
    currentResponsibilityLabel: null,
    delegationAvailable: true,
    personalAssignmentEnabled: true,
    jurisdictionSlug: null,
    isSaving: false,
    error: null
});

const emit = defineEmits<{
    (event: 'update:open', value: boolean): void
    (event: 'assign', selection: AdminAssignmentSelection): void
    (event: 'reload' | 'clear-error'): void
}>();

const { t } = useI18n();
const { user } = useAuth();
const { catalogOrgs, isCatalogLoading, loadCatalog } = useOrgCatalog('application-assignment');

const searchTerm = ref('');
const assignmentNote = ref('');
const selectedTarget = ref<SelectedAssignmentTarget | null>(null);
const liveMessage = ref('');

const unassignedLabel = computed(() => t('admin.detail.unassigned'));
const currentSuffix = computed(() => t('admin.detail.assignment.currentSuffix'));
const selfSuffix = computed(() => t('admin.detail.assignment.selfSuffix'));
const ownUuid = computed(() => user.value?.uuid ? String(user.value.uuid) : null);
const responsibilityLabel = computed(() =>
    props.currentResponsibilityLabel || t('admin.detail.delegation.currentResponsibilityUnknown')
);
const currentSelectionValue = computed(() => assignmentSelectionValue(props.currentAssignee));
const normalizedQuery = computed(() => normalizeSearchValue(searchTerm.value));

const teamTargets = computed<AdminApplicationDelegationTarget[]>(() =>
    props.teamCandidates.map(candidate => teamCandidateToDelegationTarget({ ...candidate, type: 'team' }))
);

const targetsByUuid = computed(() =>
    new Map(teamTargets.value.map(target => [target.uuid, target]))
);

const joinedTargets = computed(() =>
    joinTargetsWithCatalog(teamTargets.value, catalogOrgs.value)
);

const filteredTargets = computed(() =>
    filterDelegationTargets(joinedTargets.value, searchTerm.value, 50)
);

/** The own entry comes first and carries "(Sie)", so taking a case needs no search. */
const filteredPeople = computed(() => {
    const people = filterPersonCandidates(props.personalAssignmentEnabled ? props.candidates : [], searchTerm.value, 50);
    const own = people.find(candidate => candidate.id === ownUuid.value);
    return own ? [own, ...people.filter(candidate => candidate !== own)] : people;
});

const unassignedItem = computed<AssignmentPaletteItem | null>(() => {
    if (normalizedQuery.value && !normalizeSearchValue(unassignedLabel.value).includes(normalizedQuery.value)) {
        return null;
    }
    const current = currentSelectionValue.value === UNASSIGNED_ASSIGNEE_VALUE;
    return {
        id: UNASSIGNED_ASSIGNEE_VALUE,
        slot: 'unassigned',
        value: UNASSIGNED_ASSIGNEE_VALUE,
        kind: 'none',
        label: currentAwareLabel(unassignedLabel.value, current),
        ariaLabel: currentAwareLabel(unassignedLabel.value, current),
        displayLabel: unassignedLabel.value,
        description: t('admin.detail.assignment.unassignedDescription'),
        icon: 'i-lucide-user-x',
        path: [],
        current,
        disabled: current,
        onSelect: (event: Event) => selectItem(event, {
            kind: 'none',
            id: null,
            label: unassignedLabel.value,
            value: UNASSIGNED_ASSIGNEE_VALUE
        }, current)
    };
});

const peopleItems = computed<AssignmentPaletteItem[]>(() => {
    if (!props.personalAssignmentEnabled) return [];
    const items = filteredPeople.value.map(candidate => personItem(candidate));
    const fallback = outOfScopeItem.value;
    if (fallback?.kind === 'user' && matchesQuery(fallback.displayLabel, fallback.description)) {
        items.push(fallback);
    }
    return items;
});

const orgItems = computed<AssignmentPaletteItem[]>(() => {
    const items = filteredTargets.value.map(item => orgItem(item));
    const fallback = outOfScopeItem.value;
    if (fallback?.kind === 'team' && matchesQuery(fallback.displayLabel, fallback.description, ...fallback.path)) {
        items.push(fallback);
    }
    return items;
});

const outOfScopeItem = computed<AssignmentPaletteItem | null>(() => {
    const current = props.currentAssignee;
    if (!current || !props.currentAssigneeOutOfScope) return null;

    const kind = current.type === 'team' ? 'team' : 'user';
    const displayLabel = safeAssignmentLabel(current);
    const description = current.outOfScope === true
        ? t('admin.detail.assigneeOutsideWorkspace')
        : t('admin.detail.currentAssigneeOutsideCandidates', { name: displayLabel });
    return {
        id: `current:${assignmentSelectionValue(current)}`,
        slot: 'out-of-scope',
        value: assignmentSelectionValue(current),
        kind,
        label: currentAwareLabel(displayLabel, true),
        ariaLabel: currentAwareLabel(`${displayLabel}. ${description}`, true),
        displayLabel,
        description,
        icon: kind === 'team' ? 'i-lucide-building-2' : 'i-lucide-user-x',
        candidate: current,
        path: [],
        current: true,
        disabled: true
    };
});

const emptyCandidatesItem = computed<AssignmentPaletteItem | null>(() => {
    if (props.hasCandidates) return null;
    return {
        id: 'assignees-empty',
        slot: 'empty-candidates',
        value: 'assignees-empty',
        kind: 'none',
        label: t(props.personalAssignmentEnabled ? 'admin.detail.assigneesEmpty' : 'admin.detail.assignment.teamsEmpty'),
        ariaLabel: t(props.personalAssignmentEnabled ? 'admin.detail.assigneesEmpty' : 'admin.detail.assignment.teamsEmpty'),
        displayLabel: t(props.personalAssignmentEnabled ? 'admin.detail.assigneesEmpty' : 'admin.detail.assignment.teamsEmpty'),
        icon: 'i-lucide-user-x',
        path: [],
        current: false,
        disabled: true
    };
});

const groups = computed<CommandPaletteGroup[]>(() => {
    const result: CommandPaletteGroup[] = [];
    if (unassignedItem.value) {
        result.push({
            id: 'unassigned',
            ignoreFilter: true,
            items: [unassignedItem.value]
        });
    }
    if (peopleItems.value.length) {
        result.push({
            id: 'people',
            label: t('admin.detail.assignment.peopleSection'),
            ignoreFilter: true,
            items: peopleItems.value
        });
    }
    if (orgItems.value.length) {
        result.push({
            id: 'orgs',
            label: t('admin.detail.assignment.orgsSection'),
            ignoreFilter: true,
            items: orgItems.value
        });
    }
    if (emptyCandidatesItem.value) {
        result.push({
            id: 'assignees-empty',
            ignoreFilter: true,
            items: [emptyCandidatesItem.value]
        });
    }
    return result;
});

const ctaLabel = computed(() => {
    const target = selectedTarget.value;
    if (!target) return t(props.personalAssignmentEnabled ? 'admin.detail.assignment.initialCta' : 'admin.detail.assignment.initialTeamCta');
    if (props.error?.kind === 'error') return t('common.retry');
    if (target.kind === 'none') return t('admin.detail.assignment.removeCta');
    return t('admin.detail.assignment.assignCta', { name: target.label });
});

const consequenceLabel = computed(() => {
    const target = selectedTarget.value;
    if (!target) return t(props.personalAssignmentEnabled ? 'admin.detail.assignment.consequenceInitial' : 'admin.detail.assignment.consequenceTeamInitial');
    if (target.kind === 'none') {
        return t('admin.detail.assignment.consequenceRemove', { responsibility: responsibilityLabel.value });
    }
    const key = target.kind === 'team'
        ? 'admin.detail.assignment.consequenceAssignTeam'
        : ownUuid.value === target.id
            ? 'admin.detail.assignment.consequenceAssignSelf'
            : 'admin.detail.assignment.consequenceAssignPerson';
    return t(key, {
        target: target.label,
        responsibility: responsibilityLabel.value
    });
});

const canAddNote = computed(() =>
    selectedTarget.value?.kind === 'team'
    || (selectedTarget.value?.kind === 'user' && selectedTarget.value.id !== ownUuid.value)
);

const submitDisabled = computed(() =>
    !selectedTarget.value || props.isSaving || (!props.personalAssignmentEnabled && selectedTarget.value.kind === 'user')
);
const paletteLoading = computed(() => isCatalogLoading.value || props.isSaving);
const conflictActions = computed(() => props.error?.kind === 'conflict'
    ? [{
        label: t('admin.detail.assignment.reloadAction'),
        color: 'warning' as const,
        variant: 'subtle' as const,
        onClick: reloadAfterConflict
    }]
    : undefined
);

watch(
    () => [props.open, props.jurisdictionSlug] as const,
    ([open, jurisdictionSlug]) => {
        if (open) loadCatalog(jurisdictionSlug);
    },
    { immediate: true }
);

watch(
    () => props.open,
    (open) => {
        if (!open) resetModalState();
    }
);

watch(selectedTarget, (target) => {
    if (target) {
        liveMessage.value = t('admin.detail.assignment.selectionAnnouncement', { target: target.label, cta: ctaLabel.value });
    } else if (props.open) {
        liveMessage.value = '';
    }
});

watch(
    () => props.personalAssignmentEnabled,
    (enabled) => {
        if (!enabled && selectedTarget.value?.kind === 'user') selectedTarget.value = null;
    }
);

watch(
    () => props.error,
    (error) => {
        if (error) liveMessage.value = [error.message, error.detail].filter(Boolean).join(' ');
    }
);

function assignmentLabel(target: { type?: 'user' | 'team', label: string }): string {
    return target.type === 'team'
        ? t('admin.detail.assignmentTeamLabel', { name: target.label })
        : t('admin.detail.assignmentUserLabel', { name: target.label });
}

function safeAssignmentLabel(target: { type?: 'user' | 'team', label: string }): string {
    return target.label.trim() ? assignmentLabel(target) : t('admin.detail.assigneeOutsideWorkspace');
}

function currentAwareLabel(label: string, current: boolean): string {
    return current ? `${label} ${currentSuffix.value}` : label;
}

function matchesQuery(...parts: Array<string | undefined>): boolean {
    if (!normalizedQuery.value) return true;
    return normalizeSearchValue(parts.filter(Boolean).join(' ')).includes(normalizedQuery.value);
}

function personItem(candidate: AdminApplicationAssignee): AssignmentPaletteItem {
    const value = assignmentSelectionValue({ ...candidate, type: 'user' });
    const current = currentSelectionValue.value === value;
    const self = ownUuid.value !== null && candidate.id === ownUuid.value;
    const nameLabel = self ? `${candidate.label} ${selfSuffix.value}` : candidate.label;
    return {
        id: value,
        slot: 'person',
        value,
        kind: 'user',
        label: currentAwareLabel(nameLabel, current),
        ariaLabel: currentAwareLabel(nameLabel, current),
        displayLabel: candidate.label,
        icon: 'i-lucide-user',
        candidate,
        path: [],
        current,
        self,
        disabled: current,
        onSelect: (event: Event) => selectItem(event, {
            kind: 'user',
            id: candidate.id,
            label: candidate.label,
            value
        }, current)
    };
}

function orgItem(item: DelegationTargetWithCatalog): AssignmentPaletteItem {
    const value = assignmentSelectionValue({ type: 'team', id: item.target.uuid });
    const current = currentSelectionValue.value === value;
    const path = item.node?.pathLabels.slice(0, -1) ?? buildDelegationOrgPath(item.target, targetsByUuid.value);
    const displayLabel = item.target.label;
    const ariaLabel = item.node
        ? `${item.node.code} ${item.node.label}`
        : [displayLabel, ...path].join(' ');

    return {
        id: value,
        slot: item.node ? 'org' : 'target',
        value,
        kind: 'team',
        label: currentAwareLabel(ariaLabel, current),
        ariaLabel: currentAwareLabel(ariaLabel, current),
        displayLabel,
        icon: 'i-lucide-building-2',
        delegationTarget: item.target,
        node: item.node,
        path,
        current,
        disabled: current,
        onSelect: (event: Event) => selectItem(event, {
            kind: 'team',
            id: item.target.uuid,
            label: displayLabel,
            value
        }, current)
    };
}

function selectItem(event: Event, target: SelectedAssignmentTarget, disabled = false) {
    event.preventDefault();
    if (disabled) return;
    emit('clear-error');
    if (selectedTarget.value?.value !== target.value) assignmentNote.value = '';
    selectedTarget.value = target;
}

function typeLabel(type: string): string {
    const key = `orgSwitcher.types.${type}`;
    const translated = t(key);
    return translated === key ? type : translated;
}

function childCountLabel(count: number): string {
    return t('orgSwitcher.children', { count });
}

function updateOpen(value: boolean) {
    if (!value) resetModalState();
    emit('update:open', value);
}

function resetModalState() {
    searchTerm.value = '';
    assignmentNote.value = '';
    selectedTarget.value = null;
    emit('clear-error');
}

function submitSelection() {
    const target = selectedTarget.value;
    if (!target || submitDisabled.value) return;
    liveMessage.value = ctaLabel.value;
    emit('assign', {
        ...parseAssignmentSelection(target.value),
        ...(canAddNote.value && assignmentNote.value.trim() ? { note: assignmentNote.value.trim() } : {})
    });
}

function reloadAfterConflict() {
    assignmentNote.value = '';
    emit('reload');
    selectedTarget.value = null;
}
</script>

<template>
  <UModal
    :open="open"
    :title="t('admin.detail.assignment.modalTitle')"
    :description="t('admin.detail.assignment.modalDescription', { name: displayLabel, responsibility: responsibilityLabel })"
    :ui="{ content: 'sm:max-w-3xl' }"
    @update:open="updateOpen"
  >
    <template #content>
      <UCommandPalette
        v-model:search-term="searchTerm"
        :groups="groups"
        :placeholder="t(personalAssignmentEnabled ? 'admin.detail.assignment.searchPlaceholder' : 'admin.detail.assignment.teamSearchPlaceholder')"
        :loading="paletteLoading"
        :close="false"
        :fuse="{ resultLimit: 50 }"
        :ui="{
          viewport: 'px-4',
          item: 'data-highlighted:not-data-disabled:text-highlighted data-highlighted:not-data-disabled:before:bg-elevated/50',
        }"
        class="h-[min(70vh,42rem)]"
      >
        <template #unassigned="{ item }">
          <span
            class="flex w-full min-w-0 items-center gap-3 text-left"
            :aria-label="item.ariaLabel"
          >
            <span class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-(--ui-bg-elevated) text-(--ui-text-muted)">
              <UIcon
                name="i-lucide-user-x"
                class="size-4"
              />
            </span>
            <span class="flex min-h-9 min-w-0 flex-1 flex-col justify-center">
              <span class="block text-sm font-medium text-(--ui-text-highlighted)">
                {{ item.displayLabel }}
                <span
                  v-if="item.current"
                  class="ml-1 text-sm font-normal text-(--ui-text-muted)"
                >
                  {{ currentSuffix }}
                </span>
              </span>
              <span class="mt-1 block text-sm text-(--ui-text-muted)">
                {{ item.description }}
              </span>
            </span>
            <UIcon
              v-if="item.current"
              name="i-lucide-check"
              class="size-4 shrink-0 self-center text-(--ui-text-muted)"
            />
            <UIcon
              v-else-if="selectedTarget?.value === item.value"
              name="i-lucide-check"
              class="size-4 shrink-0 self-center text-(--ui-primary)"
            />
          </span>
        </template>

        <template #person="{ item }">
          <span
            class="flex w-full min-w-0 items-center gap-3 text-left"
            :aria-label="item.ariaLabel"
          >
            <span class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-(--ui-bg-elevated) text-(--ui-text-muted)">
              <UIcon
                name="i-lucide-user"
                class="size-4"
              />
            </span>
            <span class="flex min-h-9 min-w-0 flex-1 flex-col justify-center">
              <span class="block truncate text-sm font-medium text-(--ui-text-highlighted)">
                {{ item.displayLabel }}
                <span
                  v-if="item.self"
                  class="ml-1 text-sm font-normal text-(--ui-text-muted)"
                  data-testid="assign-self-marker"
                >
                  {{ selfSuffix }}
                </span>
                <span
                  v-if="item.current"
                  class="ml-1 text-sm font-normal text-(--ui-text-muted)"
                >
                  {{ currentSuffix }}
                </span>
              </span>
            </span>
            <UIcon
              v-if="item.current"
              name="i-lucide-check"
              class="size-4 shrink-0 self-center text-(--ui-text-muted)"
            />
            <UIcon
              v-else-if="selectedTarget?.value === item.value"
              name="i-lucide-check"
              class="size-4 shrink-0 self-center text-(--ui-primary)"
            />
          </span>
        </template>

        <template #org="{ item }">
          <AdminOrgCatalogItem
            v-if="item.node"
            :org="item.node"
            :aria-label="item.ariaLabel"
            :type-label="typeLabel"
            :child-count-label="childCountLabel"
            :active="selectedTarget?.value === item.value"
            :current="item.current"
            :current-label="currentSuffix"
          />
        </template>

        <template #target="{ item }">
          <span
            class="flex w-full min-w-0 items-center gap-3 text-left"
            :aria-label="item.ariaLabel"
          >
            <span class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-(--ui-bg-elevated) text-(--ui-text-muted)">
              <UIcon
                name="i-lucide-building-2"
                class="size-4"
              />
            </span>
            <span class="flex min-h-9 min-w-0 flex-1 flex-col justify-center">
              <span class="block text-sm font-medium text-(--ui-text-highlighted)">
                {{ item.displayLabel }}
                <span
                  v-if="item.current"
                  class="ml-1 text-sm font-normal text-(--ui-text-muted)"
                >
                  {{ currentSuffix }}
                </span>
              </span>
              <span
                v-if="item.path.length"
                class="mt-1 block truncate text-sm text-(--ui-text-muted)"
                aria-hidden="true"
              >
                {{ item.path.join(' / ') }}
              </span>
            </span>
            <UIcon
              v-if="item.current"
              name="i-lucide-check"
              class="size-4 shrink-0 self-center text-(--ui-text-muted)"
            />
            <UIcon
              v-else-if="selectedTarget?.value === item.value"
              name="i-lucide-check"
              class="size-4 shrink-0 self-center text-(--ui-primary)"
            />
          </span>
        </template>

        <template #out-of-scope="{ item }">
          <span
            class="flex w-full min-w-0 items-center gap-3 text-left"
            :aria-label="item.ariaLabel"
          >
            <span class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-(--ui-bg-elevated) text-(--ui-text-muted)">
              <UIcon
                :name="item.icon"
                class="size-4"
              />
            </span>
            <span class="flex min-h-9 min-w-0 flex-1 flex-col justify-center">
              <span class="block text-sm font-medium text-(--ui-text-highlighted)">
                {{ item.displayLabel }}
                <span class="ml-1 text-sm font-normal text-(--ui-text-muted)">
                  {{ currentSuffix }}
                </span>
              </span>
              <span class="mt-1 block text-sm text-(--ui-text-muted)">
                {{ item.description }}
              </span>
            </span>
            <UIcon
              name="i-lucide-check"
              class="size-4 shrink-0 self-center text-(--ui-text-muted)"
            />
          </span>
        </template>

        <template #empty-candidates="{ item }">
          <span
            class="flex w-full min-w-0 items-start gap-3 text-left text-(--ui-text-muted)"
            :aria-label="item.ariaLabel"
          >
            <span class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-(--ui-bg-elevated)">
              <UIcon
                name="i-lucide-user-x"
                class="size-4"
              />
            </span>
            <span class="min-w-0 flex-1 text-sm">
              {{ item.displayLabel }}
            </span>
          </span>
        </template>

        <template #empty>
          {{ t('admin.detail.assignment.emptySearch', { query: searchTerm }) }}
        </template>

        <template #footer>
          <div class="px-4 py-3 space-y-3">
            <p
              v-if="!personalAssignmentEnabled"
              class="text-sm text-(--ui-text-muted)"
            >
              {{ t('admin.detail.assignment.personalAssignmentDisabled') }}
            </p>
            <p
              class="sr-only"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {{ liveMessage }}
            </p>

            <p class="min-h-4 text-sm text-(--ui-text-muted)">
              {{ consequenceLabel }}
            </p>

            <UFormField
              v-if="canAddNote"
              name="assignmentNote"
              :label="t('admin.detail.assignment.noteLabel')"
              :help="t('admin.detail.assignment.noteHelp')"
            >
              <UTextarea
                v-model="assignmentNote"
                :rows="2"
                :maxrows="6"
                autoresize
                :maxlength="2000"
                :disabled="isSaving"
                class="w-full"
                @keydown.stop
              />
            </UFormField>

            <UAlert
              v-if="error"
              :color="error.kind === 'conflict' ? 'warning' : 'error'"
              :icon="error.kind === 'conflict' ? 'i-lucide-triangle-alert' : 'i-lucide-circle-x'"
              :role="error.kind === 'conflict' ? 'status' : 'alert'"
              :title="error.message"
              :description="error.detail"
              :actions="conflictActions"
            />

            <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <UButton
                color="neutral"
                variant="ghost"
                :disabled="isSaving"
                @click="updateOpen(false)"
              >
                {{ t('common.cancel') }}
              </UButton>
              <UButton
                icon="i-lucide-user-check"
                :loading="isSaving"
                :disabled="submitDisabled"
                @click="submitSelection"
              >
                {{ ctaLabel }}
              </UButton>
            </div>

            <p class="border-t border-(--ui-border-muted) pt-2 text-sm text-(--ui-text-muted)">
              {{ t(delegationAvailable ? 'admin.detail.assignment.scopeHint' : 'admin.detail.assignment.scopeHintNoDelegation') }}
            </p>
          </div>
        </template>
      </UCommandPalette>
    </template>
  </UModal>
</template>
