import type { ApplicantProfile } from '../types/profile';
import type { FormFieldType, FormFieldPrivacyKind } from '../types/form';
import { isSensitiveFlag } from './form-schema';

export type ApplicantPrefillProfile = Partial<Pick<ApplicantProfile,
  'fullName' | 'firstName' | 'lastName' | 'email' | 'phone' | 'address' | 'street' | 'postalCode' | 'city'
  | 'birthdate' | 'gender' | 'nationality' | 'maritalStatus'
>>;

/**
 * Profile value a form field receives. The profile keeps street and house
 * number in one field; `houseNumber` is the number split off that street
 * for a form that asks for it apart (see splitStreetAndHouseNumber()).
 */
export type ProfilePrefillProperty = keyof ApplicantPrefillProfile | 'houseNumber';

export const PROFILE_PROPERTY_BY_PUBLIC_CRM_KEY = {
    'person.full_name': 'fullName',
    'person.first_name': 'firstName',
    'person.last_name': 'lastName',
    'person.email': 'email',
    'person.phone': 'phone',
    'person.address': 'address',
    'person.street': 'street',
    'person.house_number': 'houseNumber',
    'person.postal_code': 'postalCode',
    'person.city': 'city',
    'person.birthdate': 'birthdate',
    'person.gender': 'gender',
    'person.nationality': 'nationality',
    'person.marital_status': 'maritalStatus'
} as const satisfies Record<string, ProfilePrefillProperty>;

export type PublicProfileCrmKey = keyof typeof PROFILE_PROPERTY_BY_PUBLIC_CRM_KEY;

interface ProfilePrefillFieldContract {
    type?: unknown
    crm_key?: unknown
    sensitive?: unknown
    privacy?: unknown
}

const PERSONAL_PROFILE_PRIVACY_KINDS = new Set<FormFieldPrivacyKind>(['contact', 'identity']);
const PROFILE_FIELD_TYPES: Record<PublicProfileCrmKey, readonly FormFieldType[]> = {
    'person.full_name': ['text'],
    'person.first_name': ['text'],
    'person.last_name': ['text'],
    'person.email': ['email'],
    'person.phone': ['tel'],
    'person.address': ['address', 'textarea', 'text'],
    'person.street': ['text', 'textarea'],
    'person.house_number': ['text'],
    'person.postal_code': ['text'],
    'person.city': ['text'],
    // Registered identity data, mirrors
    // PublicFormApiController::PUBLIC_PROFILE_CRM_FIELD_TYPES.
    'person.birthdate': ['date'],
    'person.gender': ['select', 'radio', 'text'],
    'person.nationality': ['select', 'text'],
    'person.marital_status': ['select', 'radio', 'text']
};

/**
 * Resolves an explicitly reusable profile field from public schema metadata.
 *
 * The CRM key alone is not sufficient: prefill is permitted only for ordinary
 * contact or identity fields with a compatible widget type. This prevents a
 * home address from being inserted into a non-personal property address or a
 * sensitive procedure field.
 */
export function profilePropertyForPrefillField(
    field: ProfilePrefillFieldContract
): ProfilePrefillProperty | null {
    if (isSensitiveFlag(field.sensitive)) return null;

    const crmKey = typeof field.crm_key === 'string' ? field.crm_key.trim() : '';
    if (!Object.hasOwn(PROFILE_PROPERTY_BY_PUBLIC_CRM_KEY, crmKey)) return null;
    const publicCrmKey = crmKey as PublicProfileCrmKey;

    const fieldType = typeof field.type === 'string' ? field.type : '';
    if (!PROFILE_FIELD_TYPES[publicCrmKey].includes(fieldType as FormFieldType)) return null;

    const privacy = field.privacy;
    const privacyKind = privacy && typeof privacy === 'object' && !Array.isArray(privacy)
        ? (privacy as { kind?: unknown }).kind
        : null;
    if (typeof privacyKind !== 'string' || !PERSONAL_PROFILE_PRIVACY_KINDS.has(privacyKind as FormFieldPrivacyKind)) {
        return null;
    }

    return PROFILE_PROPERTY_BY_PUBLIC_CRM_KEY[publicCrmKey];
}

