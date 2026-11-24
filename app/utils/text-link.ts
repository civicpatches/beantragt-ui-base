/**
 * Text links use the default text colour, medium weight and an underline with a 2 px offset. Colour is
 * never the only mark (the tenant's colour is not a link colour), so the underline stays at rest.
 *
 * Used on `UButton color="neutral" variant="link"` for an action in a text line that stays on the page (opens a
 * slide-over or a dialog), beside `CITIZEN_CONTAINER_CLASS` as the other shared class constant. Not a theme entry: the
 * `neutral` plus `link` compound variant colours every neutral link button of the product.
 *
 * Only the look: each place adds its own layout (`inline` in a text flow, padding for a 24 px target, `p-0
 * align-baseline` inside a sentence). The pattern's `min-h-6` is a layout class of the rows and is set there, not here:
 * on an inline element it has no effect, and inside a sentence it would make the line taller.
 */
export const TEXT_LINK_CLASS = 'font-medium text-default underline underline-offset-2';
