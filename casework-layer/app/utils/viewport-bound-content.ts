/*
 * The sentence behind the head's lock was 384 px wide (`max-w-sm`)
 * and reached 32 px (360) and 72 px (320) past the screen, as the section menu had done. One
 * rule for the editor's floating content (menus and popovers that hold text): at most the viewport minus
 * the framework's collision padding on both sides (8 + 8 px, the default of `UPopover` and
 * `UDropdownMenu`), so Reka's collision handling keeps it inside, and its text wraps.
 */
export const VIEWPORT_BOUND_CONTENT = 'max-w-[calc(100vw-1rem)]';

/** The framework's `ui.content` for a popover or menu bound to the viewport. */
export const VIEWPORT_BOUND_UI = { content: VIEWPORT_BOUND_CONTENT } as const;
