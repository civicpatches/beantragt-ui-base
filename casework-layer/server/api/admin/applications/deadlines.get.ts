import { setPrivateNoStore } from '~~/server/utils/request-security';
import { resolveRequiredAdminWorkspace } from '~~/casework-layer/server/utils/admin-workspace';

interface JsonApiRelationship {
    data?: { id?: string, type?: string } | Array<{ id?: string, type?: string }> | null
}

interface JsonApiResource {
    id?: string
    type?: string
    attributes?: Record<string, unknown>
    relationships?: Record<string, JsonApiRelationship>
}

interface JsonApiPageResponse {
    data?: JsonApiResource[]
    included?: unknown[]
    links?: {
        next?: { href?: string } | string | null
    }
}

type JsonApiNextLink = { href?: string } | string | null | undefined;

type DeadlineBucket = 'overdue' | 'today' | 'soon';

interface DeadlineReminder {
    id: string
    referenceNumber: string | null
    formLabel: string
    statusKey: string
    statusLabel: string
    statusColor: string | null
    dueDate: string
    bucket: DeadlineBucket
    daysDelta: number
}

const APPLICATION_PAGE_CAP = 500;
const PAGE_LIMIT = 100;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const DEFAULT_HORIZON_DAYS = 7;
const MAX_HORIZON_DAYS = 30;
const REPORT_TIME_ZONE = 'Europe/Berlin';
const COMPLETED_FLAGS = new Set(['approved', 'rejected', 'closed', 'withdrawn']);

