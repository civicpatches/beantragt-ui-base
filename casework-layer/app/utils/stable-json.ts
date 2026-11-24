/**
 * Serializes a JSON value with object keys in sorted order.
 *
 * Two values that differ only in the order of their object keys yield the
 * same string, so a stored form schema can be compared with the editor copy
 * whose keys were rebuilt in another order. Arrays keep their order;
 * undefined object members are left out like JSON.stringify does.
 */
export function stableJson(value: unknown): string {
    return JSON.stringify(sortKeys(value)) ?? 'undefined';
}

function sortKeys(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sortKeys);
    if (!value || typeof value !== 'object') return value;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
        sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return sorted;
}
