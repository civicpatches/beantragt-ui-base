/**
 * Types for the applicant Drupal entity.
 *
 * Drupal entity: applicant (beantragt_applicant module)
 * JSON:API type: applicant--applicant
 *
 * The profile stores recurring personal or company data for cross-form
 * pre-filling via CRM key mapping. A profile is identified either by
 * a Drupal user account (uid) or a session token (field_session_token)
 * for anonymous citizens.
 *
 * Drupal fields:
 *   field_full_name (string)        field_first_name (string)
 *   field_last_name (string)        field_birthdate (string)
 *   field_address (string)          field_street (string)
 *   field_postal_code (string)      field_city (string)
 *   field_phone (string)            field_email (email)
 *   field_iban (string)             field_gender (string)
 *   field_nationality (string)      field_marital_status (string)
 *   field_tax_id (string)           field_session_token (string)
 */

/**
 * Whether the profile represents a natural person or a company.
 * Currently Drupal only stores person fields. Company fields are planned
 * and typed here for frontend readiness.
 */
export type ProfileType = 'person' | 'company';

/**
 * Frontend representation of a citizen/applicant profile.
 * Combines person and company fields in a single interface.
 * Field names use camelCase (mapped from Drupal's field_ prefix snake_case).
 */
export interface ApplicantProfile {
    /** Drupal entity ID. */
    id: string
    /** Profile type discriminator. */
    type: ProfileType

    // --- Person fields (map to Drupal field_* base fields) ---

    /** field_full_name */
    fullName?: string
    /** field_first_name */
    firstName?: string
    /** field_last_name */
    lastName?: string
    /** field_birthdate (string for format flexibility) */
    birthdate?: string
    /** field_gender */
    gender?: string
    /** field_nationality */
    nationality?: string
    /** field_marital_status */
    maritalStatus?: string
    /** field_tax_id (Steuerliche Identifikationsnummer) */
    taxId?: string

    // --- Company fields (planned, not yet in Drupal entity) ---

    /** Company name. Maps to future company.name CRM key. */
    companyName?: string
    /** Handelsregisternummer. Maps to future company.register_number CRM key. */
    registerNumber?: string
    /** Umsatzsteuer-ID. Maps to future company.vat_id CRM key. */
    vatId?: string
    /** Primary contact person at the company. */
    contactPerson?: string
    /** Legal form (GmbH, UG, e.V., etc.). */
    legalForm?: string

    // --- Shared fields (used by both person and company profiles) ---

    /** field_address (full address line) */
    address?: string
    /** field_street */
    street?: string
    /** field_postal_code */
    postalCode?: string
    /** field_city */
    city?: string
    /** field_phone */
    phone?: string
    /** field_email */
    email?: string
    /** field_iban */
    iban?: string
    /** field_account_holder */
    accountHolder?: string
}

/**
 * Map from CRM key to the corresponding ApplicantProfile property name.
 * Used to pre-fill form fields from profile data and to write back
 * submitted CRM data to the profile.
 */
export const CRM_KEY_TO_PROFILE_FIELD: Record<string, keyof ApplicantProfile> = {
    'person.full_name': 'fullName',
    'person.first_name': 'firstName',
    'person.last_name': 'lastName',
    'person.birthdate': 'birthdate',
    'person.gender': 'gender',
    'person.nationality': 'nationality',
    'person.marital_status': 'maritalStatus',
    'person.tax_id': 'taxId',
    'person.address': 'address',
    'person.street': 'street',
    'person.postal_code': 'postalCode',
    'person.city': 'city',
    'person.phone': 'phone',
    'person.email': 'email',
    'person.iban': 'iban',
    'person.account_holder': 'accountHolder',
    'company.name': 'companyName',
    'company.register_number': 'registerNumber',
    'company.vat_id': 'vatId',
    'company.contact_person': 'contactPerson',
    'company.legal_form': 'legalForm'
} as const;
