import type { AdminApplicationsResponse, ApplicationRow } from '~/types';
import { safeJsonParse } from '~/composables/useFormatters';
import { hasApplicationAssignmentRelationship } from './application-assignment-filter';

export function applicationListRows(response: AdminApplicationsResponse, formId?: string): ApplicationRow[] {
    return (response.data || []).map((item) => {
        const schemaRel = item.relationships?.field_schema?.data;
        const statusRel = item.relationships?.field_workflow_status?.data;
        const assignedRel = item.relationships?.field_assigned_to?.data;
        const teamRel = item.relationships?.field_assigned_team?.data;
        const schemaId = formId ?? (schemaRel && !Array.isArray(schemaRel) ? schemaRel.id : null);
        const statusId = statusRel && !Array.isArray(statusRel) ? statusRel.id : null;
        const hasAssignment = hasApplicationAssignmentRelationship(item);
        const allowedNextIds = item.attributes.field_effective_allowed_next ?? (schemaId && statusId
            ? response.meta?.effectiveAllowedNext?.[schemaId]?.[statusId]
            : undefined);
        return {
            id: item.id,
            referenceNumber: item.attributes.field_reference_number ?? '',
            statusId,
            email: item.attributes.field_applicant_email ?? null,
            schemaId,
            assignedToId: hasAssignment && assignedRel && !Array.isArray(assignedRel) ? assignedRel.id : null,
            assignedTeamId: hasAssignment && teamRel && !Array.isArray(teamRel) ? teamRel.id : null,
            dueDate: item.attributes.field_due_date ?? null,
            ...(formId && { data: safeJsonParse(item.attributes.field_data) }),
            created: item.attributes.created ?? '',
            changed: item.attributes.changed ?? '',
            allowedNextIds,
            canChangeStatus: item.attributes.can_change_status === true,
            canDelete: item.attributes.can_delete === true,
            reviewCode: response.meta?.workflowReview?.[item.id],
            events: response.meta?.events?.[item.id] ?? {}
        };
    });
}

export function applicationListFormLabels(included: AdminApplicationsResponse['included']): Record<string, string> {
    return Object.fromEntries((included ?? [])
        .filter(item => item.type === 'form_schema--form_schema' && item.id)
        .map(item => [item.id, item.attributes?.label ?? '']));
}
