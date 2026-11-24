import type {
    AttachmentAnalysisDisclosure,
    FormAttachmentAnalysisProfile,
    PublicAttachmentAnalysisDisclosure
} from '~~/app/types/form';
import type { AttachmentAnalysisProfileContext } from './attachment-analysis-contract';

type Disclosure = (
    profile: FormAttachmentAnalysisProfile | null,
    scope: AttachmentAnalysisProfileContext['scope']
) => AttachmentAnalysisDisclosure;

let configuredDisclosure: Disclosure | undefined;

export function registerAttachmentAnalysisDisclosure(disclose: Disclosure) {
    configuredDisclosure = disclose;
}

export function hasAttachmentAnalysisDisclosureProvider(): boolean {
    return configuredDisclosure !== undefined;
}

export function attachmentAnalysisDisclosure(
    profile: FormAttachmentAnalysisProfile | null,
    scope: AttachmentAnalysisProfileContext['scope']
): AttachmentAnalysisDisclosure {
    if (configuredDisclosure) return configuredDisclosure(profile, scope);

    const enabled = profile?.enabled === true;
    return {
        state: enabled ? 'unavailable' : 'stays',
        reason: enabled ? 'not_configured' : 'disabled',
        precheck: false,
        staffEvaluation: false,
        staffValuesAtUpload: false,
        scanFallback: false,
        complete: false
    };
}

/**
 * The citizen projection: nothing about why a service is unavailable (that
 * is an operations matter) and no completeness flag. A citizen only learns
 * where the file goes, or that it stays.
 */
export function publicAttachmentAnalysisDisclosure(
    disclosure: AttachmentAnalysisDisclosure
): PublicAttachmentAnalysisDisclosure {
    if (disclosure.state !== 'provider') {
        return {
            state: 'stays',
            precheck: false,
            staffEvaluation: false,
            staffValuesAtUpload: false,
            scanFallback: false
        };
    }
    return {
        state: 'provider',
        ...(disclosure.provider ? { provider: disclosure.provider } : {}),
        ...(disclosure.model ? { model: disclosure.model } : {}),
        ...(disclosure.location ? { location: disclosure.location } : {}),
        precheck: disclosure.precheck,
        staffEvaluation: disclosure.staffEvaluation,
        staffValuesAtUpload: disclosure.staffValuesAtUpload,
        scanFallback: disclosure.scanFallback,
        ...(disclosure.redactedPrecheckOnly ? { redactedPrecheckOnly: true } : {})
    };
}
