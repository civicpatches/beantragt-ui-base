/**
 * Extension seam of the staff detail response (contract 2.3 and 4.2).
 *
 * The detail route passes on the plain fields of an attachment row itself and asks this registry for the rest. A
 * layer registers at Nitro plugin time; every register call returns the function that removes what it added, and an
 * empty registry adds nothing, so the open build answers with the plain fields only. Pro registers the analysis,
 * guard and pre-check keys (`plugins/case-response-extensions.ts`).
 *
 * Registration is idempotent: the same function is taken once, so a plugin that Nitro loads twice (an explicit
 * `nitro.plugins` entry and the scan of `server/plugins/` can name the same file) adds it once.
 *
 * Part of the open case-work layer (moves with the detail route, contract 3.4).
 */

export interface CaseAttachmentResponseContext {
    /** The form field the attachment belongs to (a string; the route drops rows without one). */
    fieldId: string
}

/** Returns the keys to add to one attachment row, or nothing. It must not return a plain field of the row. */
export type CaseAttachmentResponseExtension
    = (raw: Readonly<Record<string, unknown>>, context: CaseAttachmentResponseContext) => Record<string, unknown> | undefined;

const extensions: CaseAttachmentResponseExtension[] = [];

export function registerCaseAttachmentResponseExtension(extension: CaseAttachmentResponseExtension): () => void {
    if (extensions.includes(extension)) return () => {};
    extensions.push(extension);
    return () => {
        const index = extensions.indexOf(extension);
        if (index >= 0) extensions.splice(index, 1);
    };
}

/** The keys every registered extension adds to one raw Drupal row, in registration order; `{}` when none is registered. */
export function caseAttachmentResponseExtras(
    raw: Readonly<Record<string, unknown>>,
    context: CaseAttachmentResponseContext
): Record<string, unknown> {
    const extras: Record<string, unknown> = {};
    for (const extension of extensions) {
        Object.assign(extras, extension(raw, context) ?? {});
    }
    return extras;
}