function stringValue(value: unknown): string | null {
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function integerQueryValue(value: unknown, fallback: number, min: number, max: number): number {
    const raw = Array.isArray(value) ? value[0] : value;
    const parsed = typeof raw === 'string' || typeof raw === 'number' ? Number(raw) : NaN;
    if (!Number.isInteger(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
}

function dateOnlyValue(value: unknown): string | null {
    const raw = stringValue(value);
    if (!raw || !/^\d{4}-\d{2}-\d{2}$/u.test(raw)) return null;
    const timestamp = Date.parse(`${raw}T00:00:00Z`);
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== raw) {
        return null;
    }
    return raw;
}

function zonedDayKey(date: Date, timeZone: string): string {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(date);
    const values = new Map(parts.map(part => [part.type, part.value]));
    return `${values.get('year')}-${values.get('month')}-${values.get('day')}`;
}

function addDays(dayKey: string, days: number): string {
    const timestamp = Date.parse(`${dayKey}T00:00:00Z`);
    return new Date(timestamp + days * 86_400_000).toISOString().slice(0, 10);
}

function daysBetween(fromDay: string, toDay: string): number {
    const from = Date.parse(`${fromDay}T00:00:00Z`);
    const to = Date.parse(`${toDay}T00:00:00Z`);
    return Math.round((to - from) / 86_400_000);
}

function relationshipId(resource: JsonApiResource, field: string): string | null {
    const data = resource.relationships?.[field]?.data;
    if (!data || Array.isArray(data)) return null;
    return data.id || null;
}

function includedMap(included: unknown): Map<string, JsonApiResource> {
    const map = new Map<string, JsonApiResource>();
    if (!Array.isArray(included)) return map;
    for (const item of included) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        const resource = item as JsonApiResource;
        if (resource.type && resource.id) {
            map.set(`${resource.type}:${resource.id}`, resource);
        }
    }
    return map;
}

function semanticFlags(status: JsonApiResource | undefined): string[] {
    const raw = status?.attributes?.field_semantic_flags;
    if (!Array.isArray(raw)) return [];
    return raw
        .map((item): string | null => {
            if (typeof item === 'string') return item;
            if (item && typeof item === 'object' && 'value' in item) {
                return stringValue((item as { value?: unknown }).value);
            }
            return null;
        })
        .filter((value): value is string => !!value);
}

function isCompletedStatus(status: JsonApiResource | undefined): boolean {
    if (status?.attributes?.field_is_terminal === true) return true;
    return semanticFlags(status).some(flag => COMPLETED_FLAGS.has(flag));
}

function statusKey(status: JsonApiResource | undefined, fallback: string): string {
    return stringValue(status?.attributes?.field_machine_name)
      || stringValue(status?.attributes?.label)
      || fallback;
}

function statusLabel(status: JsonApiResource | undefined, fallback: string): string {
    return stringValue(status?.attributes?.label) || fallback;
}

function statusColor(status: JsonApiResource | undefined): string | null {
    return stringValue(status?.attributes?.field_color);
}

function nextOffsetFromLink(link: JsonApiNextLink, fallbackOffset: number): number | null {
    const href = typeof link === 'string' ? link : link?.href;
    if (!href) return null;
    try {
        const url = new URL(href, 'https://beantragt.local');
        const raw = url.searchParams.get('page[offset]');
        const parsed = raw ? Number(raw) : NaN;
        return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallbackOffset;
    } catch {
        return fallbackOffset;
    }
}

function reminderFromApplication(
    item: JsonApiResource,
    includedByKey: Map<string, JsonApiResource>,
    todayKey: string,
    horizonKey: string
): DeadlineReminder | null {
    const dueDate = dateOnlyValue(item.attributes?.field_due_date);
    if (!dueDate || dueDate > horizonKey) return null;

    const statusId = relationshipId(item, 'field_workflow_status') || 'unknown';
    const status = includedByKey.get(`workflow_status--workflow_status:${statusId}`);
    if (isCompletedStatus(status)) return null;

    const schemaId = relationshipId(item, 'field_schema') || 'unknown';
    const schema = includedByKey.get(`form_schema--form_schema:${schemaId}`);
    const daysDelta = daysBetween(todayKey, dueDate);
    const bucket: DeadlineBucket = daysDelta < 0 ? 'overdue' : daysDelta === 0 ? 'today' : 'soon';

    return {
        id: item.id || '',
        referenceNumber: stringValue(item.attributes?.field_reference_number),
        formLabel: stringValue(schema?.attributes?.label) || schemaId,
        statusKey: statusKey(status, statusId),
        statusLabel: statusLabel(status, statusId),
        statusColor: statusColor(status),
        dueDate,
        bucket,
        daysDelta
    };
}

export default defineEventHandler(async (event) => {
    await requireStaff(event);
    setPrivateNoStore(event);

    const query = getQuery(event);
    const workspace = await resolveRequiredAdminWorkspace(event);
    const horizonDays = integerQueryValue(query.horizonDays, DEFAULT_HORIZON_DAYS, 0, MAX_HORIZON_DAYS);
    const limit = integerQueryValue(query.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
    const todayKey = zonedDayKey(new Date(), REPORT_TIME_ZONE);
    const horizonKey = addDays(todayKey, horizonDays);

    const apiQuery = new URLSearchParams({
        'sort': 'field_due_date,created',
        'include': 'field_schema,field_workflow_status',
        'fields[application--application]': 'field_reference_number,created,changed,field_due_date,field_schema,field_workflow_status',
        'fields[form_schema--form_schema]': 'label',
        'fields[workflow_status--workflow_status]': 'label,field_machine_name,field_color,field_is_terminal,field_semantic_flags'
    });
    await applyAdminJurisdictionFilter(event, apiQuery, 'field_jurisdiction', { required: true });
    apiQuery.set('filter[due-to][condition][path]', 'field_due_date');
    apiQuery.set('filter[due-to][condition][operator]', '<=');
    apiQuery.set('filter[due-to][condition][value]', horizonKey);

    try {
        const reminders: DeadlineReminder[] = [];
        const includedByKey = new Map<string, JsonApiResource>();
        let offset = 0;
        let fetched = 0;
        let truncated = false;

        while (fetched < APPLICATION_PAGE_CAP) {
            apiQuery.set('page[limit]', String(PAGE_LIMIT));
            apiQuery.set('page[offset]', String(offset));
            const response = await drupalSessionFetch<JsonApiPageResponse>(
                event,
                `/jsonapi/application/application?${apiQuery.toString()}`
            );

            for (const [key, value] of includedMap(response.included).entries()) {
                includedByKey.set(key, value);
            }

            const data = Array.isArray(response.data) ? response.data : [];
            fetched += data.length;
            for (const item of data) {
                const reminder = reminderFromApplication(item, includedByKey, todayKey, horizonKey);
                if (reminder) {
                    reminders.push(reminder);
                }
            }

            const nextOffset = nextOffsetFromLink(response.links?.next, offset + data.length);
            if (nextOffset === null || data.length === 0) break;
            offset = nextOffset;
            if (fetched >= APPLICATION_PAGE_CAP) {
                truncated = true;
            }
        }

        reminders.sort((a, b) =>
            a.dueDate.localeCompare(b.dueDate)
            || (a.referenceNumber || '').localeCompare(b.referenceNumber || '')
            || a.id.localeCompare(b.id)
        );

        return {
            data: reminders.slice(0, limit),
            meta: {
                count: Math.min(reminders.length, limit),
                total: reminders.length,
                truncated,
                horizonDays,
                limit,
                today: todayKey,
                horizonDate: horizonKey,
                scope: {
                    jurisdictionSlug: workspace.jurisdictionSlug,
                    organisationSlug: workspace.organisationSlug || null
                }
            }
        };
    } catch (e: unknown) {
        const status = (e as { statusCode?: number })?.statusCode || 500;
        throw createSafeError({
            statusCode: status,
            message: 'errors.admin.applicationsLoadFailed',
            data: { code: 'errors.admin.applicationsLoadFailed' }
        });
    }
});
