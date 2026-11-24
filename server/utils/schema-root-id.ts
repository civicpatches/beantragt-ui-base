import type { FormSchema } from '~~/app/types/form';

type StoredSchemaField = string | { value?: string } | undefined;

function storedSchemaText(raw: StoredSchemaField): string {
    return typeof raw === 'string' ? raw : raw?.value || '';
}

function storedRootId(raw: StoredSchemaField, entityUuid: string): string | undefined {
    const schemaText = storedSchemaText(raw);
    if (!schemaText) return undefined;

    try {
        const parsed = JSON.parse(schemaText) as { id?: unknown };
        return typeof parsed.id === 'string'
          && parsed.id.length > 0
          && parsed.id !== entityUuid
            ? parsed.id
            : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Keep Drupal's entity UUID out of the persisted form-schema DSL.
 *
 * Read models currently project the entity UUID into `schema.id`. Full-schema
 * writes must reverse that projection: preserve the stored root id when one
 * exists, otherwise omit the synthetic root id altogether. Stored legacy ids
 * remain unchanged because Drupal validates the root id only when it changes.
 * A non-UUID id sent by an author remains untouched and is validated there.
 */
export function reconcileStoredSchemaRootId(
    schema: FormSchema,
    entityUuid: string,
    storedSchema: StoredSchemaField,
    options: { allowNewRootId?: boolean } = {}
): FormSchema {
    const persistedRootId = storedRootId(storedSchema, entityUuid);
    if (persistedRootId) {
        return schema.id === persistedRootId
            ? schema
            : { ...schema, id: persistedRootId };
    }

    if (options.allowNewRootId === false && schema.id !== undefined) {
        const reconciled = { ...schema };
        delete reconciled.id;
        return reconciled;
    }

    if (schema.id !== entityUuid) {
        return schema;
    }

    const reconciled = { ...schema };
    delete reconciled.id;
    return reconciled;
}
