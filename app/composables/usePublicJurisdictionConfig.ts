import {
    computed,
    getCurrentScope,
    onScopeDispose,
    ref,
    unref,
    watch,
    type MaybeRefOrGetter
} from 'vue';
import {
    normalizePublicJurisdictionSlug,
    normalizePublicOrganisationSlug,
    publicJurisdictionConfigEndpoint,
    type PublicJurisdictionConfig
} from '~/utils/public-jurisdiction-config';

type PublicJurisdictionConfigCache = Record<string, PublicJurisdictionConfig | null>;
type PublicJurisdictionConfigExpiryCache = Record<string, number>;

const publicConfigRequests = new Map<string, Promise<PublicJurisdictionConfig>>();
const PUBLIC_CONFIG_TTL_MS = 300_000;

function toInputValue(input: MaybeRefOrGetter<string | null | undefined>): string | null | undefined {
    return typeof input === 'function' ? input() : unref(input);
}

/**
 * `reload`: past the browser's HTTP cache. The Nuxt route answers with
 * `Cache-Control: public, max-age=300` (`server/api/jurisdictions/[slug]/config.get.ts`), so a plain
 * request, also after a page reload, may get the answer from before a branding save for up to five
 * minutes. `cache: 'reload'` asks the server and stores the new answer in the browser's cache, so the
 * next page load of this browser sees it too; the header for every other visitor stays as it is.
 */
async function requestPublicJurisdictionConfig(
    slug: string,
    organisationSlug: string | null,
    options: { reload?: boolean } = {}
): Promise<PublicJurisdictionConfig> {
    const endpoint = publicJurisdictionConfigEndpoint(slug, organisationSlug);
    if (!endpoint) {
        throw new Error('Invalid jurisdiction slug.');
    }

    // A reload never joins a plain request that may be answered from the HTTP cache.
    const cacheKey = `${slug}:${organisationSlug || ''}${options.reload ? ':reload' : ''}`;
    const existingRequest = publicConfigRequests.get(cacheKey);
    if (existingRequest) return existingRequest;

    const request = (options.reload
        ? $fetch<PublicJurisdictionConfig>(endpoint, { cache: 'reload' })
        : $fetch<PublicJurisdictionConfig>(endpoint))
        .finally(() => {
            publicConfigRequests.delete(cacheKey);
        });
    publicConfigRequests.set(cacheKey, request);
    return request;
}

/**
 * After a branding save: fetch every loaded copy of this jurisdiction's public config again, past the
 * browser's HTTP cache, so header, sidebar, logo and colours change at once, without a page reload.
 * Copies of other jurisdictions stay. A failed refetch keeps the copy it had; nothing is cleared.
 */
export async function refreshPublicJurisdictionConfigs(input: string | null | undefined): Promise<void> {
    const slug = normalizePublicJurisdictionSlug(input);
    if (!slug) return;
    const cache = useState<PublicJurisdictionConfigCache>('public-jurisdiction-configs', () => ({}));
    const cacheExpiries = useState<PublicJurisdictionConfigExpiryCache>('public-jurisdiction-config-expiries', () => ({}));
    const keys = Object.keys(cache.value).filter(key => key.startsWith(`${slug}:`));
    await Promise.all(keys.map(async (cacheKey) => {
        const organisationSlug = cacheKey.slice(slug.length + 1) || null;
        try {
            const nextConfig = await requestPublicJurisdictionConfig(slug, organisationSlug, { reload: true });
            cache.value = { ...cache.value, [cacheKey]: nextConfig };
            cacheExpiries.value = { ...cacheExpiries.value, [cacheKey]: Date.now() + PUBLIC_CONFIG_TTL_MS };
        } catch {
            // The copy stays as it was; its own timer revalidates it later.
        }
    }));
}

function isNegativeCacheableError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;

    const candidate = error as {
        status?: number
        statusCode?: number
        response?: { status?: number }
    };
    const status = candidate.status ?? candidate.statusCode ?? candidate.response?.status;
    return status === 404 || status === 410;
}

function usePublicJurisdictionConfigState(
    input: MaybeRefOrGetter<string | null | undefined>,
    organisationInput?: MaybeRefOrGetter<string | null | undefined>
) {
    const slug = computed(() => normalizePublicJurisdictionSlug(toInputValue(input)));
    const organisationSlug = computed(() => normalizePublicOrganisationSlug(
        organisationInput === undefined ? null : toInputValue(organisationInput)
    ));
    const cache = useState<PublicJurisdictionConfigCache>('public-jurisdiction-configs', () => ({}));
    const currentCacheKey = computed(() => slug.value
        ? `${slug.value}:${organisationSlug.value || ''}`
        : null
    );

    const config = computed(() => {
        return currentCacheKey.value ? cache.value[currentCacheKey.value] ?? null : null;
    });
    return { slug, organisationSlug, cache, currentCacheKey, config };
}

