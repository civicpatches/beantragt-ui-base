import type { FormSchema } from '~/types/form';
import type { SchemaAuthoringIssue } from '~/utils/form-schema';
import { collectSchemaAuthoringIssues } from '~/utils/form-schema';
import type { DraftClassificationReview } from '../../shared/schema-classification';

/**
 * Fields that keep a form from being published, derived on the client
 * with the same check the publish route runs (`assertSchemaPublishable`):
 * blocking privacy issues first, then person CRM keys on several fields. The
 * route's 422 carries the field labels as one joined string without ids, so
 * the refusal is never read back from it.
 */
export type PublishBlockerKind = 'privacy' | 'duplicate_crm_key';

export interface PublishBlockers {
    kind: PublishBlockerKind
    /** One issue per field, in form order. */
    issues: SchemaAuthoringIssue[]
}

const MAX_NAMED_FIELDS = 3;

function uniqueByField(issues: SchemaAuthoringIssue[]): SchemaAuthoringIssue[] {
    const seen = new Set<string>();
    return issues.filter((issue) => {
        if (seen.has(issue.fieldId)) return false;
        seen.add(issue.fieldId);
        return true;
    });
}

export function publishBlockers(schema: FormSchema | null | undefined, kind?: PublishBlockerKind): PublishBlockers | null {
    if (!schema) return null;
    const issues = collectSchemaAuthoringIssues(schema);
    const privacy = uniqueByField(issues.filter(issue => issue.severity === 'blocking'));
    const duplicates = uniqueByField(issues.filter(issue => issue.code === 'duplicate_crm_key'));
    if ((kind === undefined || kind === 'privacy') && privacy.length > 0) return { kind: 'privacy', issues: privacy };
    if ((kind === undefined || kind === 'duplicate_crm_key') && duplicates.length > 0) return { kind: 'duplicate_crm_key', issues: duplicates };
    return null;
}

/**
 * The name a field shows on the canvas: long imported labels carry a path
 * ("Teil / Unterteil: Angabe"), the canvas shows the last part.
 */
export function shortFieldLabel(issue: Pick<SchemaAuthoringIssue, 'fieldLabel' | 'fieldId'>): string {
    const label = (issue.fieldLabel || issue.fieldId).trim();
    const parts = label.split(/:\s+/u);
    return parts[parts.length - 1]?.trim() || label;
}

/** The first few field names for a message, and how many are left. */
export function namedBlockerFields(blockers: PublishBlockers): { names: string, more: number } {
    const shown = blockers.issues.slice(0, MAX_NAMED_FIELDS);
    const short = shown.map(shortFieldLabel);
    // Fields with one CRM key usually share a label ("E-Mail,
    // E-Mail"). A repeated canvas name falls back to the full label, and a CRM
    // key refusal adds the section, as the publish route's own message does.
    const repeated = new Set(short.filter((label, index) => short.indexOf(label) !== index));
    const names = shown.map((issue, index) => {
        const label = repeated.has(short[index]!) ? (issue.fieldLabel || issue.fieldId).trim() : short[index]!;
        const section = issue.sectionTitle?.trim();
        return section && (blockers.kind === 'duplicate_crm_key' || repeated.has(short[index]!)) ? `${label} (${section})` : label;
    });
    return { names: names.join(', '), more: Math.max(0, blockers.issues.length - MAX_NAMED_FIELDS) };
}

const REFUSAL_KINDS: Record<string, PublishBlockerKind> = {
    'errors.schema.authoringRiskUnresolved': 'privacy',
    'errors.schema.duplicateCrmKeys': 'duplicate_crm_key'
};

/** The blocker kind behind a refused publish, or null for any other error. */
export function publishRefusalKind(error: unknown): PublishBlockerKind | null {
    const { code } = formStatusErrorData(error);
    return code ? REFUSAL_KINDS[code] ?? null : null;
}

/** Only the publication and classification refusals carry affected fields. */
export function formStatusErrorData(error: unknown): { code: string | null, fields: string | null, classification?: DraftClassificationReview } {
    type ErrorData = { code?: unknown, fields?: unknown, classification?: DraftClassificationReview };
    const envelope = (error as { data?: ErrorData & { data?: ErrorData } } | null)?.data;
    const data = envelope?.data ?? envelope;
    const code = data?.code ?? envelope?.code;
    const hasAffectedFields = code === 'errors.schema.authoringRiskUnresolved' || code === 'errors.schema.duplicateCrmKeys';
    const classification = hasAffectedFields || code === 'errors.schema.classificationUnresolved' ? data?.classification : undefined;
    return {
        code: typeof code === 'string' ? code : null,
        fields: hasAffectedFields && typeof data?.fields === 'string' ? data.fields : null,
        ...(classification ? { classification } : {})
    };
}
