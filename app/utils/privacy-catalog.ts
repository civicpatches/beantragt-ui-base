/**
 * Privacy concept catalog.
 *
 * Maps field wording to a catalog concept and a suggested GDPR category
 * (Art. 4 personal data, Art. 9 special categories, Art. 10 offences).
 * Suggestions are hints for a human, never a decision: the editor confirms
 * every classification and owns the form as a whole (product decision
 * 2026-10-17). `not_personal` is never suggested.
 *
 * Measured against cached compiles with tests/eval/privacy-catalog.eval.ts.
 */
import type { FormFieldPrivacyKind, FormSchema } from '../types/form';

/** The field wording the catalog reads; any form field shape fits. */
export interface PrivacyCatalogField {
    type?: string
    label?: string
    description?: string
    placeholder?: string
}

export type SuggestedKind = Exclude<FormFieldPrivacyKind, 'not_personal'>;

export interface PrivacySuggestion {
    concept: string
    kind: SuggestedKind
    /** Why: matched field wording, the section title, or the form purpose. */
    source: 'label' | 'section' | 'purpose'
    /** The matched words (label/section), empty for purpose. */
    match: string
    /** The field may belong to an organisation, not a person: check. */
    organisationContext: boolean
}

interface Concept {
    concept: string
    kind: SuggestedKind
    pattern: RegExp
}

// Order matters: the first match wins, so Art. 10 and Art. 9 come first.
const CONCEPTS: Concept[] = [
    { concept: 'criminal.record', kind: 'criminal_offense', pattern: /vorstraf|straftat|strafverfahren|ermittlungsverfahren|führungszeugnis|fuehrungszeugnis|strafrechtlich|verurteil|criminal/iu },
    // Insurance membership is not health data as such; the hint says so and
    // leaves the decision (other_personal vs. special_category) to a human.
    { concept: 'person.health_insurance', kind: 'other_personal', pattern: /krankenversicher|krankenkasse|pflegeversicher|kv-?mitglied|versicherungsschutz/iu },
    { concept: 'health.condition', kind: 'special_category', pattern: /diagnos|krankheit|erkrank|gesundheit|medikament|arzt|ärzt|aerzt|attest|klinik|krankenhaus|therapie|reha\b|rehabilitation|pflegegrad|pflegebedürf|pflegebeduerf|pflegestufe|hilfsmittel|behinderung|schwerbehind|\bgdb\b|merkzeichen|psychisch|\bsucht|suchterkrank|abhängigkeitserkrank|schwanger|health|medical|disab/iu },
    { concept: 'belief.religion', kind: 'special_category', pattern: /religion|konfession|glaubens|weltanschau|religious/iu },
    { concept: 'origin.ethnic', kind: 'special_category', pattern: /ethnisch|rassisch|ethnic/iu },
    { concept: 'opinion.political', kind: 'special_category', pattern: /politische|partei(?:zugehörig|mitglied)|gewerkschaft/iu },
    { concept: 'biometric', kind: 'special_category', pattern: /biometri|fingerabdr|genetisch/iu },
    { concept: 'sexual.orientation', kind: 'special_category', pattern: /sexuell|sexual/iu },
    { concept: 'person.identifier', kind: 'identity', pattern: /steuer-?\s?id|steueridentifikations|identifikationsnummer|rentenversicherungs|sozialversicherungs|versichertennummer|krankenversicherten|personalausweis|reisepass|ausweisnummer|passnummer|aktenzeichen|kundennummer|personalnummer|tax id|passport/iu },
    { concept: 'person.bank', kind: 'financial', pattern: /\biban\b|\bbic\b|kontoinhaber|kreditinstitut|bankverbindung|kontonummer|bankleitzahl/iu },
    { concept: 'person.finances', kind: 'financial', pattern: /einkommen|einkünfte|einkuenfte|vermögen|vermoegen|rente\b|renten\b|\blohn|gehalt|unterhalt(?!ung)|miete\b|mietzins|wohngeld|unterkunftskosten|kosten der unterkunft|heizkosten|ersparnis|schulden|income/iu },
    { concept: 'person.birth', kind: 'identity', pattern: /geburtsdatum|geburtsort|geburtstag|geburtsname|mädchenname|maedchenname|geb\.\s*am|\bgeboren\b|date of birth|birth/iu },
    { concept: 'person.name', kind: 'identity', pattern: /\b(?:vor|nach|familien|ruf|geburts)?namen?\b|\bname\b|\bvorname|\bnachname|surname|given name/iu },
    { concept: 'person.attributes', kind: 'identity', pattern: /geschlecht|staatsangehörig|staatsangehoerig|nationalität|familienstand|\bgender\b|nationality/iu },
    { concept: 'person.address', kind: 'contact', pattern: /anschrift|adresse|straße|strasse|hausnummer|postleitzahl|\bplz\b|wohnort|wohnsitz|address|postal code/iu },
    { concept: 'person.contact', kind: 'contact', pattern: /telefon|\btel\b|handy|\bmobil(?:nummer|telefon|funk)?\b|e-?mail|\bfax\b|phone/iu },
    { concept: 'person.signature', kind: 'identity', pattern: /unterschrift|signatur|signature/iu },
    { concept: 'person.image', kind: 'identity', pattern: /lichtbild|passbild|\bfoto|photo/iu },
    { concept: 'person.circumstances', kind: 'other_personal', pattern: /\bberuf|arbeitgeber|beschäftig|beschaeftig|ausbildung|studium|\bschule\b|\bschulbesuch|kinder\b|kindes|ehegatt|lebenspartner|haushalt(?!sjahr|smittel|splan|sstelle)|aufenthalt|wohnung|fahrzeug|kennzeichen|\bhund(?!ert)|\btier/iu }
];

