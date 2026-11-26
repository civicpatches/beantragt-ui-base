<template>
  <CitizenPage
    width="narrow"
    :title="showSignedIn ? t('auth.login.signedInTitle') : t('auth.login.title')"
    :hide-footer-product-links="showStaffProductLinks"
  >
    <!--
      Show e-mail and code first, followed by BundID and the optional actions.
      The public header omits its sign-in link because this is the sign-in page.
    -->
    <template #description>
      <!-- The address only for the e-mail login, never the technical address of an SSO account. -->
      <p
        v-if="showSignedIn && signedInAddress"
        class="mt-2 max-w-prose text-base break-words text-muted"
        data-testid="login-signed-in-as"
      >
        {{ t('auth.login.signedInAs', { email: signedInAddress }) }}
      </p>
      <p
        v-else-if="!showSignedIn && !notAllowedOnHost"
        class="mt-2 max-w-prose text-base text-muted"
      >
        {{ loginSubtitle }}
      </p>
    </template>

    <!--
      One live region for the page. "Sie werden angemeldet" is the only
      visible part; it covers the seconds between the click and the next
      page.
    -->
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid="login-status"
    >
      <p
        v-if="signingIn"
        class="mb-6 flex items-center gap-2 text-base font-medium text-default"
      >
        <UIcon
          name="i-lucide-loader-circle"
          class="size-4 shrink-0 animate-spin text-muted"
          aria-hidden="true"
        />
        {{ t('auth.login.signingIn') }}
      </p>
      <span
        v-else-if="displayError"
        class="sr-only"
      >{{ t('auth.login.errorPrefix', { error: displayError }) }}</span>
      <span
        v-else-if="step === 'code-sent' && !showSignedIn"
        class="sr-only"
      >{{ t('auth.login.codeSentAria', { email: codeSentEmail }) }}</span>
    </div>

    <UAlert
      v-if="displayError"
      color="error"
      role="alert"
      icon="i-lucide-circle-x"
      :title="displayError"
      class="mb-6"
    />

    <!--
      Already signed in: no login form, but the ways on. No automatic
      redirect, so that "Abmelden" stays the way to switch the account. This
      "Abmelden" stays next to the one in the header menu: it keeps
      the person on this page and puts the focus into the e-mail field for
      the next sign-in, while the menu entry leads to the start page.
    -->
    <div
      v-if="notAllowedOnHost"
      class="space-y-4"
    >
      <UAlert
        icon="i-lucide-triangle-alert"
        color="warning"
        role="status"
        :title="hostRefusalMessage"
      />
      <UAlert
        v-if="logoutFailed"
        icon="i-lucide-circle-x"
        color="error"
        role="alert"
        :title="t('auth.logoutFailed')"
      />
      <UButton
        :loading="loading"
        @click="handleSignedInLogout"
      >
        {{ t('auth.login.switchPrivateAccount') }}
      </UButton>
    </div>
    <div
      v-else-if="showSignedIn"
      class="space-y-4"
      data-testid="login-signed-in"
    >
      <!-- The server kept the session: say so where "Abmelden" was pressed. -->
      <UAlert
        v-if="logoutFailed"
        color="error"
        icon="i-lucide-circle-x"
        role="alert"
        :title="t('auth.logoutFailed')"
        data-testid="login-logout-failed"
      />
      <div class="flex flex-wrap gap-2">
        <StaffLoginAdministrationLink
          v-if="isStaff && !citizenHost"
          :to="administrationReturnPath"
        />
        <UButton
          v-else
          :to="applicationsPath"
          size="xl"
          class="w-full justify-center sm:w-auto"
          data-testid="login-signed-in-applications"
        >
          {{ t('nav.myApplications') }}
        </UButton>
        <UButton
          type="button"
          color="neutral"
          variant="outline"
          size="xl"
          class="w-full justify-center sm:w-auto"
          :loading="loading"
          :disabled="loading"
          data-testid="login-signed-in-logout"
          @click="handleSignedInLogout"
        >
          {{ t('common.logout') }}
        </UButton>
      </div>
    </div>

    <template v-else-if="!codeSignInPending && step === 'email'">
      <!-- "Code senden" is never disabled for an empty field; the click answers at the field. -->
      <form
        class="space-y-6"
        novalidate
        data-testid="login-email-form"
        @submit.prevent="handleRequestCode"
      >
        <UFormField
          :label="t('auth.login.emailLabel')"
          :description="t('auth.login.emailHint')"
          :error="emailError ?? undefined"
          size="xl"
        >
          <UInput
            id="login-email"
            ref="emailField"
            v-model="email"
            type="email"
            autocomplete="email"
            inputmode="email"
            size="xl"
            :disabled="loading || ssoLoading"
            class="w-full"
          />
        </UFormField>

        <UButton
          type="submit"
          size="xl"
          class="w-full justify-center sm:w-auto"
          :loading="loading"
          :disabled="ssoLoading"
          data-testid="login-send-code"
        >
          {{ t('auth.login.sendMagicLink') }}
        </UButton>
      </form>

      <div
        v-if="bundIdAvailable"
        class="mt-8"
        data-testid="login-bundid"
      >
        <p class="mb-3 text-base text-muted">
          {{ t('auth.login.orBundId') }}
        </p>
        <UButton
          type="button"
          color="neutral"
          variant="outline"
          size="xl"
          class="w-full justify-center sm:w-auto"
          :loading="ssoLoading"
          :disabled="loading || ssoLoading"
          @click="handleBundIdLogin"
        >
          {{ t('auth.login.bundId') }}
        </UButton>
      </div>
    </template>

    <!-- Step 2: the code from the mail, in ONE field. -->
    <template v-else-if="!codeSignInPending && step === 'code-sent'">
      <UAlert
        v-if="!displayError"
        role="status"
        icon="i-lucide-circle-check"
        color="success"
        class="mb-6"
      >
        <template #description>
          <span>{{ t('auth.login.codeSentPrefix') }} <strong>{{ codeSentEmail }}</strong> {{ t('auth.login.codeSentSuffix') }}</span>
        </template>
      </UAlert>

      <form
        class="space-y-6"
        novalidate
        data-testid="login-code-form"
        @submit.prevent="handleVerifyCode"
      >
        <UFormField
          :label="t('auth.login.enterCode')"
          :description="t(codeHintTranslationKey)"
          :error="codeError ?? undefined"
          size="xl"
        >
          <UInput
            id="login-code"
            ref="codeField"
            v-model="codeInput"
            size="xl"
            type="text"
            inputmode="numeric"
            autocomplete="one-time-code"
            :disabled="loading"
            class="w-40 font-mono"
            data-testid="login-code"
            @paste="onCodePaste"
          />
        </UFormField>

        <div class="flex flex-wrap gap-2">
          <UButton
            type="submit"
            size="xl"
            class="w-full justify-center sm:w-auto"
            :loading="loading"
            data-testid="login-verify-code"
          >
            {{ t('auth.login.confirm') }}
          </UButton>
          <!-- On a phone the quiet pair starts a row; its text keeps the column edge (remark R2). -->
          <div class="flex flex-wrap gap-2 max-sm:-ms-3">
            <UButton
              type="button"
              color="neutral"
              variant="ghost"
              size="lg"
              :disabled="loading"
              data-testid="login-resend-code"
              @click="handleResend"
            >
              {{ t('auth.login.resend') }}
            </UButton>
            <UButton
              type="button"
              color="neutral"
              variant="ghost"
              size="lg"
              :disabled="loading"
              data-testid="login-code-back"
              @click="handleReset"
            >
              {{ t('common.back') }}
            </UButton>
          </div>
        </div>
      </form>
    </template>

    <AppProductLinks
      v-if="showStaffProductLinks"
      as="p"
      class="mt-6 text-sm"
    />

    <AppExtensionOutlet
      v-if="!showSignedIn"
      name="login-actions"
      :component-props="{ loading, administrationPath: publicAdministrationEntry, citizenReturnPath, signInWithCode }"
    />
  </CitizenPage>
