export const DATA_EDIT_REASON_REQUIRED = 'application.data_edit_reason_required';
export const DATA_EDIT_REASON_MAX_LENGTH = 500;
export const DATA_EDIT_REASON_TOO_LONG = 'application.data_edit_reason_too_long';
export const DATA_EDIT_TRANSFER_LOCKED = 'application.data_edit_transfer_locked';
export const DATA_EDIT_HISTORY_CURSOR_INVALID = 'application.data_edit_history_cursor_invalid';

export function applicationDataErrorDetails(error: unknown): Record<string, unknown> | undefined {
    const envelope = (error as { data?: Record<string, unknown> } | null)?.data;
    return envelope?.data && typeof envelope.data === 'object'
        ? envelope.data as Record<string, unknown>
        : envelope;
}

export interface ApplicationDataCorrection {
    kind: 'data_edited'
    revisionId: number
    timestamp: string
    author: { id: number | null, label: string | null }
    reason: string | null
    changes: Array<{ field: string, oldValue: unknown, hadOldValue: boolean }>
}

export interface ApplicationDataCorrectionPage {
    dataCorrections: ApplicationDataCorrection[]
    dataCorrectionsNextBefore: number | null
}
