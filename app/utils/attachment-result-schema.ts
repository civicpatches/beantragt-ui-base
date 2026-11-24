import type { FormSchema } from '~/types/form';
import { BULK_LIMITS } from '../../shared/bulk';

/**
 * Result schemas for the attachment pre-check that the form assistant may
 * propose. The assistant never decides where an attachment is sent
 * (egressPolicy, modelClass stay with the editor), so a proposal is reduced to
 * what the pre-check can safely read:
 * - yes/no facts about the document (`nonPersonal: true`, boolean only), and
 * - values for case workers (`purposeBound: true`), optionally compared with
 *   a number field of the form. They only run under a sovereign or local
 *   policy; under any other policy the editor shows a blocking hint and
 *   Drupal refuses to save, so the assistant may propose them before the
 *   editor has chosen the policy.
 * A number from the assistant is always treated as personal: it can only be
 * purpose-bound, never `nonPersonal` (which would let it reach an external
 * model). Non-personal numbers stay an editor decision in the inspector.
 * The assistant only adds keys; the saved schema is kept as it is.
 * Descriptions and other free text are dropped: they would reach the model.
 */

const RESULT_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
export const MAX_RESULT_PROPERTIES = 20;
// The batch check reads the same title; one limit for both (Vorprüfung step 3).
const MAX_TITLE_LENGTH = BULK_LIMITS.criterionTitle;
const VALUE_TYPES: readonly string[] = ['boolean', 'number', 'integer'];
/**
 * A yes/no fact the assistant may declare non-personal must read like a
 * property of the document itself (present, visible, legible, the document
 * type). Anything else could be a personal fact (health, income thresholds)
 * that would reach external models and the applicant; under a sovereign
 * policy the assistant can still propose it as purpose-bound.
 */
const DOCUMENT_FACT_KEY_PATTERN = /^(?:[a-z0-9_]+_(?:present|visible|legible|readable|complete|current|signed|stamped|document|vorhanden|erkennbar|lesbar|aktuell|vollstaendig|unterschrieben)|legible|readable|complete|lesbar|vollstaendig)$/;
/**
 * Terms that disqualify a key or title even when it looks like a document
 * fact: thresholds over a person's figures and special categories.
 */
const DERIVED_PERSONAL_TERMS: readonly string[] = [
    'above', 'below', 'exceed', 'threshold', 'limit', 'grenze', 'schwelle', 'uebersteigt', 'übersteigt',
    'schwanger', 'pregnan', 'krankheit', 'diagnos', 'illness', 'religion', 'konfession',
    'staatsang', 'nationalit', 'behinder', 'disabil', 'ethni', 'hiv', 'aids', 'positiv',
    'negativ', 'gesund', 'health', 'brutto', 'netto', 'betrag', 'amount',
    'schulden', 'debt', 'vorstraf', 'criminal', 'sexu'
];

