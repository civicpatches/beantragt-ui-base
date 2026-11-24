export type AdminWorkspaceType = 'jurisdiction' | 'organisation';

export interface AdminWorkspace {
    type: AdminWorkspaceType
    id: string
    internalId?: number | null
    label: string
    slug: string
    key: string
    path: string
    jurisdictionId: string
    jurisdictionInternalId?: number | null
    jurisdictionSlug: string
    jurisdictionLabel: string
    organisationId: string | null
    organisationInternalId?: number | null
    organisationSlug: string | null
    organisationLabel: string | null
    parentId: string | null
    parentLabel: string | null
    canCreateFormSchema?: boolean
}

interface AdminWorkspacesResponse {
    jurisdictions: AdminWorkspace[]
    organisations?: AdminWorkspace[]
    workspaces?: AdminWorkspace[]
    count: number
}

interface LoadWorkspacesOptions {
    throwOnError?: boolean
    syncRoute?: boolean
    force?: boolean
    preferredWorkspaceKey?: string
}

const WORKSPACE_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/;
const WORKSPACE_KEY_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?(?:\/[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?)?$/;

function normalizeWorkspaceSlug(value: unknown): string | null {
    const raw = Array.isArray(value) ? value[0] : value;
    if (typeof raw !== 'string') return null;
    const slug = raw.trim().toLowerCase();
    return WORKSPACE_SLUG_PATTERN.test(slug) ? slug : null;
}

function normalizeWorkspaceKey(value: unknown): string | null {
    const raw = Array.isArray(value) ? value[0] : value;
    if (typeof raw !== 'string') return null;
    const key = raw.trim().toLowerCase().replace(/^\/+|\/+$/gu, '');
    return WORKSPACE_KEY_PATTERN.test(key) ? key : null;
}

function adminPathFromRoutePath(path: string): string | null {
    if (path === '/admin' || path.startsWith('/admin/')) return path;
    const match = path.match(/^\/[a-z0-9-]+(?:\/[a-z0-9-]+)?(\/admin(?:\/.*)?|$)/u);
    if (!match) return null;
    return match[1] || '/admin';
}

function workspaceKeyFromRoute(path: string): string | null {
    if (path === '/admin' || path.startsWith('/admin/')) return null;
    // The optional org segment must not swallow the `/admin` section marker,
    // otherwise `/<jur>/admin` parses as jur=<jur>, org="admin" and resolution
    // falls back to the first jurisdiction.
    const match = path.match(/^\/([a-z0-9-]+)(?:\/(?!admin(?:\/|$))([a-z0-9-]+))?(?:\/admin(?:\/.*)?|$)/u);
    if (!match) return null;
    return normalizeWorkspaceKey(match[2] ? `${match[1]}/${match[2]}` : match[1]);
}

function workspacePathFromKey(key: string | null): string | null {
    const normalized = normalizeWorkspaceKey(key);
    return normalized ? `/${normalized}` : null;
}

export function useWorkspaceContext() {
    const route = useRoute();
    const router = useRouter();
    const { authenticated, user } = useAuth();
    const workspaces = useState<AdminWorkspace[]>('admin-workspaces', () => []);
    const isLoading = useState<boolean>('admin-workspaces-loading', () => false);
    const isLoaded = useState<boolean>('admin-workspaces-loaded', () => false);
    const loadedForUserKey = useState<string | null>('admin-workspaces-loaded-for-user', () => null);
    const loadError = useState<string | null>('admin-workspaces-error', () => null);
    const persistedKey = useCookie<string | null>('beantragt-admin-workspace', {
        sameSite: 'lax',
        path: '/'
    });

    const routeWorkspaceKey = computed(() => workspaceKeyFromRoute(route.path));
    const queryWorkspaceKey = computed(() => {
        const jurisdiction = normalizeWorkspaceSlug(route.query.jurisdiction);
        const organisation = normalizeWorkspaceSlug(route.query.organisation || route.query.organization || route.query.org);
        if (!jurisdiction) return null;
        return organisation ? `${jurisdiction}/${organisation}` : jurisdiction;
    });
    const selectedWorkspaceKey = computed(() =>
        routeWorkspaceKey.value
        || queryWorkspaceKey.value
        || normalizeWorkspaceKey(persistedKey.value)
        || workspaces.value[0]?.key
        || null
    );
    const explicitWorkspaceKey = computed(() =>
        routeWorkspaceKey.value || queryWorkspaceKey.value
    );
    const authWorkspaceCacheKey = computed(() => {
        if (!authenticated.value || !user.value) return null;
        return String(user.value.uuid || user.value.uid || user.value.email || '');
    });

    const selectedWorkspaceSlug = computed(() =>
        selectedWorkspaceKey.value?.split('/')[0] ?? null
    );

    const selectedOrganisationSlug = computed(() =>
        selectedWorkspaceKey.value?.split('/')[1] ?? null
    );

    const currentWorkspace = computed(() => {
        const key = selectedWorkspaceKey.value;
        if (!key) return workspaces.value[0] ?? null;
        const workspace = workspaces.value.find(item => item.key === key);
        if (workspace) return workspace;
        return explicitWorkspaceKey.value ? null : workspaces.value[0] || null;
    });

    const isExplicitWorkspaceDenied = computed(() =>
        Boolean(
            explicitWorkspaceKey.value
            && isLoaded.value
            && !workspaces.value.some(workspace => workspace.key === explicitWorkspaceKey.value)
        )
    );

    function withWorkspaceQuery(extra: Record<string, string | number | boolean | undefined> = {}) {
        const next: Record<string, string> = {};
        for (const [key, value] of Object.entries(extra)) {
            if (value !== undefined) {
                next[key] = String(value);
            }
        }

        const workspace = currentWorkspace.value;
        if (workspace) {
            next.jurisdiction = workspace.jurisdictionSlug;
            if (workspace.organisationSlug) {
                next.organisation = workspace.organisationSlug;
            }
        } else if (selectedWorkspaceKey.value && !explicitWorkspaceKey.value) {
            const [jurisdictionSlug, organisationSlug] = selectedWorkspaceKey.value.split('/');
            if (jurisdictionSlug) {
                next.jurisdiction = jurisdictionSlug;
            }
            if (organisationSlug) {
                next.organisation = organisationSlug;
            }
        }
        return next;
    }

    function workspaceRoute(path: string, workspace: AdminWorkspace | null = currentWorkspace.value) {
        const adminPath = adminPathFromRoutePath(path) || path;
        if (!workspace || !adminPath.startsWith('/admin')) {
            const workspacePath = workspacePathFromKey(selectedWorkspaceKey.value);
            return { path: workspacePath && adminPath.startsWith('/admin') ? `${workspacePath}${adminPath}` : adminPath };
        }

        return {
            path: `${workspace.path}${adminPath}`
        };
    }

    async function switchWorkspace(keyOrSlug: string) {
        const normalized = normalizeWorkspaceKey(keyOrSlug);
        const workspace = workspaces.value.find(item => item.key === normalized || item.slug === normalized);
        if (!normalized || !workspace || workspace.key === routeWorkspaceKey.value) return;

        const adminPath = adminPathFromRoutePath(route.path) || '/admin';
        const navigationFailure = await router.push({
            path: `${workspace.path}${adminPath}`
        });
        if (!navigationFailure) {
            persistedKey.value = workspace.key;
        }
    }

    async function ensureWorkspaceInRoute() {
        const adminPath = adminPathFromRoutePath(route.path);
        if (!adminPath) return;

        if (isExplicitWorkspaceDenied.value) {
            persistedKey.value = workspaces.value[0]?.key ?? null;
            return;
        }

        if (routeWorkspaceKey.value || !currentWorkspace.value) return;

        persistedKey.value = currentWorkspace.value.key;
        await router.replace({
            path: `${currentWorkspace.value.path}${adminPath}`
        });
    }

    async function loadWorkspaces(options: LoadWorkspacesOptions = {}) {
        const cacheKey = authWorkspaceCacheKey.value;
        if (isLoading.value) return;
        if (!options.force && isLoaded.value && loadedForUserKey.value === cacheKey) return;

        if (loadedForUserKey.value !== cacheKey) {
            workspaces.value = [];
            isLoaded.value = false;
            loadedForUserKey.value = null;
        }

        isLoading.value = true;
        loadError.value = null;
        try {
            const response = await $fetch<AdminWorkspacesResponse>('/api/admin/jurisdictions');
            workspaces.value = response.workspaces || [
                ...(response.jurisdictions || []),
                ...(response.organisations || [])
            ];
            if (options.preferredWorkspaceKey && workspaces.value.some(workspace => workspace.key === options.preferredWorkspaceKey)) {
                persistedKey.value = options.preferredWorkspaceKey;
            }
            if (persistedKey.value && !workspaces.value.some(workspace => workspace.key === persistedKey.value)) {
                persistedKey.value = workspaces.value[0]?.key ?? null;
            }
            loadedForUserKey.value = cacheKey;
            isLoaded.value = true;
            if (options.syncRoute !== false) {
                await ensureWorkspaceInRoute();
            }
        } catch (error) {
            loadError.value = error instanceof Error ? error.message : 'workspace.load_failed';
            workspaces.value = [];
            isLoaded.value = false;
            loadedForUserKey.value = null;
            if (options.throwOnError) {
                throw error;
            }
        } finally {
            isLoading.value = false;
        }
    }

    watch(authWorkspaceCacheKey, (cacheKey, previousCacheKey) => {
        if (cacheKey === previousCacheKey) return;
        workspaces.value = [];
        isLoaded.value = false;
        loadedForUserKey.value = null;
        loadError.value = null;
    });

    watch(selectedWorkspaceKey, (key) => {
        if (key) {
            persistedKey.value = key;
        }
    }, { immediate: true });

    return {
        workspaces,
        isLoading,
        isLoaded,
        loadError,
        selectedWorkspaceKey,
        selectedWorkspaceSlug,
        selectedOrganisationSlug,
        currentWorkspace,
        isExplicitWorkspaceDenied,
        withWorkspaceQuery,
        workspaceRoute,
        switchWorkspace,
        loadWorkspaces
    };
}
