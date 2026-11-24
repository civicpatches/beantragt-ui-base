import type { H3Event } from 'h3';
import { createHash } from 'node:crypto';
import type { AdminWorkspace } from '~~/casework-layer/server/utils/admin-workspace';
import { resolveAdminWorkspace } from '~~/casework-layer/server/utils/admin-workspace';
import { drupalSessionFetch } from '~~/server/utils/auth';
import { createSafeError } from '~~/server/utils/error-handling';
import { sanitizeString, validateUuid } from '~~/server/utils/validation';
import { normalizeWorkflowStatusIcon } from '~/utils/workflow-status-icon';
import {
    DELETE_BLOCKERS_FIELD,
    parseDeleteBlockers,
    type WorkflowStatusDeleteBlocker
} from './workflow-status-delete-blockers';

interface JsonApiRelationshipData {
    id: string
    type?: string
}

interface WorkflowStatusResource {
    id: string
    type: string
    attributes?: {
        label?: string
        field_machine_name?: string
        field_color?: string
        field_icon?: string
        field_weight?: number | string
        field_is_default?: boolean
        field_is_terminal?: boolean
        field_sla_days?: number | string | null
        field_escalation_days?: number | string | null
        field_semantic_flags?: unknown
        field_citizen_label_de?: string | null
        field_citizen_label_en?: string | null
        delete_blockers?: unknown
    }
    relationships?: {
        field_allowed_next?: {
            data?: JsonApiRelationshipData[]
        }
        field_group?: {
            data?: JsonApiRelationshipData | null
        }
    }
}

interface WorkflowStatusCollectionResponse {
    data?: WorkflowStatusResource[]
    links?: {
        next?: unknown
    }
}

export interface WorkflowStatusDto {
    id: string
    label: string
    machineName: string
    color: string
    icon: string
    weight: number
    version: string
    isDefault: boolean
    isTerminal: boolean
    slaDays: number
    escalationDays: number
    semanticFlags: string[]
    /** Text applicants see instead of the label; empty uses the label (en falls back to de). */
    citizenLabel: WorkflowStatusCitizenLabel
    allowedNextIds: string[]
    groupId: string | null
    groupType?: string | null
    /**
     * Why the status cannot be deleted (closed list, `[]` = deletable). Only
     * the settings list asks for it; absent means "not asked or not
     * visible to this person", never "deletable". Not part of `version`.
     */
    deleteBlockers?: WorkflowStatusDeleteBlocker[]
}

export interface WorkflowStatusCitizenLabel {
    de: string
    en: string
}

export interface WorkflowStatusListResponse {
    statuses: WorkflowStatusDto[]
    meta: {
        workspaceType: AdminWorkspace['type']
        workspaceLabel: string
        editable: boolean
    }
}

export interface WorkflowStatusInput {
    label?: string
    machineName?: string
    color?: string
    icon?: string
    weight?: number
    isDefault?: boolean
    isTerminal?: boolean
    slaDays?: number
    escalationDays?: number
    semanticFlags?: string[]
    citizenLabel?: Partial<WorkflowStatusCitizenLabel>
    allowedNextIds?: string[]
    expectedVersion?: string
}

type TerminalStatusContext = Pick<WorkflowStatusDto, 'isTerminal'>;

const MACHINE_NAME_PATTERN = /^[a-z][a-z0-9_]{1,62}[a-z0-9]$/;
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const ICON_PATTERN = /^i-lucide-[a-z0-9-]{1,54}$/;
// documents_received (Nachreichung step 2): "Unterlagen eingegangen", set by "Übernehmen und fortsetzen".
const SEMANTIC_FLAGS = new Set(['received', 'request_info', 'documents_received', 'hand_over', 'in_case_system', 'decision_issued', 'approved', 'rejected', 'filed', 'closed', 'withdrawn']);
const CITIZEN_LABEL_LANGCODES = ['de', 'en'] as const;
const CITIZEN_LABEL_MAX_LENGTH = 120;
const MAX_SLA_DAYS = 3650;
/** Drupal JSON:API serves at most 50 resources per page. */
const WORKFLOW_STATUS_PAGE_LIMIT = 50;
/**
 * Runaway guard only (10,000 statuses, about two minutes of paging); reaching
 * it fails loudly, it never cuts the list.
 */
