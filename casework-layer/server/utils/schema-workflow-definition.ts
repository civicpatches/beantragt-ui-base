import { sanitizeString } from '~~/server/utils/validation';
import type { WorkflowStatusDto } from './workflow-status-admin';

interface WorkflowDefinitionErrorOptions {
    statusCode: number
    message: string
    data?: unknown
}

function createWorkflowDefinitionError(options: WorkflowDefinitionErrorOptions): Error & { statusCode: number, data?: unknown } {
    const error = new Error(options.message) as Error & { statusCode: number, data?: unknown };
    error.statusCode = options.statusCode;
    if (options.data !== undefined) {
        error.data = options.data;
    }
    return error;
}

export interface SchemaWorkflowAttribute {
    code: string
    variable: boolean
    datatype: 'string' | 'number' | 'text' | 'datetime' | 'singlevaluelist' | 'multivaluelist' | 'imagelist'
    required: boolean
    description: string
    order: number
    values?: Array<{ key: string, name: string }>
    media_type?: string
    media_group?: string
    datatype_description?: string
    default_value?: string | number
    validation?: {
        pattern?: string
        pattern_message?: string
        min?: number
        max?: number
    }
    conditions?: {
        show_when?: Array<{
            attribute_code: string
            operator: 'equals' | 'not_equals' | 'contains' | 'not_empty'
            value?: string
        }>
    }
}

export interface SchemaWorkflowStatusRef {
    machineName: string
    description?: string
    attributes?: SchemaWorkflowAttribute[]
}

export interface SchemaWorkflowTransition {
    from: string
    to: string
    condition?: string
    attributes?: SchemaWorkflowAttribute[]
}

export interface SchemaWorkflowDefinition {
    mode: 'catalog'
    defaultStatus: string
    statuses: SchemaWorkflowStatusRef[]
    transitions: SchemaWorkflowTransition[]
}

const MACHINE_NAME_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const DATATYPES = new Set([
    'string',
    'number',
    'text',
    'datetime',
    'singlevaluelist',
    'multivaluelist',
    'imagelist'
]);
const LEGACY_DATATYPE_ALIASES: Record<string, SchemaWorkflowAttribute['datatype']> = {
    boolean: 'singlevaluelist',
    date: 'datetime'
};
const CONDITION_OPERATORS = new Set(['equals', 'not_equals', 'contains', 'not_empty']);

function fieldText(value: string | { value?: string } | null | undefined): string {
    return typeof value === 'string' ? value : value?.value || '';
}

function machineName(value: unknown, fieldName: string): string {
    const normalized = sanitizeString(value, 64).trim();
    if (!MACHINE_NAME_PATTERN.test(normalized)) {
        throw createWorkflowDefinitionError({
            statusCode: 400,
            message: 'errors.workflow.machineNameInvalid',
            data: { code: 'errors.workflow.machineNameInvalid', field: fieldName }
        });
    }
    return normalized;
}

function optionalMachineName(value: unknown, fieldName: string): string | undefined {
    const normalized = sanitizeString(value, 64).trim();
    return normalized ? machineName(normalized, fieldName) : undefined;
}

function optionKey(value: unknown, fieldName: string): string {
    const normalized = sanitizeString(value, 64)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_]+/gu, '_')
        .replace(/^_+|_+$/gu, '');
    return machineName(normalized, fieldName);
}

function normalizeDatatype(value: unknown): SchemaWorkflowAttribute['datatype'] {
    const raw = sanitizeString(value, 32).trim();
    const datatype = LEGACY_DATATYPE_ALIASES[raw] ?? raw;
    if (!DATATYPES.has(datatype)) {
        throw createWorkflowDefinitionError({
            statusCode: 400,
            message: 'errors.validation.invalidField',
            data: { code: 'errors.validation.invalidField', field: 'datatype' }
        });
    }
    return datatype as SchemaWorkflowAttribute['datatype'];
}

