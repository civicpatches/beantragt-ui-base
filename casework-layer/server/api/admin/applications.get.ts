/**
 * GET /api/admin/applications
 * Internal Nuxt UI proxy, not a separate public /api/v1 contract.
 *
 * Adapts the consolidated Drupal staff-v1 list to the existing admin UI
 * response contract. Drupal enforces workspace authorization, protected-data
 * projection and effective workflow transitions.
 *
 * A form-filtered request may include protected submitted data for dynamic
 * columns and export. The Drupal endpoint applies the same reveal/redaction
 * rules as the application detail API.
 */
import type { H3Event } from 'h3';
import type { AdminUnconfirmedApplicationsResponse } from '~~/app/types/admin';
import { normalizeWorkspaceKey, normalizeWorkspaceSlug } from '~~/casework-layer/server/utils/admin-workspace';
import { setPrivateNoStore } from '~~/server/utils/request-security';
import {
    fetchStaffApplicationIndex,
    fetchStaffUnreadApplicationPage,
    type StaffApplicationProjection,
    type StaffWorkflowStatusProjection,
    type StaffWorkspaceScope
} from '../../utils/staff-applications';

const APPLICATION_PAGE_CAP = 500;
const SUBMITTED_DATA_PAGE_CAP = 100;
const APPLICATION_TYPE = 'application--application';
const FORM_TYPE = 'form_schema--form_schema';
const STATUS_TYPE = 'workflow_status--workflow_status';
const UNREAD_QUERY_ERRORS = new Set([
    'pagination.cursor_invalid',
    'pagination.cursor_requires_unread_messages',
    'pagination.offset_with_unread_messages',
    'unread_messages.confirmation_conflict',
    'unread_messages.invalid'
]);

function invalidUnreadQuery(code: string): never {
    throw createSafeError({ statusCode: 400, message: 'errors.admin.applicationsLoadFailed', data: { code } });
}

function requiredStaffScope(event: H3Event): StaffWorkspaceScope {
    const query = getQuery(event);
    const rawJurisdiction = query.jurisdiction;
    const rawOrganisation = query.organisation ?? query.organization ?? query.org;
    const hasExplicitScope = rawJurisdiction !== undefined || rawOrganisation !== undefined;

    if (hasExplicitScope) {
        const jurisdictionSlug = normalizeWorkspaceSlug(rawJurisdiction);
        const organisationSlug = normalizeWorkspaceSlug(rawOrganisation);
        if (!jurisdictionSlug || (rawOrganisation !== undefined && !organisationSlug)) {
            throw createSafeError({
                statusCode: 400,
                message: 'errors.workspace.required',
                data: { code: 'errors.workspace.required' }
            });
        }
        return { jurisdictionSlug, organisationSlug };
    }

    const workspaceKey = normalizeWorkspaceKey(getCookie(event, 'beantragt-admin-workspace'));
    const [jurisdictionSlug, organisationSlug] = workspaceKey?.split('/') ?? [];
    if (!jurisdictionSlug) {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.workspace.required',
            data: { code: 'errors.workspace.required' }
        });
    }
    return { jurisdictionSlug, organisationSlug: organisationSlug || null };
}

function relationship(type: string, id: string | null | undefined): { data: { type: string, id: string } | null } {
    return { data: id ? { type, id } : null };
}

function applicationResource(application: StaffApplicationProjection, includeSubmittedData: boolean): Record<string, unknown> {
    const attributes: Record<string, unknown> = {
        field_reference_number: application.referenceNumber ?? null,
        field_applicant_email: application.applicant?.email ?? null,
        field_due_date: application.dueDate ?? null,
        field_effective_allowed_next: application.canChangeStatus === true ? application.status?.allowedNextIds ?? [] : [],
        can_change_status: application.canChangeStatus === true,
        can_delete: application.canDelete === true,
        created: application.submittedAt ?? '',
        changed: application.updatedAt ?? ''
    };
    if (includeSubmittedData && application.submittedData !== undefined) {
        attributes.field_data = JSON.stringify(application.submittedData || {});
    }

    const relationships: Record<string, unknown> = {
        field_schema: relationship(FORM_TYPE, application.form?.id),
        field_workflow_status: relationship(STATUS_TYPE, application.status?.id)
    };
    const assignmentsVisible = application.assignmentVisible === true
      || (application.assignmentVisible === undefined && application.assignment !== undefined);
    if (assignmentsVisible) {
        relationships.field_assigned_to = relationship('user--user', application.assignment?.assigneeId);
        relationships.field_assigned_team = relationship('group--org', application.assignment?.teamId);
    }

    return {
        type: APPLICATION_TYPE,
        id: application.id,
        attributes,
        relationships
    };
}

function formResource(application: StaffApplicationProjection): Record<string, unknown> | null {
    const id = application.form?.id;
    if (!id) return null;
    return {
        type: FORM_TYPE,
        id,
        attributes: { label: application.form?.title ?? '' }
    };
}

function statusResource(status: StaffWorkflowStatusProjection): Record<string, unknown> {
    return {
        type: STATUS_TYPE,
        id: status.id,
        attributes: {
            label: status.label ?? '',
            field_machine_name: status.machineName ?? '',
            field_color: status.color ?? '',
            field_icon: status.icon ?? '',
            field_weight: status.weight ?? 0,
            field_semantic_flags: status.semanticFlags ?? []
        },
        relationships: {
            field_allowed_next: { data: [] }
        }
    };
}

