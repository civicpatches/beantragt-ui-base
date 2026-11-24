import type { FormField, FormSchema } from '~/types/form';

/**
 * Whether a section of a citizen form is shown. A section can be an
 * information block: a title and a description without any field. So a section is hidden
 * only when it has NO visible field AND no description; with a description it stays, with or
 * without fields. "No visible field" covers a section without fields and a section whose
 * fields are all hidden by their conditions, so the answer follows the citizen's answers.
 *
 * The renderer uses it live (with the conditions' current state); the form's length summary
 * uses it for the start (fields with a condition count as hidden until an answer shows them).
 */
export function sectionIsShown(
    section: FormSchema['sections'][number],
    fieldShown: (field: FormField) => boolean,
    description: string | undefined
): boolean {
    if ((description ?? '').trim() !== '') return true;
    return section.fields.some(fieldShown);
}
