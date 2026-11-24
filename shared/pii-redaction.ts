export type PiiKind = 'address'
  | 'bic'
  | 'birthdate'
  | 'email'
  | 'iban'
  | 'name'
  | 'phone'
  | 'social_insurance'
  | 'tax_id';

export interface PiiFinding {
    kind: PiiKind
    start: number
    end: number
}

export interface PiiScanResult {
    findings: PiiFinding[]
    kinds: PiiKind[]
    hasPii: boolean
}

export interface PiiScrubResult extends PiiScanResult {
    text: string
    scrubbed: boolean
}

interface PatternDefinition {
    kind: PiiKind
    regex: RegExp
    group?: number
    validate?: (value: string) => boolean
}

const MASKS: Record<PiiKind, string> = {
    address: '[Adresse entfernt]',
    iban: '[IBAN entfernt]',
    bic: '[BIC entfernt]',
    birthdate: '[Geburtsdatum entfernt]',
    email: '[E-Mail entfernt]',
    name: '[Name entfernt]',
    phone: '[Telefonnummer entfernt]',
    social_insurance: '[Versicherungsnummer entfernt]',
    tax_id: '[Steuer-ID entfernt]'
};

function isValidIban(value: string): boolean {
    const normalized = value.replace(/[\s.-]/g, '').toUpperCase();
    if (normalized.length < 15 || normalized.length > 34 || !/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(normalized)) {
        return false;
    }

    let remainder = 0;
    const rearranged = normalized.slice(4) + normalized.slice(0, 4);
    for (const char of rearranged) {
        const expanded = /\d/.test(char) ? char : String(char.charCodeAt(0) - 55);
        for (const digit of expanded) {
            remainder = (remainder * 10 + Number(digit)) % 97;
        }
    }
    return remainder === 1;
}

const PATTERNS: PatternDefinition[] = [
    {
        kind: 'email',
        regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu
    },
    {
        kind: 'iban',
        regex: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/giu,
        validate: isValidIban
    },
    {
        kind: 'iban',
        regex: /\b[A-Z]{2}\d{2}(?:[ .-][A-Z0-9]{4}){3,7}(?:[ .-][A-Z0-9]{1,4})?\b/giu,
        validate: isValidIban
    },
    {
        kind: 'bic',
        regex: /\b(?:BIC|SWIFT)\s*[:#-]?\s*([A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?)\b/giu,
        group: 1
    },
    {
        kind: 'tax_id',
        regex: /\b(?:steuer(?:identifikationsnummer|[ -]?id|nummer)?|tax[ -]?id|identifikationsnummer)\s*[:#-]?\s*(\d(?:[\s-]?\d){10})\b/giu,
        group: 1,
        validate: value => value.replace(/\D/g, '').length === 11
    },
    {
        kind: 'social_insurance',
        regex: /\b(?:sozialversicherungsnummer|rentenversicherungsnummer|krankenversichertennummer|versicherungsnummer|social\s+security\s+number|national\s+insurance\s+number|insurance\s+number)\s*[:#-]?\s*((?:[A-Z]{1,4}[-/]?)?\d(?:[\s/-]?\d){5,17}(?:[\s/-]?[A-Z])?(?:[\s/-]?\d){0,6})\b/giu,
        group: 1
    },
    {
        kind: 'name',
        regex: /\b(?:vollst(?:ae|ä)ndiger\s+name|vorname(?:\s+und\s+nachname)?|nachname|familienname|name)\s*[:#-]\s*([\p{L}][\p{L}'-]{1,}(?:\s+[\p{L}][\p{L}'-]{1,}){0,3})\b/giu,
        group: 1,
        validate: value => value.replace(/[^\p{L}]/gu, '').length >= 3
    },
    {
        kind: 'birthdate',
        regex: /\b(?:geburtsdatum|geboren(?:\s+am)?|geb\.?)\s*[:#-]?\s*(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})\b/giu,
        group: 1
    },
    {
        kind: 'address',
        regex: /\b((?:[\p{Lu}][\p{L}.'-]{1,40}\s+){0,3}[\p{Lu}][\p{L}.'-]{1,40}(?:straße|strasse|str\.|weg|allee|platz|ring|gasse|damm|ufer)\s+\d{1,5}\s?[a-z]?)\b/giu,
        group: 1
    },
    {
        kind: 'address',
        regex: /\b(?:adresse|anschrift|wohnanschrift)\s*[:#-]\s*([^\n,;]{5,120})/giu,
        group: 1,
        validate: value => /\d/.test(value) && /(?:straße|strasse|str\.|weg|allee|platz|ring|gasse|damm|ufer|\d{5})/iu.test(value)
    },
    {
        kind: 'phone',
        regex: /(^|[^\w@])((?:\+\d{1,3}|00\d{1,3})(?:[\s()./-]*\d){6,14})(?![\w@])/g,
        group: 2,
        validate: (value) => {
            const digits = value.replace(/\D/g, '');
            return digits.length >= 8 && digits.length <= 15;
        }
    },
    {
        kind: 'phone',
        regex: /(^|[^\w@])(\(?(?:\+49|0049|0)\)?(?:[\s()./-]*\d){6,14})(?![\w@])/g,
        group: 2,
        validate: (value) => {
            const digits = value.replace(/\D/g, '');
            return digits.length >= 7 && digits.length <= 15;
        }
    }
];

function uniqueKinds(findings: PiiFinding[]): PiiKind[] {
    return [...new Set(findings.map(finding => finding.kind))];
}

function groupOffset(match: RegExpMatchArray, group: number): number {
    const value = match[group];
    if (!value) return 0;
    const index = match[0].indexOf(value);
    return index >= 0 ? index : 0;
}

function removeOverlaps(findings: PiiFinding[]): PiiFinding[] {
    const sorted = [...findings].sort((a, b) =>
        a.start - b.start || (b.end - b.start) - (a.end - a.start)
    );
    const accepted: PiiFinding[] = [];

    for (const finding of sorted) {
        const overlaps = accepted.some(existing =>
            finding.start < existing.end && finding.end > existing.start
        );
        if (!overlaps) accepted.push(finding);
    }

    return accepted.sort((a, b) => a.start - b.start);
}

export function detectPii(text: string): PiiScanResult {
    const findings: PiiFinding[] = [];

    for (const pattern of PATTERNS) {
        for (const match of text.matchAll(pattern.regex)) {
            const value = pattern.group ? match[pattern.group] : match[0];
            if (!value || (pattern.validate && !pattern.validate(value))) continue;

            const start = (match.index ?? 0) + (pattern.group ? groupOffset(match, pattern.group) : 0);
            findings.push({
                kind: pattern.kind,
                start,
                end: start + value.length
            });
        }
    }

    const merged = removeOverlaps(findings);
    return {
        findings: merged,
        kinds: uniqueKinds(merged),
        hasPii: merged.length > 0
    };
}

export function scrubPii(text: string): PiiScrubResult {
    const scan = detectPii(text);
    let scrubbedText = text;

    for (const finding of [...scan.findings].sort((a, b) => b.start - a.start)) {
        scrubbedText = scrubbedText.slice(0, finding.start) + MASKS[finding.kind] + scrubbedText.slice(finding.end);
    }

    return {
        ...scan,
        text: scrubbedText,
        scrubbed: scan.hasPii
    };
}
