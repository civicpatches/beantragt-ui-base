<script setup lang="ts">
import { inject } from 'vue';
import {
    headerLoginQuery,
    publicApplicationsPath,
    publicHomePath,
    publicLoginPath,
    publicMyDataPath,
    safeExternalAuthReturnPath,
    publicWorkspaceFromRoute,
    type PublicFormPathInput
} from '~/utils/public-form-path';
import {
    normalizeSupportedLocale,
    pathForLocaleSwitch,
    storeChosenLocale,
    withLocaleQuery
} from '~/utils/locale-routing';
import { CITIZEN_CONTAINER_CLASS } from '~/utils/citizen-layout';
import { accountHeaderIdentity } from '~/utils/account-label';
import { accountMenuExtensionKey } from '~/utils/auth-ui-extensions';
import { useLeaveConfirmation } from '~/composables/useLeaveConfirmation';

/**
 * The one header of every public citizen page: brand, "Meine Anträge" or
 * "Anmelden", the administration link for staff, language, account menu
 * and colour mode, in the same order on every page. Pages no longer switch
 * entries off; the form page protects typed entries by asking before
 * "Abmelden" instead.
 */

const props = withDefaults(defineProps<{
    /** Show back button instead of logo on the left */
    backTo?: string
    /** Label shown next to back button */
    backLabel?: string
    /** Auth-aware navigation links (Meine Anträge / Anmelden / Verwaltung); on by default */
    showNav?: boolean
    /** Account menu (identity, Meine Daten, logout) when signed in; on by default */
    showUserMenu?: boolean
    /** Brand shown on the left when no back button is active */
    brand?: 'municipality' | 'app'
    /** Show the citizen-facing org label breadcrumb next to the workspace brand */
    showOrgSwitcher?: boolean
    /** Id of the page's main region, target of the skip link */
    skipTo?: string
    /** Workspace of the links; defaults to the one in the route (the error page passes none for an unknown municipality) */
    workspace?: PublicFormPathInput
}>(), {
    backTo: undefined,
    backLabel: undefined,
    showNav: true,
    showUserMenu: true,
    brand: 'municipality',
    showOrgSwitcher: false,
    skipTo: 'main-content',
    workspace: undefined
});

const emit = defineEmits<{
    logout: []
}>();

const { t, locale, locales, setLocale } = useI18n();
const citizenHost = useRuntimeConfig().public.uiMode === 'citizen';
const { authenticated, statusChecked, user, loading, logout, ensureStatus } = useAuth();
const router = useRouter();
const route = useRoute();
const publicWorkspace = computed(() => props.workspace ?? publicWorkspaceFromRoute(route));
// The login page itself offers no "Anmelden" that leads to the login page.
const onLoginPage = computed(() => route.path.endsWith('/auth/login'));
// "You are here": the soft fill is a state, not a rank.
const onApplicationsPage = computed(() => route.path.includes('/meine-antraege'));
const homePath = computed(() => publicHomePath(publicWorkspace.value));
const loginPath = computed(() => publicLoginPath(publicWorkspace.value));
const applicationsPath = computed(() => publicApplicationsPath(publicWorkspace.value));
const myDataPath = computed(() => publicMyDataPath(publicWorkspace.value));
const loginReturnPath = computed(() => {
    const candidate = route.fullPath || route.path || homePath.value;
    return safeExternalAuthReturnPath(candidate, homePath.value);
});
// A form page as hard target, any other page as soft return.
const loginTarget = computed(() => ({
    path: loginPath.value,
    query: headerLoginQuery(loginReturnPath.value)
}));

// Only the `auth` middleware of protected pages asked the server for the
// session, so every other page rendered "Anmelden" for a signed-in citizen.
// The header asks once itself and shows no auth-dependent entry until the
// answer is in, instead of the wrong one.
const authKnown = computed(() => authenticated.value || statusChecked.value);

onMounted(() => {
    if (!authenticated.value && !statusChecked.value) {
        void ensureStatus();
    }
});

const leaveConfirmation = useLeaveConfirmation();

// The form page asks first when entries would be lost; without a
// "yes" nothing happens. After the yes its own route guard does not ask
// a second time.
// A logout the server did not confirm is no logout:
// the header stays signed in, says so below the bar and moves nowhere.
const logoutFailed = ref(false);

async function withSessionEnd(action: () => Promise<boolean>) {
    if (!(await leaveConfirmation.confirm('logout'))) return;
    logoutFailed.value = false;
    try {
        if (!(await action())) logoutFailed.value = true;
    } finally {
        leaveConfirmation.end();
    }
}

