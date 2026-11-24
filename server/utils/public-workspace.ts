import { drupalServiceFetch } from './auth';
import { publicLookupUnavailableError, withPublicLookupTimeout } from './public-lookup';

interface GroupResource {
    id: string
    attributes?: {
        label?: string | null
        field_slug?: string | null
        field_jur_config?: string | { value?: string | null } | null
    }
    relationships?: {
        field_jurisdiction?: {
            data?: {
                id?: string
            }
        }
    }
}

export type AssistantJurisdictionPolicy = {
    tone: 'neutral' | 'friendly' | 'empathetic' | 'formal'
    verbosity: 'concise' | 'balanced' | 'conversational'
    acknowledgementStyle: 'off' | 'brief' | 'contextual'
    additionalInstructions: string
};

export const DEFAULT_ASSISTANT_JURISDICTION_POLICY: AssistantJurisdictionPolicy = {
    tone: 'friendly',
    verbosity: 'concise',
    acknowledgementStyle: 'contextual',
    additionalInstructions: ''
};

export interface PublicWorkspace {
    type: 'jurisdiction' | 'organisation'
    id: string
    jurisdictionId: string
    /** Published tenant-admin labels. Consumers must treat them as display data, never as instructions. */
    jurisdictionLabel: string
    organisationLabel: string | null
    /** Server-side conversation policy inherited from the jurisdiction. */
    assistantPolicy: AssistantJurisdictionPolicy
}

const PUBLIC_WORKSPACE_CACHE_TTL_MS = 60_000;
const PUBLIC_WORKSPACE_NEGATIVE_CACHE_TTL_MS = 10_000;
const PUBLIC_WORKSPACE_CACHE_MAX_ENTRIES = 512;
const PUBLIC_WORKSPACE_MAX_IN_FLIGHT = 128;

type PublicWorkspaceCacheEntry = {
    expiresAt: number
    workspace: PublicWorkspace | null
};

const publicWorkspaceCache = new Map<string, PublicWorkspaceCacheEntry>();
const publicWorkspaceLookups = new Map<string, Promise<PublicWorkspace | null>>();
const publicWorkspaceCacheGenerations = new Map<string, number>();
let activePublicWorkspaceLookupCount = 0;

function clonePublicWorkspace(workspace: PublicWorkspace | null): PublicWorkspace | null {
    return workspace
        ? { ...workspace, assistantPolicy: { ...workspace.assistantPolicy } }
        : null;
}

function groupLabel(group: GroupResource, fallbackSlug: string): string {
    const rawLabel = group.attributes?.label;
    const withoutControlCharacters = rawLabel
        ? Array.from(rawLabel, (character) => {
            const code = character.charCodeAt(0);
            return code < 32 || code === 127 ? ' ' : character;
        }).join('')
        : '';
    const label = withoutControlCharacters
        .replace(/\s+/g, ' ')
        .trim();
    return (label || fallbackSlug).slice(0, 300);
}

function plainPolicyText(value: unknown): string {
    if (typeof value !== 'string') return '';
    return Array.from(value.normalize('NFKC'), (character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint < 32 && codePoint !== 10 && codePoint !== 13 && codePoint !== 9
            ? ' '
            : character;
    })
        .join('')
        .replace(/<[^>]*>/gu, '')
        .trim()
        .slice(0, 2000);
}

