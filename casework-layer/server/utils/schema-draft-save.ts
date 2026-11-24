/**
 * Shared draft save of a form schema.
 *
 * Extracted from PATCH /api/admin/schemas/:id without a change in behaviour:
 * the editor keeps its `expectedChanged` check in Nitro; the guided setup
 * passes `expectedRevisionId`, which Drupal checks under a row lock through
 * the X-Beantragt-Expected-Revision header.
 */
import type { H3Event } from 'h3';
import type { FormSchema } from '~~/app/types/form';
import { normalizeFormSchema, parseStoredFormSchema } from '~~/app/utils/form-schema';
import { stripCompareWith } from '../../app/utils/schema-structure';
import { reconcileStoredSchemaRootId } from '~~/server/utils/schema-root-id';

type PrepareDraft = (event: H3Event, id: string, schema: FormSchema) => Promise<FormSchema>;
let prepareDraft: PrepareDraft | undefined;

export function registerSchemaDraftPreparation(prepare: PrepareDraft): () => void {
    if (prepareDraft) return () => {};
    prepareDraft = prepare;
    return () => {
        prepareDraft = undefined;
    };
}

function retainStoredProSettings(schema: FormSchema, raw: CurrentSchemaMetadata['storedSchema'], id: string): FormSchema {
    const serialized = typeof raw === 'string' ? raw : raw?.value;
    const stored = serialized ? parseStoredFormSchema(serialized, id) : undefined;
    // Drafts can move a field between sections. The persisted field id keeps
    // its analysis settings even if the rest of that field was edited.
    const analyses = new Map(stored?.sections.flatMap(section => section.fields.map(field => [field.id, field.analysis] as const)));
    const fields = new Set(schema.sections.flatMap(section => section.fields.map(field => field.id)));
    const removed = new Set([...analyses.keys()].filter(fieldId => !fields.has(fieldId)));
    const next = {
        ...schema,
        sections: schema.sections.map(section => ({
            ...section,
            fields: section.fields.map((field) => {
                const existing = { ...field };
                const analysis = analyses.get(field.id);
                if (analysis) {
                    const resultSchema = analysis.resultSchema;
                    existing.analysis = resultSchema
                        ? { ...analysis, resultSchema: stripCompareWith(resultSchema, removed) }
                        : analysis;
                } else {
                    delete existing.analysis;
                }
                return existing;
            })
        }))
    };
    if (stored?.contextSources) next.contextSources = stored.contextSources;
    else delete next.contextSources;
    if (stored?.precheckSchema) {
        next.precheckSchema = {
            ...stored.precheckSchema,
            criteria: stored.precheckSchema.criteria.map(criterion => criterion.fieldId && !fields.has(criterion.fieldId)
                ? { ...criterion, fieldId: undefined, reviewStatus: 'suggested' }
                : criterion)
        };
    } else {
        delete next.precheckSchema;
    }
    return normalizeFormSchema(next);
}

interface FormSchemaChangedResponse {
    data?: Array<{
        attributes?: {
            changed?: string
            field_workflow_status?: string
            field_schema?: string | { value?: string }
        }
    }>
}

interface CurrentSchemaMetadata {
    changed: string | null
    workflowStatus: string
    storedSchema?: string | { value?: string }
}

export interface SchemaDraftSaveOptions {
    /** Editor: compare Drupal `changed` before saving (409 modifiedInOtherTab). */
    expectedChanged?: string | null
    /** Guided setup: Drupal compares the current revision under a row lock. */
    expectedRevisionId?: number
    publicationScope?: string
    /** Only acted on when present; empty string clears the override. */
    referencePattern?: string
}

export interface SchemaDraftSaveResult {
    changed: string | null
    /** The server-canonical schema after workspace-scoped source validation. */
    schema: FormSchema
    /**
     * Revision this PATCH created, from the JSON:API response; null when the
     * response does not carry one. The guided setup binds its decisions to it.
     */
    revisionId: number | null
}

interface FormSchemaPatchResponse {
    data?: { attributes?: { drupal_internal__revision_id?: unknown } }
}

function patchedRevisionId(response: unknown): number | null {
    const raw = (response as FormSchemaPatchResponse | null)?.data?.attributes?.drupal_internal__revision_id;
    const revisionId = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+$/u.test(raw) ? Number(raw) : NaN;
    return Number.isSafeInteger(revisionId) && revisionId > 0 ? revisionId : null;
}