</template>

<script setup lang="ts">
import { inject } from 'vue';
import { loginCodeHintKey } from '~/utils/auth-ui-extensions';
import CitizenPage from '~/components/citizen/Page.vue';
import AppExtensionOutlet from '~/components/AppExtensionOutlet.vue';
import AppProductLinks from '~/components/AppProductLinks.vue';
import { useLoadedPublicJurisdictionConfig } from '~/composables/usePublicJurisdictionConfig';
import { useBundidAvailability } from '~/composables/useBundidAvailability';
import { ssoErrorMessageKey } from '~/utils/sso-error';
import { appBasePath } from '#shared/app-base-path';
import {
    ADMIN_ENTRY_PATH,
    publicAdministrationPath,
    publicApplicationsPath,
    safeExternalAuthReturnPath,
    safeLocalAuthReturnPath,
    publicWorkspaceFromRoute
} from '~/utils/public-form-path';
import { accountLoginAddress } from '~/utils/account-label';

definePageMeta({
    layout: false
});

const { t, locale } = useI18n();
const codeHintTranslationKey = inject(loginCodeHintKey, 'auth.login.codeHint');
const router = useRouter();
const route = useRoute();
const runtimeConfig = useRuntimeConfig();
const citizenHost = runtimeConfig.public.uiMode === 'citizen';
const bundIdAvailable = useBundidAvailability();
const publicWorkspace = computed(() => publicWorkspaceFromRoute(route));
const tenantConfig = useLoadedPublicJurisdictionConfig(() => publicWorkspace.value.jurisdictionSlug);
const applicationsPath = computed(() => publicApplicationsPath(publicWorkspace.value));
// The administration entry, from the same source as the header's "Verwaltung"
// and the signed-in panel's link.
const publicAdministrationEntry = computed(() => publicAdministrationPath(publicWorkspace.value));
const {
    loading,
    error,
    step,
    codeSentEmail,
    codeLength,
    authenticated,
    notAllowedOnHost,
    hostRefusalMessage,
    isStaff,
    user,
    login,
    verify,
    logout,
    resetFlow,
    clearError
} = useAuth();

