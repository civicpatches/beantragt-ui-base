import type { ApplicationRow } from '~/types';

export interface ApplicationAssignmentRelationshipSource {
    relationships?: Record<string, unknown> | null
}

export function hasApplicationAssignmentRelationship(resource: ApplicationAssignmentRelationshipSource): boolean {
    const relationships = resource.relationships ?? {};
    return Object.prototype.hasOwnProperty.call(relationships, 'field_assigned_to')
      || Object.prototype.hasOwnProperty.call(relationships, 'field_assigned_team');
}

export function isApplicationAssignedToCurrentUser(
    row: Pick<ApplicationRow, 'assignedToId' | 'assignedTeamId'>,
    currentUserId: string | null | undefined,
    currentTeamIds: readonly string[] = []
): boolean {
    if (currentUserId && row.assignedToId === currentUserId) return true;
    return Boolean(row.assignedTeamId && currentTeamIds.includes(row.assignedTeamId));
}
