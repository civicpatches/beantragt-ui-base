/**
 * Reads the workflow that governs a running application.
 *
 * Drupal resolves the workflow from the form's current published revision
 * (not from the intake revision the application was filled in with) and
 * answers on the internal, staff-only route
 * `GET /api/admin/applications/{internalId}/workflow`. The detail GET, the
 * status PATCH and the correction PATCH read targets from here only:
 * `allowed_next` is authoritative for which transitions exist, the raw
 * `definition` only feeds the attribute definitions of the dialog.
 *
 * Malformed answers and upstream failures other than access denial return 502 (
 * `errors.server.drupalRequestFailed`), tagged so handlers can pass it through
 * their generic catch blocks unchanged. Drupal access denial stays a 403.
 */
import type { H3Event } from 'h3';
import type { EffectiveApplicationTransition } from './application-workflow-transitions';

export const WORKFLOW_REVIEW_STATUS_NOT_IN_WORKFLOW = 'status_not_in_workflow';

export type ApplicationWorkflowReviewCode = typeof WORKFLOW_REVIEW_STATUS_NOT_IN_WORKFLOW;

export interface ApplicationWorkflowStatusRef {
    /** Numeric Drupal id, only for the internal PATCH calls; never sent to the browser. */
    id: number
    uuid: string
}

