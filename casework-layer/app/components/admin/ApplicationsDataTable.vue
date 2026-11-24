<script setup lang="ts">
import ApplicationEventPill from '~/components/ApplicationEventPill.vue';
import { applicationEventItems } from '~/utils/application-events';
import { h, onBeforeUnmount, onMounted, resolveComponent } from 'vue';
import type { FormSchema, FormField } from '~/types/form';
import type { ApplicationRow } from '~/types';
import type { UnconfirmedApplicationRow } from '~/types/admin';
import type { DropdownMenuItem, TableColumn } from '@nuxt/ui';
import type { ResolvedStatus, ResolvedStatusRef } from '~/utils/workflow-status';
import { redactApplicationExportValue } from '~~/casework-layer/app/utils/application-data-redaction';
import { isApplicationAssignedToCurrentUser } from '~~/casework-layer/app/utils/application-assignment-filter';
import { deadlineDateKey, isCompletedApplication, isDeadlineOverdue } from '~~/casework-layer/app/utils/application-deadline';
import { uniqueStatusesByMachineName } from '~/utils/workflow-status';
import { formatDate } from '~/composables/useFormatters';
import { applicantStatusMailKey, NOTE_IN_MAIL_FLAG } from '~~/casework-layer/app/utils/applicant-notice';
import {
    adminEmptyValueClass,
    adminFilterEmptyClass,
    adminPagingClass,
    adminPagingSummaryClass,
    adminRowClass,
    adminSkeletonListClass,
    adminSkeletonRowClass,
    adminTdClass,
    adminThClass
} from '~~/casework-layer/app/utils/admin-table';
import AdminSelectionBar from './SelectionBar.vue';
import UnreadApplicantMessageLink from './UnreadApplicantMessageLink.vue';
import { useUnreadApplications } from '~~/casework-layer/app/composables/useUnreadApplications';
import StaffExtensionOutlet from '~~/casework-layer/app/components/StaffExtensionOutlet.vue';
import type { CaseListActionsContext } from '~~/casework-layer/app/utils/staff-extensions';

const props = withDefaults(defineProps<{
    rows: ApplicationRow[]
    /** Only the global list opts in. null means the short-info response is not available yet. */
    unconfirmedRows?: UnconfirmedApplicationRow[] | null
    /** workflow_status id -> resolved status (label, hex colour, allowed_next). */
    statusMap: Map<string, ResolvedStatus>
    /** Per-form mode: drives dynamic columns + export headers. */
    schema?: FormSchema | null
    /** Global mode: schema id -> label, for the "Formular" column. */
    schemaLabels?: Record<string, string>
    /** Show the "Formular" column + form filter (global view). */
    showFormColumn?: boolean
    /** Current admin user UUID, used for the "my cases" assignment filter. */
    currentUserId?: string | null
    /** Team UUIDs visible to the current admin user, used for team assignments. */
    currentTeamIds?: string[]
    /** Whether the API response exposed assignment relationships for filtering. */
    assignmentFilterAvailable?: boolean
    /** Whether the current user may permanently delete applications. */
    loading?: boolean
    enableUnreadMessages?: boolean
    applicationFormId?: string
    emptyFormMessage?: string
    /** The table's accessible name: the visible heading the table stands under. */
    caption?: string
}>(), {
    schema: null,
    schemaLabels: () => ({}),
    showFormColumn: false,
    currentUserId: null,
    currentTeamIds: () => [],
    assignmentFilterAvailable: false,
    loading: false,
    enableUnreadMessages: false,
    caption: ''
});

const emit = defineEmits<{ 'refresh': [], 'unread-filter-change': [active: boolean] }>();
const showUnconfirmed = defineModel<boolean>('showUnconfirmed');

const { t, locale } = useI18n();
const route = useRoute();
const toast = useToast();
const { workspaceRoute, withWorkspaceQuery, selectedWorkspaceKey } = useWorkspaceContext();
const { resolveApiErrorMessage } = useApiErrorMessage();
/**
 * Window of "Bald fällig": today up to and including today + 7 days, the
 * same range as the tile "Nächste 7 Tage" of "Kennzahlen"
 * (`StaffApplicationStatistics::DEADLINE_SOON_DAYS`).
 */
const DUE_SOON_DAYS = 7;
/** Overrides the theme's `truncate` (tailwind-merge drops it for `text-clip`), as in the workspace switcher. */
const WRAP_MENU_TEXT = 'text-clip whitespace-normal';
const fullTextTooltipUi = { content: 'h-auto max-w-sm', text: 'whitespace-normal text-clip [overflow-wrap:anywhere]' };

const unconfirmedTextClass = { class: { td: 'min-w-32 max-w-64 whitespace-normal wrap-anywhere' } };
const unconfirmedColumns = computed<TableColumn<UnconfirmedApplicationRow>[]>(() => [
    { accessorKey: 'referenceNumber', header: t('admin.table.colReference') },
    {
        id: 'formTitle',
        header: t('admin.table.colForm'),
        accessorFn: row => row.formTitle || '-',
        meta: unconfirmedTextClass
    },
    {
        id: 'submittedAt',
        header: t('admin.applications.unconfirmed.submittedAt'),
        accessorFn: row => formatDate(row.submittedAt, locale.value)
    },
    {
        id: 'applicantName',
        header: t('admin.applications.unconfirmed.name'),
        accessorFn: row => row.applicantName || '-',
        meta: unconfirmedTextClass
    },
    {
        id: 'confirmationEmail',
        header: t('admin.applications.unconfirmed.recipient'),
        accessorFn: row => row.confirmationEmail || '-',
        meta: unconfirmedTextClass
    },
    {
        id: 'confirmation',
        header: t('admin.table.status'),
        cell: () => h(resolveComponent('UBadge'), {
            label: t('admin.applications.unconfirmed.badge'),
            color: 'neutral',
            variant: 'subtle'
        })
    }
]);

// ── Status helpers ────────────────────────────────────────────────
function statusOf(row: ApplicationRow): ResolvedStatus | null {
    if (!row.statusId) return null;
    const current = visibleStatusMap.value.get(row.statusId);
    if (!current) return null;
    if (!row.allowedNextIds) return current;

    return {
        ...current,
        allowedNext: row.allowedNextIds
            .map(id => visibleStatusMap.value.get(id))
            .filter((status): status is ResolvedStatus => Boolean(status))
            .map(status => ({
                id: status.id,
                machineName: status.machineName,
                label: status.label,
                color: status.color,
                icon: status.icon,
                semanticFlags: status.semanticFlags
            }))
    };
}

const filterStatuses = computed(() => uniqueStatusesByMachineName(new Map(
    [...props.rows, ...unreadApplications.rows.value]
        .map((row) => {
            const status = statusOf(row);
            return status ? [status.id, status] as const : null;
        })
        .filter((entry): entry is readonly [string, ResolvedStatus] => Boolean(entry))
)));

// ── Toolbar state ─────────────────────────────────────────────────
const search = ref('');
const unconfirmedSearch = ref('');
const unconfirmedPage = ref(1);
const visibleSearch = computed({
    get: () => showUnconfirmed.value ? unconfirmedSearch.value : search.value,
    set: (value: string) => {
        if (showUnconfirmed.value) {
            unconfirmedSearch.value = value;
        } else {
            search.value = value;
        }
    }
});
const searchLabel = computed(() => t(showUnconfirmed.value
    ? 'admin.applications.unconfirmed.searchPlaceholder'
    : 'admin.table.searchPlaceholder'));
const filteredUnconfirmedRows = computed(() => {
    const term = unconfirmedSearch.value.trim().toLowerCase();
    const rows = props.unconfirmedRows ?? [];
    if (!term) return rows;
    return rows.filter(row => [row.referenceNumber, row.applicantName, row.confirmationEmail]
        .some(value => value?.toLowerCase().includes(term)));
});
const statusFilter = ref<string>('all'); // machine name or 'all'
const listScope = computed(() => JSON.stringify([route.path, selectedWorkspaceKey?.value, props.currentUserId, props.applicationFormId]));
const unreadPreference = props.enableUnreadMessages
    ? useState<{ scope: string, form: string } | null>('staff-unread-application-filter', () => null)
    : ref(null);
