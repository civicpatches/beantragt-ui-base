<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui';
import {
    publicHomePath,
    publicLoginPath,
    publicMyDataPath,
    publicWorkspaceFromKey
} from '~/utils/public-form-path';
import { useDashboardFullBleed } from '../composables/useDashboardFullBleed';
import { provide } from 'vue';
import { PAGE_LAYOUT_NOTICE } from '~/utils/page-layout-notice';
import { useAdminAccessNotice } from '../composables/useAdminAccessNotice';
import AccessRedirectNotice from '../components/admin/AccessRedirectNotice.vue';
import { staffAccountMenuExtensions, staffNavEntries, type StaffNavContext } from '../utils/staff-extensions';
import { OPEN_DASHBOARD_WORKSPACE_SWITCHER } from '../utils/dashboard-workspace-switcher';
import { httpLinkHref, productReleaseInfo } from '~/utils/source-link';

const { t, locale, locales, setLocale } = useI18n();
const route = useRoute();
/**
 * The sidebar can be collapsed to its icon rail with the handle in the navbar.
 * The detail view of the batch review (a case or an envelope is open) and the batch case page need the width for
 * document and review panel side by side, so the sidebar collapses on entering it and returns
 * to its previous state on leaving. A manual toggle inside the detail view is respected until it is left.
 */
// The batch case page shows the same work frame: the sidebar collapses there as well.
const inBulk = computed(() => (/\/admin\/bulk$/u.test(route.path) && typeof route.query?.case === 'string' && route.query.case !== '')
  || /\/admin\/bulk\/cases\/[^/]+$/u.test(route.path));
/*
 * The person's own sidebar choice is stored here, never the collapse a work frame forces (found in the browser
 * 13.11.: the sidebar's own cookie took the forced state, so after a reload in the frame every page opened
 * collapsed). The sidebar's built-in persistence is off (`persistent: false` on the group) because it stores every
 * change of its model. A choice made inside a frame is respected until the frame is left, and not stored.
 * Before this key existed the choice lived in the sidebar's cookie (`dashboard-sidebar-…`); it is read once.
 */
const SIDEBAR_PREFERENCE_KEY = 'beantragt-admin-sidebar-collapsed';
function storedSidebarPreference(): boolean {
    try {
        const stored = localStorage.getItem(SIDEBAR_PREFERENCE_KEY);
        if (stored !== null) return stored === 'true';
        const legacy = document.cookie.split('; ').find(part => /^dashboard-sidebar-[^=]+=/u.test(part));
        if (legacy) return (JSON.parse(decodeURIComponent(legacy.slice(legacy.indexOf('=') + 1))) as { collapsed?: unknown } | null)?.collapsed === true;
    } catch { /* Storage is optional: expanded. */ }
    return false;
}
const sidebarPreference = storedSidebarPreference();
const sidebarCollapsed = ref(inBulk.value || sidebarPreference);
let sidebarBeforeBulk: boolean | null = inBulk.value ? sidebarPreference : null;
watch(inBulk, (now) => {
    if (now) {
        sidebarBeforeBulk = sidebarCollapsed.value;
        sidebarCollapsed.value = true;
    } else if (sidebarBeforeBulk !== null) {
        sidebarCollapsed.value = sidebarBeforeBulk;
        sidebarBeforeBulk = null;
    }
});
watch(sidebarCollapsed, (value) => {
    if (inBulk.value) return;
    try {
        localStorage.setItem(SIDEBAR_PREFERENCE_KEY, String(value));
    } catch { /* Storage is optional. */ }
});
// A page that needs the whole panel body (the batch review work mode) switches padding and body scroll off.
const fullBleed = useDashboardFullBleed();
const router = useRouter();
const colorMode = useColorMode();
const { authenticated, user, loading, logout, isAdmin } = useAuth();
const sidebarAccountName = computed(() => {
    const name = user.value?.displayName?.trim() || user.value?.name?.trim();
    return name && !/[@_]/u.test(name) ? name : user.value?.email?.trim() || t('common.profile');
});
const accountAvatar = computed(() => ({ 'alt': sidebarAccountName.value, 'aria-hidden': true }));

/**
 * The own role under the name in the sidebar footer: the highest staff
 * role of the account, in the words of the handbook. Unknown roles keep the
 * generic word.
 */
const roleLabel = computed(() => {
    const roles = user.value?.roles ?? [];
    if (roles.includes('administrator')) return t('nav.roles.administrator');
    if (roles.includes('department_admin')) return t('nav.roles.departmentAdmin');
    if (roles.includes('case_worker')) return t('nav.roles.caseWorker');
    return t('nav.administration');
});

