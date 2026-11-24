/**
 * The publish route and setup review use the same check so they agree on
 * whether a form can be published. Checks run in this order:
 *
 * 1. the stored schema does not parse or validate (`errors.schema.formInvalid`)
 * 2. authoring issues of severity blocking (`errors.schema.authoringRiskUnresolved`)
 * 3. person CRM keys on several fields (`errors.schema.duplicateCrmKeys`):
 *    severity warning while editing, but such a form never goes live
 */
import type { FormSchema } from '~~/app/types/form';
import {
    collectSchemaAuthoringIssues,
    isHighRiskFormField,
    listSchemaAuthoringIssueFields,
    normalizeFormSchema
} from '~~/app/utils/form-schema';
import { classificationFieldKey, type DraftClassificationField, type DraftClassificationReview } from '../../shared/schema-classification';

export type StoredSchemaValue = string | { value?: string } | null | undefined;

export interface SchemaPublishAssessment {
    /** The normalised schema, null when it does not parse or validate. */
    schema: FormSchema | null
    blocking: ReturnType<typeof collectSchemaAuthoringIssues>
    duplicateCrmKeys: ReturnType<typeof collectSchemaAuthoringIssues>
}

export interface SchemaPublishIssue {
    code: string
    sectionId: string | null
    sectionTitle: string | null
    fieldId: string | null
    fieldLabel: string | null
}

export function storedSchemaText(raw: StoredSchemaValue): string {
    return typeof raw === 'string' ? raw : raw?.value || '';
}

export function assessSchemaPublishable(raw: StoredSchemaValue): SchemaPublishAssessment {
    const invalid: SchemaPublishAssessment = { schema: null, blocking: [], duplicateCrmKeys: [] };
    const text = storedSchemaText(raw);
    if (!text) return invalid;
    try {
        const parsed = JSON.parse(text) as FormSchema;
        if (!parsed || typeof parsed.title !== 'string' || !Array.isArray(parsed.sections)) return invalid;
        const options = { requireStoredPrivacy: true };
        const schema = normalizeFormSchema(parsed, options);
        const issues = collectSchemaAuthoringIssues(schema, options);
        return {
            schema,
            blocking: issues.filter(issue => issue.severity === 'blocking'),
            duplicateCrmKeys: issues.filter(issue => issue.code === 'duplicate_crm_key')
        };
    } catch {
        return invalid;
    }
}

/** Every refusal reason in route order, one entry per field and code. */
export function listSchemaPublishIssues(assessment: SchemaPublishAssessment): SchemaPublishIssue[] {
    if (!assessment.schema) {
        return [{ code: 'schema_invalid', sectionId: null, sectionTitle: null, fieldId: null, fieldLabel: null }];
    }
    const seen = new Set<string>();
    const issues: SchemaPublishIssue[] = [];
    for (const issue of [...assessment.blocking, ...assessment.duplicateCrmKeys]) {
        const key = `${issue.sectionId ?? ''}\u0000${issue.fieldId}\u0000${issue.code}`;
        if (seen.has(key)) continue;
        seen.add(key);
        issues.push({
            code: issue.code,
            sectionId: issue.sectionId ?? null,
            sectionTitle: issue.sectionTitle ?? null,
            fieldId: issue.fieldId || null,
            fieldLabel: issue.fieldLabel || issue.fieldId || null
        });
    }
    return issues;
}

/** Only locations and reasons from the same check that gates publication. */
export function draftClassificationReview(assessment: SchemaPublishAssessment): DraftClassificationReview {
    const { schema, blocking, duplicateCrmKeys } = assessment;
    if (!schema) return { publishable: false, fields: [] };
    const fields = new Map<string, DraftClassificationField>();
    for (const issue of [...blocking, ...duplicateCrmKeys]) {
        const key = classificationFieldKey(issue);
        let entry = fields.get(key);
        if (!entry) {
            const { sectionIndex, fieldIndex } = issue;
            const section = schema.sections[sectionIndex]!;
            const field = section.fields[fieldIndex]!;
            entry = {
                sectionIndex,
                fieldIndex,
                sectionTitle: section.title,
                fieldLabel: field.label || field.id,
                reasons: [],
                protected: field.sensitive === true,
                highRisk: isHighRiskFormField(field, {
                    sectionId: section.id,
                    sectionTitle: section.title,
                    sectionDescription: section.description,
                    sectionI18n: section.i18n
                })
            };
            fields.set(key, entry);
        }
        if (!entry.reasons.includes(issue.code)) entry.reasons.push(issue.code);
    }
    return {
        publishable: fields.size === 0,
        fields: [...fields.values()].sort((a, b) => a.sectionIndex - b.sectionIndex || a.fieldIndex - b.fieldIndex)
    };
}

/**
 * Throws the publish route's 422 for the first refusal reason, or returns the
 * normalised schema the route stores on publish.
 */
export function assertSchemaPublishable(raw: StoredSchemaValue, includeDraftReview = false): FormSchema {
    const assessment = assessSchemaPublishable(raw);
    if (!assessment.schema) {
        throw createSafeError({
            statusCode: 422,
            message: 'errors.schema.formInvalid',
            data: { code: 'errors.schema.formInvalid' }
        });
    }
    if (assessment.blocking.length > 0) {
        throw createSafeError({
            statusCode: 422,
            message: 'errors.schema.authoringRiskUnresolved',
            data: {
                code: 'errors.schema.authoringRiskUnresolved',
                fields: listSchemaAuthoringIssueFields(assessment.blocking),
                ...(includeDraftReview ? { classification: draftClassificationReview(assessment) } : {})
            }
        });
    }
    if (assessment.duplicateCrmKeys.length > 0) {
        // Equal labels ("Familienname" of two persons) are told apart by their section.
        throw createSafeError({
            statusCode: 422,
            message: 'errors.schema.duplicateCrmKeys',
            data: {
                code: 'errors.schema.duplicateCrmKeys',
                fields: assessment.duplicateCrmKeys
                    .map(issue => issue.sectionTitle ? `${issue.fieldLabel || issue.fieldId} (${issue.sectionTitle})` : issue.fieldLabel || issue.fieldId)
                    .join(', '),
                ...(includeDraftReview ? { classification: draftClassificationReview(assessment) } : {})
            }
        });
    }
    return assessment.schema;
}
