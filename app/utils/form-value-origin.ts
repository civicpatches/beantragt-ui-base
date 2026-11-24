import { toRaw } from 'vue';

interface FormValueOrigins {
    defaults: Map<string, unknown>
    edited: Set<string>
}

// Origin is local to this form object and never enters submittedData or JSON.
const origins = new WeakMap<object, FormValueOrigins>();

function state(data: Record<string, unknown>): FormValueOrigins {
    const key = toRaw(data);
    let value = origins.get(key);
    if (!value) {
        value = { defaults: new Map(), edited: new Set() };
        origins.set(key, value);
    }
    return value;
}

export function copyFormValueOrigins(from: Record<string, unknown>, to: Record<string, unknown>): Record<string, unknown> {
    const current = origins.get(toRaw(from));
    if (current) origins.set(toRaw(to), { defaults: new Map(current.defaults), edited: new Set(current.edited) });
    return to;
}

export function registerFormDefault(data: Record<string, unknown>, fieldId: string, value: unknown): void {
    state(data).defaults.set(fieldId, value);
}

/** Restore the origin together with a value reverted after profile cleanup. */
export function restoreFormFieldOrigin(data: Record<string, unknown>, fieldId: string, value: unknown): void {
    const current = state(data);
    current.edited.delete(fieldId);
    current.defaults.set(fieldId, value);
}

export function markFormFieldEdited(data: Record<string, unknown>, fieldId: string): void {
    const current = state(data);
    current.edited.add(fieldId);
    current.defaults.delete(fieldId);
}

export function formFieldWasEdited(data: Record<string, unknown>, fieldId: string): boolean {
    return origins.get(toRaw(data))?.edited.has(fieldId) ?? false;
}

export function isUntouchedFormDefault(data: Record<string, unknown>, fieldId: string): boolean {
    const current = origins.get(toRaw(data));
    return Boolean(current?.defaults.has(fieldId) && !current.edited.has(fieldId) && Object.is(data[fieldId], current.defaults.get(fieldId)));
}