/** Follow the brand loaded by the page frame without starting another fetch or refresh timer. */
export function useLoadedPublicJurisdictionConfig(input: MaybeRefOrGetter<string | null | undefined>) {
    return usePublicJurisdictionConfigState(input).config;
}

export function usePublicJurisdictionConfig(
    input: MaybeRefOrGetter<string | null | undefined>,
    organisationInput?: MaybeRefOrGetter<string | null | undefined>
) {
    const { slug, organisationSlug, cache, currentCacheKey, config } = usePublicJurisdictionConfigState(input, organisationInput);
    const cacheExpiries = useState<PublicJurisdictionConfigExpiryCache>('public-jurisdiction-config-expiries', () => ({}));
    const pendingCacheKey = ref<string | null>(null);
    const error = ref<unknown>(null);
    let refreshSequence = 0;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    const pending = computed(() => pendingCacheKey.value === currentCacheKey.value);

    function clearScheduledRefresh() {
        if (refreshTimer === null) return;
        clearTimeout(refreshTimer);
        refreshTimer = null;
    }

    function scheduleRefresh(cacheKey: string, expiresAt: number) {
        clearScheduledRefresh();
        if (typeof window === 'undefined' || disposed) return;

        refreshTimer = setTimeout(() => {
            refreshTimer = null;
            if (!disposed && currentCacheKey.value === cacheKey) {
                void refresh();
            }
        }, Math.max(0, expiresAt - Date.now()));
    }

    async function refresh(options: { force?: boolean } = {}): Promise<PublicJurisdictionConfig | null> {
        if (disposed) return null;

        const currentSlug = slug.value;
        if (!currentSlug) {
            refreshSequence += 1;
            pendingCacheKey.value = null;
            error.value = null;
            clearScheduledRefresh();
            return null;
        }

        const currentOrganisationSlug = organisationSlug.value;
        const cacheKey = `${currentSlug}:${currentOrganisationSlug || ''}`;
        const requestSequence = ++refreshSequence;
        pendingCacheKey.value = null;
        error.value = null;
        const hasCachedConfig = Object.prototype.hasOwnProperty.call(cache.value, cacheKey);
        const cacheIsFresh = (cacheExpiries.value[cacheKey] || 0) > Date.now();
        if (!options.force && hasCachedConfig && cacheIsFresh) {
            scheduleRefresh(cacheKey, cacheExpiries.value[cacheKey]!);
            return cache.value[cacheKey] ?? null;
        }

        pendingCacheKey.value = cacheKey;
        clearScheduledRefresh();

        try {
            const nextConfig = await requestPublicJurisdictionConfig(currentSlug, currentOrganisationSlug);
            const expiresAt = Date.now() + PUBLIC_CONFIG_TTL_MS;
            cache.value = { ...cache.value, [cacheKey]: nextConfig };
            cacheExpiries.value = { ...cacheExpiries.value, [cacheKey]: expiresAt };
            if (requestSequence === refreshSequence) {
                scheduleRefresh(cacheKey, expiresAt);
            }
            return nextConfig;
        } catch (e: unknown) {
            if (requestSequence === refreshSequence) {
                error.value = e;
            }
            if (isNegativeCacheableError(e)) {
                const expiresAt = Date.now() + PUBLIC_CONFIG_TTL_MS;
                cache.value = { ...cache.value, [cacheKey]: null };
                cacheExpiries.value = { ...cacheExpiries.value, [cacheKey]: expiresAt };
                if (requestSequence === refreshSequence) {
                    scheduleRefresh(cacheKey, expiresAt);
                }
            } else if (requestSequence === refreshSequence) {
                scheduleRefresh(cacheKey, Date.now() + PUBLIC_CONFIG_TTL_MS);
            }
            return null;
        } finally {
            if (requestSequence === refreshSequence) {
                pendingCacheKey.value = null;
            }
        }
    }

    watch([slug, organisationSlug], () => {
        void refresh();
    }, { immediate: true });

    if (getCurrentScope()) {
        onScopeDispose(() => {
            disposed = true;
            refreshSequence += 1;
            pendingCacheKey.value = null;
            clearScheduledRefresh();
        });
    }

    return {
        slug,
        organisationSlug,
        config,
        pending,
        error,
        refresh
    };
}