const email = ref('');
// One field for the code. Digits only, so a pasted "123 456" or the
// code the phone offers above its keyboard both count.
const codeInput = ref('');
const emailError = ref<string | null>(null);
const codeError = ref<string | null>(null);
const emailField = ref<{ inputRef?: HTMLInputElement } | null>(null);
const codeField = ref<{ inputRef?: HTMLInputElement } | null>(null);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const codeSignInPending = ref(false);
/**
 * True from checking the code until the
 * next page opens. `verify()` marks the session as signed in before the
 * navigation runs, so this flag also keeps the "Sie sind angemeldet" panel
 * from flashing during every login on this page.
 */
const signingIn = ref(false);
// The session state comes from the header's one shared status probe
// (`ensureStatus`); this page adds no request of its own.
const showSignedIn = computed(() => authenticated.value && !signingIn.value);
const ssoLoading = ref(false);
const landingError = ref<string | null>(null);

function cleanCode(value: string): string {
    return value.replace(/\D/gu, '').slice(0, codeLength.value);
}

const code = computed(() => cleanCode(codeInput.value));

// No `maxlength` on the field. A browser applies it to pasted text BEFORE
// the digits are filtered, so " 123456" or "123 456" kept only five digits and
// the field was full. Instead the field itself holds digits only, at most the
// code length, after every input and paste. UInput binds `:value`, so the DOM
// is written too: a cleaned value equal to the previous one would not patch it.
watch(codeInput, (value) => {
    const cleaned = cleanCode(value);
    if (cleaned !== value) codeInput.value = cleaned;
    const element = codeField.value?.inputRef;
    if (element && element.value !== cleaned) element.value = cleaned;
}, { flush: 'post' });

function onCodePaste(event: ClipboardEvent) {
    const element = event.target as HTMLInputElement | null;
    if (!element) return;
    event.preventDefault();
    const pasted = event.clipboardData?.getData('text') ?? '';
    const start = element.selectionStart ?? element.value.length;
    const end = element.selectionEnd ?? start;
    codeInput.value = cleanCode(element.value.slice(0, start) + pasted + element.value.slice(end));
}
const isValidCode = computed(() => code.value.length === codeLength.value);

// Checking starts by itself once the field holds the whole code, as the
// boxes did on `complete`.
watch(code, (next, previous) => {
    if (next.length === codeLength.value && next !== previous && !loading.value) void handleVerifyCode();
});

function focusField(field: { inputRef?: HTMLInputElement } | null) {
    void nextTick(() => field?.inputRef?.focus());
}

