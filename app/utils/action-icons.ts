/**
 * The product's signs for "edit this" and for the state "Entwurf": one name each, so a change of a sign is one line.
 *
 * The square pen (`EDIT_ICON`) identifies edit actions, including the form editor, profile editing,
 * self-fill and the editable workflow status icon.
 *
 * The dashed circle (`DRAFT_ICON`) distinguishes draft forms and integrations from the edit action. A content or data document keeps its
 * `file-pen` sign.
 *
 * The theme studio's copied icon lists (`app/utils/theme/icons.ts`, `nuxt-ui-icons.ts`) keep the framework's own names:
 * they are foreign source, kept verbatim.
 */
export const EDIT_ICON = 'i-lucide-square-pen';

/** The sign the product used for "edit" before; a stored workflow status icon with it is shown as `EDIT_ICON`. */
export const LEGACY_EDIT_ICON = 'i-lucide-pencil';

/** The state "Entwurf": a circle not yet closed. */
export const DRAFT_ICON = 'i-lucide-circle-dashed';