function normalizeAttributeValue(value: unknown): { key: string, name: string } | null {
    if (typeof value === 'string') {
        const key = optionKey(value, 'values.key');
        return { key, name: value };
    }
    if (!value || typeof value !== 'object') {
        return null;
    }

    const candidate = value as Record<string, unknown>;
    const key = optionKey(candidate.key, 'values.key');
    const name = sanitizeString(candidate.name, 128).trim();
    if (!name) {
        throw createWorkflowDefinitionError({
            statusCode: 400,
            message: 'errors.validation.invalidField',
            data: { code: 'errors.validation.invalidField', field: 'values.name' }
        });
    }

    return { key, name };
}

function normalizeAttributeValidation(value: unknown): SchemaWorkflowAttribute['validation'] | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const candidate = value as Record<string, unknown>;
    const validation = {
        pattern: sanitizeString(candidate.pattern, 255).trim() || undefined,
        pattern_message: sanitizeString(candidate.pattern_message, 255).trim() || undefined,
        min: Number.isFinite(Number(candidate.min)) ? Number(candidate.min) : undefined,
        max: Number.isFinite(Number(candidate.max)) ? Number(candidate.max) : undefined
    };
    return Object.values(validation).some(item => item !== undefined) ? validation : undefined;
}

function normalizeAttributeConditions(value: unknown): SchemaWorkflowAttribute['conditions'] | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const candidate = value as Record<string, unknown>;
    const rawShowWhen = candidate.show_when ?? candidate.showWhen;
    if (!Array.isArray(rawShowWhen)) return undefined;

    const show_when = rawShowWhen.slice(0, 20).map((condition) => {
        if (!condition || typeof condition !== 'object') return null;
        const conditionCandidate = condition as Record<string, unknown>;
        const operator = sanitizeString(conditionCandidate.operator, 32).trim();
        if (!CONDITION_OPERATORS.has(operator)) return null;

        return {
            attribute_code: machineName(conditionCandidate.attribute_code ?? conditionCandidate.attributeCode, 'conditions.attribute_code'),
            operator: operator as 'equals' | 'not_equals' | 'contains' | 'not_empty',
            value: sanitizeString(conditionCandidate.value, 255).trim() || undefined
        };
    }).filter((item): item is NonNullable<typeof item> => Boolean(item));

    return show_when.length ? { show_when } : undefined;
}

function normalizeAttribute(value: unknown): SchemaWorkflowAttribute {
    if (!value || typeof value !== 'object') {
        throw createWorkflowDefinitionError({
            statusCode: 400,
            message: 'errors.validation.invalidField',
            data: { code: 'errors.validation.invalidField', field: 'attributes' }
        });
    }

    const candidate = value as Record<string, unknown>;
    const datatype = normalizeDatatype(candidate.datatype ?? candidate.type ?? 'string');
    const description = sanitizeString(candidate.description ?? candidate.label, 255).trim();
    if (!description) {
        throw createWorkflowDefinitionError({
            statusCode: 400,
            message: 'errors.validation.invalidField',
            data: { code: 'errors.validation.invalidField', field: 'description' }
        });
    }

    const order = Number(candidate.order);
    const rawValues = candidate.values ?? candidate.options;
    const values = Array.isArray(rawValues)
        ? rawValues
            .slice(0, 50)
            .map(normalizeAttributeValue)
            .filter((item): item is { key: string, name: string } => Boolean(item))
        : undefined;
    const mediaType = optionalMachineName(candidate.media_type ?? candidate.mediaType, 'media_type');
    if (datatype === 'imagelist' && !mediaType) {
        throw createWorkflowDefinitionError({
            statusCode: 400,
            message: 'errors.validation.invalidField',
            data: { code: 'errors.validation.invalidField', field: 'media_type' }
        });
    }
    const mediaGroup = optionalMachineName(candidate.media_group ?? candidate.mediaGroup, 'media_group');
    const validation = normalizeAttributeValidation(candidate.validation);
    const conditions = normalizeAttributeConditions(candidate.conditions);
    const defaultValue = typeof candidate.default_value === 'number'
        ? candidate.default_value
        : sanitizeString(candidate.default_value ?? candidate.defaultValue, 255).trim() || undefined;

    return {
        code: machineName(candidate.code, 'code'),
        variable: typeof candidate.variable === 'boolean' ? candidate.variable : true,
        datatype,
        required: typeof candidate.required === 'boolean' ? candidate.required : false,
        description,
        order: Number.isInteger(order) ? Math.max(-10000, Math.min(10000, order)) : 0,
        ...(values?.length ? { values } : {}),
        ...(mediaType ? { media_type: mediaType } : {}),
        ...(mediaGroup ? { media_group: mediaGroup } : {}),
        datatype_description: sanitizeString(candidate.datatype_description ?? candidate.datatypeDescription, 500).trim() || undefined,
        default_value: defaultValue,
        ...(validation ? { validation } : {}),
        ...(conditions ? { conditions } : {})
    };
}

