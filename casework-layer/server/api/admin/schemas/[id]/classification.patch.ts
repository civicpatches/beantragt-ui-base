import { defineEventHandler, getRouterParam, type H3Event } from 'h3';
import { z } from 'zod';
import { FORM_FIELD_PRIVACY_KINDS, type FormSchema } from '~~/app/types/form';
import { isHighRiskPrivacyKind } from '~~/app/utils/form-schema';
import { requireAdmin, drupalSessionFetch } from '~~/server/utils/auth';
import { createSafeError } from '~~/server/utils/error-handling';
import { preservePrivateNoStore } from '~~/server/utils/preserve-private-no-store';
import { checkRateLimit, getClientIp } from '~~/server/utils/rate-limit';
import { requireSameOriginRequest, setPrivateNoStore } from '~~/server/utils/request-security';
import { validateUuid } from '~~/server/utils/validation';
import { classificationFieldKey, needsClassification, type DraftClassificationReview } from '~~/casework-layer/shared/schema-classification';
import { applyAdminJurisdictionFilter } from '~~/casework-layer/server/utils/admin-workspace';
import { formCreateError, normalizeFormCreateError, writeFormResourceAsSession } from '~~/casework-layer/server/utils/form-create';
import { readSchemaRequestJson } from '~~/casework-layer/server/utils/schema-file-import';
import { assessSchemaPublishable, draftClassificationReview, storedSchemaText, type StoredSchemaValue } from '~~/casework-layer/server/utils/schema-publish-check';

const CLASSIFICATION_REQUEST = z.strictObject({
    expectedRevision: z.int().positive(),
    choices: z.array(z.strictObject({
        sectionIndex: z.int().nonnegative(),
        fieldIndex: z.int().nonnegative(),
        kind: z.enum(FORM_FIELD_PRIVACY_KINDS),
        sensitive: z.literal(true).optional()
    })).nonempty()
});

interface DraftAttributes {
    field_schema?: StoredSchemaValue
    field_workflow_status?: string
    drupal_internal__revision_id?: number | string
    status?: boolean
}

async function readScopedDraft(event: H3Event, id: string): Promise<DraftAttributes> {
    const query = new URLSearchParams({
        'filter[id]': id,
        'fields[form_schema--form_schema]': 'field_schema,field_workflow_status,drupal_internal__revision_id,status',
        'page[limit]': '1'
    });
    await applyAdminJurisdictionFilter(event, query);
    const response = await drupalSessionFetch<{ data?: Array<{ attributes?: DraftAttributes }> }>(
        event,
        `/jsonapi/form_schema/form_schema?${query.toString()}`
    );
    const attributes = response?.data?.[0]?.attributes;
    if (!attributes) throw formCreateError(404, 'errors.schema.notFound');
    return attributes;
}

export default defineEventHandler(async (event): Promise<{ classification: DraftClassificationReview | null }> => {
    setPrivateNoStore(event);
    preservePrivateNoStore(event);
    requireSameOriginRequest(event);
    checkRateLimit(getClientIp(event), 'admin', event);
    await requireAdmin(event);
    const id = getRouterParam(event, 'id');
    if (!id) throw formCreateError(400, 'errors.schema.idRequired');
    validateUuid(id, 'schemaId');

    const result = CLASSIFICATION_REQUEST.safeParse(await readSchemaRequestJson(event));
    if (!result.success) throw formCreateError(400, 'errors.schema.invalid');
    const { expectedRevision, choices } = result.data;
    const current = await readScopedDraft(event, id);
    if (Number(current.drupal_internal__revision_id) !== expectedRevision) {
        throw formCreateError(409, 'errors.schema.modifiedInOtherTab');
    }
    if (current.field_workflow_status !== 'draft' || current.status !== false) {
        throw formCreateError(409, 'errors.schema.classificationDraftRequired');
    }

    const assessment = assessSchemaPublishable(current.field_schema);
    if (!assessment.schema) throw formCreateError(422, 'errors.schema.formInvalid');
    const targets = new Map(draftClassificationReview(assessment).fields.filter(needsClassification)
        .map(field => [classificationFieldKey(field), field]));
    if (targets.size !== choices.length) throw formCreateError(400, 'errors.schema.classificationIncomplete');

    // The check normalizes a copy without moving sections or fields. Write only the
    // confirmed properties at those positions in the original stored definition.
    const definition = JSON.parse(storedSchemaText(current.field_schema)) as FormSchema;
    for (const choice of choices) {
        const key = classificationFieldKey(choice);
        const target = targets.get(key);
        if (!target) throw formCreateError(400, 'errors.schema.classificationIncomplete');
        targets.delete(key);
        const requiresProtection = !target.protected && (target.highRisk || isHighRiskPrivacyKind(choice.kind));
        if (Boolean(choice.sensitive) !== requiresProtection) throw formCreateError(400, 'errors.schema.classificationIncomplete');
        const field = definition.sections[target.sectionIndex]!.fields[target.fieldIndex]!;
        if (!field || typeof field !== 'object' || Array.isArray(field)) throw formCreateError(422, 'errors.schema.formInvalid');
        field.privacy = { ...field.privacy, kind: choice.kind };
        if (choice.sensitive) field.sensitive = true;
    }

    const updated = JSON.stringify(definition);
    const checked = draftClassificationReview(assessSchemaPublishable(updated));
    const unresolved = checked.fields.filter(needsClassification);
    if (unresolved.length) {
        throw createSafeError({
            statusCode: 422,
            message: 'errors.schema.classificationUnresolved',
            data: { code: 'errors.schema.classificationUnresolved', classification: { publishable: false, fields: unresolved } }
        });
    }

    let saved: { data?: { attributes?: DraftAttributes } } | undefined;
    try {
        saved = await writeFormResourceAsSession(event, `/jsonapi/form_schema/form_schema/${id}`, {
            method: 'PATCH',
            expectedRevisionId: expectedRevision,
            body: {
                data: {
                    type: 'form_schema--form_schema',
                    id,
                    attributes: { field_schema: updated }
                }
            }
        });
    } catch (error: unknown) {
        const status = (error as { statusCode?: number })?.statusCode;
        if (status !== 401 && status !== 403) {
            const latest = await readScopedDraft(event, id).catch(() => null);
            if (latest && Number(latest.drupal_internal__revision_id) !== expectedRevision) {
                throw formCreateError(409, 'errors.schema.modifiedInOtherTab');
            }
        }
        throw normalizeFormCreateError(error, 'errors.schema.classificationFailed', {
            includeSchemaRefusal: false,
            forbiddenCode: 'errors.schema.classificationForbidden'
        });
    }

    const savedSchema = saved?.data?.attributes?.field_schema
      ?? (await readScopedDraft(event, id).catch(() => null))?.field_schema;
    const verified = assessSchemaPublishable(savedSchema);
    return { classification: verified.schema ? draftClassificationReview(verified) : null };
});
