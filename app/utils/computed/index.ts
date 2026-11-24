/**
 * Frontend preview registry for server-side compute functions.
 *
 * Each entry mirrors a plugin registered in the Drupal beantragt_compute
 * module. The frontend uses these ONLY for live preview while the citizen
 * fills the form. The server is always authoritative; never submit previewed
 * values as user input.
 *
 * Add a new entry here only when the matching backend plugin ships. Delete or
 * update entries when the backend contract changes -- the two must stay in
 * sync (drift risk).
 */
import { approvalTier } from './approvalTier';

type PreviewFn = (args: unknown[]) => unknown;

const REGISTRY: Record<string, PreviewFn> = {
    // The backend plugin approvalTier classifies an amount into an approval level.
    approvalTier: ([amount]) => approvalTier(amount)
};

/**
 * Calls the preview function for `fn` with `args` and returns the result.
 * Returns `undefined` for unknown function names so callers can decide to
 * show nothing rather than crash or show a stale value.
 */
export function computePreview(fn: string, args: unknown[]): unknown {
    const previewFn = REGISTRY[fn];
    if (!previewFn) return undefined;
    return previewFn(args);
}

export { approvalTier };
