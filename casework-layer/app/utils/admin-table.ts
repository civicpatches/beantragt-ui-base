/**
 * Class sets of lists and tables in the staff UI. Hand-built tables take these strings instead
 * of their own; new tables may use `UTable` with `adminTableUi`.
 *
 * Every value is one whole literal, never assembled, so Tailwind finds it.
 */

/** Toolbar above the table, inside the card. */
export const adminToolbarClass = 'mb-4 space-y-2';
/** One toolbar line (search left, view options right; or the filters). */
export const adminToolbarLineClass = 'flex flex-wrap items-center gap-2';
/** Search field that filters while typing (`UInput icon="i-lucide-search"`). */
export const adminSearchInputClass = 'w-full sm:w-80';
/** A filter `USelect` for an attribute with values. */
export const adminFilterSelectClass = 'w-44';
/** A group of yes or no filters (`UCheckbox` with label), `role="group"`. */
export const adminFilterCheckboxGroupClass = 'flex flex-wrap items-center gap-x-4 gap-y-2';

/** Selection bar between toolbar and table; `AdminSelectionBar` uses it. */
export const adminSelectionBarClass = 'mb-3 flex flex-wrap items-center gap-2 rounded-md bg-elevated px-3 py-2';
/** The count in the selection bar ("3 ausgewählt"), `role="status"`. */
export const adminSelectionCountClass = 'text-sm font-medium';

/** Head cell: muted, no fill, no capitals. */
export const adminThClass = 'border-b border-default px-2 py-2 text-left text-sm font-medium whitespace-nowrap text-muted';
/** Body row with hover. */
export const adminRowClass = 'hover:bg-elevated/50';
/** Body cell of a one line row (40 to 44 px; a badge in the row sets the height). */
export const adminTdClass = 'border-b border-default px-2 py-2 text-sm';
/** Reference numbers, codes and technical ids; nothing else is monospaced. */
export const adminTdCodeClass = 'font-mono';
/** An empty value, rendered as "-". */
export const adminEmptyValueClass = 'text-muted';

/** A filter without hits: one left aligned line plus a ghost button "Filter zurücksetzen". */
export const adminFilterEmptyClass = 'flex flex-wrap items-center gap-x-3 gap-y-1 py-8 text-sm text-muted';
/** Loading: five rows of `USkeleton` in row height. */
export const adminSkeletonListClass = 'space-y-2';
export const adminSkeletonRowClass = 'h-10 w-full';

/** Paging under the table: summary left, `UPagination` right. */
export const adminPagingClass = 'mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between';
export const adminPagingSummaryClass = 'text-sm text-muted';

/** `ui` for a new `UTable`. */
export const adminTableUi = {
    th: 'px-2 py-2 text-sm font-medium text-muted',
    td: 'px-2 py-2 text-sm text-default'
} as const;
