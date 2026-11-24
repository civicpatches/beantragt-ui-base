import type { Assignment, AssignmentInput, Connection, MappingSummary, MappingVersion, IntegrationIssue } from '~/types/integrations';

export function mappingChoiceReason(mapping: MappingSummary, connection?: Connection): string | null {
    if (!connection) return 'integrationRules.chooseConnectionFirst';
    if (mapping.contract_key !== connection.contract_key || mapping.contract_version !== connection.contract_version) return 'integrationRules.otherContract';
    return null;
}

export function versionChoiceReason(version: MappingVersion, draft: AssignmentInput): string | null {
    if (version.integrity === 'failed') return 'integrationUi.integrityFailed';
    if (version.status !== 'active') return 'integrationRules.notActive';
    if (version.form_schema_uuid !== draft.form_schema_uuid) return 'integrationRules.otherForm';
    if (draft.compatible_revisions.some(revision => !version.compatible_revisions.includes(revision))) return 'integrationRules.otherRevision';
    return null;
}

export function findConflictingRule(rules: Assignment[], rule: Assignment): Assignment | undefined {
    return rules.find(candidate => candidate.uuid !== rule.uuid && candidate.status === 'active'
      && candidate.form_schema_uuid === rule.form_schema_uuid && candidate.service_urn.toLowerCase() === rule.service_urn.toLowerCase());
}

export type RuleSection = 'source' | 'connection' | 'mapping' | 'dispatch' | 'trigger';

export function ruleSectionIssues(issues: IntegrationIssue[], section: RuleSection, errorCode = ''): IntegrationIssue[] {
    const fallback: Record<string, string> = {
        'integration.prerequisite_inactive': '/connection_uuid',
        'integration.connection_disabled': '/connection_uuid',
        'integration.contract_mismatch': '/mapping_uuid',
        'integration.mapping_inactive': '/mapping_uuid',
        'integration.revision_incompatible': '/compatible_revisions',
        'integration.revision_not_covered': '/compatible_revisions'
    };
    const effective = issues.length || !fallback[errorCode] ? issues : [{ pointer: fallback[errorCode]!, code: errorCode }];
    return effective.filter((issue) => {
        if (/form_schema|compatible_revisions/.test(issue.pointer)) return section === 'source';
        if (/connection|service_urn/.test(issue.pointer)) return section === 'connection';
        if (/dispatch_mode|send_attachments/.test(issue.pointer)) return section === 'dispatch';
        // The trigger of a transfer ( the form lacks the hand-over function).
        if (/^\/(?:transfer_trigger|trigger_flag)(?:\/|$)/.test(issue.pointer)) return section === 'trigger';
        return section === 'mapping';
    });
}

export function assignmentInput(rule: Assignment): AssignmentInput {
    return {
        form_schema_uuid: rule.form_schema_uuid, compatible_revisions: [...rule.compatible_revisions],
        service_urn: rule.service_urn, connection_uuid: rule.connection_uuid,
        mapping_uuid: rule.mapping_uuid, mapping_version: rule.mapping_version, dispatch_mode: rule.dispatch_mode, send_attachments: rule.send_attachments
    };
}

// Rule pages explain blocked reasons from the rule's point of view. Shared
// codes such as revision_not_covered also appear on case transfers, where a
// rule-specific cause would be wrong, so only these views swap the text.
const RULE_REASON_KEYS: Record<string, string> = {
    'integration.revision_not_covered': 'integrationRules.revisionChanged'
};

export function ruleReasonKey(code: string): string {
    return RULE_REASON_KEYS[code] ?? code;
}

/**
 * The text of one issue: the code's text, and for a form that lacks the
 * hand-over function the sentence for its moment (saving the trigger or
 * activating the rule) or for a form without an organisation.
 */
export function ruleIssueKey(
    issue: Pick<IntegrationIssue, 'code'> & Partial<Pick<IntegrationIssue, 'moment' | 'form_has_organisation'>>,
    /** What was being saved: the trigger on its own, or the whole rule (create, update). */
    saved: 'trigger' | 'rule' = 'trigger'
): string {
    if (issue.code !== 'integration.coupling_status_missing') return ruleReasonKey(issue.code);
    if (issue.form_has_organisation === false) return 'integration.coupling_status_missing_no_organisation';
    if (issue.moment === 'save') return saved === 'rule' ? 'integration.coupling_status_missing_rule_save' : 'integration.coupling_status_missing_save';
    if (issue.moment === 'activation') return 'integration.coupling_status_missing_activation';
    return ruleReasonKey(issue.code);
}

// An inactive rule sends nothing either way, so it shows as inactive and its
// reasons stay on its own page. A replaced rule would otherwise keep pointing
// admins at a rule they cannot fix. Drafts keep their reasons: they are the
// rules an admin is about to activate.
type RuleState = Pick<Assignment, 'status' | 'blocked'> & Partial<Pick<Assignment, 'blocked_reasons' | 'transfer_trigger' | 'trigger_flag'>>;

/**
 * An active status rule can still send when the receiving status is missing.
 * The case stays in its current status, so the reason is a warning. A missing
 * trigger status blocks the rule from firing. Submission and manual rules
 * move the case after acceptance and never need this warning.
 */
export function ruleSendsWithWarning(rule: RuleState): boolean {
    const reasons = rule.blocked_reasons ?? [];
    if (rule.status !== 'active' || !rule.blocked || reasons.length === 0) return false;
    if (!reasons.every(reason => reason.code === 'integration.coupling_status_missing')) return false;
    if (rule.transfer_trigger !== 'status') return false;
    // A status trigger fires only when the form carries its trigger status.
    return reasons.every(reason => Array.isArray(reason.missing_flags) && !reason.missing_flags.includes(rule.trigger_flag ?? 'hand_over'));
}

export function ruleIsBlocking(rule: RuleState): boolean {
    return rule.status !== 'inactive' && Boolean(rule.blocked) && !ruleSendsWithWarning(rule);
}

export function ruleBadgeStatus(rule: RuleState): Assignment['status'] | 'blocked' {
    return ruleIsBlocking(rule) ? 'blocked' : rule.status;
}
