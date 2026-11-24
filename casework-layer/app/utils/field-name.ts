/*
 * A field whose label is empty is named the way the card and the inspector's
 * title name it ("Feld ohne Beschriftung", passed in by the caller, who has the translation), never by its
 * key, a word the person never gave. Callers that pass no such name keep the key (internal uses).
 */
export function fieldName(field: { id: string, label?: string | null }, untitled?: string): string {
    if (field.label?.trim()) return field.label;
    return untitled || field.id;
}
