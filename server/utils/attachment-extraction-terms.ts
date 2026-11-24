import { scrubPii } from '#shared/pii-redaction';

// Keys and labels the attachment pre-check never reads, even when a result
// schema asks for them: names, contact data, addresses and identifiers.
// Shared by the analysis pipeline and the form assistant's schema proposals,
// so this module stays free of provider and persistence imports.
const UNSAFE_EXTRACTED_FIELD_PATTERN = /(^|[_.\s-])(name|vorname|nachname|familienname|fullname|full_name|applicant|antragsteller|antragstellerin|bauherr|bauherrin|e-?mail|email|telefon|phone|iban|bic|konto|bank|adresse|anschrift|street|strasse|straße|hausnummer|plz|postal|wohnort|birth|geburt|tax|steuer|ausweis|passport|personalausweis)($|[_.\s-])/iu;
const UNSAFE_EXTRACTED_FIELD_TERMS = [
    // Identifiers printed on payslips and benefit notices.
    'versicherungsnummer',
    'sozialversicherung',
    'rentenversicherung',
    'svnummer',
    'kundennummer',
    'kundennr',
    'mitarbeiter',
    'personalnummer',
    'personalnr',
    'betriebsnummer',
    'kennung',
    'aktenzeichen',
    'name',
    'fullname',
    'firstname',
    'lastname',
    'surname',
    'familyname',
    'vorname',
    'nachname',
    'familienname',
    'person',
    'contact',
    'kontakt',
    'customer',
    'client',
    'citizen',
    'resident',
    'residence',
    'einwohner',
    'buerger',
    'bürger',
    'owner',
    'eigentuemer',
    'eigentümer',
    'representative',
    'vertreter',
    'vertreterin',
    'bevollmaechtigt',
    'bevollmächtigt',
    'applicant',
    'antragsteller',
    'bauherr',
    'email',
    'mail',
    'telefon',
    'tel',
    'phone',
    'mobile',
    'handy',
    'cell',
    'cellphone',
    'fax',
    'iban',
    'bic',
    'konto',
    'bank',
    'addr',
    'address',
    'addressline',
    'adresse',
    'anschrift',
    'street',
    'strasse',
    'straße',
    'hausnummer',
    'postalcode',
    'postcode',
    'zipcode',
    'plz',
    // Concrete residence terms only: a bare 'wohn' would also hit facts
    // about the dwelling such as "Wohnflaeche".
    'wohnort',
    'wohnsitz',
    'wohnadresse',
    'wohnanschrift',
    'meldeanschrift',
    'wohnhaft',
    'ansaessig',
    'ansässig',
    'birth',
    'birthday',
    'birthdate',
    'dateofbirth',
    'dob',
    'geburt',
    'geburtstag',
    'geburtsdatum',
    'tax',
    'taxid',
    'taxnumber',
    'taxpayer',
    'steuer',
    'steuerid',
    'steuernummer',
    'steueridentifikationsnummer',
    'ssn',
    'socialsecurity',
    'nationalinsurance',
    'nationalid',
    'identity',
    'identitaet',
    'identität',
    'personid',
    'residentid',
    'ausweis',
    'passport',
    'personalausweis',
    'driverlicense',
    'license',
    'plate',
    'vehicle',
    'fahrzeug',
    'kfz',
    'licenseplate',
    'kennzeichen',
    'krankenversicherung',
    'healthinsurance'
] as const;
/**
 * Terms that are unsafe as a value (a signature image, a signer's name) but
 * fine as a yes/no fact about the document itself, such as
 * "signature_present": it says that a signature is there, not whose.
 */
const VALUE_ONLY_UNSAFE_TERMS = [
    'signature',
    'unterschrift'
] as const;

function hasUnsafeTerm(values: Array<string | undefined>, terms: readonly string[]): boolean {
    return values.some((value) => {
        if (!value) return false;
        const normalized = value.trim();
        const compact = normalized.toLowerCase().replace(/[\s_.:-]+/gu, '');
        const hasUnsafeCompactTerm = terms.some(term => term.length >= 4
            ? compact.includes(term)
            : compact === term);
        return UNSAFE_EXTRACTED_FIELD_PATTERN.test(normalized)
        // Three-character abbreviations such as "tel" must never be
        // treated as arbitrary substrings. They remain unsafe when they
        // are the complete extraction key, but not in "dargestellt".
          || hasUnsafeCompactTerm
          || scrubPii(normalized).hasPii;
    });
}

const VALUE_TERMS: readonly string[] = [...UNSAFE_EXTRACTED_FIELD_TERMS, ...VALUE_ONLY_UNSAFE_TERMS];

/** True when a key, title or type names something that is never read as a value. */
export function hasUnsafeExtractionSignal(...values: Array<string | undefined>): boolean {
    return hasUnsafeTerm(values, VALUE_TERMS);
}

/**
 * The same check for a non-personal yes/no fact about the document. It
 * admits the value-only terms, so "signature_present" passes while a
 * signature as a value or a signer's name stays blocked.
 */
export function hasUnsafeDocumentFactSignal(...values: Array<string | undefined>): boolean {
    return hasUnsafeTerm(values, UNSAFE_EXTRACTED_FIELD_TERMS);
}
