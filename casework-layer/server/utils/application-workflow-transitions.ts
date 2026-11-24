import type { H3Event } from 'h3';
import {
    normalizeSchemaWorkflowDefinition,
    type SchemaWorkflowAttribute
} from './schema-workflow-definition';
import {
    fetchWorkflowStatusesForGroup,
    isWorkflowStatusPageGuardError,
    resolveRequiredWorkflowStatusWorkspace,
    type WorkflowStatusDto
} from './workflow-status-admin';

export interface ApplicationWorkflowJsonApiResource {
    id?: string
    type?: string
    attributes?: Record<string, unknown>
    relationships?: Record<string, { data?: { id: string, type?: string } | Array<{ id: string, type?: string }> | null }>
}

export type EffectiveAllowedNext = Record<string, Record<string, string[]>>;

export interface EffectiveApplicationTransition {
    targetStatusId: string
    from: string
    to: string
    targetDescription?: string
    condition?: string
    attributes: SchemaWorkflowAttribute[]
    requiresAttributes: boolean
}

export type EffectiveApplicationTransitions = Record<string, Record<string, EffectiveApplicationTransition[]>>;

export interface EffectiveApplicationWorkflow {
    allowedNext: EffectiveAllowedNext
    transitions: EffectiveApplicationTransitions
}

function fieldText(value: unknown): string {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object' && 'value' in value) {
        const nested = (value as { value?: unknown }).value;
        return typeof nested === 'string' ? nested : '';
    }
    return '';
}

function workflowTextFromSchema(schema: ApplicationWorkflowJsonApiResource | undefined): string {
    const explicit = fieldText(schema?.attributes?.field_workflow_definition).trim();
    if (explicit) return explicit;

    const rawSchema = fieldText(schema?.attributes?.field_schema).trim();
    if (!rawSchema) return '';

    try {
        const decoded = JSON.parse(rawSchema) as { workflow?: unknown };
        return decoded.workflow && typeof decoded.workflow === 'object'
            ? JSON.stringify(decoded.workflow)
            : '';
    } catch {
        return '';
    }
}

function applicationSchemaId(application: ApplicationWorkflowJsonApiResource): string | null {
    const schemaRel = application.relationships?.field_schema?.data;
    return schemaRel && !Array.isArray(schemaRel) ? schemaRel.id : null;
}

function applicationStatusId(application: ApplicationWorkflowJsonApiResource): string | null {
    const statusRel = application.relationships?.field_workflow_status?.data;
    return statusRel && !Array.isArray(statusRel) ? statusRel.id : null;
}

function relationshipIds(resource: ApplicationWorkflowJsonApiResource | undefined, relationship: string): string[] {
    const rel = resource?.relationships?.[relationship]?.data;
    return Array.isArray(rel) ? rel.map(item => item.id).filter(Boolean) : [];
}

function relationshipId(resource: ApplicationWorkflowJsonApiResource | undefined, relationship: string): string | null {
    const rel = resource?.relationships?.[relationship]?.data;
    return rel && !Array.isArray(rel) && rel.id ? rel.id : null;
}

/**
 * Loads the status catalogue of every group the applications' current
 * statuses belong to, one request per distinct group. The builder only reads
 * statuses of the current status' own group, so the workspace-wide list (every
 * organisation of a jurisdiction) is never needed. The group comes
 * from the JSON:API include `field_workflow_status.field_group`.
 */
async function fetchCurrentGroupStatuses(
    event: H3Event,
    applications: ApplicationWorkflowJsonApiResource[],
    includedByKey: Map<string, unknown>
): Promise<WorkflowStatusDto[]> {
    const groupIds = new Set<string>();
    for (const application of applications) {
        const statusId = applicationStatusId(application);
        if (!statusId) continue;
        const current = includedByKey.get(`workflow_status--workflow_status:${statusId}`) as ApplicationWorkflowJsonApiResource | undefined;
        const groupId = relationshipId(current, 'field_group');
        if (groupId) groupIds.add(groupId);
    }
    if (groupIds.size === 0) return [];

    const workspace = await resolveRequiredWorkflowStatusWorkspace(event);
    const catalogues = await Promise.all(
        [...groupIds].map(groupId => fetchWorkflowStatusesForGroup(event, workspace, groupId))
    );
    return catalogues.flat();
}

