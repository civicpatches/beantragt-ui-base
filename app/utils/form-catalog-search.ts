export interface FormCatalogSearchItem {
    title: string
    description?: string | null
}

export function normalizeFormCatalogSearchText(value: string): string {
    return value
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLocaleLowerCase()
        .trim();
}

const NATURAL_QUERY_FILLER_WORDS = new Set([
    'brauche',
    'guten',
    'hallo',
    'helfen',
    'ein',
    'eine',
    'einen',
    'ich',
    'mein',
    'meine',
    'meinen',
    'mochte',
    'mir',
    'muss',
    'bitte',
    'konnen',
    'sie',
    'tag',
    'will',
    'wurde',
    'for',
    'hello',
    'help',
    'like',
    'can',
    'you',
    'need',
    'please',
    'want',
    'would'
]);

function significantQueryTokens(query: string): string[] {
    return query
        .split(/[^\p{L}\p{N}]+/u)
        .filter(token => token.length >= 3 && !NATURAL_QUERY_FILLER_WORDS.has(token));
}

/** Filter the localized catalog locally. An empty query preserves its order. */
export function filterFormCatalog<T extends FormCatalogSearchItem>(forms: T[], query: string): T[] {
    const needle = normalizeFormCatalogSearchText(query);
    if (!needle) return forms;

    const queryTokens = significantQueryTokens(needle);
    const requiredTokenMatches = queryTokens.length === 1
        ? 1
        : Math.max(2, Math.ceil(queryTokens.length * 0.6));

    return forms.filter((form) => {
        const haystack = normalizeFormCatalogSearchText(`${form.title} ${form.description || ''}`);
        const matchedTokens = queryTokens.filter(token => haystack.includes(token)).length;
        return haystack.includes(needle)
          || (queryTokens.length > 0 && matchedTokens >= requiredTokenMatches);
    });
}