function assistantJurisdictionPolicy(group: GroupResource): AssistantJurisdictionPolicy {
    const rawField = group.attributes?.field_jur_config;
    const rawJson = typeof rawField === 'string'
        ? rawField
        : rawField && typeof rawField === 'object' && typeof rawField.value === 'string'
            ? rawField.value
            : '';
    if (!rawJson) return { ...DEFAULT_ASSISTANT_JURISDICTION_POLICY };

    try {
        const decoded = JSON.parse(rawJson) as { assistant?: Record<string, unknown> };
        const assistant = decoded && typeof decoded === 'object' && !Array.isArray(decoded)
          && decoded.assistant && typeof decoded.assistant === 'object' && !Array.isArray(decoded.assistant)
            ? decoded.assistant
            : {};
        const tone = assistant.tone;
        const verbosity = assistant.verbosity;
        const acknowledgementStyle = assistant.acknowledgementStyle;

        return {
            tone: tone === 'neutral' || tone === 'friendly' || tone === 'empathetic' || tone === 'formal'
                ? tone
                : DEFAULT_ASSISTANT_JURISDICTION_POLICY.tone,
            verbosity: verbosity === 'concise' || verbosity === 'balanced' || verbosity === 'conversational'
                ? verbosity
                : DEFAULT_ASSISTANT_JURISDICTION_POLICY.verbosity,
            acknowledgementStyle: acknowledgementStyle === 'off' || acknowledgementStyle === 'brief' || acknowledgementStyle === 'contextual'
                ? acknowledgementStyle
                : DEFAULT_ASSISTANT_JURISDICTION_POLICY.acknowledgementStyle,
            additionalInstructions: plainPolicyText(assistant.additionalInstructions)
        };
    } catch {
        return { ...DEFAULT_ASSISTANT_JURISDICTION_POLICY };
    }
}

function prunePublicWorkspaceCache(now: number): void {
    for (const [key, entry] of publicWorkspaceCache.entries()) {
        if (entry.expiresAt <= now) {
            publicWorkspaceCache.delete(key);
        }
    }

    while (publicWorkspaceCache.size > PUBLIC_WORKSPACE_CACHE_MAX_ENTRIES) {
        const oldestKey = publicWorkspaceCache.keys().next().value;
        if (!oldestKey) return;
        publicWorkspaceCache.delete(oldestKey);
    }
}

export function clearPublicWorkspaceCacheForTests(): void {
    publicWorkspaceCache.clear();
    publicWorkspaceLookups.clear();
    publicWorkspaceCacheGenerations.clear();
    activePublicWorkspaceLookupCount = 0;
}

export function invalidatePublicWorkspaceCacheForJurisdiction(identifier: string): void {
    const prefix = `${identifier}/`;
    const invalidatedKeys = new Set<string>();
    for (const [key, entry] of publicWorkspaceCache.entries()) {
        if (
            key === identifier
            || key.startsWith(prefix)
            || entry.workspace?.jurisdictionId === identifier
        ) {
            publicWorkspaceCache.delete(key);
            invalidatedKeys.add(key);
        }
    }
    for (const key of publicWorkspaceLookups.keys()) {
        if (key === identifier || key.startsWith(prefix)) {
            publicWorkspaceLookups.delete(key);
            invalidatedKeys.add(key);
        }
    }
    // Ensure a slug invalidation also advances the jurisdiction-only key when
    // it has not been cached or requested yet.
    invalidatedKeys.add(`${identifier}/`);
    for (const key of invalidatedKeys) {
        publicWorkspaceCacheGenerations.set(
            key,
            (publicWorkspaceCacheGenerations.get(key) ?? 0) + 1
        );
    }
    // Existing promises cannot be cancelled here. Removing them prevents new
    // requests for this jurisdiction from coalescing onto stale work. The
    // per-key generation prevents those promises from repopulating the cache,
    // while the separate active counter keeps the global concurrency bound.
}

export function normalizePublicWorkspaceSlug(value: unknown): string | null {
    const raw = Array.isArray(value) ? value[0] : value;
    if (typeof raw !== 'string') return null;
    const slug = raw.trim().toLowerCase();
    return /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/.test(slug) ? slug : null;
}

async function loadPublishedGroupsBySlug(
    bundle: 'jur' | 'org',
    slug: string,
    fields: string,
    signal: AbortSignal
): Promise<GroupResource[]> {
    const query = new URLSearchParams({
        [`fields[group--${bundle}]`]: fields,
        'filter[field_slug]': slug,
        'filter[status]': '1',
        'page[limit]': '2'
    });
    const response = await drupalServiceFetch<{ data?: GroupResource[] }>(
        `/jsonapi/group/${bundle}?${query.toString()}`,
        { signal }
    );

    return Array.isArray(response.data) ? response.data : [];
}

