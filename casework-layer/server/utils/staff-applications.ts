import type { H3Event } from 'h3';
import { normalizeApplicationEvents, normalizeApplicationEventSnapshot } from '~~/app/utils/application-events';
import type { AdminApplicationEvents, AdminApplicationEventCounts, AdminUnreadApplicationsPage } from '~~/app/types/admin';
import type { ApplicationDataCorrectionPage } from '~~/casework-layer/app/utils/application-data-corrections';

export interface StaffWorkspaceScope {
    jurisdictionSlug: string
    organisationSlug?: string | null
}

export interface StaffApplicationProjection {
    id: string
    emailConfirmed?: boolean
    applicantName?: string | null
    confirmationEmail?: string | null
    assignmentVisible?: boolean
    canChangeStatus?: boolean
    canDelete?: boolean
    referenceNumber?: string | null
    form?: {
        id?: string | null
        title?: string | null
    }
    status?: {
        id?: string | null
        code?: string | null
        label?: string | null
        color?: string | null
        icon?: string | null
        weight?: number | null
        semanticFlags?: string[] | null
        allowedNextIds?: string[] | null
        /** Present only while the status is outside the form's published workflow. */
        reviewCode?: 'status_not_in_workflow' | null
    }
    assignment?: {
        assigneeId?: string | null
        teamId?: string | null
    }
    applicant?: {
        email?: string | null
    }
    crmData?: Record<string, unknown> | null
    workflowAttributes?: Record<string, unknown> | null
    submittedAt?: string | null
    updatedAt?: string | null
    dueDate?: string | null
    submittedData?: Record<string, unknown> | null
    profileConsent?: unknown
    bankConsent?: unknown
}

export interface StaffWorkflowStatusProjection {
    id: string
    machineName?: string | null
    label?: string | null
    color?: string | null
    icon?: string | null
    weight?: number | null
    semanticFlags?: string[] | null
}

interface StaffApplicationsResponse {
    data?: StaffApplicationProjection[]
    meta?: {
        count?: number
        events?: Record<string, AdminApplicationEventCounts>
        workflowStatuses?: StaffWorkflowStatusProjection[]
        page?: {
            limit?: number
            offset?: number
            hasMore?: boolean
            nextOffset?: number
            nextCursor?: string
        }
    }
}

export interface StaffApplicationIndex {
    applications: StaffApplicationProjection[]
    events: Record<string, AdminApplicationEventCounts>
    workflowStatuses: StaffWorkflowStatusProjection[]
    truncated: boolean
}

export type StaffApplicationSort = 'updated' | 'created';

function staffWorkspaceParams(workspace: StaffWorkspaceScope): URLSearchParams {
    const params = new URLSearchParams({
        jurisdiction: workspace.jurisdictionSlug
    });
    if (workspace.organisationSlug) {
        params.set('organisation', workspace.organisationSlug);
    }
    return params;
}

function normalizedLimit(value: number): number {
    return Math.max(1, Math.min(Math.floor(value), 500));
}

export function staffApplicationJsonApiAttributes(
    application: StaffApplicationProjection | undefined,
    options: { includeCrm?: boolean, includeWorkflowAttributes?: boolean } = {}
): Record<string, unknown> {
    const attributes: Record<string, unknown> = {
        field_applicant_email: application?.applicant?.email ?? null,
        field_due_date: application?.dueDate ?? null
    };
    if (options.includeCrm) {
        attributes.field_crm_data = JSON.stringify(application?.crmData || {});
    }
    if (options.includeWorkflowAttributes) {
        attributes.field_workflow_attributes = JSON.stringify(application?.workflowAttributes || {});
    }
    return attributes;
}

export function stripDrupalInternalId(resource: unknown): void {
    if (!resource || typeof resource !== 'object' || Array.isArray(resource)) return;
    const attributes = (resource as { attributes?: unknown }).attributes;
    if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) return;
    Reflect.deleteProperty(attributes as Record<string, unknown>, 'drupal_internal__id');
}

