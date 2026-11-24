import type { ApplicationConsents, ApplicationConsentSummary } from '~/types/application';

function optionalString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/**
 * Normalizes one consent block of a staff or citizen application projection.
 *
 * Fails closed: anything but an explicit `given: true` reads as no consent,
 * and a missing consent never carries date, version or Stelle.
 */
export function normalizeConsentSummary(value: unknown): ApplicationConsentSummary {
    const block = value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
    if (block.given !== true) {
        return { given: false, at: null, textVersion: null, scopeLabel: null };
    }
    const effectiveAt = optionalString(block.effectiveAt);
    return {
        given: true,
        at: optionalString(block.at),
        ...(effectiveAt ? { effectiveAt } : {}),
        textVersion: optionalString(block.textVersion),
        scopeLabel: optionalString(block.scopeLabel)
    };
}

/**
 * Reads the profileConsent and bankConsent blocks of an application projection.
 */
export function normalizeApplicationConsents(projection: unknown): ApplicationConsents {
    const source = projection && typeof projection === 'object' && !Array.isArray(projection)
        ? projection as Record<string, unknown>
        : {};
    return {
        profileConsent: normalizeConsentSummary(source.profileConsent),
        bankConsent: normalizeConsentSummary(source.bankConsent)
    };
}

/**
 * CRM keys whose values only reach the applicant profile with bank consent.
 */
export const BANK_CONSENT_CRM_KEYS = ['person.iban', 'person.account_holder'] as const;

/**
 * Whether the CRM data of an application holds bank details.
 */
export function crmDataHasBankDetails(crmData: Record<string, unknown> | null | undefined): boolean {
    if (!crmData) return false;
    return BANK_CONSENT_CRM_KEYS.some((key) => {
        const value = crmData[key];
        return value !== undefined && value !== null && value !== '';
    });
}