export function hasDerivedPersonalSignal(...values: string[]): boolean {
    return values.some((value) => {
        const compact = value.toLowerCase().replace(/[\s_.:-]+/gu, '');
        return DERIVED_PERSONAL_TERMS.some(term => compact.includes(term));
    });
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/** Definitions of a saved result schema in either supported format. */
function savedDefinitions(schema: unknown): Array<[string, Record<string, unknown>]> {
    if (!isRecord(schema)) return [];
    const definitions: Array<[string, Record<string, unknown>]> = [];
    if (isRecord(schema.properties)) {
        for (const [key, raw] of Object.entries(schema.properties)) {
            if (isRecord(raw)) definitions.push([key, raw]);
        }
    }
    if (Array.isArray(schema.fields)) {
        for (const raw of schema.fields) {
            if (!isRecord(raw)) continue;
            const key = [raw.key, raw.id, raw.name].find((value): value is string => typeof value === 'string' && value !== '');
            if (!key) continue;
            const { key: _key, id: _id, name: _name, ...definition } = raw;
            definitions.push([key, definition]);
        }
    }
    return definitions;
}

/** Ids of the number fields a purpose-bound value may be compared with. */
export function numberFieldIds(schema: Pick<FormSchema, 'sections'> | null | undefined): Set<string> {
    const ids = new Set<string>();
    for (const section of schema?.sections ?? []) {
        // Repeatable sections store their answers per instance, not by field id.
        if (section.repeatable) continue;
        for (const field of section.fields ?? []) {
            if (field.type === 'number') ids.add(field.id);
        }
    }
    return ids;
}

/**
 * Reduces an assistant proposal to an allowed result schema, or undefined when
 * nothing usable remains.
 */
export function sanitizeProposedResultSchema(
    proposal: unknown,
    comparableFieldIds?: ReadonlySet<string>,
    trustedSchema?: unknown,
    /** Server-side identifier check (hasUnsafeExtractionSignal) on key and title. */
    isUnsafe?: (...values: Array<string | undefined>) => boolean,
    /**
     * The same check for a non-personal yes/no fact about the document
     * (hasUnsafeDocumentFactSignal), which admits "signature_present".
     * Defaults to isUnsafe.
     */
    isUnsafeDocumentFact: ((...values: Array<string | undefined>) => boolean) | undefined = isUnsafe
): Record<string, unknown> | undefined {
    if (!isRecord(proposal) || !isRecord(proposal.properties)) return undefined;
    const properties: Record<string, Record<string, unknown>> = {};

    // The saved schema was released by a person: the assistant can only add
    // new keys. Changing or removing saved ones stays in the inspector. Both
    // supported formats (properties map, fields list) are kept; the result is
    // written as a properties map.
    for (const [key, raw] of savedDefinitions(trustedSchema)) {
        if (!Object.hasOwn(properties, key)) properties[key] = raw;
    }
    const editorKeys = new Set(Object.keys(properties));
    let accepted = 0;

    for (const [key, raw] of Object.entries(proposal.properties)) {
        if (Object.keys(properties).length >= MAX_RESULT_PROPERTIES + editorKeys.size) break;
        if (!RESULT_KEY_PATTERN.test(key) || !isRecord(raw) || Object.hasOwn(properties, key)) continue;
        const type = typeof raw.type === 'string' ? raw.type : '';
        if (!VALUE_TYPES.includes(type)) continue;
        const title = typeof raw.title === 'string' ? raw.title.trim().slice(0, MAX_TITLE_LENGTH) : '';
        const definition: Record<string, unknown> = { type, ...(title ? { title } : {}) };

        if (raw.purposeBound === true) {
            if (isUnsafe?.(key, title || undefined)) continue;
            definition.purposeBound = true;
            if (type !== 'boolean' && typeof raw.compareWith === 'string' && (!comparableFieldIds || comparableFieldIds.has(raw.compareWith))) {
                definition.compareWith = raw.compareWith;
            }
        } else if (
            raw.nonPersonal === true
            && type === 'boolean'
            && DOCUMENT_FACT_KEY_PATTERN.test(key)
            && !hasDerivedPersonalSignal(key, title)
            && !isUnsafeDocumentFact?.(key, title || undefined)
        ) {
            definition.nonPersonal = true;
        } else {
            continue;
        }
        properties[key] = definition;
        accepted++;
    }

    // Nothing usable from the assistant: the caller keeps the current schema.
    if (accepted === 0) return undefined;
    const keys = Object.keys(properties);
    // The assistant may only make its own new keys required; required flags
    // of saved keys stay as the editor set them.
    const requestedRequired = [
        ...(isRecord(trustedSchema) && Array.isArray(trustedSchema.required) ? trustedSchema.required : [])
            .filter(key => typeof key === 'string' && editorKeys.has(key)),
        ...(Array.isArray(proposal.required) ? proposal.required : [])
            .filter(key => typeof key === 'string' && !editorKeys.has(key))
    ];
    const required = [...new Set(requestedRequired.filter((key): key is string => typeof key === 'string' && keys.includes(key)))];
    return {
        type: 'object',
        ...(required.length > 0 ? { required } : {}),
        properties
    };
}
