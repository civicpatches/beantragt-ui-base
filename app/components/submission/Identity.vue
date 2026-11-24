<script setup lang="ts">
import { useAttrs, useId } from 'vue';
import type { PublicFormPathInput } from '~/utils/public-form-path';
import type {
    SubmissionIdentityData,
    SubmissionIdentityRequirements
} from '~/utils/submission-identity';
import {
    publicLoginPath,
    publicWorkspaceFromRoute
} from '~/utils/public-form-path';

const props = withDefaults(defineProps<{
    requirements: SubmissionIdentityRequirements
    errors?: Record<string, string>
    workspace?: PublicFormPathInput
    redirectPath?: string
    compact?: boolean
    disabled?: boolean
    hideStaffNotice?: boolean
    /**
     * Asked before the BundID login leaves the page by a full page load;
     * false keeps the citizen on the form. The e-mail login is a link and
     * goes through the page's route guard instead.
     */
    beforeExternalLogin?: (() => boolean | Promise<boolean>) | null
}>(), {
    errors: () => ({}),
    workspace: undefined,
    redirectPath: undefined,
    compact: false,
    disabled: false,
    hideStaffNotice: false,
    beforeExternalLogin: null
});

const emit = defineEmits<{
    authRedirect: [provider: 'passwordless' | 'bundid']
    staffSessionChange: [active: boolean]
}>();

const identity = defineModel<SubmissionIdentityData>('identity', { required: true });
// Field ids follow the section id, so an error summary can link to each field.
const attrs = useAttrs();
const fallbackSectionId = useId();
const fieldIdBase = computed(() => typeof attrs.id === 'string' && attrs.id ? attrs.id : `submission-identity-${fallbackSectionId}`);

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const runtimeConfig = useRuntimeConfig();
const auth = useAuth();
const ssoLoading = ref(false);
const ssoError = ref<string | null>(null);

const STAFF_ROLES = new Set(['administrator', 'department_admin', 'case_worker', 'service_account', 'nuxt_service']);
const AUTH_PROVIDER_ALIASES: Record<string, string> = {
    bundid_mock: 'bundid'
};

onMounted(() => {
    if (props.requirements.authMode !== 'anonymous') {
        void auth.checkStatus();
    }

    // Drupal redirects a failed SAML/BundID ACS back to this form page with
    // `?sso_error=1`. Surface a readable message and strip the param so a
    // refresh does not re-show it.
    if (route.query.sso_error) {
        ssoError.value = t('auth.login.ssoError');
        const { sso_error: _ssoError, ...rest } = route.query;
        void router.replace({ query: rest, hash: route.hash });
    }
});

