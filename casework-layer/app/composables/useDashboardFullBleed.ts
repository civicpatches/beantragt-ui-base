import { computed, getCurrentScope, onScopeDispose, reactive, type WritableComputedRef } from 'vue';

/*
 * SSR is off, so one client-side state is enough. A page claims the whole panel body (no padding, the body itself
 * does not scroll) while its content needs it and gives the claim back when it leaves.
 *
 * Claims, not one boolean: on a route change Vue runs the setup of the incoming page before the
 * `onUnmounted` hook of the outgoing one, so with a single flag the leaving page reset what the arriving page had
 * just set (work mode -> batch case). Each component scope holds its own claim and can only drop its own; the
 * panel is full bleed while at least one claim stands. A claim also ends with its scope. Calls outside a component
 * (tests) share one claim.
 */
const claims = reactive(new Set<symbol>());
const shared = Symbol('full-bleed-shared');

export function useDashboardFullBleed(): WritableComputedRef<boolean> {
    const claim = getCurrentScope() ? Symbol('full-bleed-claim') : shared;
    if (claim !== shared) onScopeDispose(() => claims.delete(claim));
    return computed({
        get: () => claims.size > 0,
        set: (value: boolean) => {
            if (value) claims.add(claim);
            else claims.delete(claim);
        }
    });
}
