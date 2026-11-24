import * as z from 'zod';
import {
    FORM_ATTACHMENT_ANALYSIS_EGRESS_POLICIES,
    FORM_ATTACHMENT_ANALYSIS_MODEL_CLASSES,
    FORM_ATTACHMENT_ANALYSIS_REDACTION_MODES,
    FORM_FIELD_FORMATS,
    FORM_FIELD_PRIVACY_KINDS,
    FORM_FIELD_TYPES,
    FORM_CONTEXT_SOURCE_TYPES,
    FORM_CONTEXT_SOURCE_USAGES,
    FORM_PRECHECK_FACT_TYPES,
    FORM_PRECHECK_REVIEW_STATUSES
} from '../../types/form';

const unsafeKeys = new Set([...Object.getOwnPropertyNames(Object.prototype), 'prototype', '$ref', '$dynamicRef', '$recursiveRef']);

// Build the strict draft structure only when an import is validated.
let importSchema: ReturnType<typeof buildImportSchema> | undefined;

function buildImportSchema() {
    const string = z.string();
    const nonBlank = string.refine(value => value.trim().length > 0);
    const machineId = string.regex(/^[a-z][a-z0-9_]{0,99}$/u).refine(value => !unsafeKeys.has(value));
    const optionalString = string.optional();
    const optionalNumber = z.number().optional();
    const optionalInteger = z.int().optional();
    const optionalBoolean = z.boolean().optional();
    const strings = z.array(string);
    const jsonObject = z.record(string, z.unknown());
    const identityRequirement = z.union([z.enum(['required', 'optional', 'none']), z.boolean()]).optional();
    const localizedText = z.record(string, z.strictObject({
        title: optionalString, description: optionalString, label: optionalString, placeholder: optionalString
    }));
    const addressWidget = {
        autocomplete: optionalBoolean,
        map: optionalBoolean,
        boundary: z.enum(['off', 'advisory']).optional()
    };
    const fileLimits = { maxFiles: optionalInteger, maxSizeBytes: optionalInteger, maxFileSizeBytes: optionalInteger };
    const field = z.strictObject({
        id: machineId,
        type: z.enum(FORM_FIELD_TYPES),
        label: nonBlank,
        placeholder: optionalString,
        required: optionalBoolean,
        sensitive: optionalBoolean,
        privacy: z.strictObject({ kind: z.enum(FORM_FIELD_PRIVACY_KINDS) }).optional(),
        options: strings.optional(),
        defaultValue: z.union([string, z.number(), z.boolean()]).optional(),
        i18n: z.record(string, z.strictObject({
            label: optionalString, placeholder: optionalString, options: z.union([strings, z.record(string, string)]).optional()
        })).optional(),
        crm_key: optionalString,
        semantics: z.strictObject({ concept: optionalString, sourcePath: optionalString }).optional(),
        format: z.enum(FORM_FIELD_FORMATS).optional(),
        validation: z.strictObject({
            ...fileLimits, minLength: optionalInteger, maxLength: optionalInteger,
            pattern: optionalString, min: optionalNumber, max: optionalNumber, step: optionalNumber
        }).optional(),
        widget: z.strictObject(addressWidget).optional(),
        conditionalOn: z.strictObject({ fieldId: machineId, value: z.union([string, z.boolean()]) }).optional(),
        computed: z.strictObject({ fn: nonBlank, args: z.array(machineId) }).optional(),
        analysis: z.strictObject({
            enabled: optionalBoolean,
            version: optionalInteger,
            expectedDocumentType: optionalString,
            promptSuggestion: optionalString,
            citizenPrompt: optionalString,
            staffPrompt: optionalString,
            redaction: z.enum(FORM_ATTACHMENT_ANALYSIS_REDACTION_MODES).optional(),
            resultSchema: jsonObject.optional(),
            modelClass: z.enum(FORM_ATTACHMENT_ANALYSIS_MODEL_CLASSES).optional(),
            egressPolicy: z.enum(FORM_ATTACHMENT_ANALYSIS_EGRESS_POLICIES).optional()
        }).optional(),
        ...fileLimits
    });

    const section = z.strictObject({
        id: machineId,
        title: nonBlank,
        description: optionalString,
        i18n: localizedText.optional(),
        repeatable: optionalBoolean,
        maxInstances: optionalInteger,
        fields: z.array(field),
        addressGroups: z.array(z.strictObject({
            ...addressWidget,
            id: machineId,
            label: optionalString,
            fields: z.strictObject({ street: machineId, houseNumber: machineId, postcode: machineId, city: machineId })
        })).optional()
    });

    const workflowAttribute = z.strictObject({
        code: nonBlank,
        variable: z.boolean(),
        datatype: z.enum(['string', 'number', 'text', 'datetime', 'singlevaluelist', 'multivaluelist', 'imagelist']),
        required: z.boolean(),
        description: string,
        order: z.number(),
        values: z.array(z.strictObject({ key: string, name: string })).optional(),
        media_type: optionalString,
        media_group: optionalString,
        datatype_description: optionalString,
        default_value: z.union([string, z.number()]).optional(),
        validation: z.strictObject({
            pattern: optionalString, pattern_message: optionalString, min: optionalNumber, max: optionalNumber
        }).optional(),
        conditions: z.strictObject({
            show_when: z.array(z.strictObject({
                attribute_code: nonBlank,
                operator: z.enum(['equals', 'not_equals', 'contains', 'not_empty']),
                value: optionalString
            })).optional()
        }).optional()
    });

    const workflow = z.strictObject({
        mode: z.enum(['catalog', 'inherit']).optional(),
        defaultStatus: optionalString,
        statuses: z.array(z.strictObject({
            machineName: nonBlank, description: optionalString, attributes: z.array(workflowAttribute).optional()
        })),
        transitions: z.array(z.strictObject({
            from: nonBlank, to: nonBlank, condition: optionalString, attributes: z.array(workflowAttribute).optional()
        }))
    });

    const contextSource = z.strictObject({
        type: z.enum(FORM_CONTEXT_SOURCE_TYPES),
        id: z.uuid(),
        title: nonBlank,
        placement: optionalString,
        version: optionalString,
        changed: z.int().nonnegative().optional(),
        enabledFor: z.array(z.enum(FORM_CONTEXT_SOURCE_USAGES)).min(1).optional(),
        requiredCitation: optionalBoolean
    });

    const precheckText = z.strictObject({ de: nonBlank, en: optionalString });
    const precheckCriterion = z.strictObject({
        id: machineId,
        factKey: machineId,
        fieldId: machineId.optional(),
        privacy: z.strictObject({ kind: z.literal('not_personal') }).optional(),
        factType: z.enum(FORM_PRECHECK_FACT_TYPES),
        label: precheckText,
        question: precheckText,
        affects: z.enum(['procedure_fit', 'obligation', 'both']),
        order: z.int().nonnegative(),
        reviewStatus: z.enum(FORM_PRECHECK_REVIEW_STATUSES),
        evidence: z.strictObject({
            sourceType: z.enum(['form_source', 'context_source']),
            sourceId: optionalString,
            sourceTitle: optionalString,
            quote: nonBlank,
            page: z.int().positive().optional()
        }),
        unit: optionalString,
        options: strings.optional()
    });

    // Validate the internal DSL before storage. Drupal evaluates reference integrity,
    // draft rules and publication rules. No authoring defaults or inferred privacy
    // classifications are applied to the uploaded definition.
    return z.strictObject({
        id: machineId.optional(),
        title: nonBlank.refine(value => [...value].length <= 255),
        description: optionalString,
        i18n: localizedText.optional(),
        version: z.int().positive().optional(),
        sections: z.array(section),
        workflow: workflow.optional(),
        semantics: z.strictObject({
            category: optionalString, process: optionalString, entities: strings.optional(),
            attachments: z.array(z.strictObject({ key: string, label: string, required: z.boolean() })).optional(),
            legal_references: strings.optional()
        }).optional(),
        source: z.strictObject({
            type: z.enum(['fim-json-schema', 'pdf', 'image', 'text', 'manual', 'unknown']),
            file: optionalString, url: optionalString, label: optionalString, fileName: optionalString,
            mediaType: optionalString, schemaId: optionalString, version: optionalString, importedAt: optionalString,
            textStatistics: z.strictObject({
                bytes: z.int(), lines: z.int(), parts: z.int(),
                count: z.strictObject({ unit: z.enum(['controls', 'elements', 'keys']), total: z.int() }).optional()
            }).optional()
        }).optional(),
        auth: z.strictObject({
            mode: z.enum(['anonymous', 'optional', 'required']).optional(),
            providers: z.array(z.enum(['passwordless', 'bundid'])).optional(),
            collect: z.strictObject({ fullName: identityRequirement, email: identityRequirement }).optional()
        }).optional(),
        delivery: z.strictObject({
            processingMode: z.enum(['self_contained', 'pass_through']).optional(),
            adapter: z.enum(['mock', 'webhook', 'fit_connect']).optional()
        }).optional(),
        retention: z.strictObject({ dataRetentionDays: optionalInteger }).optional(),
        contextSources: z.array(contextSource).max(24).optional(),
        precheckSchema: z.strictObject({ version: z.literal(1), criteria: z.array(precheckCriterion).max(32) }).optional()
    });
}

function isSafeJson(value: unknown, depth = 0): boolean {
    // All supported structures are shallow, including nested extraction schemas.
    if (depth > 64) return false;
    if (typeof value === 'number') return Number.isFinite(value);
    if (!value || typeof value !== 'object') return true;
    return Object.entries(value).every(([key, child]) => !unsafeKeys.has(key) && isSafeJson(child, depth + 1));
}

export function validateImportedFormSchema(value: unknown): { title: string, description?: string } | null {
    if (!isSafeJson(value)) return null;

    importSchema ??= buildImportSchema();
    const parsed = importSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
}