export const WORKFLOW_STATUS_MAX_PAGES = 200;
const workflowStatusPageGuardErrors = new WeakSet<object>();
const workflowStatusMutationLocks = new Map<string, Promise<void>>();

/**
 * True for the error the page guard throws. Callers that degrade gracefully on
 * Drupal errors must rethrow it: an incomplete catalogue is not "no statuses".
 */
export function isWorkflowStatusPageGuardError(error: unknown): boolean {
    return typeof error === 'object' && error !== null && workflowStatusPageGuardErrors.has(error);
}

export async function resolveRequiredWorkflowStatusWorkspace(event: H3Event): Promise<AdminWorkspace> {
    const workspace = await resolveAdminWorkspace(event);
    if (!workspace) {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.workflow.workspaceRequired',
            data: { code: 'errors.workflow.workspaceRequired' }
        });
    }
    return workspace;
}

export function assertWorkflowStatusEditableWorkspace(workspace: AdminWorkspace): void {
    if (workspace.type !== 'organisation') {
        throw createSafeError({
            statusCode: 409,
            message: 'errors.workflow.organisationWorkspaceRequired',
            data: { code: 'errors.workflow.organisationWorkspaceRequired' }
        });
    }
}

function getWorkspaceInternalId(workspace: AdminWorkspace): number {
    const groupId = workspace.type === 'organisation'
        ? workspace.internalId
        : workspace.jurisdictionInternalId;
    if (!groupId) {
        throw createSafeError({
            statusCode: 409,
            message: 'errors.workflow.workspaceRequired',
            data: { code: 'errors.workflow.workspaceRequired' }
        });
    }
    return groupId;
}

export async function assertWorkflowStatusWorkspaceAccess(
    event: H3Event,
    workspace: AdminWorkspace
): Promise<void> {
    try {
        await drupalSessionFetch<{ allowed: true }>(
            event,
            `/api/admin/workflow-status-access/${getWorkspaceInternalId(workspace)}`
        );
    } catch (error: unknown) {
        const statusCode = error && typeof error === 'object' && 'statusCode' in error
            ? (error as { statusCode?: number }).statusCode
            : undefined;
        if (statusCode === 403) {
            throw createSafeError({
                statusCode: 403,
                message: 'errors.auth.accessDenied',
                data: { code: 'errors.auth.accessDenied' }
            });
        }
        throw error;
    }
}

export async function assertWorkflowStatusWorkspaceWriteAccess(
    event: H3Event,
    workspace: AdminWorkspace
): Promise<void> {
    assertWorkflowStatusEditableWorkspace(workspace);
    await assertWorkflowStatusWorkspaceAccess(event, workspace);
}

function setReferenceFilter(
    searchParams: URLSearchParams,
    fieldPath: string,
    uuid: string,
    internalId: number | null | undefined
): void {
    if (internalId) {
        searchParams.set(`filter[${fieldPath}.meta.drupal_internal__target_id]`, String(internalId));
        return;
    }

    searchParams.set(`filter[${fieldPath}.id]`, uuid);
}

export function applyWorkflowStatusWorkspaceFilter(
    searchParams: URLSearchParams,
    workspace: AdminWorkspace
): void {
    if (workspace.type === 'organisation') {
        setReferenceFilter(searchParams, 'field_group', workspace.id, workspace.internalId);
        return;
    }

    setReferenceFilter(
        searchParams,
        'field_group.field_jurisdiction',
        workspace.jurisdictionId,
        workspace.jurisdictionInternalId
    );
}

function normalizeWorkflowStatus(resource: WorkflowStatusResource): WorkflowStatusDto {
    const attributes = resource.attributes ?? {};
    const status = {
        id: resource.id,
        label: attributes.label ?? '',
        machineName: attributes.field_machine_name ?? '',
        color: attributes.field_color ?? '#6b7280',
        icon: normalizeWorkflowStatusIcon(attributes.field_icon),
        weight: Number(attributes.field_weight ?? 0),
        isDefault: Boolean(attributes.field_is_default),
        isTerminal: Boolean(attributes.field_is_terminal),
        slaDays: normalizeDayCountAttribute(attributes.field_sla_days),
        escalationDays: normalizeDayCountAttribute(attributes.field_escalation_days),
        semanticFlags: normalizeSemanticFlagAttribute(attributes.field_semantic_flags),
        citizenLabel: {
            de: typeof attributes.field_citizen_label_de === 'string' ? attributes.field_citizen_label_de : '',
            en: typeof attributes.field_citizen_label_en === 'string' ? attributes.field_citizen_label_en : ''
        },
        allowedNextIds: (resource.relationships?.field_allowed_next?.data ?? [])
            .map(item => item.id)
            .filter(Boolean),
        groupId: resource.relationships?.field_group?.data?.id ?? null,
        groupType: resource.relationships?.field_group?.data?.type ?? null
    };
    const deleteBlockers = parseDeleteBlockers(attributes.delete_blockers);
    return {
        ...status,
        version: workflowStatusVersion(status),
        ...(deleteBlockers ? { deleteBlockers } : {})
    };
}