const activeWorkspace = computed(() => props.workspace || publicWorkspaceFromRoute(route));
const returnPath = computed(() => {
    const raw = props.redirectPath || route.fullPath || route.path || '/';
    return raw.startsWith('/') && !raw.startsWith('//') ? raw : '/';
});
const isAssistantDraftRedirect = computed(() => returnPath.value.includes('assistantDraft='));
const loginPath = computed(() => {
    const path = publicLoginPath(activeWorkspace.value);
    return `${path}?redirect=${encodeURIComponent(returnPath.value)}`;
});
const roles = computed(() => auth.user.value?.roles || []);
const shouldUseAuthSession = computed(() => props.requirements.authMode !== 'anonymous');
const isStaffSession = computed(() => shouldUseAuthSession.value && auth.authenticated.value && roles.value.some(role => STAFF_ROLES.has(role)));
const currentProvider = computed(() => normalizeAuthProvider(auth.user.value?.auth_provider));
const allowedProviders = computed(() => new Set(props.requirements.providers.map(normalizeAuthProvider)));
const matchesProvider = computed(() => allowedProviders.value.size > 0 && allowedProviders.value.has(currentProvider.value));
const isCitizenSession = computed(() => shouldUseAuthSession.value && auth.authenticated.value && !isStaffSession.value && matchesProvider.value);
const isUnsupportedCitizenSession = computed(() => shouldUseAuthSession.value && auth.authenticated.value && !isStaffSession.value && !matchesProvider.value);
const canUseBundId = computed(() =>
    props.requirements.providers.includes('bundid')
    && runtimeConfig.public.uiMode !== 'citizen'
    && Boolean(runtimeConfig.public.ssoBundidEnabled)
);
const canUsePasswordless = computed(() => props.requirements.providers.includes('passwordless'));
const canUseAuth = computed(() => props.requirements.authMode !== 'anonymous' && (canUsePasswordless.value || canUseBundId.value));
const authRequired = computed(() => props.requirements.authMode === 'required');
const hasUnavailableRequiredProvider = computed(() => authRequired.value && !canUseAuth.value && !isCitizenSession.value);
const showFullName = computed(() => props.requirements.fullName !== 'none');
const showEmail = computed(() => props.requirements.email !== 'none');
const hasSupplementalFields = computed(() => showFullName.value || showEmail.value);
const shouldUseSessionEmail = computed(() => isCitizenSession.value && currentProvider.value === 'passwordless');
const sessionOwnerId = computed(() => {
    const uid = auth.user.value?.uid;
    if (typeof uid === 'number' || typeof uid === 'string') return `uid:${uid}`;
    const email = auth.user.value?.email;
    return typeof email === 'string' && email.trim() ? `email:${email.trim().toLowerCase()}` : null;
});
let appliedSessionEmail: string | null = null;
let appliedSessionEmailOwnerId: string | null = null;
const signedInDescription = computed(() => shouldUseSessionEmail.value && auth.user.value?.email
    ? t('form.identitySignedInAs', { email: auth.user.value.email })
    : t('form.identitySignedIn')
);
// The box says what fits the state: a signed-in citizen reads that the
// application goes to the account and is not asked to sign in again. A
// staff session keeps the citizen login, because its own account is never
// taken over as applicant (the page says so above the form).
const showLoginActions = computed(() => canUseAuth.value && !isCitizenSession.value);
const description = computed(() => {
    if (props.requirements.authMode === 'anonymous') return t('form.identityAnonymous');
    if (isCitizenSession.value) return signedInDescription.value;
    if (authRequired.value) return t('form.identityLoginRequired');
    if (!showLoginActions.value) return hasSupplementalFields.value ? t('form.identityDescription') : '';
    if (hasSupplementalFields.value) return t('form.identityAuthOptional');
    return t('form.identityAuthOptionalWithFormFields');
});
const loginBenefit = computed(() => showLoginActions.value && !authRequired.value ? t('form.identityLoginBenefit') : '');

watch(isStaffSession, active => emit('staffSessionChange', active), { immediate: true });

watch([sessionOwnerId, () => auth.user.value?.email, shouldUseSessionEmail], ([ownerId, email, useSessionEmail]) => {
    const sessionEmail = typeof email === 'string' ? email.trim() : '';
    const currentEmail = identity.value.email;

    if (appliedSessionEmailOwnerId !== null && ownerId !== null && appliedSessionEmailOwnerId !== ownerId) {
        const nextEmail = useSessionEmail ? sessionEmail : '';
        identity.value = { ...identity.value, email: nextEmail };
        appliedSessionEmail = nextEmail || null;
        appliedSessionEmailOwnerId = nextEmail ? ownerId : null;
        return;
    }

    if (appliedSessionEmail !== null) {
        if (currentEmail !== appliedSessionEmail) {
            appliedSessionEmail = null;
            return;
        }

        const nextEmail = useSessionEmail ? sessionEmail : '';
        identity.value = { ...identity.value, email: nextEmail };
        appliedSessionEmail = nextEmail || null;
        if (!nextEmail) appliedSessionEmailOwnerId = null;
        return;
    }

    if (useSessionEmail && sessionEmail && !currentEmail) {
        identity.value = { ...identity.value, email: sessionEmail };
        appliedSessionEmail = sessionEmail;
        appliedSessionEmailOwnerId = ownerId;
    }
}, { immediate: true });

const fullNameModel = computed({
    get: () => identity.value.fullName,
    set: (fullName: string) => {
        identity.value = { ...identity.value, fullName };
    }
});

const emailModel = computed({
    get: () => identity.value.email,
    set: (email: string) => {
        identity.value = { ...identity.value, email };
    }
});

function normalizeAuthProvider(value: unknown): string {
    if (typeof value !== 'string') return 'unknown';
    const provider = value.trim().toLowerCase();
    if (!provider) return 'unknown';
    return AUTH_PROVIDER_ALIASES[provider] || provider;
}

