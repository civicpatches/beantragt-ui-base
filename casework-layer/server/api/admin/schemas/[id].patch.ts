/**
 * PATCH /api/admin/schemas/:id
 *
 * Updates a form_schema via Drupal JSON:API.
 * Requires admin authentication.
 */
import { normalizeFormSchema } from '~~/app/utils/form-schema';
import type { FormSchema } from '~~/app/types/form';
import { saveSchemaDraft } from '~~/casework-layer/server/utils/schema-draft-save';

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;

    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function throwRetentionInvalid(): never {
    throw createSafeError({
        statusCode: 400,
        message: 'errors.schema.retentionInvalid',
        data: { code: 'errors.schema.retentionInvalid' }
    });
}

function validateSchemaRetentionOverride(schema: Record<string, unknown>): void {
    if (!Object.hasOwn(schema, 'retention')) return;

    const retention = schema.retention;
    if (!isPlainRecord(retention)) {
        throwRetentionInvalid();
    }

    const keys = Object.keys(retention);
    if (keys.length !== 1 || keys[0] !== 'dataRetentionDays') {
        throwRetentionInvalid();
    }

    const dataRetentionDays = retention.dataRetentionDays;
    if (typeof dataRetentionDays !== 'number' || !Number.isInteger(dataRetentionDays) || dataRetentionDays < 0) {
        throwRetentionInvalid();
    }
}

export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    requireSameOriginRequest(event);
    setPrivateNoStore(event);

    const id = getRouterParam(event, 'id');

    if (!id) {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.schema.idRequired',
            data: { code: 'errors.schema.idRequired' }
        });
    }

    validateUuid(id, 'schemaId');

    const body = await readBody<{
        schema?: Record<string, unknown> & { title?: string, description?: string, sections?: unknown[] }
        publicationScope?: string
        referencePattern?: string | null
        expectedChanged?: string | null
    }>(event);
    const schema = body.schema;

    if (!schema || typeof schema.title !== 'string' || !Array.isArray(schema.sections)) {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.schema.invalid',
            data: { code: 'errors.schema.invalid' }
        });
    }

    validateSchemaRetentionOverride(schema);

    if (!Object.hasOwn(body, 'expectedChanged')) {
        throw createSafeError({
            statusCode: 428,
            message: 'errors.schema.staleVersionMissing',
            data: { code: 'errors.schema.staleVersionMissing' }
        });
    }

    const normalizedSchema = normalizeFormSchema(schema as FormSchema);
    const allowedPublicationScopes = ['internet', 'intranet'];
    const publicationScope = body.publicationScope;
    if (publicationScope !== undefined && !allowedPublicationScopes.includes(publicationScope)) {
        throw createSafeError({
            statusCode: 400,
            message: 'errors.schema.publicationScopeInvalid',
            data: { code: 'errors.schema.publicationScopeInvalid' }
        });
    }

    // Per-form reference pattern (Aktenzeichen). Only acted on when the caller
    // explicitly sends the key. Trimmed; empty string clears the override so the
    // backend falls back to the organisation pattern. Drupal field max is 128.
    const hasReferencePattern = Object.hasOwn(body, 'referencePattern');
    let referencePattern: string | undefined;
    if (hasReferencePattern) {
        if (body.referencePattern !== null && typeof body.referencePattern !== 'string') {
            throw createSafeError({
                statusCode: 400,
                message: 'errors.schema.referencePatternInvalid',
                data: { code: 'errors.schema.referencePatternInvalid' }
            });
        }
        referencePattern = (body.referencePattern ?? '').trim();
        if (referencePattern.length > 128) {
            throw createSafeError({
                statusCode: 400,
                message: 'errors.schema.referencePatternTooLong',
                data: { code: 'errors.schema.referencePatternTooLong' }
            });
        }
    }

    const saved = await saveSchemaDraft(event, id, normalizedSchema, {
        expectedChanged: body.expectedChanged,
        publicationScope,
        ...(hasReferencePattern ? { referencePattern } : {})
    });

    return {
        success: true,
        changed: saved.changed,
        // This is the server-canonical schema after workspace-scoped source
        // validation. Autosaves must adopt it too, otherwise a document
        // deleted between the editor's list request and PATCH could remain
        // selected in the browser and be sent again on the next save.
        schema: saved.schema
    };
});