function workflowStatusQuery(workspace: AdminWorkspace, mode: 'workspace' | 'jurisdiction-direct' | 'jurisdiction-orgs' = 'workspace'): URLSearchParams {
    const query = new URLSearchParams({
        // The internal id is the unique tie-breaker offset paging needs: with
        // equal weights and labels across organisations, pages overlap and
        // statuses go missing (791 of 1,020 at 60 organisations).
        'sort': 'field_weight,label,drupal_internal__id',
        'include': 'field_allowed_next,field_group',
        'fields[workflow_status--workflow_status]': 'label,field_machine_name,field_color,field_icon,field_weight,field_is_default,field_is_terminal,field_sla_days,field_escalation_days,field_semantic_flags,field_citizen_label_de,field_citizen_label_en,field_allowed_next,field_group',
        'fields[group--jur]': 'drupal_internal__id,label,field_slug',
        'fields[group--org]': 'drupal_internal__id,label,field_slug,field_jurisdiction',
        'page[limit]': '100'
    });

    if (workspace.type === 'jurisdiction' && mode === 'jurisdiction-direct') {
        setReferenceFilter(query, 'field_group', workspace.jurisdictionId, workspace.jurisdictionInternalId);
    } else if (workspace.type === 'jurisdiction' && mode === 'jurisdiction-orgs') {
        setReferenceFilter(
            query,
            'field_group.field_jurisdiction',
            workspace.jurisdictionId,
            workspace.jurisdictionInternalId
        );
    } else {
        applyWorkflowStatusWorkspaceFilter(query, workspace);
    }
    return query;
}

/**
 * Loads every page of a workflow status query. There is no size cap: the loop
 * follows `links.next` until Drupal reports the last page. A page can come back
 * shorter than the limit while more pages exist (resources omitted by access),
 * so the page length only ends the loop when Drupal sends no links at all.
 */
async function fetchWorkflowStatusResources(event: H3Event, baseQuery: URLSearchParams): Promise<WorkflowStatusResource[]> {
    const data: WorkflowStatusResource[] = [];

    for (let page = 0; page < WORKFLOW_STATUS_MAX_PAGES; page++) {
        const query = new URLSearchParams(baseQuery);
        query.set('page[limit]', String(WORKFLOW_STATUS_PAGE_LIMIT));
        query.set('page[offset]', String(page * WORKFLOW_STATUS_PAGE_LIMIT));

        const response = await drupalSessionFetch<WorkflowStatusCollectionResponse>(
            event,
            `/jsonapi/workflow_status/workflow_status?${query.toString()}`
        );
        const pageData = response.data ?? [];
        data.push(...pageData);
        const hasNextPage = response.links
            ? Boolean(response.links.next)
            : pageData.length >= WORKFLOW_STATUS_PAGE_LIMIT;
        if (!hasNextPage) return data;
    }

    console.error(`[admin] Workflow status query exceeded the page guard of ${WORKFLOW_STATUS_MAX_PAGES} pages; refusing a partial list`);
    const error = createSafeError({
        statusCode: 502,
        message: 'errors.server.drupalRequestFailed',
        data: { code: 'errors.server.drupalRequestFailed' }
    });
    workflowStatusPageGuardErrors.add(error);
    throw error;
}

function sortWorkflowStatuses(statuses: WorkflowStatusDto[]): WorkflowStatusDto[] {
    return statuses.sort((a, b) => a.weight - b.weight || a.label.localeCompare(b.label, 'de'));
}

/**
 * The settings list asks Drupal for `delete_blockers` in its own request.
 * Never in `workflowStatusQuery`: that query also feeds the application
 * transitions, the form workflow editor and the status pre-checks, and the
 * field makes Drupal scan the forms.
 */
