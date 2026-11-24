export interface StatusBoilerplateCandidate {
    id: string
    title: string
    text?: string
    body?: {
        value?: string
        processed?: string
    }
}

export interface StatusBoilerplateTarget {
    machineName?: string
    label?: string
    semanticFlags?: string[]
}

const SEMANTIC_KEYWORDS: Record<string, string[]> = {
    request_info: [
        'Rückfrage',
        'Nachforderung',
        'nachreichen',
        'Nachweis',
        'Unterlagen',
        'Angaben',
        'ergänzen',
        'fehlend',
        'benötigen',
        'erforderlich',
        'Frage'
    ],
    hand_over: ['Weiterleitung', 'Fachverfahren'],
    approved: ['positiv', 'Genehmigung', 'bewilligt', 'Freigabe', 'Auflagen'],
    rejected: ['negativ', 'Ablehnung', 'abgelehnt', 'Begründung', 'nicht positiv'],
    decision_issued: ['Bescheid', 'beschieden', 'Entscheidung'],
    filed: ['Ablage', 'abgelegt', 'E-Akte'],
    closed: ['geschlossen', 'erledigt', 'Abschluss', 'abschließen', 'beantwortet'],
    withdrawn: ['zurückgezogen', 'zurücknehmen']
};

export function statusBoilerplateText(boilerplate: StatusBoilerplateCandidate): string {
    return boilerplate.text || boilerplate.body?.value || boilerplate.body?.processed || '';
}

function normalizeText(value: string | undefined): string {
    return (value ?? '')
        .replace(/ß/gu, 'ss')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/gu, '')
        .toLowerCase();
}

function targetTerms(target: StatusBoilerplateTarget): string[] {
    const text = normalizeText(`${target.label ?? ''} ${target.machineName ?? ''}`);
    return [...new Set(text.split(/[^a-z0-9]+/u).filter(term => term.length >= 4))];
}

function matchScore(boilerplate: StatusBoilerplateCandidate, target: StatusBoilerplateTarget): number {
    const title = normalizeText(boilerplate.title);
    const body = normalizeText(statusBoilerplateText(boilerplate));
    const haystack = `${title} ${body}`;
    let score = 0;

    for (const flag of target.semanticFlags ?? []) {
        for (const keyword of SEMANTIC_KEYWORDS[flag] ?? []) {
            const needle = normalizeText(keyword);
            if (!needle) continue;
            if (title.includes(needle)) score += 12;
            if (body.includes(needle)) score += 6;
        }
    }

    for (const term of targetTerms(target)) {
        if (title.includes(term)) score += 4;
        if (haystack.includes(term)) score += 2;
    }

    return score;
}

export function recommendStatusBoilerplate(
    boilerplates: StatusBoilerplateCandidate[],
    target: StatusBoilerplateTarget | null | undefined
): StatusBoilerplateCandidate | null {
    if (!target || boilerplates.length === 0) return null;

    const scored = boilerplates
        .map((boilerplate, index) => ({
            boilerplate,
            index,
            score: matchScore(boilerplate, target)
        }))
        .filter(candidate => candidate.score > 0)
        .sort((a, b) => (b.score - a.score) || (a.index - b.index));

    return scored[0]?.boilerplate ?? null;
}
