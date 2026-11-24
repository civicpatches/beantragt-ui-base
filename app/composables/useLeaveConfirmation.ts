import { getCurrentScope, onScopeDispose, shallowRef } from 'vue';

/** What the person is about to do that leaves the page. */
export type LeaveIntent = 'logout';

type LeaveAsker = (intent: LeaveIntent) => boolean | Promise<boolean>;

// One page at a time can hold entries that would be lost (the citizen form).
const asker = shallowRef<LeaveAsker | null>(null);
let confirmedLeave = false;

/**
 * Asks the open page before an action that leaves it and ends the session
 *: "Abmelden" and the demo persona switch in the header. Navigation
 * guards ask only once the session is already gone, so the header asks
 * first; the page's own route guard then lets the following navigation
 * pass without asking a second time.
 */
export function useLeaveConfirmation() {
    /** The page registers its question for as long as it is mounted. */
    function register(fn: LeaveAsker): void {
        asker.value = fn;
        if (getCurrentScope()) {
            onScopeDispose(() => {
                if (asker.value === fn) asker.value = null;
            });
        }
    }

    /** True when nothing is open or the person agreed to leave. */
    async function confirm(intent: LeaveIntent): Promise<boolean> {
        const ask = asker.value;
        if (!ask) return true;
        const leave = await ask(intent);
        confirmedLeave = leave;
        return leave;
    }

    /** For the page's route guard: the leave was already confirmed. */
    function alreadyConfirmed(): boolean {
        return confirmedLeave;
    }

    /** The action that asked is over (navigated, failed or cancelled). */
    function end(): void {
        confirmedLeave = false;
    }

    return { register, confirm, alreadyConfirmed, end };
}