/** Skip link target: one `main` per admin page, rendered by this layout. */
const MAIN_ID = 'admin-main';

function skipToMain() {
    // Focus without a route change: a hash navigation would re-run the admin middleware.
    document.getElementById(MAIN_ID)?.focus();
}
const {
    currentWorkspace,
    selectedWorkspaceKey,
    workspaceRoute
} = useWorkspaceContext();

const publicWorkspace = computed(() => {
    const workspace = currentWorkspace.value;
    if (workspace) {
        return {
            jurisdictionSlug: workspace.jurisdictionSlug,
            jurisdictionLabel: workspace.jurisdictionLabel,
            organisationSlug: workspace.organisationSlug,
            organisationLabel: workspace.organisationLabel
        };
    }
    return publicWorkspaceFromKey(selectedWorkspaceKey.value);
});

const homePath = computed(() => publicHomePath(publicWorkspace.value));
const loginPath = computed(() => publicLoginPath(publicWorkspace.value));
const myDataPath = computed(() => publicMyDataPath(publicWorkspace.value));

// A pending notice after a redirect (role or workspace) belongs to the account
// that was redirected; it never survives into another session.
const { clearRedirect } = useAdminAccessNotice();
// Every page frame below shows that notice first in its content.
provide(PAGE_LAYOUT_NOTICE, AccessRedirectNotice);

const workspaceSwitcher = ref<{ openFrom: (opener: HTMLElement) => void } | null>(null);
provide(OPEN_DASHBOARD_WORKSPACE_SWITCHER, opener => workspaceSwitcher.value?.openFrom(opener));

// If the server does not confirm logout, keep the local session.
// The menu closes on selection. Announce the error next to its trigger.
const logoutFailed = ref(false);
function announceLogoutFailed() {
    logoutFailed.value = true;
}

async function handleLogout() {
    clearRedirect();
    logoutFailed.value = false;
    if (!(await logout())) {
        announceLogoutFailed();
        return;
    }
    await router.push(homePath.value);
}

const { public: runtime } = useRuntimeConfig();
const accountExtensions = staffAccountMenuExtensions().map(useItems => useItems({ announceLogoutFailed }));
const accountMenuContent = {
    expanded: { side: 'top', align: 'start', class: 'w-(--reka-dropdown-menu-trigger-width)' },
    collapsed: { side: 'right', align: 'end', class: 'w-48' }
} as const;

const productMenuItems = computed<DropdownMenuItem[]>(() => {
    if (runtime.hideProductLinks) return [];
    const { href, icon, version } = productReleaseInfo(runtime.sourceUrl, runtime.appVersion);
    const docsHref = httpLinkHref(runtime.docsUrl);
    const items: DropdownMenuItem[] = [];
    if (docsHref) {
        const label = t('nav.documentation');
        items.push({
            label,
            'icon': 'i-lucide-book-open',
            'to': docsHref,
            'target': '_blank',
            'rel': 'noopener',
            'aria-label': t('nav.linkOpensInNewTab', { label })
        });
    }
    if (href) {
        const label = t('nav.productSource');
        items.push({
            label,
            icon,
            'to': href,
            'target': '_blank',
            'rel': 'noopener',
            'aria-label': t('nav.linkOpensInNewTab', { label })
        });
    }
    // The product line links the product website like the citizen footer does (NUXT_PUBLIC_WEBSITE_URL).
    const product = version ? `beantragt.ai ${version}` : 'beantragt.ai';
    const websiteHref = httpLinkHref(runtime.websiteUrl);
    items.push(websiteHref
        ? { 'label': product, 'icon': 'i-lucide-globe', 'to': websiteHref, 'target': '_blank', 'rel': 'noopener', 'aria-label': t('nav.linkOpensInNewTab', { label: `${product}, ${t('nav.productWebsite')}` }) }
        : { type: 'label', label: product });
    return items;
});

const accountMenuItems = computed<DropdownMenuItem[][]>(() => {
    const email = user.value?.email?.trim();
    return [
        [{ type: 'label', label: sidebarAccountName.value, description: email === sidebarAccountName.value ? undefined : email, avatar: accountAvatar.value }],
        [{ label: t('nav.myData'), icon: 'i-lucide-user-round', to: myDataPath.value }, ...accountExtensions.flatMap(items => items.value)],
        ...(productMenuItems.value.length ? [productMenuItems.value] : []),
        [{ label: t('common.logout'), icon: 'i-lucide-log-out', disabled: loading.value, onSelect: handleLogout }]
    ];
});

/**
 * The sidebar lists what the layers registered, in one order for
 * both audiences; entries for admins only are left out for the other staff roles.
 */