// Surface the auth composable error and any SSO landing error in one place so
// the alert and the ARIA live region stay in sync.
const displayError = computed(() => error.value || landingError.value);

/**
 * Surface one-time errors carried by auth redirects and strip their flags so
 * a refresh does not repeat the message. Keep `redirect` intact for login.
 */
onMounted(() => {
    if (route.query.sso_error === undefined && !route.query.session_expired) return;

    landingError.value = route.query.session_expired
        ? t('auth.login.sessionExpired')
        : t(ssoErrorMessageKey(route.query.sso_error));

    const {
        sso_error: _ssoError,
        session_expired: _sessionExpired,
        ...rest
    } = route.query;
    void router.replace({ query: rest, hash: route.hash });
});

function safeRedirectPath(fallback: string = applicationsPath.value): string {
    const rawQuery = route.query.redirect;
    const raw = (Array.isArray(rawQuery) ? rawQuery[0] : rawQuery) || fallback;
    return safeLocalAuthReturnPath(raw, fallback);
}

/**
 * Where a person goes after signing in when the address names no (safe)
 * target: staff into the administration, citizens to "Meine Anträge".
 * Read after `verify()`: it stores the account with its roles before it
 * resolves, so `isStaff` already describes the person who just signed in.
 * Without a workspace in the address the bare entry lets the admin middleware
 * pick the person's own workspace. A build without the administration (the
 * citizen-only build) sends staff to "Meine Anträge" as well.
 */
function defaultTargetAfterSignIn(): string {
    if (!isStaff.value) return applicationsPath.value;
    const entry = publicAdministrationEntry.value ?? ADMIN_ENTRY_PATH;
    return isAdministrationRoute(entry) ? entry : applicationsPath.value;
}

/**
 * True when `path` resolves to an administration page of THIS build. Asks the
 * router itself, so it cannot drift from the routes: the citizen-only build
 * has no admin pages, and `/admin/...` there falls to another route.
 */
function isAdministrationRoute(path: string): boolean {
    try {
        const record = router.resolve(path).matched.at(-1);
        return Boolean(record && /(?:^|\/)admin(?:\/|$)/iu.test(record.path));
    } catch {
        return false;
    }
}