function normalizeStatusRef(value: unknown): SchemaWorkflowStatusRef {
    if (typeof value === 'string') {
        return { machineName: machineName(value, 'statuses') };
    }
    if (!value || typeof value !== 'object') {
        throw createWorkflowDefinitionError({
            statusCode: 400,
            message: 'errors.validation.invalidField',
            data: { code: 'errors.validation.invalidField', field: 'statuses' }
        });
    }
    const candidate = value as Record<string, unknown>;
    const attributes = Array.isArray(candidate.attributes)
        ? candidate.attributes.slice(0, 50).map(normalizeAttribute)
        : undefined;

    return {
        machineName: machineName(candidate.machineName ?? candidate.id, 'statuses'),
        description: sanitizeString(candidate.description, 1000).trim() || undefined,
        ...(attributes?.length ? { attributes } : {})
    };
}

function normalizeTransition(value: unknown): SchemaWorkflowTransition {
    if (!value || typeof value !== 'object') {
        throw createWorkflowDefinitionError({
            statusCode: 400,
            message: 'errors.validation.invalidField',
            data: { code: 'errors.validation.invalidField', field: 'transitions' }
        });
    }
    const candidate = value as Record<string, unknown>;
    const attributes = Array.isArray(candidate.attributes)
        ? candidate.attributes.slice(0, 50).map(normalizeAttribute)
        : undefined;

    return {
        from: machineName(candidate.from, 'from'),
        to: machineName(candidate.to, 'to'),
        condition: sanitizeString(candidate.condition ?? candidate.description, 500).trim() || undefined,
        ...(attributes?.length ? { attributes } : {})
    };
}

// ── The standard and the four functions (contract E1 to E5) ────
//
// One place for the frontend: the editor response, the form page and the
// settings page all read this. It knows flags, never a status name or id
// (flags are the vocabulary). Pure functions, no
// server imports, so pages can import it as well.

/** Statuses on the shape this module needs: a subset of `WorkflowStatusDto`. */
export type WorkflowCatalogueStatus = Pick<WorkflowStatusDto, 'id' | 'machineName' | 'weight' | 'isDefault' | 'isTerminal' | 'semanticFlags' | 'allowedNextIds'>;

/**
 * The statuses of the standard: reachable from the start status along the
 * catalogue's edges, terminal statuses not expanded, start first, then by
 * weight. The same rule as the backend (`EffectiveWorkflowResolver`, a form
 * without own workflow). A catalogue without start status is all standard,
 * as there.
 */
export function standardStatuses<T extends WorkflowCatalogueStatus>(statuses: T[]): T[] {
    const start = statuses.find(status => status.isDefault);
    if (!start) return [...statuses].sort((a, b) => a.weight - b.weight);
    const byId = new Map(statuses.map(status => [status.id, status]));
    const reached = new Set<string>([start.id]);
    const queue: T[] = [start];
    while (queue.length) {
        const current = queue.shift()!;
        if (current.isTerminal) continue;
        for (const nextId of current.allowedNextIds) {
            const next = byId.get(nextId);
            if (next && !reached.has(next.id)) {
                reached.add(next.id);
                queue.push(next);
            }
        }
    }
    const rest = statuses.filter(status => reached.has(status.id) && status.id !== start.id)
        .sort((a, b) => a.weight - b.weight || a.machineName.localeCompare(b.machineName));
    return [start, ...rest];
}

/** The workflow of a form that has none of its own: the standard and its edges. */
export function defaultWorkflow(statuses: WorkflowCatalogueStatus[]): SchemaWorkflowDefinition {
    const standard = standardStatuses(statuses);
    const inStandard = new Map(standard.map(status => [status.id, status]));
    return {
        mode: 'catalog',
        defaultStatus: standard[0]?.machineName ?? 'new',
        statuses: standard.map(status => ({ machineName: status.machineName })),
        transitions: standard.filter(status => !status.isTerminal).flatMap(status =>
            status.allowedNextIds
                .map(targetId => inStandard.get(targetId))
                .filter((target): target is WorkflowCatalogueStatus => Boolean(target) && target!.id !== status.id)
                .map(target => ({ from: status.machineName, to: target.machineName }))
        )
    };
}

