/**
 * PATCH /api/admin/applications/:id/data
 *
 * Updates submitted application data through the Drupal application data
 * controller. Drupal remains responsible for entity access, CRM extraction,
 * validation and creating the new revision.
 */
import { sameChangedTimestamp } from '~~/casework-layer/server/utils/application-concurrency';

import {
    applicationEditEntryColumnIds,
    applicationEditEntrySections,
    collectApplicationEditValidationIssues,
    collectEntryHiddenElementViolations,
    createApplicationEditVisibilityPredicate,
    parseDrupalRefusal,
    refusalReasonOfIssue,
    type ApplicationEditHiddenElementViolation,
    type ApplicationEditRefusal,
    type ApplicationEditRefusalReason,
    type ApplicationEditValidationIssue
} from '~~/casework-layer/app/utils/application-edit-data';
import { parseStoredFormSchema } from '~~/app/utils/form-schema';
import {
    DATA_EDIT_REASON_REQUIRED,
    DATA_EDIT_REASON_TOO_LONG,
    DATA_EDIT_TRANSFER_LOCKED
} from '~~/casework-layer/app/utils/application-data-corrections';

function parseJsonObject(raw: unknown): Record<string, unknown> {
    if (typeof raw !== 'string' || raw.trim() === '') return {};
    try {
        const parsed = JSON.parse(raw) as unknown;
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed as Record<string, unknown>
            : {};
    } catch {
        return {};
    }
}

function stableJson(value: unknown): string {
    return JSON.stringify(value);
}

const PROTECTED_DATA_CODE = 'errors.applications.protectedDataPermissionRequired';
const SCHEMA_NOT_ACCESSIBLE_CODE = 'errors.applications.schemaNotAccessible';
const EDIT_NOT_ALLOWED_CODE = 'errors.applications.dataEditNotAllowed';
/**
 * 403 reasons this proxy names itself. Any other 403 keeps the former answer;
 * a rights or scope problem is never reported as invalid data.
 */
const OWN_FORBIDDEN_CODES = new Set([PROTECTED_DATA_CODE, SCHEMA_NOT_ACCESSIBLE_CODE, EDIT_NOT_ALLOWED_CODE]);

function forbidden(code: string) {
    return createSafeError({ statusCode: 403, message: code, data: { code } });
}

/**
 * Refusals that name what was refused: the field by its label from the schema (never the id, never a value),
 * the reason, and for an entry of a repeatable section the section and a one-based entry number. The proxy's
 * own check and Drupal's bare messages (read back by `parseDrupalRefusal`) answer with the same codes, so the
 * person reads the same sentence whichever side refuses; the page places it at the field.
 */
const SAVE_REFUSED_CODE = 'errors.applications.saveRefused';
const REFUSAL_CODES = new Set([
    'errors.applications.entryCount',
    'errors.applications.entryColumn',
    'errors.applications.entryRefused',
    'errors.applications.fieldRefused',
    'errors.applications.unknownField',
    SAVE_REFUSED_CODE
]);
/** 422 answers this route gives itself; any other 422 (Drupal's own) becomes a refusal sentence, never "try later". */
const OWN_422_CODES = new Set([...REFUSAL_CODES, 'errors.applications.dataInvalid']);
const REFUSAL_PARAMS = ['section', 'sectionId', 'label', 'field', 'reason', 'number', 'expected'];

function refusalCode(refusal: ApplicationEditRefusal): string {
    if (refusal.kind === 'entryCount' || refusal.kind === 'entryColumn') return `errors.applications.${refusal.kind}`;
    if (refusal.kind === 'unknownField') return 'errors.applications.unknownField';
    return refusal.kind === 'field' && refusal.number !== undefined ? 'errors.applications.entryRefused' : 'errors.applications.fieldRefused';
}

function refused(refusal: ApplicationEditRefusal) {
    const code = refusalCode(refusal);
    const data: Record<string, unknown> = { code };
    for (const [key, value] of Object.entries(refusal)) {
        if (REFUSAL_PARAMS.includes(key) && value !== undefined) data[key] = value;
    }
    return createSafeError({ statusCode: 422, message: code, data });
}