export async function fetchStaffApplicationDetail(
    event: H3Event,
    workspace: StaffWorkspaceScope,
    applicationId: string,
    options: { eventsOnly?: boolean, dataCorrections?: { before?: string } } = {}
): Promise<{ application: StaffApplicationProjection, events?: AdminApplicationEvents, corrections?: ApplicationDataCorrectionPage }> {
    const params = staffWorkspaceParams(workspace);
    const includeCorrections = options.eventsOnly && options.dataCorrections;
    if (includeCorrections) {
        params.set('includeDataCorrections', '1');
        if (includeCorrections.before !== undefined) params.set('dataCorrectionsBefore', includeCorrections.before);
    }
    const response = await drupalSessionFetch<{
        data?: StaffApplicationProjection
        meta?: { events?: AdminApplicationEvents } & Partial<ApplicationDataCorrectionPage>
    }>(
        event,
        options.eventsOnly
            ? `/api/internal/staff/applications/${applicationId}/events?${params.toString()}`
            : `/api/v1/staff/applications/${applicationId}?${params.toString()}`
    );
    if (response.data && response.data.id !== applicationId) {
        throw createSafeError({ statusCode: 502, message: 'errors.server.drupalRequestFailed' });
    }
    return {
        application: response.data || { id: applicationId },
        events: normalizeApplicationEventSnapshot(response.meta?.events),
        ...(includeCorrections && {
            corrections: {
                dataCorrections: response.meta?.dataCorrections ?? [],
                dataCorrectionsNextBefore: response.meta?.dataCorrectionsNextBefore ?? null
            }
        })
    };
}

export async function fetchStaffApplicationIndex(
    event: H3Event,
    workspace: StaffWorkspaceScope,
    options: {
        maxApplications?: number
        formId?: string
        sort?: StaffApplicationSort
        includeSubmittedData?: boolean
        confirmation?: 'unconfirmed'
    } = {}
): Promise<StaffApplicationIndex> {
    const maxApplications = Math.max(1, Math.min(Math.floor(options.maxApplications || 500), 500));
    const applications: StaffApplicationProjection[] = [];
    const events: Record<string, AdminApplicationEventCounts> = {};
    let offset = 0;
    let truncated = false;
    const workflowStatuses = new Map<string, StaffWorkflowStatusProjection>();

    while (applications.length < maxApplications) {
        const limit = normalizedLimit(maxApplications - applications.length);
        const params = staffWorkspaceParams(workspace);
        params.set('limit', String(limit));
        params.set('offset', String(offset));
        params.set('sort', options.sort || 'updated');
        if (options.formId) {
            params.set('form', options.formId);
        }
        if (options.confirmation === 'unconfirmed') {
            params.set('confirmation', 'unconfirmed');
        } else if (options.includeSubmittedData) {
            params.set('include', 'submittedData');
        }

        const response = await drupalSessionFetch<StaffApplicationsResponse>(
            event,
            `/api/v1/staff/applications?${params.toString()}`
        );
        const pageData = Array.isArray(response.data) ? response.data.slice(0, maxApplications - applications.length) : [];
        applications.push(...pageData);
        // Only copy counts belonging to applications in this authorized page.
        for (const application of pageData) {
            events[application.id] = normalizeApplicationEvents(response.meta?.events?.[application.id]);
        }
        for (const status of response.meta?.workflowStatuses ?? []) {
            if (status?.id) {
                workflowStatuses.set(status.id, status);
            }
        }

        const page = response.meta?.page;
        if (page?.hasMore && applications.length >= maxApplications) {
            truncated = true;
            break;
        }
        if (!page?.hasMore || pageData.length === 0) {
            break;
        }
        offset = Number.isInteger(page.nextOffset)
            ? Number(page.nextOffset)
            : offset + pageData.length;
    }

    return {
        applications: applications.slice(0, maxApplications),
        events,
        workflowStatuses: [...workflowStatuses.values()],
        truncated
    };
}