function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value as Record<string, unknown>)
            .filter(([, item]) => item !== undefined)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, item]) => [key, canonical(item)]));
    }
    return value;
}

function sortedKeys<T>(items: T[], key: (item: T) => string): string[] {
    return items.map(item => `${key(item)}=${JSON.stringify(canonical(item))}`).sort();
}

/**
 * Whether a workflow is the standard (E4): same start, same statuses with
 * nothing of their own (no description, no Zusatzangaben), same edges without
 * condition or fields. Order does not count. Such a draft is stored empty, so
 * the form keeps following the standard.
 */
export function isStandardWorkflow(workflow: SchemaWorkflowDefinition, statuses: WorkflowCatalogueStatus[]): boolean {
    const standard = defaultWorkflow(statuses);
    if (workflow.defaultStatus !== standard.defaultStatus) return false;
    const statusKey = (item: SchemaWorkflowStatusRef) => item.machineName;
    const transitionKey = (item: SchemaWorkflowTransition) => `${item.from}>${item.to}`;
    const a = sortedKeys(workflow.statuses, statusKey);
    const b = sortedKeys(standard.statuses, statusKey);
    const c = sortedKeys(workflow.transitions, transitionKey);
    const d = sortedKeys(standard.transitions, transitionKey);
    return a.length === b.length && a.every((item, index) => item === b[index])
      && c.length === d.length && c.every((item, index) => item === d[index]);
}

/**
 * The flags a status of the catalogue can carry (the same list as the status
 * routes in `workflow-status-admin.ts`); the vocabulary of every check here.
 */
export const WORKFLOW_SEMANTIC_FLAGS: ReadonlySet<string> = new Set(['received', 'request_info', 'documents_received', 'hand_over', 'in_case_system', 'decision_issued', 'approved', 'rejected', 'filed', 'closed', 'withdrawn']);

/** The four functions a form can switch on (contract section 2, analysis 3.3). */
export type WorkflowFeatureKey = 'requestInfo' | 'handOver' | 'outcome' | 'withdrawal';

interface WorkflowFeatureDefinition {
    key: WorkflowFeatureKey
    /** Flags whose statuses the function brings, in this order. */
    flags: string[]
    /**
     * Flags whose statuses receive an edge from every open status of the form
     * (the way into the function). The other statuses are reached along the
     * catalogue's own edges.
     */
    entryFlags: string[]
    /**
     * Ways out the function needs, by flag of its status: target flags, with
     * `STANDARD_END` for the neutral end of the standard. Used only for a
     * status of the function that has no way out in the form after the
     * catalogue's own edges (a status created in the settings has none, and
     * the settings no longer draw edges; cross-stack review, should-fix 3).
     */
    exits: Record<string, string[]>
}

/** Target token of `exits`: the terminal status of the standard. */
export const STANDARD_END = '@standard_end';

/**
 * The feature table, keyed by flag (analysis 3.3):
 * - "Unterlagen nachfordern": the staff message and the batch request move
 *   an application into `request_info` from any open status; out of it along
 *   the catalogue (to `documents_received` and to the end).
 * - "Übergabe an ein Fachverfahren": open statuses to `hand_over` (a person's
 *   change starts the transfer), `hand_over` to `in_case_system` and on to the
 *   end along the catalogue.
 * - "Ergebnis ausweisen": `approved` and `rejected` as hand-set or automatic
 *   outcomes from the open statuses.
 * - "Rücknahme": `withdrawn` from the open statuses.
 */
