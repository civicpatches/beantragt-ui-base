import { workflowStatusCitizenLabel } from '~/utils/workflow-status';

/**
 * One sentence set for "this reaches the applicant".
 *
 * Status mails: `beantragt_notification` mails the applicant only when the
 * status text they see changes (`CitizenStatusProjection::labels()`, in the
 * applicant's language) and the matching mail template is active (approval,
 * rejection or the general status mail). The note of a status change stays
 * internal, except for a target with the semantic flag `rejected`: the
 * backend puts it into the rejection mail as `@rejection_reason`
 * (`WorkflowNotificationSubscriber::onWorkflowTransition`).
 *
 * Callers show the sentence before the action and may repeat it in the
 * success toast. Keys live under `admin.applicantNotice`.
 */

/** Semantic flag whose status mail carries the note as the reason. */
export const NOTE_IN_MAIL_FLAG = 'rejected';

type NoticeStatus = {
    label?: string | null
    citizenLabel?: { de?: string | null, en?: string | null } | null
    semanticFlags?: readonly string[] | null
};

export type ApplicantNotice = { key: string, params?: Record<string, string> };

/**
 * What the page knows about the application besides its statuses. Only an
 * application from batch processing is known never to get a status mail
 * (`NotificationMailer::sendCitizenNotificationWithResult()`, origin `bulk`).
 * A missing or unconfirmed address is not in the answers the pages load,
 * so those cases stay in the conditional wording of the sentences.
 */
export type ApplicantMailContext = { origin?: string | null };

/** Origin value of applications from batch processing. */
export const BATCH_ORIGIN = 'bulk';

/** Notice keys after which certainly no status mail goes out. */
const NO_MAIL_KEYS = new Set([
    'admin.applicantNotice.statusUnchanged',
    'admin.applicantNotice.statusChangedNoMailBatch',
    'admin.applicantNotice.statusNoMailBatch'
]);

/** The general status mail sentence, for one application or for several. */
export function applicantStatusMailKey(count = 1): string {
    return count > 1 ? 'admin.applicantNotice.statusMailMany' : 'admin.applicantNotice.statusMail';
}

/**
 * A connection may replace the text applicants see for a handover status or
 * a notice without outcome (`TimelineLabels::apply()` in beantragt_delivery).
 * The browser does not know that text, so it claims nothing for such statuses.
 */
function mayShowConnectionText(flags: readonly string[]): boolean {
    if (flags.includes('in_case_system')) return true;
    return flags.includes('decision_issued') && !['approved', 'rejected', 'filed'].some(flag => flags.includes(flag));
}

/**
 * What the applicant sees and receives for a change from one status to
 * another. Precise only where the code guarantees it: the citizen texts of
 * both statuses are known, no connection text can apply, and German and
 * English agree on "changes" or "stays" (the mail rule compares in the
 * applicant's language). Everything else falls back to the general sentence.
 */
export function applicantStatusNotice(
    from: NoticeStatus | null | undefined,
    to: NoticeStatus | null | undefined,
    langcode: string,
    context: ApplicantMailContext = {}
): ApplicantNotice {
    const fromBatch = context.origin === BATCH_ORIGIN;
    const general = { key: fromBatch ? 'admin.applicantNotice.statusNoMailBatch' : applicantStatusMailKey() };
    if (!from || !to) return general;
    if (mayShowConnectionText(from.semanticFlags ?? []) || mayShowConnectionText(to.semanticFlags ?? [])) return general;

    const changed = ['de', 'en'].map(lang => workflowStatusCitizenLabel(from, lang) !== workflowStatusCitizenLabel(to, lang));
    const target = workflowStatusCitizenLabel(to, langcode);
    if (changed.every(Boolean) && target) {
        return {
            key: fromBatch ? 'admin.applicantNotice.statusChangedNoMailBatch' : 'admin.applicantNotice.statusChanged',
            params: { label: target }
        };
    }
    if (changed.every(value => !value)) {
        return { key: 'admin.applicantNotice.statusUnchanged' };
    }
    return general;
}

/** Whether the notice says that certainly no status mail goes out. */
export function noticeExcludesMail(notice: ApplicantNotice): boolean {
    return NO_MAIL_KEYS.has(notice.key);
}

/**
 * What happens to the note of a status change.
 *
 * - No status mail goes out (the notice says so): the note stays internal.
 * - Target with the flag `rejected`: the note is the reason in the rejection mail.
 * - Target without any flag: the backend derives the flags from the machine
 *   name (`WorkflowNotificationSubscriber::targetSemanticFlags()`), so it may
 *   still be treated as a rejection; the sentence names both cases.
 * - Otherwise the note stays internal.
 */
export function applicantNoteNoticeKey(targetFlags: readonly string[], notice?: ApplicantNotice): string {
    if (notice && noticeExcludesMail(notice)) return 'admin.applicantNotice.noteInternal';
    if (targetFlags.includes(NOTE_IN_MAIL_FLAG)) return 'admin.applicantNotice.noteRejectionReason';
    if (targetFlags.length === 0) return 'admin.applicantNotice.noteMaybeRejectionReason';
    return 'admin.applicantNotice.noteInternal';
}
