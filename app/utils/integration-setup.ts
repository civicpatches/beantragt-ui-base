/**
 * Setup state of the integrations of one municipality.
 *
 * The chain is: an active connection, a mapping with an active version, an
 * active transfer rule that is not blocked. The overview shows all three
 * steps; the connection and mapping version pages show the step after their
 * own one when it is the next open step, whatever way the person came.
 * `?setup=1` in the address no longer decides; links may still carry it as a
 * hint for the assistant.
 */
import type { Assignment, Connection, IntegrationListResponse, MappingSummary } from '~/types/integrations';

export type IntegrationSetupStepKey = 'connection' | 'mapping' | 'rule';

export interface IntegrationSetupInput {
    connections: ReadonlyArray<Partial<Pick<Connection, 'status'>>>
    mappings: ReadonlyArray<Partial<Pick<MappingSummary, 'versions'>>>
    rules: ReadonlyArray<Partial<Pick<Assignment, 'status' | 'blocked'>>>
}

export interface IntegrationSetupStep {
    key: IntegrationSetupStepKey
    done: boolean
}

export function integrationSetupSteps(input: IntegrationSetupInput): IntegrationSetupStep[] {
    return [
        { key: 'connection', done: input.connections.some(connection => connection?.status === 'active') },
        { key: 'mapping', done: input.mappings.some(mapping => (mapping?.versions ?? []).some(version => version?.status === 'active')) },
        { key: 'rule', done: input.rules.some(rule => rule?.status === 'active' && !rule.blocked) }
    ];
}

/** The first open step, or null when every step is done. */
export function nextIntegrationSetupStep(input: IntegrationSetupInput): IntegrationSetupStepKey | null {
    return integrationSetupSteps(input).find(step => !step.done)?.key ?? null;
}

type ListFn = <T>(suffix: string) => Promise<IntegrationListResponse<T>>;

/**
 * Loads the three lists and answers the next open step for a detail page.
 * A failed or truncated list cannot prove that a step is open, so the hint
 * stays hidden then; it never breaks the page load.
 */
export async function loadNextIntegrationSetupStep(list: ListFn): Promise<IntegrationSetupStepKey | null> {
    try {
        const [connections, mappings, rules] = await Promise.all([
            list<Connection>('/connections'),
            list<MappingSummary>('/mappings'),
            list<Assignment>('/assignments')
        ]);
        const lists = [connections, mappings, rules];
        if (lists.some(result => !Array.isArray(result?.data) || result.meta?.truncated)) return null;
        return nextIntegrationSetupStep({ connections: connections.data, mappings: mappings.data, rules: rules.data });
    } catch {
        return null;
    }
}