export const WORKFLOW_FEATURES: readonly WorkflowFeatureDefinition[] = [
    { key: 'requestInfo', flags: ['request_info'], entryFlags: ['request_info'], exits: { request_info: ['documents_received', STANDARD_END] } },
    // Both entries: a rule triggered by status enters `hand_over` by a
    // person's change; a rule triggered on submission or by hand is accepted
    // straight into `in_case_system` (analysis 3.3, second row; cross-stack
    // review, blocker 2).
    { key: 'handOver', flags: ['hand_over', 'in_case_system'], entryFlags: ['hand_over', 'in_case_system'], exits: { hand_over: ['in_case_system'], in_case_system: [STANDARD_END] } },
    { key: 'outcome', flags: ['approved', 'rejected'], entryFlags: ['approved', 'rejected'], exits: {} },
    { key: 'withdrawal', flags: ['withdrawn'], entryFlags: ['withdrawn'], exits: {} }
];

export interface WorkflowFeatureState {
    key: WorkflowFeatureKey
    /** The catalogue holds a status outside the standard for every flag of the function. */
    available: boolean
    /** Every flag of the function is already a standard status of the department. */
    inStandard: boolean
    /** All its statuses are in the workflow. */
    enabled: boolean
    /** Machine names of the statuses it brings, in flag order (empty when not available). */
    statuses: string[]
    /** Machine names of the statuses that receive an edge from every open status. */
    entryStatuses: string[]
}

/** The status the catalogue keeps for a flag outside the standard: lowest weight first. */
function featureStatusFor<T extends WorkflowCatalogueStatus>(statuses: T[], standardIds: Set<string>, flag: string): T | undefined {
    return statuses
        .filter(status => !standardIds.has(status.id) && status.semanticFlags.includes(flag))
        .sort((a, b) => a.weight - b.weight || a.machineName.localeCompare(b.machineName))[0];
}

/**
 * The four functions against a department's catalogue and a form's workflow.
 *
 * A function is on when the FORM's workflow carries a status for each of its
 * flags (the backend asks the governing workflow, not the organisation graph;
 * cross-stack review, should-fix 2). "Already in the standard" is said only
 * for a form that follows the standard, whose standard carries every flag.
 * Per flag the function uses the status the form already has, else one
 * outside the standard, else (an old wide catalogue) the standard's own.
 */
export function workflowFeatureStates(
    statuses: WorkflowCatalogueStatus[],
    workflow: SchemaWorkflowDefinition | null
): WorkflowFeatureState[] {
    const standard = standardStatuses(statuses);
    const standardIds = new Set(standard.map(status => status.id));
    const followsStandard = !workflow || isStandardWorkflow(workflow, statuses);
    const active = new Set((workflow?.statuses ?? []).map(status => status.machineName));
    const byWeight = (a: WorkflowCatalogueStatus, b: WorkflowCatalogueStatus) => a.weight - b.weight || a.machineName.localeCompare(b.machineName);
    const pick = (flag: string) =>
        statuses.filter(status => active.has(status.machineName) && status.semanticFlags.includes(flag)).sort(byWeight)[0]
        ?? featureStatusFor(statuses, standardIds, flag)
        ?? statuses.filter(status => status.semanticFlags.includes(flag)).sort(byWeight)[0];
    return WORKFLOW_FEATURES.map((feature) => {
        const inStandard = followsStandard && feature.flags.every(flag => standard.some(status => status.semanticFlags.includes(flag)));
        const found = feature.flags.map(pick);
        const available = !inStandard && found.every(Boolean);
        const machineNames = available ? found.map(status => status!.machineName) : [];
        const entryStatuses = available ? feature.entryFlags.map(flag => pick(flag)!.machineName) : [];
        return {
            key: feature.key,
            available,
            inStandard,
            enabled: available && machineNames.every(name => active.has(name)),
            statuses: machineNames,
            entryStatuses
        };
    });
}

/** Which function brings a status, or null (standard, or a status added by hand). */
export function workflowFeatureOf(
    machineName: string,
    features: Pick<WorkflowFeatureState, 'key' | 'statuses'>[]
): WorkflowFeatureKey | null {
    return features.find(feature => feature.statuses.includes(machineName))?.key ?? null;
}

/**
 * The flag-to-function table for a status of the catalogue (settings page,
 * "Kommt mit „…“"): the function whose statuses carry one of its flags.
 */
export function workflowFeatureOfFlags(flags: string[]): WorkflowFeatureKey | null {
    return WORKFLOW_FEATURES.find(feature => feature.flags.some(flag => flags.includes(flag)))?.key ?? null;
}

