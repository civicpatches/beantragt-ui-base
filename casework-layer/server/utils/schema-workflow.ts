import type { H3Event } from 'h3';
import {
    applyAdminJurisdictionFilter,
    normalizeAdminOrganisationList,
    type AdminWorkspace,
    type GroupCollectionResponse
} from '~~/casework-layer/server/utils/admin-workspace';
import { drupalSessionFetch } from '~~/server/utils/auth';
import { createSafeError } from '~~/server/utils/error-handling';
import {
    isStandardWorkflow,
    normalizeSchemaWorkflowDefinition,
    parseSchemaWorkflowDefinition,
    standardStatuses,
    workflowFeatureStates,
    type SchemaWorkflowDefinition,
    type WorkflowFeatureState
} from '~~/casework-layer/server/utils/schema-workflow-definition';
import { validateUuid } from '~~/server/utils/validation';
import {
    assertWorkflowStatusWorkspaceAccess,
    assertWorkflowStatusWorkspaceWriteAccess,
    fetchWorkflowStatuses,
    resolveRequiredWorkflowStatusWorkspace,
    type WorkflowStatusDto
} from '~~/casework-layer/server/utils/workflow-status-admin';

interface FormSchemaWorkflowResource {
    id: string
    attributes?: {
        label?: string
        changed?: string
        drupal_internal__revision_id?: number | string
        field_workflow_status?: string
        field_workflow_definition?: string | { value?: string } | null
    }
    relationships?: {
        field_organisation?: {
            data?: { id: string, type?: string } | null
        }
    }
}

interface FormSchemaWorkflowResponse {
    data?: FormSchemaWorkflowResource[]
    included?: GroupCollectionResponse['included']
}

interface ScopedSchemaWorkflowResponse {
    schema: FormSchemaWorkflowResource
    included: GroupCollectionResponse['included']
}

export interface SchemaWorkflowEditorResponse {
    workflow: SchemaWorkflowDefinition
    statuses: WorkflowStatusDto[]
    /**
     * The standard of the department (machine names reachable from
     * the start status, start first) and whether this form follows it, i.e.
     * stores no workflow of its own.
     */
    standard: {
        statuses: string[]
        followed: boolean
    }
    /** The four functions against the catalogue and this workflow. */
    features: WorkflowFeatureState[]
    meta: {
        schemaId: string
        schemaLabel: string
        schemaChanged: string | null
        workspaceLabel: string
        editable: boolean
    }
}

async function fetchScopedSchemaWorkflowWithIncluded(
    event: H3Event,
    schemaId: string
): Promise<ScopedSchemaWorkflowResponse> {
    const query = new URLSearchParams({
        'filter[id]': schemaId,
        'include': 'field_organisation,field_organisation.field_jurisdiction',
        'fields[form_schema--form_schema]': 'label,changed,drupal_internal__revision_id,field_workflow_status,field_workflow_definition,field_organisation',
        'fields[group--org]': 'drupal_internal__id,label,field_slug,field_jurisdiction',
        'fields[group--jur]': 'drupal_internal__id,label,field_slug',
        'page[limit]': '1'
    });
    await applyAdminJurisdictionFilter(event, query);

    const response = await drupalSessionFetch<FormSchemaWorkflowResponse>(
        event,
        `/jsonapi/form_schema/form_schema?${query.toString()}`
    );
    const schema = response.data?.[0];
    if (!schema) {
        throw createSafeError({
            statusCode: 404,
            message: 'errors.schema.notFound',
            data: { code: 'errors.schema.notFound' }
        });
    }
    return {
        schema,
        included: response.included || []
    };
}

function resolveSchemaOrganisationWorkspace(
    schema: FormSchemaWorkflowResource,
    included: GroupCollectionResponse['included'] | undefined,
    fallbackWorkspace: AdminWorkspace
): AdminWorkspace {
    const organisationRel = schema.relationships?.field_organisation?.data;
    if (!organisationRel && fallbackWorkspace.type === 'organisation') {
        return fallbackWorkspace;
    }
    if (!organisationRel) {
        throw createSafeError({
            statusCode: 409,
            message: 'errors.workflow.organisationWorkspaceRequired',
            data: { code: 'errors.workflow.organisationWorkspaceRequired' }
        });
    }

    const organisation = (included || []).find(item => item.id === organisationRel.id && item.type === 'group--org');
    if (!organisation) {
        throw createSafeError({
            statusCode: 502,
            message: 'errors.server.drupalRequestFailed',
            data: { code: 'errors.server.drupalRequestFailed' }
        });
    }

    const [workspace] = normalizeAdminOrganisationList({
        data: [organisation],
        included: included || []
    });
    if (!workspace) {
        throw createSafeError({
            statusCode: 502,
            message: 'errors.server.drupalRequestFailed',
            data: { code: 'errors.server.drupalRequestFailed' }
        });
    }

    return workspace;
}