async function handleBundIdLogin() {
    if (props.disabled) return;
    if (props.beforeExternalLogin && !(await props.beforeExternalLogin())) return;
    ssoError.value = null;
    emit('authRedirect', 'bundid');
    ssoLoading.value = true;
    const target = `/api/auth/sso-login?returnTo=${encodeURIComponent(returnPath.value)}`;
    window.location.assign(target);
}

function handlePasswordlessLogin() {
    if (props.disabled) return;
    emit('authRedirect', 'passwordless');
}
</script>

<template>
  <section
    v-if="requirements.show"
    class="rounded-lg border border-default bg-elevated/40 p-4"
    :class="compact ? 'space-y-3' : 'space-y-4'"
    :aria-label="t('form.identityTitle')"
  >
    <div class="flex items-start gap-3">
      <div class="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        <UIcon
          name="i-lucide-user-check"
          class="size-5"
        />
      </div>
      <div class="min-w-0">
        <p class="text-sm font-semibold text-highlighted">
          {{ t('form.identityTitle') }}
        </p>
        <p
          v-if="description"
          class="mt-1 text-sm leading-relaxed text-muted"
          data-testid="submission-identity-description"
        >
          {{ description }}
        </p>
        <p
          v-if="loginBenefit"
          class="mt-1 text-sm leading-relaxed text-muted"
          data-testid="submission-identity-login-benefit"
        >
          {{ loginBenefit }}
        </p>
      </div>
    </div>

    <UAlert
      v-if="ssoError"
      color="error"
      role="alert"
      icon="i-lucide-circle-x"
      :title="ssoError"
    />

    <UAlert
      v-if="isUnsupportedCitizenSession"
      role="status"
      color="warning"
      icon="i-lucide-triangle-alert"
      :title="t('form.identityProviderMismatch')"
    />
    <UAlert
      v-else-if="isStaffSession && !hideStaffNotice"
      role="status"
      color="warning"
      icon="i-lucide-triangle-alert"
      :title="t('form.identityStaffSession')"
    />
    <UAlert
      v-else-if="hasUnavailableRequiredProvider"
      role="status"
      color="warning"
      icon="i-lucide-triangle-alert"
      :title="t('form.identityProviderUnavailable')"
    />

    <div
      v-if="showLoginActions"
      class="flex flex-col gap-2 sm:flex-row"
    >
      <UButton
        v-if="canUseBundId"
        type="button"
        color="neutral"
        variant="outline"
        icon="i-lucide-shield-check"
        :loading="ssoLoading"
        :disabled="disabled || ssoLoading"
        @click="handleBundIdLogin"
      >
        {{ t('form.identityBundId') }}
      </UButton>
      <UButton
        v-if="canUsePasswordless"
        :to="loginPath"
        color="neutral"
        variant="soft"
        icon="i-lucide-mail"
        :disabled="disabled"
        @click="handlePasswordlessLogin"
      >
        {{ t('form.identityEmailLogin') }}
      </UButton>
    </div>
    <p
      v-if="showLoginActions && isAssistantDraftRedirect"
      class="text-sm leading-relaxed text-muted"
    >
      {{ t('form.identityDraftRedirectHint') }}
    </p>

    <div
      v-if="showFullName || showEmail"
      class="grid grid-cols-1 gap-4 md:grid-cols-2"
    >
      <UFormField
        v-if="showFullName"
        :id="`${fieldIdBase}-full-name`"
        name="applicant_full_name"
        :label="t('form.identityFullName')"
        :required="requirements.fullName === 'required'"
        :error="errors.fullName"
      >
        <UInput
          v-model="fullNameModel"
          type="text"
          autocomplete="name"
          :placeholder="t('form.identityFullNamePlaceholder')"
          class="w-full"
          :disabled="disabled"
        />
      </UFormField>

      <UFormField
        v-if="showEmail"
        :id="`${fieldIdBase}-email`"
        name="applicant_email"
        :label="t('form.identityEmail')"
        :required="requirements.email === 'required'"
        :error="errors.email"
      >
        <UInput
          v-model="emailModel"
          type="email"
          autocomplete="email"
          inputmode="email"
          :placeholder="t('form.identityEmailPlaceholder')"
          class="w-full"
          :disabled="disabled"
        />
      </UFormField>
    </div>
  </section>
</template>