export interface ApplicationWorkflowSource {
    form: {
        uuid: string
        version: number | null
        revisionId: number | null
        source: 'published' | 'intake'
    } | null
    /** PHP's hasWorkflowOverride() for the governing revision. */
    override: boolean
    /** Raw workflow text of the governing revision; null means organisation graph. */
    definition: string | null
    canChangeStatus: boolean
    allowedNext: ApplicationWorkflowStatusRef[]
    review: {
        code: ApplicationWorkflowReviewCode
        canCorrect: boolean
        targets: ApplicationWorkflowStatusRef[]
    } | null
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FAILURE_CODE = 'errors.server.drupalRequestFailed';

const sourceFailures = new WeakSet<object>();

class MalformedWorkflowSource extends Error {}

function workflowSourceFailure(): Error {
    const error = createSafeError({
        statusCode: 502,
        message: FAILURE_CODE,
        data: { code: FAILURE_CODE }
    }) as Error;
    sourceFailures.add(error);
    return error;
}

/** True for the error thrown by fetchApplicationWorkflowSource(). */
export function isApplicationWorkflowSourceFailure(error: unknown): boolean {
    return Boolean(error && typeof error === 'object' && sourceFailures.has(error));
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function statusRefs(value: unknown): ApplicationWorkflowStatusRef[] {
    if (!Array.isArray(value)) throw new MalformedWorkflowSource('status list is not an array');
    return value.map((entry) => {
        if (!isRecord(entry)) throw new MalformedWorkflowSource('status entry is not an object');
        const id = entry.id;
        const uuid = entry.uuid;
        if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) {
            throw new MalformedWorkflowSource('status entry without a positive integer id');
        }
        if (typeof uuid !== 'string' || !UUID_PATTERN.test(uuid)) {
            throw new MalformedWorkflowSource('status entry without a valid uuid');
        }
        return { id, uuid };
    });
}

function formRef(value: unknown): ApplicationWorkflowSource['form'] {
    if (!isRecord(value)) return null;
    const uuid = typeof value.uuid === 'string' ? value.uuid : '';
    if (!uuid) return null;
    const version = Number(value.version);
    const revisionId = Number(value.revision_id);
    return {
        uuid,
        version: Number.isInteger(version) ? version : null,
        revisionId: Number.isInteger(revisionId) && revisionId > 0 ? revisionId : null,
        source: value.source === 'published' ? 'published' : 'intake'
    };
}

/** Validates the shape of the Drupal answer; throws MalformedWorkflowSource. */
export function parseApplicationWorkflowSource(raw: unknown): ApplicationWorkflowSource {
    if (!isRecord(raw)) throw new MalformedWorkflowSource('answer is not an object');
    if (typeof raw.override !== 'boolean') throw new MalformedWorkflowSource('override is not a boolean');
    if (typeof raw.can_change_status !== 'boolean') throw new MalformedWorkflowSource('can_change_status is not a boolean');
    if (raw.definition !== null && typeof raw.definition !== 'string') {
        throw new MalformedWorkflowSource('definition is neither a string nor null');
    }

    let review: ApplicationWorkflowSource['review'] = null;
    if (raw.review !== null && raw.review !== undefined) {
        if (!isRecord(raw.review)) throw new MalformedWorkflowSource('review is not an object');
        if (raw.review.code !== WORKFLOW_REVIEW_STATUS_NOT_IN_WORKFLOW) {
            throw new MalformedWorkflowSource('unknown review code');
        }
        if (typeof raw.review.can_correct !== 'boolean') {
            throw new MalformedWorkflowSource('review.can_correct is not a boolean');
        }
        review = {
            code: WORKFLOW_REVIEW_STATUS_NOT_IN_WORKFLOW,
            canCorrect: raw.review.can_correct,
            targets: statusRefs(raw.review.targets)
        };
    }

    return {
        form: formRef(raw.form),
        override: raw.override,
        // Drupal sends null whenever the workflow is no override; the
        // TypeScript builder must never interpret `mode` on its own.
        definition: raw.override && typeof raw.definition === 'string' ? raw.definition : null,
        canChangeStatus: raw.can_change_status,
        allowedNext: statusRefs(raw.allowed_next),
        review
    };
}

/**
 * Fetches and validates the governing workflow of one application.
 *
 * @throws a 403 on denied access, or a 502 `errors.server.drupalRequestFailed` (see
 *   isApplicationWorkflowSourceFailure) when Drupal fails or answers with an
 *   unexpected shape.
 */
export async function fetchApplicationWorkflowSource(
    event: H3Event,
    applicationInternalId: number
): Promise<ApplicationWorkflowSource> {
    if (!Number.isInteger(applicationInternalId) || applicationInternalId <= 0) {
        throw workflowSourceFailure();
    }
    try {
        const raw = await drupalSessionFetch<unknown>(
            event,
            `/api/admin/applications/${applicationInternalId}/workflow`
        );
        return parseApplicationWorkflowSource(raw);
    } catch (e: unknown) {
        if ((e as { statusCode?: number })?.statusCode === 403) {
            throw createSafeError({
                statusCode: 403,
                message: 'errors.admin.accessDenied',
                data: { code: 'errors.admin.accessDenied' }
            });
        }
        console.error(
            `[admin] Could not read the workflow of application ${applicationInternalId}:`,
            e instanceof Error ? e.message : e
        );
        throw workflowSourceFailure();
    }
}

/**
 * Restricts the builder's transitions of one application to the targets
 * Drupal allows. Drupal is the only authority on which targets
 * exist; the builder only contributes attribute definitions. A builder
 * transition to a target outside `allowedNext` is dropped; an allowed target
 * the builder does not know is offered without attributes, and Drupal refuses
 * the save if the transition needs one.
 */
export function transitionsForAllowedTargets(
    builderTransitions: EffectiveApplicationTransition[],
    allowedNext: ApplicationWorkflowStatusRef[],
    context: { from: string, machineNameOf: (statusUuid: string) => string }
): EffectiveApplicationTransition[] {
    const allowed = new Set(allowedNext.map(target => target.uuid));
    const transitions = builderTransitions.filter(transition => allowed.has(transition.targetStatusId));
    const known = new Set(transitions.map(transition => transition.targetStatusId));
    for (const target of allowedNext) {
        if (known.has(target.uuid)) continue;
        known.add(target.uuid);
        transitions.push({
            targetStatusId: target.uuid,
            from: context.from,
            to: context.machineNameOf(target.uuid),
            attributes: [],
            requiresAttributes: false
        });
    }
    return transitions;
}

/** Targets reachable without transition attributes, as the inline list select needs them. */
export function allowedNextWithoutAttributes(transitions: EffectiveApplicationTransition[]): string[] {
    return [...new Set(
        transitions
            .filter(transition => transition.attributes.length === 0)
            .map(transition => transition.targetStatusId)
    )];
}
