export type AdminNotificationReceiptColor = 'success' | 'warning';

export interface AdminNotificationReceipt {
    messageKey: string
    color: AdminNotificationReceiptColor
}

type NotificationStatus
    = | 'sent'
      | 'failed'
      | 'skipped_self_assignment'
      | 'skipped_disabled'
      | 'skipped_no_recipient';

interface NotificationOutcome {
    key: string
    recipient_kind: 'person' | 'org_mailbox' | null
    status: NotificationStatus
}

const STATUS_PRIORITY: Record<NotificationStatus, number> = {
    failed: 0,
    sent: 1,
    skipped_self_assignment: 2,
    skipped_disabled: 3,
    skipped_no_recipient: 4
};
const VALID_STATUSES = new Set<string>(Object.keys(STATUS_PRIORITY));

function isNotificationOutcome(value: unknown): value is NotificationOutcome {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const outcome = value as Record<string, unknown>;
    return Boolean(
        typeof outcome.key === 'string'
        && (outcome.recipient_kind === 'person' || outcome.recipient_kind === 'org_mailbox' || outcome.recipient_kind === null)
        && typeof outcome.status === 'string'
        && VALID_STATUSES.has(outcome.status)
        && (outcome.status !== 'sent' || outcome.recipient_kind !== null)
    );
}

/**
 * Selects the most important usable receipt from a backend notifications field.
 * Invalid or missing response data deliberately falls back to the legacy toast.
 */
export function resolveAdminNotificationReceipt(value: unknown): AdminNotificationReceipt | null {
    if (!Array.isArray(value)) return null;
    const outcomes = value
        .filter(isNotificationOutcome)
        .sort((left, right) => STATUS_PRIORITY[left.status] - STATUS_PRIORITY[right.status]);
    const outcome = outcomes[0];
    if (!outcome) return null;

    if (outcome.status === 'failed') {
        return {
            messageKey: 'admin.detail.notificationReceipt.failed',
            color: 'warning'
        };
    }
    if (outcome.status === 'sent') {
        if (outcome.recipient_kind === 'person') {
            return {
                messageKey: 'admin.detail.notificationReceipt.sentPerson',
                color: 'success'
            };
        }
        if (outcome.recipient_kind === 'org_mailbox') {
            return {
                messageKey: 'admin.detail.notificationReceipt.sentOrgMailbox',
                color: 'success'
            };
        }
        return null;
    }

    const messageKeys: Record<Exclude<NotificationStatus, 'sent' | 'failed'>, string> = {
        skipped_self_assignment: 'admin.detail.notificationReceipt.skippedSelfAssignment',
        skipped_disabled: 'admin.detail.notificationReceipt.skippedDisabled',
        skipped_no_recipient: 'admin.detail.notificationReceipt.skippedNoRecipient'
    };
    return {
        messageKey: messageKeys[outcome.status],
        color: 'success'
    };
}
