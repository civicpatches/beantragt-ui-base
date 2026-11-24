/**
 * Loosely-typed JSON:API shapes for server routes that parse raw Drupal
 * responses defensively (fields treated as optional because the response is
 * consumed before any attribute-level validation).
 *
 * Distinct from the stricter `JsonApiResource` / `JsonApiRelationship` in
 * `~/types/api`, which model already-validated entity resources with
 * required id/type/attributes.
 */

/** A to-one JSON:API relationship envelope with a loosely-typed identifier. */
export interface RawJsonApiRelationship {
    data?: {
        type?: string
        id?: string
    } | null
}

/** A generic JSON:API resource object as returned by Drupal, pre-validation. */
export interface RawJsonApiResource {
    id?: string
    type?: string
    attributes?: Record<string, unknown>
    relationships?: Record<string, {
        data?: { id: string, type?: string } | Array<{ id: string, type?: string }> | null
    }>
}

/** A `group--jur` / `group--org` resource as it appears in an `included` array. */
export interface RawJsonApiGroupResource {
    type?: string
    id?: string
    relationships?: {
        field_jurisdiction?: RawJsonApiRelationship
    }
}