function queryValue(key: string): string | null {
    const raw = route.query[key];
    const value = Array.isArray(raw) ? raw[0] : raw;
    return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * The soft return of the header's "Anmelden": the page the person was
 * on. Checked by the same `safeLocalAuthReturnPath` with the same fallback as
 * `redirect`, so it can only lead where `redirect` could.
 */
function softReturnPath(fallback: string): string {
    return safeLocalAuthReturnPath(queryValue('return') || fallback, fallback);
}

/**
 * Where a person goes after the code. `redirect` is a hard
 * target (a guard, the form flow or an invite asked for it) and wins for
 * everyone when it is safe; an unsafe one falls back to the soft return, then
 * to the default. `return` is a soft return: a citizen comes back to that page;
 * staff go into the administration, unless the return already is an
 * administration page of this build.
 */
function targetAfterSignIn(): string {
    const fallback = defaultTargetAfterSignIn();
    const soft = softReturnPath(fallback);
    const softTarget = !isStaff.value || (ADMIN_RETURN_PATH.test(soft) && isAdministrationRoute(soft)) ? soft : fallback;
    return safeLocalAuthReturnPath(queryValue('redirect') || softTarget, softTarget);
}

/** The return for citizen-only ways (BundID and login extensions): safe hard, else soft, else "Meine Anträge". */
function citizenReturnPath(): string {
    const soft = softReturnPath(applicationsPath.value);
    return safeLocalAuthReturnPath(queryValue('redirect') || soft, soft);
}

const logoutFailed = ref(false);
const signedInAddress = computed(() => accountLoginAddress(user.value));

// `/admin...`, `/<workspace>/admin...` or `/<workspace>/<organisation>/admin...`,
// without regard to case, as the router matches.
const ADMIN_RETURN_PATH = /^\/(?:[^/?#]+\/){0,2}admin(?:[/?#]|$)/iu;

/**
 * True when the page was reached from a link into the administration (the
 * admin middleware sends signed-out staff here with `?redirect=`). Only then
 * does the page speak of the administration; citizens never see it.
 */
const redirectsToAdministration = computed(() => !citizenHost && ADMIN_RETURN_PATH.test(safeRedirectPath()));
const showStaffProductLinks = computed(() => redirectsToAdministration.value && Boolean(tenantConfig.value));
const loginSubtitle = computed(() => redirectsToAdministration.value
    ? t('auth.login.subtitleAdministration')
    : t('auth.login.subtitle'));
const administrationReturnPath = computed(() =>
    redirectsToAdministration.value ? safeRedirectPath() : undefined
);

function stillOnLoginPage(): boolean {
    const path = router.currentRoute?.value?.path ?? route.path ?? '';
    return path.endsWith('/auth/login');
}

/**
 * After a successful login the next page takes over. When the navigation
 * did not leave this page (a guard kept it), the person is signed in here
 * and sees the signed-in panel instead of a status that never ends.
 */
async function leaveAfterLogin(path: string) {
    try {
        await router.push(path);
    } finally {
        if (stillOnLoginPage()) signingIn.value = false;
    }
}

/**
 * "Abmelden" on the signed-in panel: the login form returns and the focus
 * goes to its first field, where the next sign-in starts.
 */
async function handleSignedInLogout() {
    logoutFailed.value = false;
    if (!(await logout())) {
        // Still signed in: the panel stays, nothing moves.
        logoutFailed.value = true;
        return;
    }
    handleReset();
    await nextTick();
    document.getElementById('login-email')?.focus();
}

/**
 * Request login code
 */
async function handleRequestCode() {
    landingError.value = null;
    emailError.value = null;
    clearError();
    // The click answers at the field.
    if (!EMAIL_PATTERN.test(email.value.trim())) {
        emailError.value = t('auth.login.emailInvalid');
        focusField(emailField.value);
        return;
    }
    await login(email.value, publicWorkspace.value.jurisdictionSlug, locale.value);
}

/**
 * Verify entered code
 */
async function handleVerifyCode() {
    if (!codeSentEmail.value) return;
    codeError.value = null;
    if (!isValidCode.value) {
        codeError.value = t('auth.login.codeRequired');
        focusField(codeField.value);
        return;
    }

    clearError();
    signingIn.value = true;
    const result = await verify(codeSentEmail.value, code.value);

    if (result.success) {
        // An explicit safe `redirect` wins for everyone, as before.
        await leaveAfterLogin(targetAfterSignIn());
    } else {
        signingIn.value = false;
        codeInput.value = '';
        if (citizenHost && result.refusedOnHost) {
            email.value = '';
            focusField(emailField.value);
        }
    }
}

/**
 * Start BundID through the same-origin SSO route.
 */
function handleBundIdLogin() {
    landingError.value = null;
    ssoLoading.value = true;
    const returnPath = safeExternalAuthReturnPath(citizenReturnPath(), applicationsPath.value);
    const target = `/api/auth/sso-login?returnTo=${encodeURIComponent(returnPath)}`;
    window.location.assign(appBasePath(runtimeConfig.app.baseURL, target));
}

/**
 * Request and verify a code for a login extension.
 */
async function signInWithCode(address: string, code: string, redirect: string) {
    codeSignInPending.value = true;
    signingIn.value = true;
    landingError.value = null;
    clearError();
    email.value = address;
    let leaving = false;

    try {
        const loginResult = await login(address, publicWorkspace.value.jurisdictionSlug, locale.value);
        if (!loginResult.success) return;

        const result = await verify(address, code);
        if (result.success) {
            leaving = true;
            await leaveAfterLogin(redirect);
        }
    } finally {
        codeSignInPending.value = false;
        if (!leaving) signingIn.value = false;
    }
}

/**
 * Reset back to email step
 */
function handleReset() {
    resetFlow();
    landingError.value = null;
    codeError.value = null;
    codeInput.value = '';
}

/**
 * Resend the login code
 */
async function handleResend() {
    if (!codeSentEmail.value) return;
    codeInput.value = '';
    codeError.value = null;
    landingError.value = null;
    clearError();
    await login(codeSentEmail.value);
}

useHead({
    title: computed(() => `${t('auth.login.title')} - beantragt.ai`)
});
</script>