function withDeleteBlockers(query: URLSearchParams): URLSearchParams {
    const fieldsKey = 'fields[workflow_status--workflow_status]';
    query.set(fieldsKey, `${query.get(fieldsKey)},${DELETE_BLOCKERS_FIELD}`);
    return query;
}

export async function fetchWorkflowStatuses(
    event: H3Event,
    workspace: AdminWorkspace,
    options: { deleteBlockers?: boolean } = {}
): Promise<WorkflowStatusDto[]> {
    const modes = workspace.type === 'jurisdiction'
        ? ['jurisdiction-direct', 'jurisdiction-orgs'] as const
        : ['workspace'] as const;
    const resourcesById = new Map<string, WorkflowStatusResource>();

    const resourcesByMode = await Promise.all(
        modes.map((mode) => {
            const query = workflowStatusQuery(workspace, mode);
            return fetchWorkflowStatusResources(event, options.deleteBlockers ? withDeleteBlockers(query) : query);
        })
    );
    for (const resources of resourcesByMode) {
        for (const resource of resources) {
            resourcesById.set(resource.id, resource);
        }
    }

    return sortWorkflowStatuses([...resourcesById.values()].map(normalizeWorkflowStatus));
}

/**
 * Loads the status catalogue of one group (organisation or jurisdiction) and
 * nothing else. The result equals the `groupId` slice of
 * fetchWorkflowStatuses(event, workspace), workspace scope included: an
 * organisation workspace only reaches its own catalogue, a jurisdiction
 * workspace its direct statuses and those of its own organisations. Detail and
 * status change use it so they never load every organisation of a
 * jurisdiction.
 */
export async function fetchWorkflowStatusesForGroup(
    event: H3Event,
    workspace: AdminWorkspace,
    groupId: string
): Promise<WorkflowStatusDto[]> {
    let query: URLSearchParams;
    if (workspace.type === 'organisation') {
        if (groupId !== workspace.id) return [];
        query = workflowStatusQuery(workspace, 'workspace');
    } else if (groupId === workspace.jurisdictionId) {
        query = workflowStatusQuery(workspace, 'jurisdiction-direct');
    } else {
        query = workflowStatusQuery(workspace, 'jurisdiction-orgs');
        query.set('filter[field_group.id]', groupId);
    }

    return sortWorkflowStatuses(
        (await fetchWorkflowStatusResources(event, query))
            .map(normalizeWorkflowStatus)
            .filter(status => status.groupId === groupId)
    );
}

export async function fetchWorkflowStatusById(
    event: H3Event,
    workspace: AdminWorkspace,
    id: string
): Promise<WorkflowStatusDto | null> {
    validateUuid(id, 'statusId');
    return (await fetchWorkflowStatuses(event, workspace)).find(status => status.id === id) ?? null;
}

export async function withWorkflowStatusMutationLock<T>(
    key: string,
    callback: () => Promise<T>
): Promise<T> {
    const previous = workflowStatusMutationLocks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
        release = resolve;
    });
    const tail = previous.then(() => current, () => current);
    workflowStatusMutationLocks.set(key, tail);

    await previous.catch(() => undefined);
    try {
        return await callback();
    } finally {
        release();
        if (workflowStatusMutationLocks.get(key) === tail) {
            workflowStatusMutationLocks.delete(key);
        }
    }
}

export async function buildWorkflowStatusListResponse(
    event: H3Event,
    workspace: AdminWorkspace
): Promise<WorkflowStatusListResponse> {
    return {
        // Only the organisation workspace shows the status cards with their
        // bins, so only there the list asks for the delete blockers.
        statuses: await fetchWorkflowStatuses(event, workspace, { deleteBlockers: workspace.type === 'organisation' }),
        meta: {
            workspaceType: workspace.type,
            workspaceLabel: workspace.label,
            editable: workspace.type === 'organisation'
        }
    };
}

function normalizeOptionalString(
    value: unknown,
    maxLength: number,
    fieldName: string,
    required: boolean
): string | undefined {
    if (value === undefined && !required) return undefined;
    const normalized = sanitizeString(value, maxLength).trim();
    if (!normalized) {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.validation.invalidField',
            data: { code: 'errors.validation.invalidField', field: fieldName }
        });
    }
    return normalized;
}