const unreadOnly = computed({
    get: () => props.enableUnreadMessages && !showUnconfirmed.value && unreadPreference.value?.scope === listScope.value,
    set: (checked: boolean) => {
        unreadPreference.value = checked ? { scope: listScope.value, form: formFilter.value } : null;
    }
});
watch(unreadOnly, active => emit('unread-filter-change', active), { immediate: true });
const formFilter = ref(unreadOnly.value ? unreadPreference.value?.form ?? 'all' : 'all');
watch(listScope, () => {
    formFilter.value = unreadOnly.value ? unreadPreference.value?.form ?? 'all' : 'all';
});
watch(formFilter, (form) => {
    if (unreadOnly.value) unreadPreference.value = { scope: listScope.value, form };
});
const mineOnly = ref(false);
const overdueOnly = ref(route.query.deadline === 'overdue');
const dueSoonOnly = ref(route.query.deadline === 'soon');
// The function search links here with `?deadline=overdue`; follow the query
// while the list is open, not only on mount.
watch(() => route.query.deadline, (deadline) => {
    overdueOnly.value = deadline === 'overdue';
    dueSoonOnly.value = deadline === 'soon';
});
/** Only applications whose status left the form's published workflow. */
const reviewOnly = ref(false);

const canFilterMine = computed(() => Boolean((props.currentUserId || props.currentTeamIds.length > 0) && props.assignmentFilterAvailable));
// The filter is a real choice only while at least one loaded row is marked.
const canFilterReview = computed(() => props.rows.some(row => Boolean(row.reviewCode)));

const formOptions = computed(() => {
    const items: { label: string, value: string }[] = [{ label: t('admin.table.allForms'), value: 'all' }];
    for (const [id, label] of Object.entries(visibleSchemaLabels.value)) {
        if (props.rows.some(r => r.schemaId === id) || unreadApplications.rows.value.some(r => r.schemaId === id)) {
            items.push({ label, value: id });
        }
    }
    return items;
});

const statusFilterOptions = computed(() => [
    { label: t('admin.table.allStatuses'), value: 'all' },
    ...filterStatuses.value.map(s => ({ label: s.label, value: s.machineName }))
]);

// ── Sorting ───────────────────────────────────────────────────────
type SortKey = 'referenceNumber' | 'status' | 'form' | 'dueDate' | 'created';
const sortKey = ref<SortKey>('created');
const sortDir = ref<'asc' | 'desc'>('desc');

const unreadFormId = computed(() => props.applicationFormId ?? (props.showFormColumn && formFilter.value !== 'all' ? formFilter.value : undefined));
const unreadQuery = computed(() => props.enableUnreadMessages
    ? withWorkspaceQuery(unreadFormId.value ? { schemaId: unreadFormId.value } : {})
    : {});
const unreadScope = computed(() => JSON.stringify([listScope.value, unreadQuery.value, sortKey.value, sortDir.value]));
const tableMounted = ref(false);
onMounted(() => {
    tableMounted.value = true;
});
const unreadApplications = useUnreadApplications({
    ready: computed(() => tableMounted.value && props.enableUnreadMessages && !showUnconfirmed.value && !props.loading),
    active: unreadOnly,
    scope: unreadScope,
    query: unreadQuery,
    hasListedMessage: computed(() => props.rows.some(row =>
        (!unreadFormId.value || unreadFormId.value === row.schemaId) && (row.events?.message ?? 0) > 0
    )),
    formId: computed(() => props.applicationFormId)
});
const {
    available: unreadAvailable,
    rows: unreadRows,
    loading: unreadLoading,
    failed: unreadFailed,
    nextCursor: unreadNextCursor
} = unreadApplications;
const visibleStatusMap = computed(() => unreadOnly.value
    ? new Map([...props.statusMap, ...unreadApplications.statuses.value])
    : props.statusMap);
const visibleSchemaLabels = computed(() => unreadOnly.value
    ? { ...props.schemaLabels, ...unreadApplications.labels.value }
    : props.schemaLabels);
const displayedRows = computed(() => unreadOnly.value ? unreadRows.value : props.rows);

async function loadMoreUnread(event: MouseEvent) {
    const trigger = event.currentTarget;
    await unreadApplications.loadMore();
    await nextTick();
    if (trigger instanceof HTMLElement && !trigger.isConnected && document.activeElement === document.body) {
        tableFocusTarget.value?.focus({ preventScroll: true });
    }
}

function toggleSort(key: SortKey) {
    if (sortKey.value === key) {
        sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc';
    } else {
        sortKey.value = key;
        sortDir.value = 'asc';
    }
}

/** The arrow of the sorted column, none on the others (as before). */
function sortIcon(key: SortKey): string | undefined {
    if (sortKey.value !== key) return undefined;
    return sortDir.value === 'asc' ? 'i-lucide-arrow-up' : 'i-lucide-arrow-down';
}

/**
 * The sort controls are framework buttons: `neutral` + `link` is today's look of the
 * head (muted, default on hover) with the framework's focus ring. The negative margin takes back the button's own
 * padding, so the words stay on their column's edge and the head row keeps its height.
 */
const SORT_CONTROL_CLASS = '-mx-2.5 -my-1';

function ariaSort(key: SortKey): 'ascending' | 'descending' | 'none' {
    if (sortKey.value !== key) return 'none';
    return sortDir.value === 'asc' ? 'ascending' : 'descending';
}

function sortValue(row: ApplicationRow, key: SortKey): string | number {
    switch (key) {
        case 'referenceNumber': return row.referenceNumber || '';
        case 'status': return statusOf(row)?.weight ?? 999;
        case 'form': return (row.schemaId ? visibleSchemaLabels.value[row.schemaId] : '') || '';
        case 'dueDate': return row.dueDate ? new Date(`${row.dueDate}T00:00:00`).getTime() : Number.MAX_SAFE_INTEGER;
        case 'created': return row.created ? new Date(row.created).getTime() : 0;
    }
}