const navigation = computed(() => {
    const context: StaffNavContext = {
        t: key => t(key),
        routePath: route.path,
        workspaceRoute,
        isAdmin: isAdmin.value,
        workspaceType: currentWorkspace.value?.type ?? null
    };
    return staffNavEntries()
        .filter(entry => (entry.audience === 'staff' || context.isAdmin) && (entry.when?.(context) ?? true))
        .map(entry => entry.item(context));
});
const collapsedNavigation = computed(() => navigation.value.map(item => ({
    ...item,
    'aria-label': item.label
})));

const availableLocales = computed(() =>
    (locales.value as Array<{ code: string, name: string }>).map(l => ({
        label: l.name,
        value: l.code
    }))
);

function onLocaleChange(code: string) {
    if (code === 'de' || code === 'en') {
        setLocale(code);
    }
}

// Compact preference controls live in the top bar, account actions in the
// sidebar footer.
const currentLanguageLabel = computed(() =>
    availableLocales.value.find(l => l.value === locale.value)?.label ?? locale.value
);

// `type: 'checkbox'` renders the active marker as a dedicated trailing
// indicator (role="menuitemcheckbox" + aria-checked), instead of a leading
// `icon` that only the active row carried — which shifted that row's label.
const languageItems = computed(() => [
    availableLocales.value.map(l => ({
        label: l.label,
        type: 'checkbox' as const,
        checked: locale.value === l.value,
        onSelect: () =>
            onLocaleChange(l.value)
    }))
]);

const themeItems = computed(() => [
    [
        {
            label: t('nav.themeLight'),
            icon: 'i-lucide-sun',
            type: 'checkbox' as const,
            checked: colorMode.preference === 'light',
            onSelect: () =>
                colorMode.preference = 'light'
        },
        {
            label: t('nav.themeDark'),
            icon: 'i-lucide-moon',
            type: 'checkbox' as const,
            checked: colorMode.preference === 'dark',
            onSelect: () =>
                colorMode.preference = 'dark'
        },
        {
            label: t('nav.themeSystem'),
            icon: 'i-lucide-monitor',
            type: 'checkbox' as const,
            checked: colorMode.preference === 'system',
            onSelect: () =>
                colorMode.preference = 'system'
        }
    ]
]);

const mobilePreferenceItems = computed(() => [
    [
        {
            label: t('nav.theme'),
            type: 'label' as const
        },
        ...(themeItems.value[0] ?? [])
    ],
    [
        {
            label: t('nav.language'),
            type: 'label' as const
        },
        ...(languageItems.value[0] ?? [])
    ]
]);

// Load the personal theme preview only in development so the shipped build excludes the component and its chunk.
const StaffThemePreview = import.meta.dev
    ? defineAsyncComponent(() => import('../components/admin/StaffThemePreview.vue'))
    : null;

const currentThemeIcon = computed(() => {
    if (colorMode.preference === 'light') return 'i-lucide-sun';
    if (colorMode.preference === 'dark') return 'i-lucide-moon';
    return 'i-lucide-monitor';
});

const currentThemeLabel = computed(() => {
    if (colorMode.preference === 'light') return t('nav.themeLight');
    if (colorMode.preference === 'dark') return t('nav.themeDark');
    return t('nav.themeSystem');
});
</script>