export default defineEventHandler(async (event) => {
    await requireStaff(event);
    setPrivateNoStore(event);

    const query = getQuery(event);
    const schemaId = typeof query.schemaId === 'string' ? query.schemaId : undefined;
    const unconfirmed = query.confirmation === 'unconfirmed';
    const unread = query.unreadMessages === 'true';
    const after = typeof query.after === 'string' ? query.after : undefined;
    if (query.unreadMessages !== undefined && !unread && query.unreadMessages !== 'false') invalidUnreadQuery('unread_messages.invalid');
    if (query.after !== undefined && !unread) invalidUnreadQuery('pagination.cursor_requires_unread_messages');
    if (query.after !== undefined && !after) invalidUnreadQuery('pagination.cursor_invalid');
    if (unread && unconfirmed) invalidUnreadQuery('unread_messages.confirmation_conflict');
    if (unread && query.offset !== undefined && query.offset !== '0') invalidUnreadQuery('pagination.offset_with_unread_messages');
    if (schemaId) {
        validateUuid(schemaId, 'schemaId');
    }
    const scope = requiredStaffScope(event);
    const includeSubmittedData = Boolean(schemaId) && (unread ? query.include === 'submittedData' : !unconfirmed);
    if (includeSubmittedData) await requireAdmin(event);
    const limit = query.limit === undefined ? 25 : typeof query.limit === 'string' && /^\d+$/.test(query.limit) ? Number(query.limit) : 0;
    if (unread && (limit < 1 || limit > (includeSubmittedData ? SUBMITTED_DATA_PAGE_CAP : APPLICATION_PAGE_CAP))) {
        throw createSafeError({ statusCode: 400, message: 'errors.admin.applicationsLoadFailed', data: { code: 'errors.admin.applicationsLoadFailed' } });
    }

    try {
        const unreadPage = unread ? await fetchStaffUnreadApplicationPage(event, scope, { formId: schemaId, includeSubmittedData, limit, after }) : null;
        const staffIndex = unreadPage ?? await fetchStaffApplicationIndex(event, scope, {
            maxApplications: schemaId && !unconfirmed ? SUBMITTED_DATA_PAGE_CAP : APPLICATION_PAGE_CAP,
            formId: schemaId,
            sort: 'created',
            includeSubmittedData,
            ...(unconfirmed && { confirmation: 'unconfirmed' })
        });
        if (unconfirmed) {
            const data: AdminUnconfirmedApplicationsResponse['data'] = staffIndex.applications
                .filter(application => application.emailConfirmed === false)
                .map(application => ({
                    id: application.id,
                    referenceNumber: application.referenceNumber ?? '',
                    formTitle: application.form?.title ?? null,
                    submittedAt: application.submittedAt ?? '',
                    applicantName: application.applicantName ?? null,
                    confirmationEmail: application.confirmationEmail ?? null,
                    emailConfirmed: false
                }));
            return { data, meta: { truncated: staffIndex.truncated && data.length > 0 } } satisfies AdminUnconfirmedApplicationsResponse;
        }

        const applications = staffIndex.applications.filter(application => application.emailConfirmed !== false);
        const forms = new Map<string, Record<string, unknown>>();
        const effectiveAllowedNext: Record<string, Record<string, string[]>> = {};
        // Application UUID -> review code; only applications that need review.
        const workflowReview: Record<string, 'status_not_in_workflow'> = {};

        for (const application of applications) {
            const form = formResource(application);
            if (form && typeof form.id === 'string') {
                forms.set(form.id, form);
            }
            const formId = application.form?.id;
            const statusId = application.status?.id;
            if (formId && statusId) {
                effectiveAllowedNext[formId] ??= {};
                effectiveAllowedNext[formId][statusId] = application.canChangeStatus === true ? application.status?.allowedNextIds ?? [] : [];
            }
            if (application.status?.reviewCode === 'status_not_in_workflow') {
                workflowReview[application.id] = 'status_not_in_workflow';
            }
        }

        return {
            data: applications.map(application => applicationResource(application, includeSubmittedData)),
            included: [
                ...forms.values(),
                ...staffIndex.workflowStatuses.map(statusResource)
            ],
            meta: {
                count: applications.length,
                effectiveAllowedNext,
                workflowReview,
                events: Object.fromEntries(applications
                    .filter(application => staffIndex.events?.[application.id] !== undefined)
                    .map(application => [application.id, staffIndex.events[application.id]])),
                truncated: staffIndex.truncated,
                ...(unreadPage && { page: unreadPage.page })
            }
        };
    } catch (e: unknown) {
        const upstream = e as { statusCode?: number, data?: { upstreamCode?: string } } | undefined;
        const status = upstream?.statusCode || 500;
        const upstreamCode = upstream?.data?.upstreamCode;
        const code = status === 400 && upstreamCode && UNREAD_QUERY_ERRORS.has(upstreamCode)
            ? upstreamCode
            : 'errors.admin.applicationsLoadFailed';
        throw createSafeError({
            statusCode: status,
            message: 'errors.admin.applicationsLoadFailed',
            data: { code }
        });
    }
});