function firstEntryRefusal(issues: ApplicationEditValidationIssue[], hidden: ApplicationEditHiddenElementViolation[], sectionOf: (fieldId: string) => { id: string, title: string }): ApplicationEditRefusal | null {
    for (const { field, issue, entry } of issues) {
        if (issue.code === 'entryCount' || issue.code === 'entryColumn') {
            const section = sectionOf(field.id);
            return { kind: issue.code, sectionId: section.id, section: section.title, field: field.id, label: field.label, expected: issue.expected };
        }
        if (entry) {
            return { kind: 'field', field: field.id, label: field.label, reason: refusalReasonOfIssue(field, issue.code), sectionId: entry.sectionId, section: entry.sectionTitle, number: entry.index + 1 };
        }
    }
    const violation = hidden[0];
    return violation
        ? { kind: 'field', field: violation.field.id, label: violation.field.label, reason: 'hidden', sectionId: violation.entry.sectionId, section: violation.entry.sectionTitle, number: violation.entry.index + 1 }
        : null;
}

export default defineEventHandler(async (event) => {
    await requireStaff(event);
    requireSameOriginRequest(event);
    setPrivateNoStore(event);

    const id = getRouterParam(event, 'id');
    if (!id) {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.applications.idMissing',
            data: { code: 'errors.applications.idMissing' }
        });
    }
    validateUuid(id, 'applicationId');

    const body = await readBody<{
        data?: unknown
        expectedChanged?: string
        reason?: unknown
    }>(event);

    if (!body || !body.data || typeof body.data !== 'object' || Array.isArray(body.data)) {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.applications.dataInvalid',
            data: { code: 'errors.applications.dataInvalid' }
        });
    }
    if (typeof body.expectedChanged !== 'string' || body.expectedChanged === '') {
        throw createSafeError({
            statusCode: 428,
            message: 'errors.applications.dataConflict',
            data: { code: 'errors.applications.dataConflict' }
        });
    }

    const serialized = JSON.stringify(body.data);
    if (serialized.length > 1_048_576) {
        throw createSafeError({
            statusCode: 413,
            message: 'errors.applications.dataTooLarge',
            data: { code: 'errors.applications.dataTooLarge' }
        });
    }

    try {
        const scopeQuery = new URLSearchParams({
            'filter[id]': id,
            'include': 'field_schema',
            'fields[application--application]': 'drupal_internal__id,changed,field_schema,field_origin',
            'fields[form_schema--form_schema]': 'field_schema',
            'page[limit]': '1'
        });
        await applyAdminJurisdictionFilter(event, scopeQuery, 'field_jurisdiction', { required: true });

        const scopedResponse = await drupalSessionFetch<{
            data?: Array<{
                relationships?: {
                    field_schema?: {
                        data?: { id: string } | null
                    }
                }
                attributes?: {
                    drupal_internal__id?: number | string
                    changed?: string
                    field_origin?: string | null
                }
            }>
            included?: Array<{
                type?: string
                id?: string
                attributes?: {
                    field_schema?: string | { value?: string } | null
                }
            }>
        }>(
            event,
            `/jsonapi/application/application?${scopeQuery.toString()}`
        );

        const current = scopedResponse.data?.[0];
        if (!current) {
            throw createSafeError({
                statusCode: 404,
                message: 'errors.applications.notFound',
                data: { code: 'errors.applications.notFound' }
            });
        }

        const currentChanged = current.attributes?.changed ?? '';
        if (!sameChangedTimestamp(currentChanged, body.expectedChanged)) {
            throw createSafeError({
                statusCode: 409,
                message: 'errors.applications.dataConflict',
                data: { code: 'errors.applications.dataConflict' }
            });
        }

        const internalId = Number(current.attributes?.drupal_internal__id);
        if (!Number.isInteger(internalId) || internalId <= 0) {
            throw createSafeError({
                statusCode: 502,
                message: 'errors.server.drupalRequestFailed',
                data: { code: 'errors.server.drupalRequestFailed' }
            });
        }

        // A refused read of the stored data is the protected-data right (Drupal
        // `protectedDataAccess`), so its 403 keeps that reason.
        const protectedData = await drupalSessionFetch<{
            data?: Record<string, unknown>
            meta?: {
                protected_data_redacted?: boolean
                /** The schema revision the application is pinned to (Drupal `applicationSchemaMeta`). */
                schema?: {
                    id?: string
                    type?: string
                    attributes?: { field_schema?: string | { value?: string | null } | null }
                } | null
            }
        }>(
            event,
            `/api/admin/applications/${internalId}/data`
        ).catch((error: unknown) => {
            throw (error as { statusCode?: number })?.statusCode === 403 ? forbidden(PROTECTED_DATA_CODE) : error;
        });
        if (protectedData.meta?.protected_data_redacted === true) {
            throw forbidden(PROTECTED_DATA_CODE);
        }

        const schemaId = current.relationships?.field_schema?.data?.id;
        const schemaResource = scopedResponse.included?.find(resource =>
            resource.type === 'form_schema--form_schema' && resource.id === schemaId
        );
        const rawSchema = schemaResource?.attributes?.field_schema;
        const rawSchemaValue = typeof rawSchema === 'string' ? rawSchema : rawSchema?.value;
        if (!rawSchemaValue) {
            // JSON:API leaves out an included resource the session may not view
            // (for example a form without organisation, or an unpublished one), and
            // may give no relationship at all. Either way it is the account's scope,
            // not the data: the page itself shows the schema. A schema that
            // came back without content stays a data problem.
            if (!schemaResource) throw forbidden(SCHEMA_NOT_ACCESSIBLE_CODE);
            throw createSafeError({
                statusCode: 422,
                message: 'errors.applications.dataInvalid',
                data: { code: 'errors.applications.dataInvalid' }
            });
        }

        // The scope checks above stay on the form (the include). The check below uses the schema revision the
        // application is pinned to, as the page and Drupal do, so a form saved with a changed schema after the
        // application came in does not refuse its edit. Without a revision named by the data route the
        // form's current schema stays the fallback.
        const pinnedSchema = protectedData.meta?.schema?.type === 'form_schema--form_schema' ? protectedData.meta.schema : null;
        const pinnedRaw = pinnedSchema?.attributes?.field_schema;
        const pinnedSchemaValue = typeof pinnedRaw === 'string' ? pinnedRaw : pinnedRaw?.value;
        const formSchema = pinnedSchemaValue
            ? parseStoredFormSchema(pinnedSchemaValue, pinnedSchema?.id ?? schemaId)
            : parseStoredFormSchema(rawSchemaValue, schemaId);
        const editedData = body.data as Record<string, unknown>;
        const originalData = protectedData.data && typeof protectedData.data === 'object'
            ? protectedData.data
            : parseJsonObject('');
        // Entry columns (Rule U): origin and stored data as read from Drupal above, never from the request body.
        const origin = typeof current.attributes?.field_origin === 'string' ? current.attributes.field_origin : null;
        const entryColumnIds = applicationEditEntryColumnIds(applicationEditEntrySections(formSchema, originalData, origin));
        const visible = createApplicationEditVisibilityPredicate(formSchema, editedData, entryColumnIds);
        const originallyVisible = createApplicationEditVisibilityPredicate(formSchema, originalData, entryColumnIds);
        const validationIssues = collectApplicationEditValidationIssues(formSchema, editedData, visible, originalData, origin);
        const hiddenElementViolations = collectEntryHiddenElementViolations(formSchema, originalData, editedData, origin);
        const sectionOf = (fieldId: string) => {
            const section = formSchema.sections.find(item => item.fields.some(field => field.id === fieldId));
            return { id: section?.id ?? '', title: section?.title ?? '' };
        };
        const entryRefusal = firstEntryRefusal(validationIssues, hiddenElementViolations, sectionOf);
        if (entryRefusal) throw refused(entryRefusal);
        // A flat field is named too (section and field by their titles, the reason), as Drupal's flat refusals
        // are read back: the clerk sees which field, never "Antragsdaten sind ungültig" without one.
        const flatRefusal = (field: { id: string, label: string }, reason: ApplicationEditRefusalReason) => {
            const section = sectionOf(field.id);
            return refused({ kind: 'field', field: field.id, label: field.label, reason, sectionId: section.id, section: section.title });
        };
        const firstFlatIssue = validationIssues[0];
        if (firstFlatIssue) {
            throw flatRefusal(firstFlatIssue.field, refusalReasonOfIssue(firstFlatIssue.field, firstFlatIssue.issue.code));
        }

        const schemaFieldIds = new Set(formSchema.sections.flatMap(section =>
            section.fields.map(field => field.id)
        ));
        for (const section of formSchema.sections) {
            for (const field of section.fields) {
                if (visible(field.id)) continue;
                if (!Object.prototype.hasOwnProperty.call(editedData, field.id)) {
                    if (
                        !originallyVisible(field.id)
                        && Object.prototype.hasOwnProperty.call(originalData, field.id)
                    ) {
                        throw flatRefusal(field, 'hidden');
                    }
                    continue;
                }
                if (
                    !originallyVisible(field.id)
                    && Object.prototype.hasOwnProperty.call(originalData, field.id)
                    && stableJson(originalData[field.id]) === stableJson(editedData[field.id])
                ) {
                    continue;
                }
                throw flatRefusal(field, 'hidden');
            }
        }
        for (const key of Object.keys(originalData)) {
            if (schemaFieldIds.has(key)) continue;
            if (!Object.prototype.hasOwnProperty.call(editedData, key)) {
                throw createSafeError({
                    statusCode: 422,
                    message: 'errors.applications.dataInvalid',
                    data: { code: 'errors.applications.dataInvalid' }
                });
            }
        }
        for (const [key, value] of Object.entries(editedData)) {
            if (schemaFieldIds.has(key)) continue;
            if (!Object.prototype.hasOwnProperty.call(originalData, key) || stableJson(originalData[key]) !== stableJson(value)) {
                throw createSafeError({
                    statusCode: 422,
                    message: 'errors.applications.dataInvalid',
                    data: { code: 'errors.applications.dataInvalid' }
                });
            }
        }

        // Drupal refuses the save with 403 for a missing `edit application data
        // entities`, missing protected-data view on sensitive fields, or a scope the
        // account does not administer (ApplicationDataController::access). The
        // answer therefore says only that this account may not change the data.
        return await drupalSessionFetch(event, `/api/admin/applications/${internalId}/data`, {
            method: 'PATCH',
            body: {
                data: body.data,
                expected_changed: body.expectedChanged,
                reason: body.reason
            }
        }).catch((error: unknown) => {
            if ((error as { statusCode?: number })?.statusCode === 403) throw forbidden(EDIT_NOT_ALLOWED_CODE);
            // Backstop: Drupal refuses with 422, no code and a message with ids only. Read it back into the field
            // and reason; a message we do not know still says the data were refused and nothing changed.
            if ((error as { statusCode?: number })?.statusCode !== 422) throw error;
            const detail = (error as { data?: { detail?: unknown } })?.data?.detail;
            const refusal = typeof detail === 'string' ? parseDrupalRefusal(formSchema, detail) : null;
            throw refusal
                ? refused(refusal)
                : createSafeError({ statusCode: 422, message: SAVE_REFUSED_CODE, data: { code: SAVE_REFUSED_CODE } });
        });
    } catch (e: unknown) {
        const failure = e as { statusCode?: number, data?: { upstreamCode?: unknown, code?: unknown } } | undefined;
        const upstream = failure?.statusCode;
        const upstreamCode = failure?.data?.upstreamCode;
        if ((upstream === 400 && (upstreamCode === DATA_EDIT_REASON_REQUIRED || upstreamCode === DATA_EDIT_REASON_TOO_LONG))
          || (upstream === 409 && upstreamCode === DATA_EDIT_TRANSFER_LOCKED)) {
            throw createSafeError({ statusCode: upstream, message: upstreamCode, data: { code: upstreamCode } });
        }
        console.error(`[admin] Failed to update application ${id} data:`, e instanceof Error ? e.message : e);
        const errorData = (e as { data?: { code?: unknown }, message?: string })?.data;
        const thrownCode = typeof errorData?.code === 'string'
            ? errorData.code
            : typeof (e as { message?: string })?.message === 'string' && (e as { message: string }).message.startsWith('errors.')
                ? (e as { message: string }).message
                : undefined;
        const mappedCode = upstream === 409 || upstream === 428
            ? 'errors.applications.dataConflict'
            : upstream === 404
                ? 'errors.applications.notFound'
                : upstream === 403
                    ? (thrownCode && OWN_FORBIDDEN_CODES.has(thrownCode) ? thrownCode : PROTECTED_DATA_CODE)
                    : upstream === 422
                        ? (thrownCode && OWN_422_CODES.has(thrownCode) ? thrownCode : SAVE_REFUSED_CODE)
                        : 'errors.applications.updateFailed';
        // 423: a running transfer holds the case; nothing was stored.
        const code = upstream === 423 ? 'errors.applications.dataBusy' : mappedCode;
        // Refusals keep their field, label, reason, section and entry number for the sentence.
        const entryParams = upstream === 422 && REFUSAL_CODES.has(code) && errorData && typeof errorData === 'object'
            ? Object.fromEntries(Object.entries(errorData as Record<string, unknown>).filter(([key]) => REFUSAL_PARAMS.includes(key)))
            : {};
        throw createSafeError({
            statusCode: upstream === 400 || upstream === 404 || upstream === 409 || upstream === 413 || upstream === 422 || upstream === 403 || upstream === 423 || upstream === 428 ? upstream : 500,
            message: code,
            data: { code, ...entryParams }
        });
    }
});