function standardAndFeatures(statuses: WorkflowStatusDto[], workflow: SchemaWorkflowDefinition): Pick<SchemaWorkflowEditorResponse, 'standard' | 'features'> {
    return {
        standard: {
            statuses: standardStatuses(statuses).map(status => status.machineName),
            followed: isStandardWorkflow(workflow, statuses)
        },
        features: workflowFeatureStates(statuses, workflow)
    };
}

export async function buildSchemaWorkflowResponse(
    event: H3Event,
    schemaIdValue: unknown
): Promise<SchemaWorkflowEditorResponse> {
    const schemaId = validateUuid(schemaIdValue, 'schemaId');
    const workspace = await resolveRequiredWorkflowStatusWorkspace(event);
    const schemaResponse = await fetchScopedSchemaWorkflowWithIncluded(event, schemaId);
    const ownerWorkspace = resolveSchemaOrganisationWorkspace(schemaResponse.schema, schemaResponse.included, workspace);
    await assertWorkflowStatusWorkspaceAccess(event, ownerWorkspace);
    const statuses = await fetchWorkflowStatuses(event, ownerWorkspace);

    const workflow = parseSchemaWorkflowDefinition(schemaResponse.schema.attributes?.field_workflow_definition, statuses);
    return {
        workflow,
        statuses,
        ...standardAndFeatures(statuses, workflow),
        meta: {
            schemaId,
            schemaLabel: schemaResponse.schema.attributes?.label || '',
            schemaChanged: schemaResponse.schema.attributes?.changed ?? null,
            workspaceLabel: ownerWorkspace.label,
            editable: schemaResponse.schema.attributes?.field_workflow_status === 'draft'
              && typeof schemaResponse.schema.attributes?.changed === 'string'
              && schemaResponse.schema.attributes.changed.length > 0
              && Number.isInteger(Number(schemaResponse.schema.attributes?.drupal_internal__revision_id))
              && Number(schemaResponse.schema.attributes?.drupal_internal__revision_id) > 0
        }
    };
}

export async function saveSchemaWorkflowDefinition(
    event: H3Event,
    schemaIdValue: unknown,
    value: unknown,
    expectedChanged: unknown
): Promise<SchemaWorkflowEditorResponse> {
    const schemaId = validateUuid(schemaIdValue, 'schemaId');
    if (typeof expectedChanged !== 'string' || expectedChanged === '') {
        throw createSafeError({
            statusCode: 428,
            message: 'errors.schema.staleVersionMissing',
            data: { code: 'errors.schema.staleVersionMissing' }
        });
    }

    const workspace = await resolveRequiredWorkflowStatusWorkspace(event);
    const schemaResponse = await fetchScopedSchemaWorkflowWithIncluded(event, schemaId);
    if (schemaResponse.schema.attributes?.field_workflow_status !== 'draft') {
        throw createSafeError({
            statusCode: 409,
            message: 'errors.schema.publishedEditForbidden',
            data: { code: 'errors.schema.publishedEditForbidden' }
        });
    }
    const currentChanged = schemaResponse.schema.attributes?.changed ?? null;
    if (!currentChanged || currentChanged !== expectedChanged) {
        throw createSafeError({
            statusCode: 409,
            message: 'errors.schema.modifiedInOtherTab',
            data: { code: 'errors.schema.modifiedInOtherTab' }
        });
    }
    const currentRevisionId = Number(schemaResponse.schema.attributes?.drupal_internal__revision_id);
    if (!Number.isInteger(currentRevisionId) || currentRevisionId <= 0) {
        throw createSafeError({
            statusCode: 409,
            message: 'errors.schema.modifiedInOtherTab',
            data: { code: 'errors.schema.modifiedInOtherTab' }
        });
    }

    const ownerWorkspace = resolveSchemaOrganisationWorkspace(schemaResponse.schema, schemaResponse.included, workspace);
    await assertWorkflowStatusWorkspaceWriteAccess(event, ownerWorkspace);
    const statuses = await fetchWorkflowStatuses(event, ownerWorkspace);
    const workflow = normalizeSchemaWorkflowDefinition(value, statuses);
    // E4: a draft equal to the standard is stored empty, so the form keeps
    // following the standard (and later changes of it) instead of a copy.
    const followsStandard = isStandardWorkflow(workflow, statuses);

    await drupalSessionFetch(
        event,
        `/jsonapi/form_schema/form_schema/${schemaId}`,
        {
            method: 'PATCH',
            expectedRevisionId: currentRevisionId,
            body: {
                data: {
                    type: 'form_schema--form_schema',
                    id: schemaId,
                    attributes: {
                        field_workflow_definition: followsStandard ? null : JSON.stringify(workflow)
                    }
                }
            }
        }
    );

    return {
        workflow,
        statuses,
        ...standardAndFeatures(statuses, workflow),
        meta: {
            schemaId,
            schemaLabel: schemaResponse.schema.attributes?.label || '',
            schemaChanged: currentChanged,
            workspaceLabel: ownerWorkspace.label,
            editable: true
        }
    };
}
