/*
 * At 390 px the field bar in the inspector's sheet wrapped into
 * two rows (318 x 68 px instead of 318 x 32), because "Feld löschen" with its text (121 px) did not fit
 * beside the other two groups and the spacing, and everything in the inspector sat 36 px lower. A
 * viewport threshold had been computed without the spacing. The room decides: "Feld löschen" shows
 * its text only where the row has room for it, else it is its icon (with its name and tooltip).
 */

/** The widths of one row of the bar, in px. */
export interface FieldBarRow {
    /** The width the bar may take (its card, or the sheet's head). */
    available: number
    /** The space between two groups. */
    gap: number
    /** The natural widths of the groups before "Feld löschen". */
    groups: number[]
    /** "Feld löschen" as its icon only (a square button). */
    deleteIcon: number
    /** What its text adds (label and the space between icon and label). */
    deleteText: number
}

/** "Feld löschen" with its text fits in one row with the other groups. */
export function deleteTextFits(row: FieldBarRow): boolean {
    const groups = row.groups.reduce((sum, width) => sum + width, 0);
    const gaps = row.gap * row.groups.length;
    return groups + gaps + row.deleteIcon + row.deleteText <= row.available;
}

/**
 * At the field the bar keeps the section's bin column (32 px at the card's right
 * end) and 48 px before it free, so the field's delete never stands within a finger of the section's.
 * From 640 px; below, the field's delete is the bar's first control instead.
 */
export const SECTION_BIN_CLEARANCE = 32 + 48;

/*
 * The last decision per place of the bar (the field, the sheet) and width class (from 640 px or below),
 * so a bar mounted anew (another selection, a drop) starts with it until its first sizes arrive. At
 * first: the text, except in the sheet below 640 px.
 */
const remembered = new Map<string, boolean>();

export function rememberedDeleteText(placement: 'field' | 'sheet', wide: boolean): boolean {
    return remembered.get(`${placement}:${wide}`) ?? (placement === 'field' || wide);
}

export function rememberDeleteText(placement: 'field' | 'sheet', wide: boolean, shown: boolean): void {
    remembered.set(`${placement}:${wide}`, shown);
}

/*
 * At 1280 px with the sidebar expanded and three or more sections the
 * bar was capped at 472 px while its middle group needed 232 ("In Abschnitt verschieben ▾" 196 and the
 * keyboard help 32, neither shrinks): the group was pressed to 163 px and the keyboard help lay inside
 * "Feld löschen". The decision had used the group's observed, squeezed width. It uses the controls'
 * own widths, and nothing may overlap. When the row has too little room, in this order:
 * 1. "Feld löschen" loses its text (its icon, with its name and tooltip);
 * 2. the section control takes its short form (its icon, with its name and tooltip, as in the sheet);
 * 3. the bar wraps.
 * The one-target button may be cut instead (its name in the tooltip): its least width is its icon's.
 */
/** The menu trigger's short form: a square button with its icon and the chevron (6 + 20 + 6 + 20 + 6). */
export const MENU_SHORT_WIDTH = 58;

export interface FieldBarRoom {
    /** The width the bar may take (its card minus the section's bin column, or the sheet's head). */
    available: number
    /** Between groups. */
    gap: number
    /** Between the controls of a group (gap-1). */
    inner: number
    /** The move group as it is (its controls do not shrink). */
    move: number
    /** The section control at its full form (for the one-target button: the least it may be cut to). */
    sectionFull: number
    /** The section control at its short form. */
    sectionShort: number
    /** The keyboard help. */
    keyboard: number
    /** "Feld löschen" as its icon; what its text adds. */
    deleteIcon: number
    deleteText: number
}

export interface FieldBarForms {
    deleteText: boolean
    sectionShort: boolean
    wrap: boolean
}

function rowWidth(room: FieldBarRoom, section: number, remove: number): number {
    return room.move + room.gap + section + room.inner + room.keyboard + room.gap + remove;
}

export function decideBarForms(room: FieldBarRoom): FieldBarForms {
    if (rowWidth(room, room.sectionFull, room.deleteIcon + room.deleteText) <= room.available) return { deleteText: true, sectionShort: false, wrap: false };
    if (rowWidth(room, room.sectionFull, room.deleteIcon) <= room.available) return { deleteText: false, sectionShort: false, wrap: false };
    if (rowWidth(room, room.sectionShort, room.deleteIcon) <= room.available) return { deleteText: false, sectionShort: true, wrap: false };
    return { deleteText: false, sectionShort: true, wrap: true };
}

/** The boxes (from, to) of the bar's four parts in one row for given forms; for tests and the report. */
export function barBoxes(room: FieldBarRoom, forms: FieldBarForms): Record<'move' | 'section' | 'keyboard' | 'delete', [number, number]> {
    const section = forms.sectionShort ? room.sectionShort : room.sectionFull;
    const remove = room.deleteIcon + (forms.deleteText ? room.deleteText : 0);
    const move: [number, number] = [0, room.move];
    const sectionBox: [number, number] = [move[1] + room.gap, move[1] + room.gap + section];
    const keyboard: [number, number] = [sectionBox[1] + room.inner, sectionBox[1] + room.inner + room.keyboard];
    const removeBox: [number, number] = [keyboard[1] + room.gap, keyboard[1] + room.gap + remove];
    return { move, section: sectionBox, keyboard, delete: removeBox };
}
