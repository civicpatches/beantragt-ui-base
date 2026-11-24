/**
 * Neutral extension outlets of the base app.
 *
 * A layer registers components for a named outlet (for example the commercial
 * demo tour overlay); `<AppExtensionOutlet name="..." />` renders them. The
 * base app registers nothing, so the citizen build renders empty outlets and
 * never imports layer code.
 */
import { markRaw, shallowReactive, type Component } from 'vue';

export type AppExtensionOutletName = 'app-overlay' | 'home-actions' | 'footer-actions' | 'start-footer-actions' | 'login-actions';

const registry = shallowReactive<Partial<Record<AppExtensionOutletName, readonly Component[]>>>({});

/** Adds a component to an outlet once; returns a function that removes it. */
export function registerAppExtension(name: AppExtensionOutletName, component: Component): () => void {
    const raw = markRaw(component);
    const current = registry[name] ?? [];
    if (!current.includes(raw)) {
        registry[name] = [...current, raw];
    }
    return () => {
        registry[name] = (registry[name] ?? []).filter(entry => entry !== raw);
    };
}

/** The components registered for an outlet, in registration order. */
export function appExtensions(name: AppExtensionOutletName): readonly Component[] {
    return registry[name] ?? [];
}