function sortByCatalogue(names: SchemaWorkflowStatusRef[], statuses: WorkflowCatalogueStatus[], defaultStatus: string): SchemaWorkflowStatusRef[] {
    const weight = (name: string) => statuses.find(status => status.machineName === name)?.weight ?? Number.MAX_SAFE_INTEGER;
    return [...names].sort((a, b) =>
        Number(b.machineName === defaultStatus) - Number(a.machineName === defaultStatus)
        || weight(a.machineName) - weight(b.machineName)
        || a.machineName.localeCompare(b.machineName));
}

/**
 * Switch a function on in a draft: add its statuses, an edge into each entry
 * status from every open status of the form that the function does not
 * bring, and the catalogue's edges out of its statuses to statuses of the
 * form. Existing statuses and edges stay untouched; nothing is added twice.
 * Edges into the entry statuses of functions already on come from the new
 * statuses too, so the order of switching does not matter.
 */
export function enableWorkflowFeature(
    workflow: SchemaWorkflowDefinition,
    feature: Pick<WorkflowFeatureState, 'key' | 'available' | 'statuses' | 'entryStatuses'>,
    statuses: WorkflowCatalogueStatus[],
    otherFeatures: Pick<WorkflowFeatureState, 'key' | 'statuses' | 'entryStatuses'>[] = []
): SchemaWorkflowDefinition {
    if (!feature.available || feature.statuses.length === 0) return workflow;
    const byName = new Map(statuses.map(status => [status.machineName, status]));
    const byId = new Map(statuses.map(status => [status.id, status]));
    const present = new Set(workflow.statuses.map(status => status.machineName));
    const added = feature.statuses.filter(name => !present.has(name) && byName.has(name));
    const nextStatuses = sortByCatalogue([...workflow.statuses, ...added.map(name => ({ machineName: name }))], statuses, workflow.defaultStatus);
    const active = new Set(nextStatuses.map(status => status.machineName));
    const own = new Set(feature.statuses);
    const isOpen = (name: string) => !byName.get(name)?.isTerminal;
    const transitions = [...workflow.transitions];
    const has = (from: string, to: string) => transitions.some(item => item.from === from && item.to === to);
    const add = (from: string, to: string) => {
        if (from === to || !active.has(from) || !active.has(to) || !isOpen(from) || has(from, to)) return;
        transitions.push({ from, to });
    };
    // Into the function from every open status it does not bring.
    for (const entry of feature.entryStatuses) {
        for (const status of nextStatuses) {
            if (!own.has(status.machineName)) add(status.machineName, entry);
        }
    }
    // Out of its statuses along the catalogue, to statuses of the form.
    for (const name of feature.statuses) {
        for (const nextId of byName.get(name)?.allowedNextIds ?? []) {
            const target = byId.get(nextId);
            if (target) add(name, target.machineName);
        }
    }
    // A status of the function without a way out gets the table's exits by
    // flag (to the `documents_received` status, to `in_case_system`, to the
    // end of the standard), so no case gets stuck in it.
    const definition = WORKFLOW_FEATURES.find(item => item.key === feature.key);
    const standardEnd = standardStatuses(statuses).find(status => status.isTerminal && active.has(status.machineName));
    const targetFor = (flag: string) => {
        if (flag === STANDARD_END) return standardEnd?.machineName;
        const candidates = nextStatuses
            .map(item => byName.get(item.machineName))
            .filter((status): status is WorkflowCatalogueStatus => Boolean(status) && status!.semanticFlags.includes(flag));
        return candidates[0]?.machineName;
    };
    for (const name of feature.statuses) {
        const status = byName.get(name);
        if (!status || status.isTerminal || transitions.some(item => item.from === name)) continue;
        for (const flag of status.semanticFlags) {
            for (const targetFlag of definition?.exits[flag] ?? []) {
                const target = targetFor(targetFlag);
                if (target) add(name, target);
            }
        }
    }
    // Its open statuses lead into the functions already switched on.
    for (const other of otherFeatures) {
        if (other.key === feature.key || !other.statuses.every(name => active.has(name))) continue;
        for (const entry of other.entryStatuses) {
            for (const name of feature.statuses) add(name, entry);
        }
    }
    return { ...workflow, statuses: nextStatuses, transitions };
}