function mergeRuntimeAttributes(
    statusAttributes: SchemaWorkflowAttribute[] | undefined,
    transitionAttributes: SchemaWorkflowAttribute[] | undefined
): SchemaWorkflowAttribute[] {
    const byCode = new Map<string, SchemaWorkflowAttribute>();
    for (const attribute of [...(statusAttributes ?? []), ...(transitionAttributes ?? [])]) {
        if (!attribute.variable) continue;
        byCode.set(attribute.code, attribute);
    }
    return [...byCode.values()].sort((a, b) => (a.order - b.order) || a.code.localeCompare(b.code));
}

function hasRequiredRuntimeAttributes(attributes: SchemaWorkflowAttribute[]): boolean {
    return attributes.some(attribute => attribute.required);
}

function emptyWorkflow(applications: ApplicationWorkflowJsonApiResource[]): EffectiveApplicationWorkflow {
    const allowedNext: EffectiveAllowedNext = {};
    const transitions: EffectiveApplicationTransitions = {};
    for (const application of applications) {
        const schemaId = applicationSchemaId(application);
        const statusId = applicationStatusId(application);
        if (!schemaId || !statusId) continue;
        allowedNext[schemaId] ??= {};
        allowedNext[schemaId][statusId] = [];
        transitions[schemaId] ??= {};
        transitions[schemaId][statusId] = [];
    }
    return { allowedNext, transitions };
}

export function applicationEffectiveAllowedNext(
    meta: EffectiveAllowedNext,
    application: ApplicationWorkflowJsonApiResource
): string[] | null {
    const schemaId = applicationSchemaId(application);
    const statusId = applicationStatusId(application);
    if (!schemaId || !statusId) return null;
    return meta[schemaId]?.[statusId] ?? null;
}

export function applicationEffectiveTransitions(
    meta: EffectiveApplicationTransitions,
    application: ApplicationWorkflowJsonApiResource
): EffectiveApplicationTransition[] {
    const schemaId = applicationSchemaId(application);
    const statusId = applicationStatusId(application);
    if (!schemaId || !statusId) return [];
    return meta[schemaId]?.[statusId] ?? [];
}

/**
 * Computes the transitions of each application's current status.
 *
 * @param workflowTextBySchemaId Workflow text per form schema UUID that
 *   replaces the text of the included schema (the governing
 *   revision from Drupal's `/workflow` route). A present key with `null`
 *   means "no override", that is the organisation graph.
 */