function normalizeBoolean(value: unknown, fieldName: string): boolean | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'boolean') {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.validation.invalidField',
            data: { code: 'errors.validation.invalidField', field: fieldName }
        });
    }
    return value;
}

function normalizeWeight(value: unknown): number | undefined {
    if (value === undefined) return undefined;
    const normalized = Number(value);
    if (!Number.isInteger(normalized) || normalized < -10000 || normalized > 10000) {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.validation.invalidField',
            data: { code: 'errors.validation.invalidField', field: 'weight' }
        });
    }
    return normalized;
}

function normalizeDayCountAttribute(value: unknown): number {
    const numberValue = Number(value ?? 0);
    if (!Number.isInteger(numberValue) || numberValue < 0) return 0;
    return Math.min(numberValue, MAX_SLA_DAYS);
}

function normalizeDayCount(value: unknown, fieldName: 'slaDays' | 'escalationDays'): number | undefined {
    if (value === undefined) return undefined;
    const normalized = Number(value);
    if (!Number.isInteger(normalized) || normalized < 0 || normalized > MAX_SLA_DAYS) {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.validation.invalidField',
            data: { code: 'errors.validation.invalidField', field: fieldName }
        });
    }
    return normalized;
}

function normalizeAllowedNextIds(value: unknown): string[] | undefined {
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.length > 100) {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.validation.invalidField',
            data: { code: 'errors.validation.invalidField', field: 'allowedNextIds' }
        });
    }

    return [...new Set(value.map(item => validateUuid(item, 'allowedNextIds')))];
}

function normalizeExpectedVersion(value: unknown): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || value.trim() === '' || value.length > 64) {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.workflow.expectedVersionRequired',
            data: { code: 'errors.workflow.expectedVersionRequired' }
        });
    }
    return value;
}

function normalizeSemanticFlagAttribute(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const values = value
        .map((item) => {
            if (typeof item === 'string') return item;
            if (item && typeof item === 'object' && 'value' in item) {
                const nested = (item as { value?: unknown }).value;
                return typeof nested === 'string' ? nested : '';
            }
            return '';
        })
        .filter(item => SEMANTIC_FLAGS.has(item));
    return [...new Set(values)];
}

function normalizeSemanticFlags(value: unknown): string[] | undefined {
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.length > SEMANTIC_FLAGS.size) {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.validation.invalidField',
            data: { code: 'errors.validation.invalidField', field: 'semanticFlags' }
        });
    }
    const flags = value.map((item) => {
        if (typeof item !== 'string' || !SEMANTIC_FLAGS.has(item)) {
            throw createSafeError({
                statusCode: 400,
                message: 'errors.validation.invalidField',
                data: { code: 'errors.validation.invalidField', field: 'semanticFlags' }
            });
        }
        return item;
    });
    return [...new Set(flags)];
}

function citizenLabelInvalid(): never {
    throw createSafeError({
        statusCode: 422,
        message: 'errors.workflow.citizenLabelInvalid',
        data: { code: 'errors.workflow.citizenLabelInvalid' }
    });
}

/**
 * Citizen texts are plain text for mails and the citizen UI: trimmed, at most
 * 120 characters, no control characters and no angle brackets. Empty clears
 * the text (the label shows). Mirrors the backend WorkflowStatusCitizenLabel.
 */
export function normalizeCitizenLabel(value: unknown): Partial<WorkflowStatusCitizenLabel> | undefined {
    if (value === undefined) return undefined;
    if (!value || typeof value !== 'object' || Array.isArray(value)) citizenLabelInvalid();
    const record = value as Record<string, unknown>;
    if (Object.keys(record).some(key => !(CITIZEN_LABEL_LANGCODES as readonly string[]).includes(key))) citizenLabelInvalid();
    const result: Partial<WorkflowStatusCitizenLabel> = {};
    for (const langcode of CITIZEN_LABEL_LANGCODES) {
        const text = record[langcode];
        if (text === undefined) continue;
        if (typeof text !== 'string') citizenLabelInvalid();
        const trimmed = text.trim();
        // Plain-text grammar: control characters and markup are rejected, not stripped.
        // eslint-disable-next-line no-control-regex
        if (Array.from(trimmed).length > CITIZEN_LABEL_MAX_LENGTH || /[\u0000-\u001f\u007f<>]/u.test(trimmed)) citizenLabelInvalid();
        result[langcode] = trimmed;
    }
    return result;
}

