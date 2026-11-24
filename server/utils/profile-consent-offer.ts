import type { ProfileConsentOffer, ProfileConsentOffers } from '~~/app/types/form';

export function isProfileConsentOfferId(value: unknown): value is string {
    return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value) && value.length === 64;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasText(value: unknown): value is string {
    return typeof value === 'string' && value.trim() !== '';
}

function readOffer(value: unknown): ProfileConsentOffer | null | undefined {
    if (value === null) return null;
    if (!isRecord(value)) return;
    const { id, textVersion, text, fields } = value;
    if (isProfileConsentOfferId(id) && hasText(textVersion) && hasText(text)
      && Array.isArray(fields) && fields.length > 0 && fields.every(hasText)) {
        return { id, textVersion, text, fields };
    }
}

function readLanguage(value: unknown): ProfileConsentOffers['de'] | null {
    if (!isRecord(value)) return null;
    const contact = readOffer(value.contact);
    const bank = readOffer(value.bank);
    if (contact === undefined || bank === undefined || (!contact && bank)) return null;
    return { contact, bank };
}

/** Read the public projection without modifying its wording or forwarding extra attributes. */
export function parseProfileConsentOffers(raw: unknown): ProfileConsentOffers | null {
    if (typeof raw !== 'string') return null;
    try {
        const value: unknown = JSON.parse(raw);
        if (!isRecord(value)) return null;
        const de = readLanguage(value.de);
        const en = readLanguage(value.en);
        return de && en ? { de, en } : null;
    } catch {
        return null;
    }
}