interface ProfilePrefillOptionField {
    type?: unknown
    options?: unknown
    i18n?: unknown
}

function normalizedChoice(value: string): string {
    return value.normalize('NFC').trim().toLocaleLowerCase('de');
}

/**
 * Picks the option of a select or radio field that a profile value names.
 *
 * The profile keeps the value of the form it came from, which may be another
 * form with other options. A value prefills only when it equals an option
 * value or one of its translated labels (case and surrounding spaces
 * ignored); the option value is returned. Anything else, including an
 * ambiguous label, is not set.
 */
export function profileOptionValue(field: ProfilePrefillOptionField, profileValue: string): string | null {
    const options = Array.isArray(field.options)
        ? field.options.filter((option): option is string => typeof option === 'string' && option.trim() !== '')
        : [];
    if (options.length === 0) return null;
    const wanted = normalizedChoice(profileValue);
    if (!wanted) return null;

    const byValue = options.filter(option => normalizedChoice(option) === wanted);
    if (byValue.length === 1) return byValue[0]!;
    if (byValue.length > 1) return null;

    const matches = new Set<string>();
    const translations = field.i18n && typeof field.i18n === 'object' && !Array.isArray(field.i18n)
        ? Object.values(field.i18n as Record<string, unknown>)
        : [];
    for (const translation of translations) {
        const labels = translation && typeof translation === 'object'
            ? (translation as { options?: unknown }).options
            : null;
        if (!labels || typeof labels !== 'object') continue;
        if (Array.isArray(labels)) {
            // Array form: labels map by index onto the raw option list, like
            // getLocalizedFormFieldOptionLabel() in the renderer.
            const rawOptions = Array.isArray(field.options) ? field.options : [];
            labels.forEach((label, index) => {
                const option = rawOptions[index];
                if (typeof label === 'string' && typeof option === 'string' && options.includes(option) && normalizedChoice(label) === wanted) {
                    matches.add(option);
                }
            });
            continue;
        }
        for (const [option, label] of Object.entries(labels as Record<string, unknown>)) {
            if (typeof label === 'string' && options.includes(option) && normalizedChoice(label) === wanted) {
                matches.add(option);
            }
        }
    }
    return matches.size === 1 ? [...matches][0]! : null;
}

/**
 * Normalizes a stored date of birth for a date field (YYYY-MM-DD).
 *
 * Accepts the ISO form and the German DD.MM.YYYY form a sign-in may deliver;
 * anything else, including impossible dates, is not set.
 */
export function profileDateValue(profileValue: string): string | null {
    const value = profileValue.trim();
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
    const german = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/u.exec(value);
    const parts = iso
        ? { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) }
        : german
            ? { year: Number(german[3]), month: Number(german[2]), day: Number(german[1]) }
            : null;
    if (!parts) return null;
    const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
    if (date.getUTCFullYear() !== parts.year || date.getUTCMonth() !== parts.month - 1 || date.getUTCDate() !== parts.day) {
        return null;
    }
    return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

// A German house number at the end of a street line: "1", "12a", "12 a",
// "12-14", "12/1". Everything before it is the street name.
const TRAILING_HOUSE_NUMBER = /^(.*\S)\s+(\d+(?:\s?[a-z])?(?:\s?[-/]\s?\d+(?:\s?[a-z])?)?)$/iu;

/**
 * Splits a stored street line into street name and house number.
 *
 * The profile keeps both in one field ("Marktplatz 1"); forms that follow
 * FIM ask for them apart. Returns null when the line does not end with a
 * house number, so the caller keeps the line as it is.
 */
export function splitStreetAndHouseNumber(streetLine: string): { street: string, houseNumber: string } | null {
    const match = TRAILING_HOUSE_NUMBER.exec(streetLine.trim());
    if (!match) return null;
    return { street: match[1]!.trim(), houseNumber: match[2]!.replace(/\s+/gu, '') };
}
