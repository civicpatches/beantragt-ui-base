/**
 * Recognises internal audit notes that the backend writes in a fixed,
 * language-neutral form, so the thread can show them in the UI language.
 *
 * Delegation (ApplicationAssignmentController::createDelegationAuditComment):
 *   beantragt_application:delegation
 *   Delegation
 *   Source organisation: <label>
 *   Target organisation: <label>
 *   Delegated by: <name> (uid: <id>)
 *   Note: <text>            (optional, may span several lines)
 */
export interface DelegationNote {
    kind: 'delegation'
    source: string
    target: string
    by: string
    note: string
}

export interface AssignmentNote {
    kind: 'assignment'
    target: string
    targetUser: string
    by: string
    note: string
}

export type SystemNote = DelegationNote | AssignmentNote;

const DELEGATION_MARKER = 'beantragt_application:delegation';

function field(lines: string[], prefix: string): string {
    const line = lines.find(value => value.startsWith(prefix));
    return line ? line.slice(prefix.length).trim() : '';
}

export function parseSystemNote(body: string | null | undefined): SystemNote | null {
    if (typeof body !== 'string') return null;
    const lines = body.split('\n');
    if (lines[0]?.trim() === 'beantragt_application:assignment') {
        const target = field(lines, 'Assigned to:');
        const by = field(lines, 'Assigned by:').replace(/\s*\(uid:\s*\d+\)\s*$/, '');
        const noteIndex = lines.findIndex(value => value.startsWith('Note:'));
        if (!target || !by || noteIndex < 0) return null;
        return {
            kind: 'assignment', target, by,
            targetUser: field(lines, 'Target user UUID:'),
            note: [lines[noteIndex]!.slice('Note:'.length), ...lines.slice(noteIndex + 1)].join('\n').trim()
        };
    }
    if (lines[0]?.trim() !== DELEGATION_MARKER) return null;

    const source = field(lines, 'Source organisation:');
    const target = field(lines, 'Target organisation:');
    if (!source || !target) return null;

    // The account ID is audit detail for the backend, not for the reader.
    const by = field(lines, 'Delegated by:').replace(/\s*\(uid:\s*\d+\)\s*$/, '');
    const noteIndex = lines.findIndex(value => value.startsWith('Note:'));
    const note = noteIndex >= 0
        ? [lines[noteIndex]!.slice('Note:'.length), ...lines.slice(noteIndex + 1)].join('\n').trim()
        : '';

    return { kind: 'delegation', source, target, by, note };
}