<template>
  <UDashboardGroup
    unit="rem"
    :persistent="false"
  >
    <ULink
      :to="`#${MAIN_ID}`"
      class="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-(--ui-bg) focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-(--ui-text) focus:ring-2 focus:ring-primary focus:outline-none"
      data-testid="admin-skip-link"
      @click.prevent="skipToMain"
    >
      {{ t('nav.skipToContent') }}
    </ULink>
    <!-- Fixed rem width: a percentage cut labels like "Verwaltungsassistenz" on laptops. -->
    <UDashboardSidebar
      v-model:collapsed="sidebarCollapsed"
      :collapsible="true"
      :ui="{ root: 'transition-[width] duration-200 ease-out data-[dragging=true]:transition-none motion-reduce:transition-none' }"
      :default-size="15"
      :min-size="15"
      :max-size="15"
      :menu="({ icon: 'i-lucide-menu' } as Record<string, unknown>)"
    >
      <template #header="{ collapsed }">
        <NuxtLink
          :to="homePath"
          class="flex min-w-0 py-2"
          :class="collapsed ? 'justify-center' : 'justify-start'"
        >
          <MunicipalityBrand
            :key="publicWorkspace.jurisdictionSlug || 'default'"
            :workspace="publicWorkspace"
            :show-text="!collapsed"
            :size="collapsed ? 'xs' : 'sm'"
          />
        </NuxtLink>
      </template>

      <template #default="{ collapsed }">
        <UNavigationMenu
          :collapsed="collapsed"
          orientation="vertical"
          :items="collapsed ? collapsedNavigation : navigation"
          :aria-label="t('nav.main')"
          class="flex-1"
        />
      </template>

      <template #footer="{ collapsed }">
        <div
          class="flex w-full min-w-0 flex-col gap-1"
          :class="{ 'items-center': collapsed }"
        >
          <UDropdownMenu
            v-if="authenticated"
            :items="accountMenuItems"
            :content="collapsed ? accountMenuContent.collapsed : accountMenuContent.expanded"
            :external-icon="false"
          >
            <UButton
              color="neutral"
              variant="ghost"
              :avatar="accountAvatar"
              :trailing-icon="collapsed ? undefined : 'i-lucide-chevrons-up-down'"
              :block="!collapsed"
              :square="collapsed"
              :aria-label="collapsed ? sidebarAccountName : undefined"
              data-testid="admin-account-menu"
            >
              <span
                v-if="!collapsed"
                class="min-w-0 flex-1 text-start"
              >
                <span class="block truncate">{{ sidebarAccountName }}</span>
                <span class="block truncate text-xs font-normal text-muted">{{ roleLabel }}</span>
              </span>
            </UButton>
          </UDropdownMenu>
          <UButton
            v-else
            :to="loginPath"
            color="neutral"
            variant="ghost"
            icon="i-lucide-log-in"
            :label="collapsed ? undefined : t('common.login')"
            :block="!collapsed"
            :square="collapsed"
            :aria-label="t('common.login')"
          />
          <div
            v-if="authenticated && logoutFailed"
            role="alert"
            data-testid="admin-logout-failed"
          >
            <UAlert
              v-if="!collapsed"
              color="error"
              icon="i-lucide-circle-x"
              :title="t('auth.logoutFailed')"
            />
            <span
              v-else
              class="flex justify-center py-1"
              :title="t('auth.logoutFailed')"
            >
              <UIcon
                name="i-lucide-alert-circle"
                class="size-4 text-(--ui-error)"
                aria-hidden="true"
              />
              <span class="sr-only">{{ t('auth.logoutFailed') }}</span>
            </span>
          </div>
        </div>
      </template>
    </UDashboardSidebar>

    <UDashboardPanel
      class="flex-1"
      :ui="fullBleed ? { body: 'gap-0 overflow-hidden p-0 sm:gap-0 sm:p-0' } : undefined"
    >
      <template #header>
        <UDashboardNavbar :ui="{ left: 'min-w-0 flex-1', right: 'shrink-0' }">
          <template #left>
            <UDashboardSidebarCollapse />
            <AdminDashboardWorkspaceSwitcher
              ref="workspaceSwitcher"
              placement="header"
              class="min-w-0 flex-1"
            />
          </template>

          <template #right>
            <div class="flex items-center gap-1.5">
              <UDropdownMenu
                :items="mobilePreferenceItems"
                :content="{ side: 'bottom', align: 'end' }"
              >
                <UButton
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-settings-2"
                  square
                  class="sm:hidden"
                  :aria-label="`${t('nav.settings')}: ${t('nav.theme')}, ${t('nav.language')}`"
                />
              </UDropdownMenu>

              <div class="hidden items-center gap-1.5 sm:flex">
                <component
                  :is="StaffThemePreview"
                  v-if="StaffThemePreview"
                />
                <UDropdownMenu
                  :items="themeItems"
                  :content="{ side: 'bottom', align: 'end' }"
                >
                  <UButton
                    color="neutral"
                    variant="ghost"
                    :icon="currentThemeIcon"
                    square
                    :aria-label="`${t('nav.theme')}: ${currentThemeLabel}`"
                    :title="currentThemeLabel"
                  />
                </UDropdownMenu>

                <UDropdownMenu
                  :items="languageItems"
                  :content="{ side: 'bottom', align: 'end' }"
                >
                  <UButton
                    color="neutral"
                    variant="ghost"
                    icon="i-lucide-languages"
                    square
                    :aria-label="`${t('nav.language')}: ${currentLanguageLabel}`"
                    :title="currentLanguageLabel"
                  />
                </UDropdownMenu>
              </div>
            </div>
          </template>
        </UDashboardNavbar>
      </template>

      <template #body>
        <!-- Keep absolutely positioned page content (including sr-only text) inside the panel scroller. -->
        <main
          :id="MAIN_ID"
          tabindex="-1"
          class="relative flex flex-1 flex-col focus:outline-none"
          :class="fullBleed ? 'min-h-0 gap-0' : 'gap-4 sm:gap-6'"
          data-testid="admin-main"
        >
          <slot />
        </main>
      </template>
    </UDashboardPanel>
  </UDashboardGroup>
</template>