/** Maps a rejected citizen text from the backend constraint to the proxy code. */
export function mapWorkflowStatusWriteError(error: unknown): unknown {
    const data = error && typeof error === 'object' && 'data' in error
        ? (error as { data?: { detail?: unknown } }).data
        : undefined;
    const statusCode = error && typeof error === 'object' && 'statusCode' in error
        ? (error as { statusCode?: number }).statusCode
        : undefined;
    if (statusCode === 422 && typeof data?.detail === 'string' && data.detail.includes('field_citizen_label_')) {
        return createSafeError({
            statusCode: 422,
            message: 'errors.workflow.citizenLabelInvalid',
            data: { code: 'errors.workflow.citizenLabelInvalid' }
        });
    }
    return error;
}

export function normalizeWorkflowStatusInput(body: Record<string, unknown> | null | undefined, mode: 'create' | 'patch'): WorkflowStatusInput {
    const payload = body && typeof body === 'object' ? body : {};
    const input: WorkflowStatusInput = {};
    const requireBaseFields = mode === 'create';

    const label = normalizeOptionalString(payload.label, 128, 'label', requireBaseFields);
    if (label !== undefined) input.label = label;

    if (mode === 'create') {
        const machineName = normalizeOptionalString(payload.machineName, 64, 'machineName', true);
        if (!machineName || !MACHINE_NAME_PATTERN.test(machineName)) {
            throw createSafeError({
                statusCode: 400,
                message: 'errors.workflow.machineNameInvalid',
                data: { code: 'errors.workflow.machineNameInvalid' }
            });
        }
        input.machineName = machineName;
    } else if (payload.machineName !== undefined) {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.workflow.machineNameImmutable',
            data: { code: 'errors.workflow.machineNameImmutable' }
        });
    }

    const color = normalizeOptionalString(payload.color, 9, 'color', requireBaseFields);
    if (color !== undefined) {
        if (!HEX_COLOR_PATTERN.test(color)) {
            throw createSafeError({
                statusCode: 400,
                message: 'errors.workflow.colorInvalid',
                data: { code: 'errors.workflow.colorInvalid' }
            });
        }
        input.color = color;
    }

    const icon = normalizeOptionalString(payload.icon, 64, 'icon', requireBaseFields);
    if (icon !== undefined) {
        if (!ICON_PATTERN.test(icon)) {
            throw createSafeError({
                statusCode: 400,
                message: 'errors.workflow.iconInvalid',
                data: { code: 'errors.workflow.iconInvalid' }
            });
        }
        input.icon = icon;
    }

    const weight = normalizeWeight(payload.weight);
    if (weight !== undefined) input.weight = weight;

    const isDefault = normalizeBoolean(payload.isDefault, 'isDefault');
    if (isDefault !== undefined) input.isDefault = isDefault;

    const isTerminal = normalizeBoolean(payload.isTerminal, 'isTerminal');
    if (isTerminal !== undefined) input.isTerminal = isTerminal;

    const slaDays = normalizeDayCount(payload.slaDays, 'slaDays');
    if (slaDays !== undefined) input.slaDays = isTerminal === true ? 0 : slaDays;
    else if (isTerminal === true) input.slaDays = 0;

    const escalationDays = normalizeDayCount(payload.escalationDays, 'escalationDays');
    if (escalationDays !== undefined) input.escalationDays = isTerminal === true ? 0 : escalationDays;
    else if (isTerminal === true) input.escalationDays = 0;

    const semanticFlags = normalizeSemanticFlags(payload.semanticFlags);
    if (semanticFlags !== undefined) input.semanticFlags = semanticFlags;

    const citizenLabel = normalizeCitizenLabel(payload.citizenLabel);
    if (citizenLabel !== undefined && Object.keys(citizenLabel).length > 0) input.citizenLabel = citizenLabel;

    const allowedNextIds = normalizeAllowedNextIds(payload.allowedNextIds);
    if (allowedNextIds !== undefined) input.allowedNextIds = isTerminal === true ? [] : allowedNextIds;
    else if (isTerminal === true) input.allowedNextIds = [];

    const expectedVersion = normalizeExpectedVersion(payload.expectedVersion);
    if (expectedVersion !== undefined) input.expectedVersion = expectedVersion;

    const meaningfulInputKeys = Object.keys(input).filter(key => key !== 'expectedVersion');
    if (meaningfulInputKeys.length === 0) {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.validation.invalidPayload',
            data: { code: 'errors.validation.invalidPayload' }
        });
    }

    return input;
}