async function loadCurrentSchemaMetadata(event: H3Event, id: string): Promise<CurrentSchemaMetadata> {
    const query = new URLSearchParams({
        'filter[id]': id,
        'fields[form_schema--form_schema]': 'changed,field_workflow_status,field_schema',
        'page[limit]': '1'
    });
    await applyAdminJurisdictionFilter(event, query);

    const response = await drupalSessionFetch<FormSchemaChangedResponse>(
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
        changed: schema.attributes?.changed ?? null,
        workflowStatus: schema.attributes?.field_workflow_status || 'draft',
        storedSchema: schema.attributes?.field_schema
    };
}

/**
 * Saves a normalised schema as the new draft revision. Error behaviour is the
 * editor's: 404 and 409 pass through, everything else becomes
 * `errors.schema.saveFailed` with the upstream status.
 */
export async function saveSchemaDraft(
    event: H3Event,
    id: string,
    schema: FormSchema,
    options: SchemaDraftSaveOptions = {}
): Promise<SchemaDraftSaveResult> {
    let normalizedSchema = schema;
    try {
        const currentSchema = await loadCurrentSchemaMetadata(event, id);
        if (currentSchema.workflowStatus === 'published') {
            throw createSafeError({
                statusCode: 409,
                message: 'errors.schema.publishedEditForbidden',
                data: { code: 'errors.schema.publishedEditForbidden' }
            });
        }

        if (options.expectedChanged) {
            if (currentSchema.changed && currentSchema.changed !== options.expectedChanged) {
                throw createSafeError({
                    statusCode: 409,
                    message: 'errors.schema.modifiedInOtherTab',
                    data: { code: 'errors.schema.modifiedInOtherTab' }
                });
            }
        }

        normalizedSchema = reconcileStoredSchemaRootId(normalizedSchema, id, currentSchema.storedSchema);
        normalizedSchema = prepareDraft
            ? await prepareDraft(event, id, normalizedSchema)
            : retainStoredProSettings(normalizedSchema, currentSchema.storedSchema, id);

        const attributes: {
            label: string
            field_description: string
            field_schema: string
            field_publication_scope?: string
            field_reference_pattern?: string | null
        } = {
            label: normalizedSchema.title,
            field_description: normalizedSchema.description || '',
            field_schema: JSON.stringify(normalizedSchema)
        };
        if (options.publicationScope) {
            attributes.field_publication_scope = options.publicationScope;
        }
        if (options.referencePattern !== undefined) {
            // Empty string clears the override -> org pattern fallback.
            attributes.field_reference_pattern = options.referencePattern || null;
        }

        const patched = await drupalSessionFetch<FormSchemaPatchResponse>(
            event,
            `/jsonapi/form_schema/form_schema/${id}`,
            {
                method: 'PATCH',
                body: {
                    data: {
                        type: 'form_schema--form_schema',
                        id,
                        attributes
                    }
                },
                ...(options.expectedRevisionId !== undefined ? { expectedRevisionId: options.expectedRevisionId } : {})
            }
        );

        return {
            changed: (await loadCurrentSchemaMetadata(event, id)).changed,
            // Autosaves must adopt this schema too, otherwise a document
            // deleted between the editor's list request and PATCH could remain
            // selected in the browser and be sent again on the next save.
            schema: normalizedSchema,
            revisionId: patchedRevisionId(patched)
        };
    } catch (e: unknown) {
        const statusCode = (e as { statusCode?: number })?.statusCode;
        if (statusCode === 409 || statusCode === 404) {
            throw e;
        }

        console.error(`[admin] Failed to update schema ${id}:`, e instanceof Error ? e.message : e);
        const upstreamData = (e as { data?: { detail?: unknown, upstreamCode?: unknown } })?.data;
        throw createSafeError({
            statusCode: statusCode || 500,
            message: 'errors.schema.saveFailed',
            data: {
                code: 'errors.schema.saveFailed',
                ...(typeof upstreamData?.upstreamCode === 'string' ? { upstreamCode: upstreamData.upstreamCode } : {}),
                ...(typeof upstreamData?.detail === 'string' ? { detail: upstreamData.detail } : {})
            }
        });
    }
}