/** Switch a function off: its statuses and every edge that touches them leave the draft. */
export function disableWorkflowFeature(
    workflow: SchemaWorkflowDefinition,
    feature: Pick<WorkflowFeatureState, 'statuses'>
): SchemaWorkflowDefinition {
    const own = new Set(feature.statuses.filter(name => name !== workflow.defaultStatus));
    return {
        ...workflow,
        statuses: workflow.statuses.filter(status => !own.has(status.machineName)),
        transitions: workflow.transitions.filter(item => !own.has(item.from) && !own.has(item.to))
    };
}

export function parseSchemaWorkflowDefinition(
    raw: string | { value?: string } | null | undefined,
    statuses: WorkflowStatusDto[]
): SchemaWorkflowDefinition {
    const text = fieldText(raw).trim();
    if (!text) {
        return defaultWorkflow(statuses);
    }

    try {
        return normalizeSchemaWorkflowDefinition(JSON.parse(text), statuses);
    } catch (error) {
        if (error && typeof error === 'object' && 'statusCode' in error) {
            throw error;
        }
        throw createWorkflowDefinitionError({
            statusCode: 409,
            message: 'errors.workflow.definitionInvalid',
            data: { code: 'errors.workflow.definitionInvalid' }
        });
    }
}

export function normalizeSchemaWorkflowDefinition(
    value: unknown,
    statuses: WorkflowStatusDto[]
): SchemaWorkflowDefinition {
    const payload = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const catalogMachineNames = new Set(statuses.map(status => status.machineName));

    const activeStatuses = Array.isArray(payload.statuses)
        ? [...new Map(payload.statuses.slice(0, 100).map((item) => {
            const status = normalizeStatusRef(item);
            return [status.machineName, status] as const;
        })).values()]
        : statuses.map(status => ({ machineName: status.machineName }));

    if (activeStatuses.length === 0) {
        throw createWorkflowDefinitionError({
            statusCode: 400,
            message: 'errors.validation.invalidField',
            data: { code: 'errors.validation.invalidField', field: 'statuses' }
        });
    }

    for (const status of activeStatuses) {
        if (!catalogMachineNames.has(status.machineName)) {
            throw createWorkflowDefinitionError({
                statusCode: 422,
                message: 'errors.workflow.statusNotFound',
                data: { code: 'errors.workflow.statusNotFound', status: status.machineName }
            });
        }
    }

    const activeMachineNames = new Set(activeStatuses.map(status => status.machineName));
    const fallbackDefaultStatus = activeStatuses[0]?.machineName;
    const defaultStatus = machineName(payload.defaultStatus ?? fallbackDefaultStatus, 'defaultStatus');
    if (!activeMachineNames.has(defaultStatus)) {
        throw createWorkflowDefinitionError({
            statusCode: 422,
            message: 'errors.workflow.defaultOutOfScope',
            data: { code: 'errors.workflow.defaultOutOfScope' }
        });
    }

    const transitions = Array.isArray(payload.transitions)
        ? payload.transitions.slice(0, 500).map(normalizeTransition)
        : [];

    const terminalStatuses = new Set(statuses.filter(status => status.isTerminal).map(status => status.machineName));
    for (const transition of transitions) {
        if (!activeMachineNames.has(transition.from) || !activeMachineNames.has(transition.to)) {
            throw createWorkflowDefinitionError({
                statusCode: 422,
                message: 'errors.workflow.allowedNextOutOfScope',
                data: { code: 'errors.workflow.allowedNextOutOfScope' }
            });
        }
        if (transition.from === transition.to) {
            throw createWorkflowDefinitionError({
                statusCode: 422,
                message: 'errors.workflow.selfTransitionInvalid',
                data: { code: 'errors.workflow.selfTransitionInvalid' }
            });
        }
        if (terminalStatuses.has(transition.from)) {
            throw createWorkflowDefinitionError({
                statusCode: 422,
                message: 'errors.workflow.terminalTransitionInvalid',
                data: { code: 'errors.workflow.terminalTransitionInvalid' }
            });
        }
    }

    return {
        mode: 'catalog',
        defaultStatus,
        statuses: activeStatuses,
        transitions
    };
}