async function handleLogout() {
    await withSessionEnd(async () => {
        if (!(await logout())) return false;
        await router.push(homePath.value);
        emit('logout');
        return true;
    });
}

const availableLocales = computed(() =>
    (locales.value as Array<{ code: string, name: string }>).map(l => ({
        label: l.name,
        value: l.code
    }))
);

const currentLanguageLabel = computed(() =>
    availableLocales.value.find(l => l.value === locale.value)?.label ?? locale.value
);

async function onLocaleChange(code: string) {
    const selectedLocale = normalizeSupportedLocale(code);
    if (!selectedLocale) return;

    // The one place a citizen chooses the language; only this is stored.
    storeChosenLocale(selectedLocale);
    await setLocale(selectedLocale);

    const nextPath = pathForLocaleSwitch(route.path, selectedLocale);
    if (nextPath !== route.path || normalizeSupportedLocale(route.query.lang) !== selectedLocale) {
        await router.replace({
            path: nextPath,
            query: withLocaleQuery(route.query, selectedLocale),
            hash: route.hash
        });
    }
}

// `type: 'checkbox'` gives each entry role="menuitemcheckbox" with
// aria-checked; `lang` marks the language name for screen readers through
// the `#item-label` slot below.
const languageItems = computed(() => [
    availableLocales.value.map(l => ({
        label: l.label,
        lang: l.value,
        type: 'checkbox' as const,
        checked: locale.value === l.value,
        onSelect: () => {
            void onLocaleChange(l.value);
        }
    }))
]);

// Below `sm` the language and account triggers are icon-only, but the hidden
// label span still counts as a default slot, so UButton never applies its
// square padding. These classes restore it (and a smaller chevron); the
// links with a word get a little less padding, so the row fits 375 px.
// The links with a word drop their icon below `sm`, so the word fits.
const labelledButtonUi = { base: 'px-2 sm:px-2.5 gap-1 sm:gap-1.5', leadingIcon: 'max-sm:hidden' };
const menuTriggerUi = {
    base: 'px-1.5 sm:px-2.5 gap-1 sm:gap-1.5',
    trailingIcon: 'size-4 sm:size-5'
};

const accountMenuExtension = inject(accountMenuExtensionKey, null)?.({
    workspace: publicWorkspace,
    applicationsPath,
    loading,
    withSessionEnd
});

// The colour mode stays a single control in the bar (UColorModeButton),
// also for signed-in citizens; the menu carries no appearance group.
const accountItems = computed(() => [
    [
        { label: accountIdentity.value ?? t('nav.signedInNeutral'), type: 'label' as const }
    ],
    [
        { label: t('citizen.myData.title'), icon: 'i-lucide-id-card', to: myDataPath.value }
    ],
    ...(accountMenuExtension?.groups.value ?? []),
    [
        {
            label: t('common.logout'),
            icon: 'i-lucide-log-out',
            disabled: loading.value,
            onSelect: () => {
                void handleLogout();
            }
        }
    ]
]);

const accountIdentity = computed(() => accountHeaderIdentity(user.value));
const accountLabel = computed(() => accountIdentity.value
    ? t('nav.signedInAs', { identity: accountIdentity.value })
    : t('nav.signedInNeutral'));
</script>