/** Adds days to a `YYYY-MM-DD` key on the calendar, independent of local time. */
function addDaysToKey(dayKey: string, days: number): string {
    return new Date(Date.parse(`${dayKey}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

// The day moves on while the list stays open over midnight.
const now = ref(new Date());
let dayTimer: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
    dayTimer = setInterval(() => {
        now.value = new Date();
    }, 60_000);
});
onBeforeUnmount(() => {
    if (dayTimer) clearInterval(dayTimer);
});
const todayKey = computed(() => deadlineDateKey(now.value));
const dueSoonLastKey = computed(() => addDaysToKey(todayKey.value, DUE_SOON_DAYS));

function isOverdue(row: ApplicationRow): boolean {
    return isDeadlineOverdue({ dueDate: row.dueDate, statusFlags: statusOf(row)?.semanticFlags }, todayKey.value);
}

function isDueSoon(row: ApplicationRow): boolean {
    if (!row.dueDate || isCompletedApplication({ statusFlags: statusOf(row)?.semanticFlags })) return false;
    return row.dueDate >= todayKey.value && row.dueDate <= dueSoonLastKey.value;
}

/** Both deadline filters together show either kind; one alone shows its own. */
function matchesDeadlineFilter(row: ApplicationRow): boolean {
    if (!overdueOnly.value && !dueSoonOnly.value) return true;
    return (overdueOnly.value && isOverdue(row)) || (dueSoonOnly.value && isDueSoon(row));
}

// ── Filter + sort pipeline ────────────────────────────────────────
const filteredRows = computed(() => {
    const term = search.value.trim().toLowerCase();
    let result = displayedRows.value.filter((row) => {
        if (mineOnly.value && !isApplicationAssignedToCurrentUser(row, props.currentUserId, props.currentTeamIds)) return false;
        if (!matchesDeadlineFilter(row)) return false;
        if (reviewOnly.value && !row.reviewCode) return false;
        if (statusFilter.value !== 'all' && statusOf(row)?.machineName !== statusFilter.value) return false;
        if (props.showFormColumn && formFilter.value !== 'all' && row.schemaId !== formFilter.value) return false;
        if (term) {
            const haystack = `${row.referenceNumber} ${row.email ?? ''}`.toLowerCase();
            if (!haystack.includes(term)) return false;
        }
        return true;
    });

    result = [...result].sort((a, b) => {
        const av = sortValue(a, sortKey.value);
        const bv = sortValue(b, sortKey.value);
        const cmp = typeof av === 'number' && typeof bv === 'number'
            ? av - bv
            : String(av).localeCompare(String(bv), 'de');
        return sortDir.value === 'asc' ? cmp : -cmp;
    });

    return result;
});

// ── Pagination ────────────────────────────────────────────────────
const page = ref(1);
const pageSize = ref(25);
const pagedUnconfirmedRows = computed(() => {
    const start = (unconfirmedPage.value - 1) * pageSize.value;
    return filteredUnconfirmedRows.value.slice(start, start + pageSize.value);
});
watch([unconfirmedSearch, () => props.unconfirmedRows], () => {
    unconfirmedPage.value = 1;
});
const total = computed(() => filteredRows.value.length);
const pagedRows = computed(() => {
    if (unreadOnly.value) return filteredRows.value;
    const start = (page.value - 1) * pageSize.value;
    return filteredRows.value.slice(start, start + pageSize.value);
});
/** What a list action (Pro: "Exportieren") reads: the filtered rows in list order, at the moment it acts. */
const listActionsContext = computed<CaseListActionsContext>(() => ({
    rows: filteredRows.value,
    schema: props.schema,
    showFormColumn: props.showFormColumn,
    schemaLabels: visibleSchemaLabels.value,
    statusOf
}));
const emptyMessage = computed(() => {
    if (unreadOnly.value && !unreadRows.value.length && !unreadNextCursor.value) return t('admin.table.noUnreadMessages');
    if (unreadOnly.value && unreadNextCursor.value) return t('admin.table.noLoadedUnreadMatches');
    if (!unreadOnly.value && unreadAvailable.value && !props.rows.length) return t('admin.table.noApplicationsLoaded');
    if (!props.rows.length && !unreadOnly.value) return t('admin.applications.empty');
    if (overdueOnly.value && dueSoonOnly.value) return t('admin.table.noDeadlineMatches', { days: DUE_SOON_DAYS });
    if (overdueOnly.value) return t('admin.table.noOverdueMatches');
    if (dueSoonOnly.value) return t('admin.table.noDueSoonMatches', { days: DUE_SOON_DAYS });
    if (mineOnly.value) return t('admin.table.noMineMatches');
    return t('admin.table.noMatches');
});

/** An empty list is one line in the card, a list without a hit adds "Filter zurücksetzen". */
const emptyBecauseFiltered = computed(() => unreadOnly.value || props.rows.length > 0);
const unreadSummary = computed(() => unreadNextCursor.value
    ? t('admin.table.unreadMessagesLoaded', { count: total.value }, total.value)
    : t('admin.table.unreadMessagesCount', { count: total.value }, total.value));
const unreadAnnouncement = computed(() => {
    if (!unreadOnly.value) return '';
    if (props.loading || unreadLoading.value) return t('admin.table.loadingUnreadMessages');
    if (unreadFailed.value) return t('admin.table.unreadMessagesFailed');
    return total.value ? unreadSummary.value : emptyMessage.value;
});

/**
 * "Filter zurücksetzen": clears the search, both selects and every quick filter.
 * The button leaves with the empty line, so the focus goes to the table area.
 * A `?deadline=` in the address stays, as when the boxes are unticked by hand.
 */
function resetFilters() {
    search.value = '';
    statusFilter.value = 'all';
    formFilter.value = 'all';
    mineOnly.value = false;
    overdueOnly.value = false;
    dueSoonOnly.value = false;
    reviewOnly.value = false;
    unreadOnly.value = false;
    void nextTick(() => tableFocusTarget.value?.focus());
}

watch(
    [
        search,
        statusFilter,
        formFilter,
        mineOnly,
        overdueOnly,
        dueSoonOnly,
        reviewOnly,
        unreadOnly,
        pageSize,
        () => props.currentUserId,
        () => props.currentTeamIds.join(','),
        () => props.assignmentFilterAvailable
    ],
    () => {
        page.value = 1;
        clearSelection();
    }
);

watch([() => props.currentUserId, () => props.currentTeamIds.join(','), () => props.assignmentFilterAvailable], ([currentUserId, currentTeamIds, assignmentFilterAvailable]) => {
    if ((!currentUserId && !currentTeamIds) || !assignmentFilterAvailable) mineOnly.value = false;
});

watch(canFilterReview, (available) => {
    if (!available) reviewOnly.value = false;
});

// ── Dynamic columns (per-form) ────────────────────────────────────
const dynamicColumns = computed<(FormField & { sectionTitle: string })[]>(() => {
    if (!props.schema) return [];
    const all: (FormField & { sectionTitle: string })[] = [];
    for (const section of props.schema.sections) {
        for (const field of section.fields) {
            all.push({ ...field, sectionTitle: section.title });
        }
    }
    const maxCols = 5;
    const fixedCrmKeys = new Set(['person.email']);
    const crmFields = all.filter(f => f.crm_key && !fixedCrmKeys.has(String(f.crm_key)));
    const otherFields = all.filter(f => !f.crm_key);
    return [
        ...crmFields.slice(0, maxCols),
        ...otherFields.slice(0, Math.max(0, maxCols - crmFields.length))
    ];
});

function formatCell(value: unknown): string {
    const safeValue = redactApplicationExportValue(value, null);
    if (safeValue === null || safeValue === undefined || safeValue === '') return '-';
    if (typeof safeValue === 'boolean') return safeValue ? t('common.yes') : t('common.no');
    if (Array.isArray(safeValue)) return safeValue.join(', ');
    if (typeof safeValue === 'object') return '-';
    const str = String(safeValue);
    return str.length > 40 ? `${str.substring(0, 40)}...` : str;
}

// ── Column visibility (generic columns) ───────────────────────────
// Reading order of a case worker: reference, status, received,
// deadline, who works on it, form. "E-Mail" is mostly empty and off by default.
/**
 * "Eingereicht" is on by default only where the table has room for it
 * without scrolling (90rem window width). What "Spalten" shows as ticked is
 * what is visible, at every width.
 */
function roomForCreatedColumn(): boolean {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
    return window.matchMedia('(min-width: 90rem)').matches;
}
const columnVisibility = ref({
    form: true,
    assignment: true,
    created: roomForCreatedColumn(),
    email: false
});
// Keep the existing column menu and hidden-sort hint in sync after resizing.
onMounted(() => {
    const media = window.matchMedia('(min-width: 90rem)');
    const update = () => {
        columnVisibility.value.created = media.matches;
    };
    media.addEventListener('change', update);
    onBeforeUnmount(() => media.removeEventListener('change', update));
});
type ToggleableColumn = keyof typeof columnVisibility.value;

const referenceColumnWidth = 240;
const tableMinWidth = computed(() => 32 + referenceColumnWidth + 200 + 108
  + (columnVisibility.value.created ? 108 : 0)
  + (showAssignmentColumn.value ? 120 : 0)
  + (props.showFormColumn && columnVisibility.value.form ? 112 : 0)
  + dynamicColumns.value.length * 192
  + (columnVisibility.value.email ? 200 : 0));

function otherEvents(row: ApplicationRow) {
    return applicationEventItems(row.events).filter(event => event.kind !== 'message');
}

function remainingEventsText(row: ApplicationRow): string {
    return otherEvents(row).slice(2)
        .map(event => t(`admin.table.events.${event.kind}`, { count: event.count }, event.count))
        .join('; ');
}
const columnToggleItems = computed(() => [
    { key: 'created' as const, label: t('admin.detail.submitted'), show: true },
    { key: 'assignment' as const, label: t('admin.table.colAssignment'), show: props.assignmentFilterAvailable },
    { key: 'form' as const, label: t('admin.table.colForm'), show: props.showFormColumn },
    { key: 'email' as const, label: t('admin.detail.email'), show: true }
].filter(i => i.show));
const columnMenuItems = computed<DropdownMenuItem[]>(() => columnToggleItems.value.map(col => ({
    type: 'checkbox' as const,
    label: col.label,
    checked: columnVisibility.value[col.key],
    onUpdateChecked: (checked: boolean) => setColumnVisible(col.key, checked),
    // Keep the menu open so several columns can be switched in one go.
    onSelect: (event: Event) => event.preventDefault()
})));

function setColumnVisible(key: ToggleableColumn, visible: boolean) {
    columnVisibility.value = { ...columnVisibility.value, [key]: visible };
}

/** When the list is sorted by a column that is switched off, it says so. */
const sortHint = computed(() => {
    const ascending = sortDir.value === 'asc';
    if (sortKey.value === 'created' && !columnVisibility.value.created) {
        return t('admin.table.sortedByHidden', {
            column: t('admin.detail.submitted'),
            direction: t(ascending ? 'admin.table.sortOldestFirst' : 'admin.table.sortNewestFirst')
        });
    }
    if (sortKey.value === 'form' && props.showFormColumn && !columnVisibility.value.form) {
        return t('admin.table.sortedByHidden', {
            column: t('admin.table.colForm'),
            direction: t(ascending ? 'admin.table.sortAToZ' : 'admin.table.sortZToA')
        });
    }
    return '';
});

/** The list answer carries assignment ids only; without them the column would say "Offen" untruly. */
const showAssignmentColumn = computed(() => props.assignmentFilterAvailable && columnVisibility.value.assignment);

type AssignmentState = 'mine' | 'other' | 'open';
/** Who works on the application, by person (a team alone is routing, not a person). */
function assignmentState(row: ApplicationRow): AssignmentState {
    if (!row.assignedToId) return 'open';
    return props.currentUserId && row.assignedToId === props.currentUserId ? 'mine' : 'other';
}
/** Filter checkboxes sit on the baseline of the selects (the default root aligns to the top). */
const checkboxUi = { root: 'h-8 items-center' };

/** Plain text, so the status badge stays the only badge in a row; the words differ, not only the colour. */
const ASSIGNMENT_TEXT: Record<AssignmentState, { key: string, class: string }> = {
    mine: { key: 'admin.table.assignedToMe', class: 'text-(--ui-text)' },
    other: { key: 'admin.table.assignedToOther', class: 'text-(--ui-text-muted)' },
    open: { key: 'admin.table.unassigned', class: 'text-(--ui-text-muted)' }
};

// ── Selection ─────────────────────────────────────────────────────
const selected = ref<Set<string>>(new Set());
const allPageSelected = computed(() =>
    pagedRows.value.length > 0 && pagedRows.value.every(r => selected.value.has(r.id))
);
const somePageSelected = computed(() =>
    pagedRows.value.some(r => selected.value.has(r.id))
);
const selectedRows = computed(() => props.rows.filter(r => selected.value.has(r.id)));
const canDeleteSelection = computed(() => selectedRows.value.length > 0 && selectedRows.value.every(row => row.canDelete === true));
const canSetSelectionDeadline = computed(() => selectedRows.value.length > 0 && selectedRows.value.every(row => row.canChangeStatus === true));

watch(() => props.rows.map(r => r.id).join(','), () => {
    const validIds = new Set(props.rows.map(r => r.id));
    selected.value = new Set([...selected.value].filter(id => validIds.has(id)));
});

function toggleSelectAll() {
    const next = new Set(selected.value);
    if (allPageSelected.value) {
        pagedRows.value.forEach(r => next.delete(r.id));
    } else {
        pagedRows.value.forEach(r => next.add(r.id));
    }
    selected.value = next;
}

function toggleSelect(id: string) {
    const next = new Set(selected.value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selected.value = next;
}

function clearSelection() {
    selected.value = new Set();
}

// ── Status changes (selection bar, always confirmed) ─────────────
// Require confirmation in the selection bar to prevent accidental status changes or emails.

/** One resolver for menu counts, confirmation text and the PATCH loop. */
function targetFor(row: ApplicationRow, machineName: string): ResolvedStatusRef | null {
    const current = statusOf(row);
    if (row.canChangeStatus === false || !current || current.machineName === machineName) return null;
    return current.allowedNext.find(status => status.machineName === machineName) ?? null;
}

type PatchResult = { ok: true } | { ok: false, error: unknown };

async function patchStatus(row: ApplicationRow, statusId: string): Promise<PatchResult> {
    try {
        await $fetch(`/api/admin/applications/${row.id}/status`, {
            method: 'PATCH',
            query: withWorkspaceQuery(),
            body: {
                statusId,
                expectedStatusId: row.statusId ?? undefined,
                expectedChanged: row.changed
            }
        });
        return { ok: true };
    } catch (error) {
        console.error('[admin] status update failed', error);
        return { ok: false, error };
    }
}

// Resolves the chosen machine name to each row's own org status (via that
// row's allowed_next), so transitions stay valid per organisation. The rows
// are the ones the confirmation named; each is looked up fresh, so its
// concurrency token is current. Rows that failed stay selected, as after a
// bulk delete, and the list reloads.
const bulkBusy = ref(false);
async function onBulkStatus(machineName: string, candidates: ApplicationRow[]): Promise<void> {
    if (!candidates.length || bulkBusy.value || bulkDeleteBusy.value) return;
    bulkBusy.value = true;

    let applied = 0;
    const failedIds = new Set<string>();
    let firstError: unknown = null;
    for (const candidate of candidates) {
        const row = props.rows.find(r => r.id === candidate.id);
        if (row && statusOf(row)?.machineName === machineName) {
            continue; // already in target status
        }
        const target = row ? targetFor(row, machineName) : null;
        if (!row || !target) {
            failedIds.add(candidate.id); // changed since the confirmation opened
            continue;
        }
        const result = await patchStatus(row, target.id);
        if (result.ok) {
            applied++;
        } else {
            failedIds.add(row.id);
            firstError ??= result.error;
        }
    }

    bulkBusy.value = false;
    selected.value = failedIds;

    if (failedIds.size === 0) {
        toast.add({
            title: t('admin.table.statusAppliedCount', { count: applied }, applied),
            description: t(applicantStatusMailKey(applied)),
            color: 'success'
        });
        emit('refresh');
        return;
    }

    toast.add({
        title: applied > 0
            ? t('admin.table.bulkStatusPartial', { applied, failed: failedIds.size })
            : t('admin.table.statusUpdateError'),
        description: firstError
            ? resolveApiErrorMessage(firstError, 'admin.table.statusUpdateError')
            : t('errors.admin.statusConflict'),
        color: applied > 0 ? 'warning' : 'error'
    });
    emit('refresh');
}

const bulkTargets = computed(() => {
    const targets = new Map<string, { label: string, flags: string[], count: number }>();
    for (const row of selectedRows.value) {
        for (const next of statusOf(row)?.allowedNext ?? []) {
            if (!targetFor(row, next.machineName)) continue;
            const entry = targets.get(next.machineName) ?? { label: next.label, flags: next.semanticFlags, count: 0 };
            entry.count++;
            targets.set(next.machineName, entry);
        }
    }
    return [...targets].map(([machineName, target]) => ({ machineName, ...target }));
});
const hasBulkTargets = computed(() => bulkTargets.value.length > 0);
const bulkStatusMenuItems = computed<DropdownMenuItem[][]>(() => {
    const total = selectedRows.value.length;
    // "(n von m)" and its explanation only inform when several are selected.
    const withCounts = total > 1;
    return [
        [{
            type: 'label',
            label: t('admin.table.bulkMenuTitle'),
            description: withCounts ? t('admin.table.bulkMenuHint') : undefined,
            // The theme truncates labels and descriptions; these must wrap.
            ui: { itemLabel: WRAP_MENU_TEXT, itemDescription: WRAP_MENU_TEXT }
        }],
        bulkTargets.value.map(target => ({
            label: withCounts
                ? t('admin.table.bulkTargetLabel', { label: target.label, count: target.count, total })
                : target.label,
            onSelect: () => openStatusConfirm(target.machineName, target.label, target.flags)
        }))
    ];
});

const bulkStatusTriggerId = 'applications-bulk-status';
const statusConfirmCancelId = 'applications-status-confirm-cancel';
const bulkStatusNoneId = 'applications-bulk-status-none';
const bulkStatusHintId = 'applications-bulk-status-hint';
/** Screen readers hear why the button is off, or what the numbers in its menu mean (review K5, small item 7). */
const bulkStatusDescribedBy = computed(() => {
    if (!hasBulkTargets.value) return bulkStatusNoneId;
    return selectedRows.value.length > 1 ? bulkStatusHintId : undefined;
});
const statusConfirmOpen = ref(false);
/**
 * Snapshot taken when the confirmation opens, so its text stays put while
 * the dialog closes after the change (the selection is cleared by then).
 * `rows` are the rows that will change; the others keep their status
 * (already there or not allowed from their current status).
 */
const statusConfirm = ref<{ machineName: string, label: string, flags: string[], rows: ApplicationRow[], unchanged: number } | null>(null);
const statusConfirmCount = computed(() => statusConfirm.value?.rows.length ?? 0);
const statusConfirmUnchanged = computed(() => statusConfirm.value?.unchanged ?? 0);
const statusConfirmTitle = computed(() => statusConfirmCount.value === 1
    ? t('admin.table.statusConfirmTitle')
    : t('admin.table.bulkStatusConfirmTitle', { count: statusConfirmCount.value }));
// The mail sentence is part of the description, so the dialog announces it.
const statusConfirmDescription = computed(() => {
    const status = statusConfirm.value?.label ?? '';
    const [only] = statusConfirm.value?.rows ?? [];
    const change = statusConfirmCount.value === 1 && only
        ? t('admin.table.statusConfirmDescription', { ref: only.referenceNumber || only.id.slice(0, 8), status })
        : t('admin.table.bulkStatusConfirmDescription', { count: statusConfirmCount.value, status });
    return `${change} ${t(applicantStatusMailKey(statusConfirmCount.value))}`;
});
/** The list sends no note, so a rejection from here carries no reason. */
const statusConfirmWithoutReason = computed(() => Boolean(statusConfirm.value?.flags.includes(NOTE_IN_MAIL_FLAG)));

function openStatusConfirm(machineName: string, label: string, flags: string[] = []) {
    if (bulkBusy.value || bulkDeleteBusy.value) return;
    const rows = selectedRows.value.filter(row => targetFor(row, machineName));
    if (!rows.length) return;
    statusConfirm.value = { machineName, label, flags, rows, unchanged: selectedRows.value.length - rows.length };
    statusConfirmOpen.value = true;
}

function closeStatusConfirm() {
    if (bulkBusy.value) return;
    statusConfirmOpen.value = false;
}

async function confirmStatusChange() {
    const target = statusConfirm.value;
    // A late click during the closing animation starts nothing.
    if (!statusConfirmOpen.value || !target || bulkBusy.value) return;
    // Exactly the rows the confirmation named: the announced "unchanged"
    // ones are not sent and not reported as skipped.
    await onBulkStatus(target.machineName, target.rows);
    statusConfirmOpen.value = false;
}

/** Repeated Enter must never save: the dialog opens on "Abbrechen". */
function focusStatusConfirmCancel(event: Event) {
    event.preventDefault();
    void nextTick(() => document.getElementById(statusConfirmCancelId)?.focus());
}

/**
 * Back to where the person was: the bar's "Status ändern" while the
 * selection stands (cancel), the table after a change (the bar is gone).
 */
function restoreFocusAfterStatusConfirm(event: Event) {
    event.preventDefault();
    void nextTick(() => {
        const trigger = selected.value.size > 0 ? document.getElementById(bulkStatusTriggerId) : null;
        (trigger ?? tableFocusTarget.value)?.focus();
    });
}

// ── Deadline for the selection ─────────────────────────────
// Shown wherever the bar is: the deadline card on the application page has
// no role condition either; the route itself checks the right.
const bulkDeadlineTriggerId = 'applications-bulk-deadline';
const bulkDeadlineOpen = ref(false);
const bulkDeadlineBusy = ref(false);
/** The rows the dialog names, fixed when it opens. */
const bulkDeadlineRows = ref<ApplicationRow[]>([]);

function openBulkDeadline() {
    if (bulkBusy.value || bulkDeleteBusy.value || bulkDeadlineBusy.value || !canSetSelectionDeadline.value) return;
    bulkDeadlineRows.value = [...selectedRows.value];
    bulkDeadlineOpen.value = true;
}

/** Failed rows stay selected, the others leave the selection; the list reloads once. */
function onBulkDeadlineFinished(failedIds: string[]) {
    selected.value = new Set(failedIds);
    emit('refresh');
}

/** Back to "Frist setzen" while a selection stands, to the table when the bar is gone. */
function restoreFocusAfterBulkDeadline() {
    void nextTick(() => {
        const trigger = selected.value.size > 0 ? document.getElementById(bulkDeadlineTriggerId) : null;
        (trigger ?? tableFocusTarget.value)?.focus();
    });
}

// ── Permanent bulk deletion ─────────────────────────────────────
const bulkDeleteOpen = ref(false);
const bulkDeleteBusy = ref(false);
const tableFocusTarget = ref<HTMLElement | null>(null);

function openBulkDeleteDialog() {
    if (!canDeleteSelection.value
      || bulkBusy.value
      || bulkDeleteBusy.value
      || selectedRows.value.length === 0) return;
    bulkDeleteOpen.value = true;
}

function closeBulkDeleteDialog() {
    if (bulkDeleteBusy.value) return;
    bulkDeleteOpen.value = false;
}

async function deleteSelectedApplications() {
    if (!canDeleteSelection.value
      || bulkBusy.value
      || bulkDeleteBusy.value
      || selectedRows.value.length === 0) return;

    bulkDeleteBusy.value = true;
    const operationWorkspaceQuery = { ...withWorkspaceQuery() };
    const failedIds = new Set<string>();
    let deleted = 0;

    for (const row of selectedRows.value) {
        if (!row.changed) {
            failedIds.add(row.id);
            continue;
        }
        try {
            const deleteUrl: string = `/api/admin/applications/${row.id}`;
            await $fetch(deleteUrl, {
                method: 'DELETE',
                query: operationWorkspaceQuery,
                body: { expectedChanged: row.changed }
            });
            deleted++;
        } catch (error) {
            console.error(`[admin] Failed to delete application ${row.id}:`, error);
            failedIds.add(row.id);
        }
    }

    bulkDeleteBusy.value = false;
    bulkDeleteOpen.value = false;
    selected.value = failedIds;

    if (deleted > 0) {
        toast.add({
            title: failedIds.size > 0
                ? t('admin.table.bulkDeletePartial', { deleted, failed: failedIds.size })
                : t('admin.table.bulkDeleteSuccess', { count: deleted }),
            color: failedIds.size > 0 ? 'warning' : 'success'
        });
        emit('refresh');
        await nextTick();
        tableFocusTarget.value?.focus();
        return;
    }

    toast.add({
        title: t('admin.table.bulkDeleteFailed'),
        color: 'error'
    });
}

function goToDetail(id: string) {
    navigateTo(workspaceRoute(`/admin/applications/${id}`));
}

function detailRoute(id: string) {
    return workspaceRoute(`/admin/applications/${id}`);
}
</script>

<template>
  <p
    v-if="emptyFormMessage && !unreadOnly && !unreadAvailable"
    class="text-sm text-muted"
    data-test="form-applications-empty"
  >
    {{ emptyFormMessage }}
  </p>
  <div
    v-else
    ref="tableFocusTarget"
    tabindex="-1"
    class="min-w-0"
  >
    <div class="mb-4 space-y-2">
      <div class="flex flex-wrap items-center gap-2">
        <UInput
          v-model="visibleSearch"
          icon="i-lucide-search"
          :placeholder="searchLabel"
          :aria-label="searchLabel"
          name="application-search"
          autocomplete="off"
          :spellcheck="false"
          class="w-full sm:w-72 lg:w-80"
        />
        <USwitch
          v-if="unconfirmedRows !== undefined"
          v-model="showUnconfirmed"
          :label="t('admin.applications.unconfirmed.filter')"
        />
        <div
          v-if="!showUnconfirmed"
          class="flex shrink-0 flex-wrap items-center gap-2 sm:ml-auto"
        >
          <UDropdownMenu
            :items="columnMenuItems"
            :content="{ align: 'end' }"
          >
            <UButton
              data-test="columns-menu"
              color="neutral"
              variant="outline"
              :label="t('admin.table.columns')"
              trailing-icon="i-lucide-chevron-down"
            />
          </UDropdownMenu>
          <!-- Export controls for this list. -->
          <StaffExtensionOutlet
            name="case-list-actions"
            :context="listActionsContext"
          />
        </div>
      </div>
      <div
        v-if="!showUnconfirmed"
        data-test="filter-line"
        class="flex flex-wrap items-center gap-2"
      >
        <USelect
          v-model="statusFilter"
          :items="statusFilterOptions"
          value-key="value"
          class="w-40"
          :aria-label="t('admin.table.filterByStatus')"
        />
        <USelect
          v-if="showFormColumn"
          v-model="formFilter"
          :items="formOptions"
          value-key="value"
          class="w-44"
          :aria-label="t('admin.table.filterByForm')"
        />
        <div
          data-test="filter-checkboxes"
          role="group"
          :aria-label="t('admin.table.quickFilters')"
          class="flex flex-wrap items-center gap-x-4 gap-y-1 px-1"
        >
          <UCheckbox
            v-if="canFilterMine"
            v-model="mineOnly"
            :label="t('admin.table.mineOnly')"
            :ui="checkboxUi"
          />
          <UCheckbox
            v-model="overdueOnly"
            data-test="overdue-filter"
            :label="t('admin.table.overdueOnly')"
            :ui="checkboxUi"
          />
          <UCheckbox
            v-model="dueSoonOnly"
            data-test="due-soon-filter"
            :label="t('admin.table.dueSoonOnly')"
            :ui="checkboxUi"
          />
          <UCheckbox
            v-if="unreadOnly || (enableUnreadMessages && !loading && unreadAvailable)"
            v-model="unreadOnly"
            data-test="unread-messages-filter"
            :label="t('admin.table.unreadMessagesOnly')"
            :ui="checkboxUi"
          />
          <UCheckbox
            v-if="canFilterReview"
            v-model="reviewOnly"
            data-test="status-review-filter"
            :label="t('admin.detail.statusReviewFilter')"
            :ui="checkboxUi"
          />
        </div>
      </div>
    </div>

    <!-- Selection bar: ONE filled action, "Frist setzen" outlined,
         "Auswahl aufheben" quiet (from AdminSelectionBar), delete as red text alone at the end -->
    <AdminSelectionBar
      v-if="!showUnconfirmed"
      :count="selected.size"
      :busy="bulkBusy || bulkDeleteBusy || bulkDeadlineBusy"
      @clear="clearSelection"
    >
      <UDropdownMenu
        v-if="selectedRows.some(row => row.canChangeStatus !== false)"
        :items="bulkStatusMenuItems"
        :ui="{ content: 'max-w-80' }"
      >
        <UButton
          :id="bulkStatusTriggerId"
          data-test="bulk-status-open"
          :loading="bulkBusy"
          :disabled="!hasBulkTargets || bulkBusy || bulkDeleteBusy || bulkDeadlineBusy"
          :label="t('admin.table.bulkSetStatus')"
          :aria-describedby="bulkStatusDescribedBy"
          trailing-icon="i-lucide-chevron-down"
        />
      </UDropdownMenu>
      <!-- On the filled bar the sentence is text-toned, text-muted would fall under 4.5:1 in light mode. -->
      <span
        v-if="!hasBulkTargets && selectedRows.some(row => row.canChangeStatus !== false)"
        :id="bulkStatusNoneId"
        data-test="bulk-status-none"
        class="text-sm text-toned"
      >{{ t('admin.table.bulkNoTargets') }}</span>
      <span
        v-else-if="selectedRows.length > 1"
        :id="bulkStatusHintId"
        class="sr-only"
      >{{ t('admin.table.bulkMenuHint') }}</span>
      <UButton
        v-if="canSetSelectionDeadline"
        :id="bulkDeadlineTriggerId"
        data-test="bulk-deadline-open"
        color="neutral"
        variant="outline"
        :loading="bulkDeadlineBusy"
        :disabled="bulkBusy || bulkDeleteBusy || bulkDeadlineBusy"
        :label="t('admin.table.bulkSetDeadline')"
        @click="openBulkDeadline"
      />
      <template
        v-if="canDeleteSelection"
        #end
      >
        <UButton
          icon="i-lucide-trash-2"
          color="error"
          variant="ghost"
          :loading="bulkDeleteBusy"
          :disabled="bulkBusy || bulkDeleteBusy || bulkDeadlineBusy"
          :label="t('admin.table.bulkDelete')"
          data-test="bulk-delete-open"
          @click="openBulkDeleteDialog"
        />
      </template>
    </AdminSelectionBar>

    <UModal
      v-if="!showUnconfirmed"
      :open="statusConfirmOpen"
      :title="statusConfirmTitle"
      :description="statusConfirmDescription"
      :close="!bulkBusy"
      :dismissible="!bulkBusy"
      :content="{ onOpenAutoFocus: focusStatusConfirmCancel, onCloseAutoFocus: restoreFocusAfterStatusConfirm }"
      @update:open="(value: boolean) => !value && closeStatusConfirm()"
    >
      <template
        v-if="statusConfirmUnchanged > 0 || statusConfirmWithoutReason"
        #body
      >
        <div
          data-test="status-confirm-modal"
          class="space-y-2 text-sm"
        >
          <p
            v-if="statusConfirmWithoutReason"
            data-test="status-confirm-no-reason"
          >
            {{ t('admin.table.statusConfirmNoReason') }}
          </p>
          <p
            v-if="statusConfirmUnchanged > 0"
            data-test="status-confirm-unchanged"
            class="text-(--ui-text-muted)"
          >
            {{ t('admin.table.bulkStatusConfirmUnchanged', { count: statusConfirmUnchanged }, statusConfirmUnchanged) }}
          </p>
        </div>
      </template>

      <template #footer>
        <div class="flex w-full flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <UButton
            :id="statusConfirmCancelId"
            color="neutral"
            variant="ghost"
            data-test="status-confirm-cancel"
            :disabled="bulkBusy"
            @click="closeStatusConfirm"
          >
            {{ t('common.cancel') }}
          </UButton>
          <UButton
            icon="i-lucide-check"
            data-test="status-confirm-apply"
            :loading="bulkBusy"
            :disabled="bulkBusy"
            @click="confirmStatusChange"
          >
            {{ t('admin.table.bulkSetStatus') }}
          </UButton>
        </div>
      </template>
    </UModal>

    <AdminApplicationsBulkDeadlineModal
      v-if="!showUnconfirmed"
      v-model:open="bulkDeadlineOpen"
      :rows="bulkDeadlineRows"
      @busy="(value: boolean) => bulkDeadlineBusy = value"
      @finished="onBulkDeadlineFinished"
      @closed="restoreFocusAfterBulkDeadline"
    />

    <UModal
      v-if="!showUnconfirmed"
      :open="bulkDeleteOpen"
      :title="t('admin.table.bulkDeleteTitle')"
      :description="t('admin.table.bulkDeleteDescription', { count: selectedRows.length })"
      :close="!bulkDeleteBusy"
      :dismissible="!bulkDeleteBusy"
      @update:open="(value: boolean) => !value && closeBulkDeleteDialog()"
    >
      <template #body>
        <UAlert
          role="status"
          color="warning"
          icon="i-lucide-triangle-alert"
          :title="t('admin.table.bulkDeleteDeliveryWarningTitle')"
          :description="t('admin.table.bulkDeleteDeliveryWarning')"
        />
      </template>

      <template #footer>
        <div class="flex w-full flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <UButton
            color="neutral"
            variant="ghost"
            :disabled="bulkDeleteBusy"
            @click="closeBulkDeleteDialog"
          >
            {{ t('common.cancel') }}
          </UButton>
          <UButton
            color="error"
            icon="i-lucide-trash-2"
            :loading="bulkDeleteBusy"
            :disabled="bulkDeleteBusy"
            data-test="bulk-delete-confirm"
            @click="deleteSelectedApplications"
          >
            {{ t('admin.table.bulkDeleteConfirm', { count: selectedRows.length }) }}
          </UButton>
        </div>
      </template>
    </UModal>

    <p
      v-if="!showUnconfirmed && sortHint && !loading && filteredRows.length"
      data-test="sort-hint"
      class="mb-2 text-sm text-(--ui-text-muted)"
    >
      {{ sortHint }}
    </p>

    <p
      v-if="showUnconfirmed"
      class="mb-2 text-sm text-muted"
    >
      {{ t('admin.applications.unconfirmed.explanation') }}
    </p>

    <p
      v-if="enableUnreadMessages && !showUnconfirmed"
      role="status"
      aria-atomic="true"
      class="sr-only"
      data-test="unread-messages-status"
    >
      {{ unreadAnnouncement }}
    </p>

    <!-- Loading -->
    <div
      v-if="loading || (unreadOnly && unreadLoading && !unreadRows.length)"
      data-test="applications-loading"
      :class="adminSkeletonListClass"
    >
      <p
        v-if="showUnconfirmed"
        role="status"
        class="sr-only"
      >
        {{ t('admin.applications.unconfirmed.loading') }}
      </p>
      <USkeleton
        v-for="i in 5"
        :key="i"
        :class="adminSkeletonRowClass"
      />
    </div>

    <template v-else-if="showUnconfirmed">
      <template v-if="unconfirmedRows">
        <UTable
          v-if="filteredUnconfirmedRows.length"
          :data="pagedUnconfirmedRows"
          :columns="unconfirmedColumns"
          :caption="t('admin.applications.unconfirmed.filter')"
          :aria-label="t('admin.applications.unconfirmed.filter')"
          role="region"
          tabindex="0"
        />
        <p
          v-else
          role="status"
          :class="adminFilterEmptyClass"
        >
          {{ t('admin.applications.unconfirmed.empty') }}
        </p>
        <AppPagination
          v-if="filteredUnconfirmedRows.length > pageSize"
          v-model:page="unconfirmedPage"
          :total="filteredUnconfirmedRows.length"
          :items-per-page="pageSize"
          variant="ghost"
          active-variant="outline"
          active-color="neutral"
          :ui="{ first: 'hidden', last: 'hidden' }"
        />
      </template>
    </template>

    <!-- Empty: one left aligned line inside the card, no icon; without a hit
         it is followed by "Filter zurücksetzen". The toolbar stays above it. -->
    <div
      v-else-if="!filteredRows.length"
      data-test="applications-empty"
      :class="adminFilterEmptyClass"
    >
      <p v-if="!unreadFailed">
        {{ emptyMessage }}
      </p>
      <UButton
        v-if="emptyBecauseFiltered"
        data-test="filters-reset"
        color="neutral"
        variant="ghost"
        :label="t('admin.table.resetFilters')"
        @click="resetFilters"
      />
    </div>

    <!-- Table: fixed columns shrink to their content, "Formular" takes the rest and wraps (two lines at most) -->
    <div
      v-else
      class="max-w-full overflow-x-auto"
    >
      <table
        class="w-full table-fixed text-sm"
        :style="{ minWidth: `${tableMinWidth}px` }"
      >
        <!-- The table's name: the heading it stands under, given by the page (screen readers name the table). -->
        <caption class="sr-only">
          {{ caption || t('admin.applications.title') }}
        </caption>
        <colgroup>
          <col class="w-10 sm:w-8">
          <col
            data-column="reference"
            :style="{ width: `${referenceColumnWidth}px` }"
          >
          <col
            data-column="status"
            style="width: 200px"
          >
          <col
            v-if="columnVisibility.created"
            data-column="created"
            style="width: 108px"
          >
          <col
            data-column="dueDate"
            style="width: 108px"
          >
          <col
            v-if="showAssignmentColumn"
            data-column="assignment"
            style="width: 120px"
          >
          <col
            v-if="showFormColumn && columnVisibility.form"
            data-column="form"
          >
          <col
            v-for="col in dynamicColumns"
            :key="col.id"
            style="width: 192px"
          >
          <col
            v-if="columnVisibility.email"
            data-column="email"
            style="width: 200px"
          >
        </colgroup>
        <thead>
          <tr data-test="applications-head">
            <th :class="adminThClass">
              <UCheckbox
                :model-value="allPageSelected ? true : (somePageSelected ? 'indeterminate' : false)"
                :aria-label="t('admin.table.selectAll')"
                :ui="{ base: 'max-sm:size-6', container: 'max-sm:h-6' }"
                @update:model-value="toggleSelectAll"
              />
            </th>
            <th
              data-column="reference"
              :class="adminThClass"
              :aria-sort="ariaSort('referenceNumber')"
            >
              <UButton
                color="neutral"
                variant="link"
                :label="t('admin.table.colReference')"
                :trailing-icon="sortIcon('referenceNumber')"
                :class="SORT_CONTROL_CLASS"
                data-test="sort-control"
                @click="toggleSort('referenceNumber')"
              />
            </th>
            <th
              data-column="status"
              :class="adminThClass"
              :aria-sort="ariaSort('status')"
            >
              <UButton
                color="neutral"
                variant="link"
                :label="t('admin.detail.status')"
                :trailing-icon="sortIcon('status')"
                :class="SORT_CONTROL_CLASS"
                data-test="sort-control"
                @click="toggleSort('status')"
              />
            </th>
            <th
              v-if="columnVisibility.created"
              data-column="created"
              :class="adminThClass"
              :aria-sort="ariaSort('created')"
            >
              <UButton
                color="neutral"
                variant="link"
                :label="t('admin.detail.submitted')"
                :trailing-icon="sortIcon('created')"
                :class="SORT_CONTROL_CLASS"
                data-test="sort-control"
                @click="toggleSort('created')"
              />
            </th>
            <th
              data-column="dueDate"
              :class="adminThClass"
              :aria-sort="ariaSort('dueDate')"
            >
              <UButton
                color="neutral"
                variant="link"
                :label="t('admin.detail.dueDate')"
                :trailing-icon="sortIcon('dueDate')"
                :class="SORT_CONTROL_CLASS"
                data-test="sort-control"
                @click="toggleSort('dueDate')"
              />
            </th>
            <th
              v-if="showAssignmentColumn"
              data-column="assignment"
              :class="adminThClass"
            >
              {{ t('admin.table.colAssignment') }}
            </th>
            <th
              v-if="showFormColumn && columnVisibility.form"
              data-column="form"
              :class="adminThClass"
              :aria-sort="ariaSort('form')"
            >
              <UButton
                color="neutral"
                variant="link"
                :label="t('admin.table.colForm')"
                :trailing-icon="sortIcon('form')"
                :class="SORT_CONTROL_CLASS"
                data-test="sort-control"
                @click="toggleSort('form')"
              />
            </th>
            <th
              v-for="col in dynamicColumns"
              :key="col.id"
              data-column="field"
              :class="adminThClass"
            >
              {{ col.label }}
            </th>
            <th
              v-if="columnVisibility.email"
              data-column="email"
              :class="adminThClass"
            >
              {{ t('admin.detail.email') }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in pagedRows"
            :key="row.id"
            data-test="application-row"
            :class="[adminRowClass, 'cursor-pointer transition-colors']"
            @click="goToDetail(row.id)"
          >
            <td
              :class="adminTdClass"
              @click.stop
            >
              <UCheckbox
                :model-value="selected.has(row.id)"
                :aria-label="t('admin.table.selectRow', { ref: row.referenceNumber || row.id.slice(0, 8) })"
                :ui="{ base: 'max-sm:size-6', container: 'max-sm:h-6' }"
                @update:model-value="toggleSelect(row.id)"
              />
            </td>
            <td :class="adminTdClass">
              <div class="flex flex-wrap items-center gap-x-2">
                <NuxtLink
                  :to="detailRoute(row.id)"
                  class="min-w-0 max-w-full break-words font-mono rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  @click.stop
                >
                  {{ row.referenceNumber || row.id.slice(0, 8) }}
                </NuxtLink>
                <span class="ms-auto inline-flex shrink-0 flex-nowrap items-center gap-1 whitespace-nowrap">
                  <ApplicationEventPill
                    v-for="event in otherEvents(row).slice(0, 2)"
                    :key="event.kind"
                    :kind="event.kind"
                    :count="event.count"
                    :to="{ ...detailRoute(row.id), hash: `#${event.sectionId}` }"
                    :aria-suffix="row.referenceNumber || row.id.slice(0, 8)"
                    data-test="event-marker"
                    @click.stop
                  />
                  <UTooltip
                    v-if="otherEvents(row).length > 2"
                    :text="remainingEventsText(row)"
                    :content="{ side: 'top' }"
                    :ui="fullTextTooltipUi"
                  >
                    <ULink
                      :to="{ ...detailRoute(row.id), hash: `#${otherEvents(row)[2]!.sectionId}` }"
                      :aria-label="`${row.referenceNumber || row.id.slice(0, 8)}: ${remainingEventsText(row)}`"
                      class="inline-flex min-h-6 shrink-0 items-center rounded-sm text-xs text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                      data-test="event-overflow"
                      raw
                      @click.stop
                    >+{{ otherEvents(row).length - 2 }}</ULink>
                  </UTooltip>
                </span>
              </div>
              <UnreadApplicantMessageLink
                v-if="row.events?.message"
                :count="row.events.message"
                :to="{ ...detailRoute(row.id), hash: '#application-messages' }"
                :reference="row.referenceNumber || row.id.slice(0, 8)"
                data-test="unread-message-link"
              />
            </td>
            <td :class="[adminTdClass, 'whitespace-nowrap']">
              <div class="flex min-w-0 items-center gap-1.5">
                <UTooltip
                  v-if="statusOf(row)"
                  :text="statusOf(row)!.label"
                  :content="{ side: 'top' }"
                  :ui="fullTextTooltipUi"
                >
                  <StatusBadge
                    :status="statusOf(row)!.machineName"
                    :label="statusOf(row)!.label"
                    :color="statusOf(row)!.color"
                    :icon="statusOf(row)!.icon"
                    wrap
                    tabindex="0"
                    class="rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  />
                </UTooltip>
                <span
                  v-else
                  :class="adminEmptyValueClass"
                >-</span>
                <!-- A marker, not a second badge: the status badge stays the one coloured badge of the row. -->
                <UTooltip
                  v-if="row.reviewCode"
                  :text="t('admin.detail.statusReviewBadge')"
                  :content="{ side: 'top' }"
                  :ui="fullTextTooltipUi"
                >
                  <span
                    data-test="status-review-badge"
                    tabindex="0"
                    class="inline-flex shrink-0 items-center gap-1 text-sm text-default rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    <UIcon
                      name="i-lucide-circle-help"
                      class="size-4 shrink-0 text-warning"
                      aria-hidden="true"
                    />
                    <span>{{ t('admin.detail.statusReviewBadge') }}</span>
                  </span>
                </UTooltip>
              </div>
            </td>
            <td
              v-if="columnVisibility.created"
              data-test="created-cell"
              :class="[adminTdClass, 'whitespace-nowrap']"
            >
              {{ formatDate(row.created) }}
            </td>
            <td :class="[adminTdClass, 'whitespace-nowrap']">
              <!-- A deadline is a date in the row's size; overdue: red with a triangle. -->
              <span
                v-if="row.dueDate"
                data-test="due-date"
                :data-overdue="isOverdue(row) ? 'true' : undefined"
                class="inline-flex items-center gap-1 text-sm"
                :class="isOverdue(row) ? 'font-medium text-error' : 'text-default'"
              >
                <UIcon
                  v-if="isOverdue(row)"
                  name="i-lucide-alert-triangle"
                  class="size-4 shrink-0"
                  aria-hidden="true"
                />
                <span
                  v-if="isOverdue(row)"
                  class="sr-only"
                >{{ t('admin.table.overdueOnly') }}:</span>
                {{ formatDate(row.dueDate) }}
              </span>
              <span
                v-else
                :class="adminEmptyValueClass"
              >-</span>
            </td>
            <td
              v-if="showAssignmentColumn"
              data-test="assignment-cell"
              :data-state="assignmentState(row)"
              :class="[adminTdClass, 'whitespace-nowrap', ASSIGNMENT_TEXT[assignmentState(row)].class]"
            >
              {{ t(ASSIGNMENT_TEXT[assignmentState(row)].key) }}
            </td>
            <td
              v-if="showFormColumn && columnVisibility.form"
              data-test="form-cell"
              :class="adminTdClass"
            >
              <UTooltip
                :text="row.schemaId ? (visibleSchemaLabels[row.schemaId] || '-') : '-'"
                :content="{ side: 'top' }"
                :ui="fullTextTooltipUi"
              >
                <span
                  class="line-clamp-2 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  tabindex="0"
                >{{ row.schemaId ? (visibleSchemaLabels[row.schemaId] || '-') : '-' }}</span>
              </UTooltip>
            </td>
            <td
              v-for="col in dynamicColumns"
              :key="col.id"
              :class="[adminTdClass, 'max-w-48 truncate']"
            >
              {{ formatCell(row.data?.[col.id]) }}
            </td>
            <td
              v-if="columnVisibility.email"
              :class="adminTdClass"
            >
              <UTooltip
                :text="row.email || '-'"
                :content="{ side: 'top' }"
                :ui="fullTextTooltipUi"
              >
                <span
                  class="block truncate rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  tabindex="0"
                >{{ row.email || '-' }}</span>
              </UTooltip>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div
      v-if="unreadOnly && !loading && (total || unreadNextCursor || unreadFailed)"
      :class="adminPagingClass"
    >
      <p :class="adminPagingSummaryClass">
        {{ unreadFailed ? t('admin.table.unreadMessagesFailed') : unreadSummary }}
      </p>
      <UButton
        v-if="unreadNextCursor || unreadFailed"
        data-test="load-more-unread-messages"
        color="neutral"
        variant="outline"
        :loading="unreadLoading"
        :label="t(unreadFailed ? 'common.retry' : 'admin.table.loadMoreUnreadMessages')"
        @click="loadMoreUnread"
      />
    </div>

    <!-- Pagination footer -->
    <div
      v-else-if="!showUnconfirmed && !unreadOnly && filteredRows.length"
      :class="adminPagingClass"
    >
      <p :class="adminPagingSummaryClass">
        {{ t('admin.table.showing', { from: (page - 1) * pageSize + 1, to: Math.min(page * pageSize, total), total }) }}
      </p>
      <AppPagination
        v-if="total > pageSize"
        v-model:page="page"
        :total="total"
        :items-per-page="pageSize"
        variant="ghost"
        active-variant="outline"
        active-color="neutral"
        :ui="{ first: 'hidden', last: 'hidden' }"
      />
    </div>
  </div>
</template>