export async function buildEffectiveApplicationWorkflow(
    event: H3Event,
    applications: ApplicationWorkflowJsonApiResource[],
    includedByKey: Map<string, unknown>,
    preloadedStatuses?: WorkflowStatusDto[],
    workflowTextBySchemaId?: Record<string, string | null>
): Promise<EffectiveApplicationWorkflow> {
    try {
        const statuses = preloadedStatuses ?? await fetchCurrentGroupStatuses(event, applications, includedByKey);
        for (const status of statuses) {
            includedByKey.set(`workflow_status--workflow_status:${status.id}`, {
                id: status.id,
                type: 'workflow_status--workflow_status',
                attributes: {
                    label: status.label,
                    field_machine_name: status.machineName,
                    field_color: status.color,
                    field_icon: status.icon,
                    field_weight: status.weight,
                    field_semantic_flags: status.semanticFlags,
                    field_citizen_label_de: status.citizenLabel?.de ?? '',
                    field_citizen_label_en: status.citizenLabel?.en ?? ''
                },
                relationships: {
                    field_allowed_next: {
                        data: status.allowedNextIds.map(id => ({ id, type: 'workflow_status--workflow_status' }))
                    },
                    field_group: status.groupId
                        ? { data: { id: status.groupId, type: status.groupType || 'group--org' } }
                        : { data: null }
                }
            });
        }

        const includedMap = new Map(
            [...includedByKey.values()]
                .filter((item): item is ApplicationWorkflowJsonApiResource => Boolean((item as ApplicationWorkflowJsonApiResource).id && (item as ApplicationWorkflowJsonApiResource).type))
                .map(item => [`${item.type}:${item.id}`, item])
        );
        const bySchemaAndGroup = new Map<string, ReturnType<typeof normalizeSchemaWorkflowDefinition> | null>();
        const allowedNext: EffectiveAllowedNext = {};
        const transitions: EffectiveApplicationTransitions = {};

        for (const application of applications) {
            const schemaRel = application.relationships?.field_schema?.data;
            const statusRel = application.relationships?.field_workflow_status?.data;
            if (!schemaRel || Array.isArray(schemaRel) || !statusRel || Array.isArray(statusRel)) continue;

            const schema = includedMap.get(`form_schema--form_schema:${schemaRel.id}`);
            const current = includedMap.get(`workflow_status--workflow_status:${statusRel.id}`);
            const workflowText = workflowTextBySchemaId && Object.hasOwn(workflowTextBySchemaId, schemaRel.id)
                ? (workflowTextBySchemaId[schemaRel.id] ?? '').trim()
                : workflowTextFromSchema(schema);
            const currentMachineName = String(current?.attributes?.field_machine_name ?? '');
            const groupRel = current?.relationships?.field_group?.data;
            const groupId = groupRel && !Array.isArray(groupRel) ? groupRel.id : null;
            allowedNext[schemaRel.id] ??= {};
            transitions[schemaRel.id] ??= {};
            const schemaAllowedNext = allowedNext[schemaRel.id]!;
            const schemaTransitions = transitions[schemaRel.id]!;
            if (!workflowText || !currentMachineName || !groupId) {
                const targetIds = relationshipIds(current, 'field_allowed_next');
                schemaAllowedNext[statusRel.id] = targetIds;
                schemaTransitions[statusRel.id] = targetIds.map((targetStatusId) => {
                    const target = includedMap.get(`workflow_status--workflow_status:${targetStatusId}`);
                    return {
                        targetStatusId,
                        from: currentMachineName,
                        to: String(target?.attributes?.field_machine_name ?? ''),
                        attributes: [],
                        requiresAttributes: false
                    };
                });
                continue;
            }

            const cacheKey = `${schemaRel.id}:${groupId}`;
            if (!bySchemaAndGroup.has(cacheKey)) {
                const groupStatuses = statuses.filter(status => status.groupId === groupId);
                try {
                    bySchemaAndGroup.set(cacheKey, normalizeSchemaWorkflowDefinition(JSON.parse(workflowText), groupStatuses));
                } catch (e) {
                    console.error('[admin] Invalid schema workflow definition while building application transitions', e);
                    bySchemaAndGroup.set(cacheKey, null);
                }
            }

            const workflow = bySchemaAndGroup.get(cacheKey);
            if (!workflow) {
                schemaAllowedNext[statusRel.id] = [];
                schemaTransitions[statusRel.id] = [];
                continue;
            }

            const groupStatuses = statuses.filter(status => status.groupId === groupId);
            const effectiveTransitions = workflow.transitions
                .filter(transition => transition.from === currentMachineName)
                .map((transition) => {
                    const target = groupStatuses.find(status => status.machineName === transition.to);
                    if (!target) return null;
                    const targetDefinition = workflow.statuses.find(status => status.machineName === transition.to);
                    const attributes = mergeRuntimeAttributes(targetDefinition?.attributes, transition.attributes);
                    return {
                        targetStatusId: target.id,
                        from: transition.from,
                        to: transition.to,
                        ...(targetDefinition?.description ? { targetDescription: targetDefinition.description } : {}),
                        ...(transition.condition ? { condition: transition.condition } : {}),
                        attributes,
                        requiresAttributes: hasRequiredRuntimeAttributes(attributes)
                    };
                })
                .filter((transition): transition is EffectiveApplicationTransition => Boolean(transition));
            schemaTransitions[statusRel.id] = effectiveTransitions;
            schemaAllowedNext[statusRel.id] = [...new Set(
                effectiveTransitions
                    .filter(transition => transition.attributes.length === 0)
                    .map(transition => transition.targetStatusId)
            )];
        }

        return { allowedNext, transitions };
    } catch (e) {
        // A catalogue cut by the page guard must not pass for "no transitions".
        if (isWorkflowStatusPageGuardError(e)) throw e;
        console.error('[admin] Failed to build effective application transitions', e);
        return emptyWorkflow(applications);
    }
}

export async function buildEffectiveApplicationAllowedNext(
    event: H3Event,
    applications: ApplicationWorkflowJsonApiResource[],
    includedByKey: Map<string, unknown>,
    preloadedStatuses?: WorkflowStatusDto[]
): Promise<EffectiveAllowedNext> {
    return (await buildEffectiveApplicationWorkflow(event, applications, includedByKey, preloadedStatuses)).allowedNext;
}
