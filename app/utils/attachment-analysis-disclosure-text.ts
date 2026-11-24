import type {
    AttachmentAnalysisDisclosure,
    FormAttachmentAnalysisEgressPolicy,
    PublicAttachmentAnalysisDisclosure
} from '~/types/form';

/**
 * Texts that say where an upload field's file goes for the AI pre-check,
 * for citizens at the field and for staff in the form editor. The labels
 * come from the server (operator configuration); a missing label shortens
 * the sentence instead of printing a placeholder.
 */

type Translate = (key: string, params?: Record<string, unknown>) => string;

const CITIZEN_KEY = 'form.attachmentAnalysis.disclosure';
const STAFF_KEY = 'admin.fieldInspector.attachmentAnalysis.disclosure';

function label(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

/** " (Modell X, Standort Y)", only the parts that are known, or "". */
function citizenDetails(t: Translate, disclosure: PublicAttachmentAnalysisDisclosure): string {
    const model = label(disclosure.model);
    const location = label(disclosure.location);
    const parts = [
        model ? t(`${CITIZEN_KEY}.model`, { model }) : '',
        location ? t(`${CITIZEN_KEY}.location`, { location }) : ''
    ].filter(Boolean);
    return parts.length > 0 ? ` (${parts.join(', ')})` : '';
}

function citizenProvider(t: Translate, disclosure: PublicAttachmentAnalysisDisclosure): string {
    return label(disclosure.provider) || t(`${CITIZEN_KEY}.someProvider`);
}

/**
 * Static helper lines under an upload field (no live region): where the
 * file goes, whether staff read values after submission, whether scans go
 * unredacted. external_allowed says it inside the consent box
 * (citizenAttachmentConsentHint) while the box is shown, and in one line
 * here once the box is gone (the field holds its last file).
 */
export function citizenAttachmentDisclosureLines(
    t: Translate,
    egressPolicy: FormAttachmentAnalysisEgressPolicy | undefined,
    disclosure: PublicAttachmentAnalysisDisclosure | undefined,
    options: { consentBoxShown?: boolean } = {}
): string[] {
    if (!disclosure) return [];
    const lines = [t(`${CITIZEN_KEY}.administration`)];
    if (disclosure.state !== 'provider') return [...lines, t(`${CITIZEN_KEY}.stays`)];
    const params = { provider: citizenProvider(t, disclosure), details: citizenDetails(t, disclosure) };
    if (egressPolicy === 'external_allowed') {
        if (options.consentBoxShown === false) lines.push(t(`${CITIZEN_KEY}.sentWithConsent`, params));
    } else if (egressPolicy === 'external_redacted') {
        if (disclosure.precheck) lines.push(t('form.attachmentAnalysis.consentHintByPolicy.external_redacted', params));
    } else if (disclosure.precheck) {
        // Older projections used scanFallback to indicate redaction when_possible.
        const redactedOnly = disclosure.redactedPrecheckOnly ?? disclosure.scanFallback;
        lines.push(t(redactedOnly ? `${CITIZEN_KEY}.sentRedacted` : `${CITIZEN_KEY}.sentAtUpload`, params));
        if (disclosure.staffEvaluation) lines.push(t(`${CITIZEN_KEY}.staffEvaluation`));
        else if (disclosure.staffValuesAtUpload) lines.push(t(`${CITIZEN_KEY}.staffValuesAtUpload`));
    } else if (disclosure.staffEvaluation) {
        lines.push(t(`${CITIZEN_KEY}.sentForStaffOnly`, params));
    }
    if (disclosure.staffEvaluation && disclosure.scanFallback) lines.push(t(`${CITIZEN_KEY}.staffScanFallback`));
    return lines;
}

/** The hint inside the external_allowed consent box. */
export function citizenAttachmentConsentHint(
    t: Translate,
    disclosure: PublicAttachmentAnalysisDisclosure | undefined
): string {
    if (disclosure?.state !== 'provider') return t('form.attachmentAnalysis.consentHint');
    return t('form.attachmentAnalysis.consentHintByPolicy.external_allowed', {
        provider: citizenProvider(t, disclosure),
        details: citizenDetails(t, disclosure)
    });
}

export interface StaffAttachmentDisclosureText {
    /** At most two lines: where the file goes, then the redaction. */
    lines: string[]
    /** Operations must complete the configuration. */
    warning?: string
}

/**
 * One redaction sentence for the external policies only. Under sovereign and
 * local the redaction select with its help text sits right above the box, so
 * repeating it would only make the long inspector card longer.
 */
function staffRedactionLines(
    t: Translate,
    egressPolicy: FormAttachmentAnalysisEgressPolicy | undefined
): string[] {
    if (egressPolicy === 'external_redacted') return [t(`${STAFF_KEY}.redaction.external_redacted`)];
    if (egressPolicy === 'external_allowed') return [t(`${STAFF_KEY}.redaction.external_allowed`)];
    return [];
}

/**
 * The "Wohin die Anlage geht" box in the field inspector. No box while the
 * card already explains the state itself (no model class chosen yet).
 */
export function staffAttachmentDisclosureText(
    t: Translate,
    egressPolicy: FormAttachmentAnalysisEgressPolicy | undefined,
    disclosure: AttachmentAnalysisDisclosure | undefined
): StaffAttachmentDisclosureText {
    if (!disclosure || disclosure.reason === 'not_selected') return { lines: [] };
    if (disclosure.state === 'unavailable') {
        return { lines: [t(`${STAFF_KEY}.stays`)], warning: t(`${STAFF_KEY}.warningUnavailable`) };
    }
    if (disclosure.state !== 'provider') return { lines: [t(`${STAFF_KEY}.stays`)] };
    const provider = label(disclosure.provider);
    const model = label(disclosure.model);
    const location = label(disclosure.location);
    const target = [
        provider || t(`${STAFF_KEY}.unknownProvider`),
        model ? t(`${STAFF_KEY}.model`, { model }) : '',
        location ? t(`${STAFF_KEY}.location`, { location }) : t(`${STAFF_KEY}.unknownLocation`)
    ].filter(Boolean).join(', ');
    return {
        lines: [`${target}.`, ...staffRedactionLines(t, egressPolicy)],
        ...(provider && location ? {} : { warning: t(`${STAFF_KEY}.warningIncomplete`) })
    };
}

/** The box when the server could not say where the file goes (error, expired session). */
export function staffAttachmentDisclosureUnresolved(t: Translate): StaffAttachmentDisclosureText {
    return { lines: [], warning: t(`${STAFF_KEY}.warningUnresolved`) };
}