export async function fetchStaffUnreadApplicationPage(
    event: H3Event,
    workspace: StaffWorkspaceScope,
    options: { formId?: string, includeSubmittedData: boolean, limit: number, after?: string }
): Promise<StaffApplicationIndex & { page: AdminUnreadApplicationsPage }> {
    const params = staffWorkspaceParams(workspace);
    params.set('unreadMessages', 'true');
    params.set('sort', 'created');
    params.set('limit', String(options.limit));
    if (options.formId) params.set('form', options.formId);
    if (options.includeSubmittedData) params.set('include', 'submittedData');
    if (options.after !== undefined) params.set('after', options.after);

    const response = await drupalSessionFetch<StaffApplicationsResponse>(event, `/api/v1/staff/applications?${params}`);
    const page = response.meta?.page;
    const missingContinuation = page?.hasMore && (!page.nextCursor || typeof page.nextCursor !== 'string' || page.nextCursor === options.after);
    if (!Array.isArray(response.data) || typeof page?.hasMore !== 'boolean' || page.offset !== undefined || missingContinuation) {
        throw createSafeError({ statusCode: 502, message: 'errors.server.drupalRequestFailed' });
    }
    const applications = response.data;
    return {
        applications,
        events: Object.fromEntries(applications.map(application => [
            application.id, normalizeApplicationEvents(response.meta?.events?.[application.id])
        ])),
        workflowStatuses: response.meta?.workflowStatuses ?? [],
        truncated: false,
        page: {
            limit: page.limit ?? options.limit,
            hasMore: page.hasMore,
            ...(page.hasMore && { nextCursor: page.nextCursor })
        }
    };
}

/**
 * Per-form maps of GET /api/v1/staff/applications/counts used by the admin
 * start page (the response also carries total and per-flow figures).
 */
export interface StaffApplicationCounts {
    /** Visible applications per form UUID; a missing key means 0. */
    applicationsByForm: Record<string, number>
    /** Number of visible form groups (flows) per form UUID. */
    formGroupsByForm: Record<string, number>
}

export interface StaffReportBucket {
    key: string
    label: string
    count: number
}

export interface StaffReportFormBucket extends StaffReportBucket {
    averageProcessingHours: number | null
    followUpCount: number
}

/** `data` of GET /api/v1/staff/applications/report. */
export interface StaffApplicationReport {
    totals?: {
        applications?: number
        completed?: number
        open?: number
        followUps?: number
        averageProcessingHours?: number | null
        medianProcessingHours?: number | null
    }
    deadlines?: {
        overdue?: number
        dueToday?: number
        dueSoon?: number
        today?: string
        horizonDays?: number
    }
    byStatus?: Array<StaffReportBucket & { color?: string | null, completed?: boolean }>
    byForm?: StaffReportFormBucket[]
    byDay?: Array<{ date: string, count: number }>
}

export interface StaffApplicationReportFilters {
    formId?: string | null
    /** Inclusive lower bound on `created`, ISO 8601 with offset. */
    from?: string | null
    /** Inclusive upper bound on `created`, ISO 8601 with offset. */
    to?: string | null
}

// Drupal serializes an empty PHP map as `[]`; the routes promise an object.
function countMap(value: unknown): Record<string, number> {
    if (Array.isArray(value) && value.length === 0) return {};
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || !Object.values(value).every(count => Number.isSafeInteger(count) && count >= 0)) {
        throw new Error('Invalid staff application count map');
    }
    return value as Record<string, number>;
}

/**
 * Counts the applications visible in the workspace per form and form group,
 * aggregated in Drupal under the staff list's visibility rules.
 */
export async function fetchStaffApplicationCounts(
    event: H3Event,
    workspace: StaffWorkspaceScope
): Promise<StaffApplicationCounts> {
    const params = staffWorkspaceParams(workspace);
    const response = await drupalSessionFetch<{ data?: Partial<Record<keyof StaffApplicationCounts, unknown>> }>(
        event,
        `/api/v1/staff/applications/counts?${params.toString()}`
    );
    return {
        applicationsByForm: countMap(response.data?.applicationsByForm),
        formGroupsByForm: countMap(response.data?.formGroupsByForm)
    };
}

/**
 * Loads the report figures for the applications visible in the workspace,
 * aggregated in Drupal (no row limit).
 */
export async function fetchStaffApplicationReport(
    event: H3Event,
    workspace: StaffWorkspaceScope,
    filters: StaffApplicationReportFilters = {}
): Promise<StaffApplicationReport> {
    const params = staffWorkspaceParams(workspace);
    if (filters.formId) {
        params.set('form', filters.formId);
    }
    if (filters.from) {
        params.set('from', filters.from);
    }
    if (filters.to) {
        params.set('to', filters.to);
    }
    const response = await drupalSessionFetch<{ data?: StaffApplicationReport }>(
        event,
        `/api/v1/staff/applications/report?${params.toString()}`
    );
    return response.data || {};
}