<template>
  <!-- One bar of 64 px on every page, not sticky. -->
  <header class="shrink-0 border-b border-default bg-default">
    <!-- First tab stop of every public page. -->
    <a
      :href="`#${skipTo}`"
      class="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-(--ui-bg) focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-(--ui-text) focus:ring-2 focus:ring-primary focus:outline-none"
      data-testid="app-header-skip-link"
    >
      {{ t('nav.skipToContent') }}
    </a>

    <!-- One width for every citizen page, so logo and controls never jump. -->
    <div
      class="flex min-h-16 items-center justify-between gap-2"
      :class="CITIZEN_CONTAINER_CLASS"
      data-testid="app-header-container"
    >
      <!-- Left side -->
      <div
        class="flex min-w-0 items-center gap-3"
        :class="{ 'shrink-0': !backTo }"
      >
        <!-- Back button mode -->
        <template v-if="backTo">
          <UButton
            :to="backTo"
            color="neutral"
            variant="ghost"
            icon="i-lucide-arrow-left"
            :aria-label="backLabel || t('common.back')"
          />
          <span
            v-if="backLabel"
            class="truncate font-semibold text-(--ui-text)"
          >
            {{ backLabel }}
          </span>
        </template>

        <!-- Municipality brand mode (default) -->
        <NuxtLink
          v-else
          :to="homePath"
          class="flex shrink-0 items-center gap-3"
        >
          <MunicipalityBrand :workspace="brand === 'app' ? {} : publicWorkspace" />
        </NuxtLink>

        <!--
          The citizen org breadcrumb lives in the org-context sidebar
          (OrgContextSidebar), not the header row. `showOrgSwitcher` is
          retained for callers/plumbing but no longer renders here.
        -->
        <slot name="after-title" />
      </div>

      <!--
        Right side. No wrapping from `sm` on: labels drop in a fixed order
        instead (language name from `md`, account label from `lg`). Below `sm`
        language and account are icons with square padding and keep their
        chevron, "Anträge" or "Anmelden" keep their word; that fits 375 px
        with a logo of up to 7 rem. `flex-wrap` below `sm` is only a safety net for rows
        that are wider than the documented cases (long fallback brand name,
        administrator link), so they wrap instead of overflowing sideways.
      -->
      <nav
        :aria-label="t('nav.main')"
        class="flex min-w-0 flex-wrap items-center justify-end gap-1 sm:shrink-0 sm:flex-nowrap sm:gap-2"
      >
        <slot name="actions" />

        <!--
          Auth-aware navigation links. Both keep a word on phones:
          "Anträge" below sm, the full "Meine Anträge" from sm on; the
          accessible name is always the full one and contains the word seen.
        -->
        <template v-if="showNav && authKnown">
          <UButton
            v-if="authenticated"
            :to="applicationsPath"
            :variant="onApplicationsPage ? 'soft' : 'ghost'"
            :aria-current="onApplicationsPage ? 'page' : undefined"
            color="neutral"
            icon="i-lucide-file-text"
            :ui="labelledButtonUi"
            :aria-label="t('nav.myApplications')"
            data-testid="app-header-applications"
          >
            <span class="sm:hidden">{{ t('nav.myApplicationsShort') }}</span>
            <span class="hidden sm:inline">{{ t('nav.myApplications') }}</span>
          </UButton>
          <UButton
            v-else-if="!onLoginPage"
            :to="loginTarget"
            variant="ghost"
            color="neutral"
            icon="i-lucide-log-in"
            :ui="labelledButtonUi"
            data-testid="app-header-login"
          >
            {{ t('common.login') }}
          </UButton>
          <StaffAppHeaderAdministrationLink v-if="!citizenHost && !onLoginPage" />
        </template>

        <!-- Language switcher: visible for everyone, also on the login page -->
        <UDropdownMenu
          :items="languageItems"
          :content="{ align: 'end' }"
          data-testid="app-header-language"
        >
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-languages"
            trailing-icon="i-lucide-chevron-down"
            :ui="menuTriggerUi"
            :aria-label="t('nav.languageCurrent', { name: currentLanguageLabel })"
          >
            <span class="hidden md:inline">{{ currentLanguageLabel }}</span>
          </UButton>

          <template #item-label="{ item }">
            <span :lang="item.lang">{{ item.label }}</span>
          </template>
        </UDropdownMenu>

        <!-- Account menu -->
        <UDropdownMenu
          v-if="showUserMenu && authenticated"
          :items="accountItems"
          :content="{ align: 'end' }"
          :ui="{ content: 'w-64' }"
          data-testid="app-header-account"
        >
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-user-round"
            trailing-icon="i-lucide-chevron-down"
            :ui="menuTriggerUi"
            :loading="loading || accountMenuExtension?.busy.value"
            :title="accountIdentity ?? undefined"
            :aria-label="accountLabel"
          >
            <span
              v-if="accountIdentity"
              class="hidden max-w-[12rem] truncate lg:inline"
            >{{ accountIdentity }}</span>
          </UButton>
        </UDropdownMenu>

        <UColorModeButton />
      </nav>
    </div>

    <!-- At the place of the click: the account menu sits in this bar. -->
    <div
      v-if="logoutFailed && authenticated"
      :class="CITIZEN_CONTAINER_CLASS"
      class="pb-3"
    >
      <UAlert
        color="error"
        icon="i-lucide-circle-x"
        role="alert"
        :title="t('auth.logoutFailed')"
        close
        data-testid="app-header-logout-failed"
        @update:open="logoutFailed = false"
      />
    </div>
  </header>
</template>
