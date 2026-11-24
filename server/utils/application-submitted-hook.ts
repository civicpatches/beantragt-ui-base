/**
 * Neutral extension point after a successful citizen submit.
 *
 * `/api/submit` calls `emitApplicationSubmitted()` once the application
 * exists. Layers may listen to the Nitro hook `beantragt:application-submitted`
 * (the commercial layer binds an in-app demo tour to it). The base app knows
 * no listener. The emitter waits at most 3 s, swallows every error and never
 * changes the submit response.
 */
import type { H3Event } from 'h3';

export interface ApplicationSubmittedPayload {
    schemaId: string
    referenceNumber: string
}

declare module 'nitropack/types' {
    interface NitroRuntimeHooks {
        'beantragt:application-submitted': (event: H3Event, payload: ApplicationSubmittedPayload) => void | Promise<void>
    }
}

export const APPLICATION_SUBMITTED_HOOK = 'beantragt:application-submitted';
export const APPLICATION_SUBMITTED_HOOK_TIMEOUT_MS = 3000;

export async function emitApplicationSubmitted(
    event: H3Event,
    payload: ApplicationSubmittedPayload,
    timeoutMs = APPLICATION_SUBMITTED_HOOK_TIMEOUT_MS
): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        const listeners = Promise.resolve()
            .then(() => useNitroApp().hooks.callHook(APPLICATION_SUBMITTED_HOOK, event, { ...payload }))
            .catch(() => {
                console.warn('[submit] application-submitted listener failed');
            });
        const timeout = new Promise<void>((resolve) => {
            timer = setTimeout(resolve, timeoutMs);
        });
        await Promise.race([listeners, timeout]);
    } catch {
        // Never affects the submit.
    } finally {
        if (timer !== undefined) clearTimeout(timer);
    }
}