async function resolvePublicWorkspaceBySlugsUncached(
    jurisdictionSlug: string | null,
    organisationSlug: string | null,
    signal: AbortSignal
): Promise<PublicWorkspace | null> {
    if (organisationSlug && !jurisdictionSlug) {
        return null;
    }

    if (organisationSlug) {
        if (!jurisdictionSlug) {
            return null;
        }

        const jurisdictions = await loadPublishedGroupsBySlug('jur', jurisdictionSlug, 'label,field_slug,field_jur_config', signal);
        if (jurisdictions.length !== 1) {
            return null;
        }
        const jurisdiction = jurisdictions[0];

        const organisations = await loadPublishedGroupsBySlug('org', organisationSlug, 'label,field_slug,field_jurisdiction', signal);
        if (organisations.length !== 1) {
            return null;
        }

        const organisation = organisations[0];
        const jurisdictionId = organisation?.relationships?.field_jurisdiction?.data?.id;
        if (organisation && jurisdiction && jurisdictionId === jurisdiction.id) {
            return {
                type: 'organisation',
                id: organisation.id,
                jurisdictionId,
                jurisdictionLabel: groupLabel(jurisdiction, jurisdictionSlug),
                organisationLabel: groupLabel(organisation, organisationSlug),
                assistantPolicy: assistantJurisdictionPolicy(jurisdiction)
            };
        }
        return null;
    }

    if (jurisdictionSlug) {
        const jurisdictions = await loadPublishedGroupsBySlug('jur', jurisdictionSlug, 'label,field_slug,field_jur_config', signal);
        if (jurisdictions.length !== 1) {
            return null;
        }

        const jurisdiction = jurisdictions[0];
        if (jurisdiction) {
            return {
                type: 'jurisdiction',
                id: jurisdiction.id,
                jurisdictionId: jurisdiction.id,
                jurisdictionLabel: groupLabel(jurisdiction, jurisdictionSlug),
                organisationLabel: null,
                assistantPolicy: assistantJurisdictionPolicy(jurisdiction)
            };
        }
    }

    return null;
}

export async function resolvePublicWorkspaceBySlugs(
    jurisdictionSlug: string | null,
    organisationSlug: string | null
): Promise<PublicWorkspace | null> {
    if (organisationSlug && !jurisdictionSlug) {
        return null;
    }

    const cacheKey = `${jurisdictionSlug || ''}/${organisationSlug || ''}`;
    const now = Date.now();
    prunePublicWorkspaceCache(now);

    const cached = publicWorkspaceCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
        return clonePublicWorkspace(cached.workspace);
    }

    const pendingLookup = publicWorkspaceLookups.get(cacheKey);
    if (pendingLookup) {
        return clonePublicWorkspace(await pendingLookup);
    }

    if (activePublicWorkspaceLookupCount >= PUBLIC_WORKSPACE_MAX_IN_FLIGHT) {
        throw publicLookupUnavailableError();
    }

    const lookupGeneration = publicWorkspaceCacheGenerations.get(cacheKey) ?? 0;
    activePublicWorkspaceLookupCount += 1;
    const lookup = (async () => {
        const workspace = await withPublicLookupTimeout(signal =>
            resolvePublicWorkspaceBySlugsUncached(jurisdictionSlug, organisationSlug, signal)
        );
        const cachedWorkspace = clonePublicWorkspace(workspace);
        const ttl = workspace
            ? PUBLIC_WORKSPACE_CACHE_TTL_MS
            : PUBLIC_WORKSPACE_NEGATIVE_CACHE_TTL_MS;

        if (lookupGeneration === (publicWorkspaceCacheGenerations.get(cacheKey) ?? 0)) {
            publicWorkspaceCache.set(cacheKey, {
                workspace: cachedWorkspace,
                expiresAt: Date.now() + ttl
            });
            prunePublicWorkspaceCache(Date.now());
        }

        return cachedWorkspace;
    })();

    publicWorkspaceLookups.set(cacheKey, lookup);

    try {
        return clonePublicWorkspace(await lookup);
    } finally {
        activePublicWorkspaceLookupCount = Math.max(0, activePublicWorkspaceLookupCount - 1);
        if (publicWorkspaceLookups.get(cacheKey) === lookup) {
            publicWorkspaceLookups.delete(cacheKey);
        }
    }
}