export function applyWorkflowStatusTerminalInvariant(
    input: WorkflowStatusInput,
    existingStatus?: TerminalStatusContext
): WorkflowStatusInput {
    const effectiveIsTerminal = input.isTerminal ?? existingStatus?.isTerminal ?? false;
    if (!effectiveIsTerminal) return input;
    return {
        ...input,
        slaDays: 0,
        escalationDays: 0,
        allowedNextIds: []
    };
}

export function assertWorkflowStatusPatchPrecondition(
    status: WorkflowStatusDto,
    input: WorkflowStatusInput
): void {
    if (!input.expectedVersion) {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.workflow.expectedVersionRequired',
            data: { code: 'errors.workflow.expectedVersionRequired' }
        });
    }
    if (status.version !== input.expectedVersion) {
        throw createSafeError({
            statusCode: 409,
            message: 'errors.workflow.statusChanged',
            data: { code: 'errors.workflow.statusChanged' }
        });
    }
}

function workflowStatusVersion(status: Omit<WorkflowStatusDto, 'version'>): string {
    return createHash('sha256')
        .update(JSON.stringify({
            id: status.id,
            label: status.label,
            machineName: status.machineName,
            color: status.color,
            icon: status.icon,
            weight: status.weight,
            isDefault: status.isDefault,
            isTerminal: status.isTerminal,
            slaDays: status.slaDays,
            escalationDays: status.escalationDays,
            semanticFlags: status.semanticFlags,
            citizenLabel: status.citizenLabel,
            allowedNextIds: status.allowedNextIds,
            groupId: status.groupId
        }))
        .digest('hex');
}

export async function assertAllowedNextTargets(
    event: H3Event,
    workspace: AdminWorkspace,
    status: WorkflowStatusDto,
    allowedNextIds: string[] | undefined
): Promise<void> {
    if (allowedNextIds === undefined) return;
    if (allowedNextIds.includes(status.id)) {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.workflow.selfTransitionInvalid',
            data: { code: 'errors.workflow.selfTransitionInvalid' }
        });
    }

    const statuses = await fetchWorkflowStatuses(event, workspace);
    const byId = new Map(statuses.map(item => [item.id, item]));
    for (const targetId of allowedNextIds) {
        const target = byId.get(targetId);
        if (!target || target.groupId !== status.groupId) {
            throw createSafeError({
                statusCode: 400,
                message: 'errors.workflow.allowedNextOutOfScope',
                data: { code: 'errors.workflow.allowedNextOutOfScope' }
            });
        }
    }
}

export function workflowStatusAttributes(input: WorkflowStatusInput): Record<string, unknown> {
    const attributes: Record<string, unknown> = {};
    if (input.label !== undefined) attributes.label = input.label;
    if (input.machineName !== undefined) attributes.field_machine_name = input.machineName;
    if (input.color !== undefined) attributes.field_color = input.color;
    if (input.icon !== undefined) attributes.field_icon = input.icon;
    if (input.weight !== undefined) attributes.field_weight = input.weight;
    if (input.isDefault !== undefined) attributes.field_is_default = input.isDefault;
    if (input.isTerminal !== undefined) attributes.field_is_terminal = input.isTerminal;
    if (input.slaDays !== undefined) attributes.field_sla_days = input.slaDays;
    if (input.escalationDays !== undefined) attributes.field_escalation_days = input.escalationDays;
    if (input.semanticFlags !== undefined) attributes.field_semantic_flags = input.semanticFlags;
    if (input.citizenLabel?.de !== undefined) attributes.field_citizen_label_de = input.citizenLabel.de;
    if (input.citizenLabel?.en !== undefined) attributes.field_citizen_label_en = input.citizenLabel.en;
    return attributes;
}

export function workflowStatusRelationships(input: WorkflowStatusInput): Record<string, unknown> {
    if (input.allowedNextIds === undefined) return {};
    return {
        field_allowed_next: {
            data: input.allowedNextIds.map(id => ({
                type: 'workflow_status--workflow_status',
                id
            }))
        }
    };
}