const PLACE_ONLY_LABEL = /^\s*(?:ort|stadt|city)\s*$/iu;

const ORGANISATION_CONTEXT = /verein|firma|unternehmen|betrieb|gesellschaft|gmbh|behörde|behoerde|dienststelle|träger|traeger|einrichtung|kita\b|schule|veranstalter|organisation|institution|körperschaft|koerperschaft|amt\b|kommune|gemeinde|stadt\b|kreditinstitut/iu;
// The form's purpose is read from its title and description only: section
// titles like "Krankenversicherung" appear in many non-health forms.
const HEALTH_PURPOSE = /pflege|behinderung|schwerbehind|krankheit|erkrank|gesundheit|sgb\s*(?:ix|xi|v)\b|eingliederungshilfe|rehabilitation|teilhabe/iu;
// Social benefit data is confidential (Sozialgeheimnis) but not Art. 9.
const SOCIAL_PURPOSE = /sozialhilfe|sgb\s*(?:ii|xii)\b|grundsicherung|wohngeld|bürgergeld|buergergeld|elterngeld|bafög|bafoeg|ausbildungsförderung|ausbildungsfoerderung|kinderzuschlag|unterhaltsvorschuss/iu;
// Forms whose applicant is usually an organisation (club grants, subsidies).
const ORGANISATION_PURPOSE = /verein|zuwendung|zuschuss|förderrichtlinie|foerderrichtlinie|träger|traeger|körperschaft|koerperschaft/iu;
const FREE_TEXT_LABEL = /begründung|begruendung|sonstig|bemerkung|erläuter|erlaeuter|anmerkung|weitere angaben|ergänzende|ergaenzende|beschreib|schilder|anlass/iu;
// Office-use parts (budget, cost centre, sign-off by the department head)
// describe the administration, not the applicant: no hint there.
const OFFICE_USE = /amtsleitung|geschäftsstelle|geschaeftsstelle|kontierung|haushaltsmittel|kostenstelle|bearbeitungsvermerk|nur für die (?:behörde|verwaltung|dienststelle)|von der (?:behörde|verwaltung|dienststelle) auszufüllen/iu;
// "Name der Veranstaltung" names a thing or an organisation, not a person.
const NON_PERSON_NAME = /name (?:der|des|von) (?:veranstaltung|einrichtung|schule|kita|projekt|maßnahme|massnahme|firma|verein|organisation|veranstalter|betrieb|unternehmen|gaststätte|gaststaette|hundes|tieres)/iu;
// "Zahl der Beschäftigten" counts people, it does not describe one.
const COUNT_LABEL = /^\s*(?:anzahl|zahl der|gesamtzahl)\b/iu;

export interface FormPrivacyContext {
    health: boolean
    social: boolean
    organisation: boolean
}

function fieldWording(field: PrivacyCatalogField): string {
    return [field.label, field.description, field.placeholder].filter(Boolean).join(' ');
}

/** What the form as a whole is about, from its title and description. */
export function formPrivacyContext(schema: Pick<FormSchema, 'title' | 'description'>): FormPrivacyContext {
    const text = [schema.title, schema.description].filter(Boolean).join(' ');
    return {
        health: HEALTH_PURPOSE.test(text),
        social: SOCIAL_PURPOSE.test(text),
        organisation: ORGANISATION_PURPOSE.test(text)
    };
}

export function suggestPrivacy(
    field: PrivacyCatalogField,
    sectionTitle: string,
    context: FormPrivacyContext
): PrivacySuggestion | null {
    const wording = fieldWording(field);
    if (OFFICE_USE.test(sectionTitle) || OFFICE_USE.test(field.label ?? '')) return null;
    if (NON_PERSON_NAME.test(wording)) return null;
    const organisationContext = context.organisation || ORGANISATION_CONTEXT.test(`${sectionTitle} ${field.label ?? ''}`);
    const isCount = COUNT_LABEL.test(field.label ?? '');
    for (const entry of CONCEPTS) {
        if (isCount && entry.concept === 'person.circumstances') continue;
        const match = wording.match(entry.pattern);
        if (match) {
            return { concept: entry.concept, kind: entry.kind, source: 'label', match: match[0].trim(), organisationContext };
        }
    }
    // A field inside a health section inherits it ("ab/am (Monat/Jahr)" under
    // "Angaben zu Ihren Gesundheitsstörungen").
    const health = CONCEPTS.find(entry => entry.concept === 'health.condition');
    if (health && health.pattern.test(sectionTitle)) {
        return { concept: 'health.condition', kind: 'special_category', source: 'section', match: sectionTitle, organisationContext };
    }
    // A lone place word is an address part only under an address or
    // residence section ("Ort" under "Wohnsitz"), not as a destination or venue.
    const address = CONCEPTS.find(entry => entry.concept === 'person.address');
    if (address && PLACE_ONLY_LABEL.test(field.label ?? '') && address.pattern.test(sectionTitle)) {
        return { concept: 'person.address', kind: 'contact', source: 'section', match: sectionTitle, organisationContext };
    }
    const freeText = field.type === 'textarea' || FREE_TEXT_LABEL.test(wording);
    if (freeText && context.health) {
        return { concept: 'free_text.health', kind: 'special_category', source: 'purpose', match: '', organisationContext };
    }
    if (freeText && context.social) {
        return { concept: 'free_text.social', kind: 'other_personal', source: 'purpose', match: '', organisationContext };
    }
    return null;
}
