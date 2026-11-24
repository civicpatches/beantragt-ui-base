const PRECHECK_PERSONAL_DATA_QUESTION_PATTERN = /(?:\b(?:wie|welches)\s+alt(?:er)?\s+(?:sind|bist|haben|hast)\s+(?:sie|du)\b|\bwann\s+(?:wurden\s+sie|wurdest\s+du)\s+geboren\b|\bsind\s+sie\s+verheiratet\b|\bbist\s+du\s+verheiratet\b|\b(?:ihr|dein|euer)\s+(?:lebens)?alter\b|\b(?:how\s+old\s+are\s+you|what\s+is\s+your\s+age|when\s+were\s+you\s+born|are\s+you\s+married|(?:your|applicant'?s)\s+age)\b|\b(?:name\w*|vorname\w*|nachname\w*|geburts(?:datum|ort)?\w*|geschlecht\w*|familienstand\w*|nationalit[aä]t\w*|staatsangeh[oö]rigkeit\w*|einkommen\w*|verm[oö]gen\w*|gesundheit\w*|behinder\w*|schwanger\w*|religion\w*|ethni\w*|herkunft\w*|rasse\w*|politisch\w*|gewerkschaft\w*|biometr\w*|genetisch\w*|sexuell\w*|straf\w*|vorstraf\w*|anschrift\w*|adresse\w*|postleitzahl\w*|e-?mail\w*|telefon\w*|iban\w*|konto\w*|steuer(?:identifikationsnummer|-?id|nummer)?\w*|kennzeichen\w*|aktenzeichen\w*|vorgangsnummer\w*|antragsnummer\w*|kundennummer\w*|passnummer\w*|ausweisnummer\w*|sozialversicherungsnummer\w*|rentenversicherungsnummer\w*|krankenversichertennummer\w*|versicherungsnummer\w*|birth(?:date|place)?\w*|gender\w*|marital\s+status\w*|nationality\w*|citizenship\w*|income\w*|wealth\w*|health\w*|disab\w*|pregnan\w*|religio\w*|ethni\w*|race\w*|politic\w*|union\w*|biometr\w*|genetic\w*|sexual\w*|criminal\w*|conviction\w*|address\w*|postcode\w*|postal\s+code\w*|e-?mail\w*|phone\w*|iban\w*|account\w*|tax\s*(?:id|number)\w*|licen[cs]e\s+plate\w*|case\s+number\w*|reference\s+number\w*|application\s+number\w*|customer\s+number\w*|passport\s+number\w*|identity\s+document\s+number\w*|social\s+security\s+number\w*|national\s+insurance\s+number\w*|insurance\s+number\w*)\b)/iu;

const PRECHECK_PERSONAL_DATA_METADATA_PATTERN = /(?:\b(?:applicant|applicant'?s|antragsteller|antragstellende|citizen|bürger|buerger|person|user)[ _./:-]*(?:age|alter|birth|geburt|marital|familienstand|gender|geschlecht|nationality|nationalität|nationalitaet|citizenship|staatsangehörigkeit|staatsangehoerigkeit|income|einkommen|health|gesundheit|address|anschrift|adresse|contact|kontakt)\b|\b(?:age|alter|birth|geburt|marital|familienstand|gender|geschlecht|nationality|nationalität|nationalitaet|citizenship|staatsangehörigkeit|staatsangehoerigkeit|income|einkommen|health|gesundheit)[ _./:-]*(?:of|von)?[ _./:-]*(?:applicant|antragsteller|citizen|bürger|buerger|person|user)\b)/iu;
const PRECHECK_PERSONAL_DATA_PARAPHRASE_PATTERN = /(?:\bin\s+welchem\s+jahr\s+(?:sind|wurden)\s+sie\s+geboren\b|\bwelcher\s+altersgruppe\b|\bleben\s+sie\s+in\s+einer\s+ehe\b|\bwelche\s+staatsbürgerschaft\b|\baus\s+welchem\s+land\s+stammen\s+sie\b|\bwhat\s+year\s+were\s+you\s+born\b|\bwhich\s+age\s+group\b|\bdo\s+you\s+live\s+in\s+a\s+marriage\b|\bwhat\s+citizenship\b|\bwhich\s+country\s+are\s+you\s+from\b)/iu;
const PRECHECK_INSTRUCTION_INJECTION_PATTERN = /(?:\b(?:ignoriere|ignorieren|missachte|missachten|vergiss|überschreibe|ueberschreibe)\b.{0,80}\b(?:vorherige|bisherige|system|entwickler)\b.{0,50}\b(?:anweisung(?:en)?|nachricht(?:en)?|prompt)\b|\b(?:ignore|disregard|forget|override)\b.{0,80}\b(?:previous|prior|system|developer)\b.{0,50}\b(?:instructions?|messages?|prompts?)\b|\b(?:systemprompt|entwicklernachricht|developer\s+message|system\s+prompt)\b)/iu;

interface PrecheckCriterionSafetyInput {
    id?: unknown
    factKey?: unknown
    fieldId?: unknown
    label?: unknown
    question?: unknown
    unit?: unknown
    options?: unknown
}

function flattenCriterionText(value: unknown): string[] {
    if (typeof value === 'string') return [value];
    if (Array.isArray(value)) return value.flatMap(flattenCriterionText);
    if (value && typeof value === 'object') {
        return Object.values(value as Record<string, unknown>).flatMap(flattenCriterionText);
    }
    return [];
}

/**
 * Returns true when a precheck question asks for blocked personal data.
 *
 * Ordinary case facts can participate in a reviewed precheck. Direct
 * identifiers, contact details, protected attributes and other blocked
 * personal data stay in normal form widgets and never become
 * assistant-generated follow-up questions.
 */
export function precheckQuestionRequestsPersonalData(question: string): boolean {
    return PRECHECK_PERSONAL_DATA_QUESTION_PATTERN.test(question)
      || PRECHECK_PERSONAL_DATA_PARAPHRASE_PATTERN.test(question)
      || PRECHECK_INSTRUCTION_INJECTION_PATTERN.test(question);
}

/**
 * Rejects a criterion whose complete semantics request blocked personal data.
 *
 * Model output can disguise a sensitive criterion behind a neutral question.
 * Machine keys, labels, units and enum options therefore participate in the
 * same policy decision as the localized question.
 */
export function precheckCriterionRequestsPersonalData(
    criterion: PrecheckCriterionSafetyInput
): boolean {
    const questions = flattenCriterionText(criterion.question);
    if (questions.some(precheckQuestionRequestsPersonalData)) return true;

    const metadata = flattenCriterionText({
        id: criterion.id,
        factKey: criterion.factKey,
        fieldId: criterion.fieldId,
        label: criterion.label,
        unit: criterion.unit,
        options: criterion.options
    }).join(' ');

    return PRECHECK_PERSONAL_DATA_QUESTION_PATTERN.test(metadata)
      || PRECHECK_PERSONAL_DATA_PARAPHRASE_PATTERN.test(metadata)
      || PRECHECK_PERSONAL_DATA_METADATA_PATTERN.test(metadata)
      || PRECHECK_INSTRUCTION_INJECTION_PATTERN.test(metadata);
}
