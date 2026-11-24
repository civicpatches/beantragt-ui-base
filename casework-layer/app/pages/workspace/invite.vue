<template>
  <div class="min-h-screen flex items-center justify-center px-3 sm:px-4 py-8 bg-default">
    <main class="w-full max-w-lg">
      <div class="text-center mb-8">
        <NuxtLink
          to="/"
          class="inline-flex items-center gap-2 mb-6"
          :aria-label="t('common.appName')"
        >
          <MunicipalityBrand />
        </NuxtLink>
        <p class="text-sm font-medium uppercase tracking-wide text-primary mb-2">
          {{ t(invite?.purpose === 'member_invite' ? 'workspaceInvite.memberEyebrow' : 'workspaceInvite.eyebrow') }}
        </p>
        <h1 class="text-2xl font-bold text-highlighted">
          {{ pageTitle }}
        </h1>
      </div>

      <section class="bg-default ring ring-default rounded-lg shadow-md p-5 sm:p-8">
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          class="sr-only"
        >
          {{ liveStatus }}
        </div>

        <div
          v-if="state === 'loading'"
          class="flex flex-col items-center text-center py-8"
        >
          <UIcon
            name="i-lucide-loader-circle"
            class="size-10 text-primary animate-spin mb-4"
          />
          <p class="text-muted">
            {{ t('workspaceInvite.loading') }}
          </p>
        </div>

        <div v-else-if="state === 'error'">
          <UAlert
            icon="i-lucide-circle-x"
            color="error"
            :title="t('workspaceInvite.errorTitle')"
            :description="error"
            class="mb-6"
          />
          <div class="flex flex-col sm:flex-row gap-3">
            <UButton
              to="/"
              color="neutral"
              variant="soft"
              size="lg"
              icon="i-lucide-home"
              block
            >
              {{ t('common.backToHome') }}
            </UButton>
            <UButton
              v-if="errorCode === 'workspace_invite.email_mismatch'"
              size="lg"
              icon="i-lucide-log-in"
              :loading="switchingAccount"
              :disabled="switchingAccount"
              block
              @click="switchAccount"
            >
              {{ t('workspaceInvite.switchAccount') }}
            </UButton>
            <UButton
              v-else-if="errorCode === 'workspace_invite.auth_required'"
              size="lg"
              icon="i-lucide-log-in"
              block
              @click="goToLogin"
            >
              {{ t('workspaceInvite.loginToAccept') }}
            </UButton>
            <UButton
              v-else
              size="lg"
              icon="i-lucide-refresh-cw"
              block
              @click="verifyInvite"
            >
              {{ t('common.refresh') }}
            </UButton>
          </div>
          <UAlert
            v-if="switchLogoutFailed"
            color="error"
            icon="i-lucide-circle-x"
            role="alert"
            :title="t('auth.logoutFailed')"
            class="mt-4"
            data-testid="workspace-invite-logout-failed"
          />
        </div>

        <div v-else-if="state === 'claimed'">
          <div class="flex flex-col items-center text-center mb-6">
            <div class="size-12 rounded-full bg-success/10 flex items-center justify-center mb-4">
              <UIcon
                name="i-lucide-check"
                class="size-7 text-success"
              />
            </div>
            <p class="text-muted">
              {{ t(invite?.purpose === 'member_invite' ? 'workspaceInvite.memberClaimedDescription' : 'workspaceInvite.claimedDescription') }}
            </p>
          </div>

          <dl
            v-if="invite"
            class="rounded-lg border border-default divide-y divide-default mb-6"
          >
            <div class="px-4 py-3">
              <dt class="text-xs font-medium uppercase tracking-wide text-muted">
                {{ t('workspaceInvite.targetParent') }}
              </dt>
              <dd class="mt-1 text-sm text-highlighted">
                {{ invite.target_parent_label || t('workspaceInvite.unknownTarget') }}
              </dd>
            </div>
            <div
              v-if="claimedEmail"
              class="px-4 py-3"
            >
              <dt class="text-xs font-medium uppercase tracking-wide text-muted">
                {{ t('workspaceInvite.acceptedFor') }}
              </dt>
              <dd class="mt-1 text-sm text-highlighted break-all">
                {{ claimedEmail }}
              </dd>
            </div>
          </dl>

          <UButton
            :to="continueToCasework ? claimedWorkspaceEntry || ADMIN_ENTRY_PATH : '/auth/login'"
            size="lg"
            icon="i-lucide-log-in"
            block
          >
            {{ t(continueToCasework ? 'workspaceInvite.continueToCasework' : 'workspaceInvite.continueToLogin') }}
          </UButton>
        </div>

        <div v-else-if="(state === 'pending' || state === 'claiming') && invite">
          <UAlert
            icon="i-lucide-info"
            color="info"
            :title="t('workspaceInvite.pendingTitle')"
            :description="t(invite.purpose === 'member_invite' ? 'workspaceInvite.memberPendingDescription' : 'workspaceInvite.pendingDescription')"
            class="mb-6"
          />

          <dl class="rounded-lg border border-default divide-y divide-default mb-6">
            <div class="px-4 py-3">
              <dt class="text-xs font-medium uppercase tracking-wide text-muted">
                {{ t('workspaceInvite.targetParent') }}
              </dt>
              <dd class="mt-1 text-sm text-highlighted">
                {{ invite.target_parent_label || t('workspaceInvite.unknownTarget') }}
              </dd>
            </div>
            <div class="px-4 py-3">
              <dt class="text-xs font-medium uppercase tracking-wide text-muted">
                {{ t('workspaceInvite.expires') }}
              </dt>
              <dd class="mt-1 text-sm text-highlighted">
                {{ formattedExpires }}
              </dd>
            </div>
          </dl>

          <UAlert
            v-if="error"
            role="alert"
            icon="i-lucide-circle-x"
            color="error"
            :title="error"
            class="mb-6"
          />

          <template v-if="isAuthenticated">
            <UButton
              size="lg"
              icon="i-lucide-check"
              :loading="state === 'claiming'"
              :disabled="state === 'claiming'"
              block
              @click="claimInvite"
            >
              {{ t('workspaceInvite.accept') }}
            </UButton>
          </template>
          <template v-else>
            <p class="text-sm text-muted mb-3">
              {{ t('workspaceInvite.loginRequiredHint') }}
            </p>
            <UButton
              size="lg"
              icon="i-lucide-log-in"
              block
              @click="goToLogin"
            >
              {{ t('workspaceInvite.loginToAccept') }}
            </UButton>
          </template>
        </div>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import type { WorkspaceInvitePublic, WorkspaceInviteResponse } from '~/types';
import { ADMIN_ENTRY_PATH, publicAdministrationPath } from '~/utils/public-form-path';

definePageMeta({
    layout: false
});

const { t, locale } = useI18n();
const route = useRoute();
const { isAuthenticated, isStaff, user, checkStatus, logout } = useAuth();

type InvitePageState = 'loading' | 'pending' | 'claiming' | 'claimed' | 'error';

const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

const state = ref<InvitePageState>('loading');
const invite = ref<WorkspaceInvitePublic | null>(null);
// Set only from the authenticated claim response; the anonymous verify
// response intentionally carries no invitee email.
const claimedEmail = ref<string | null>(null);
const claimedWorkspaceEntry = ref<string | null>(null);
const continueToCasework = computed(() => invite.value?.purpose === 'member_invite' && isStaff.value);
const error = ref('');
const errorCode = ref('');
const switchingAccount = ref(false);

const token = computed(() => {
    const raw = route.query.token;
    const value = Array.isArray(raw) ? raw[0] : raw;
    return typeof value === 'string' ? value.trim() : '';
});

// Set when the visitor returns from the login round trip: the intent to
// accept was already expressed by the "sign in and accept" button, so the
// claim runs automatically once the session is established.
const shouldAutoClaim = computed(() => route.query.autoclaim === '1');

const pageTitle = computed(() => {
    if (state.value === 'claimed') return t('workspaceInvite.claimedTitle');
    if (state.value === 'error') return t('workspaceInvite.errorTitle');
    return t('workspaceInvite.title');
});

const liveStatus = computed(() => {
    if (error.value) return error.value;
    if (state.value === 'claimed') return t('workspaceInvite.claimedTitle');
    if (state.value === 'claiming') return t('workspaceInvite.claiming');
    if (state.value === 'pending') return t('workspaceInvite.pendingTitle');
    return t('workspaceInvite.loading');
});

const formattedExpires = computed(() => {
    if (!invite.value?.expires) return t('workspaceInvite.unknownExpiry');
    return new Intl.DateTimeFormat(locale.value === 'en' ? 'en-US' : 'de-DE', {
        dateStyle: 'medium',
        timeStyle: 'short'
    }).format(new Date(invite.value.expires * 1000));
});

interface InviteErrorInfo {
    code: string
    message: string
}

// Names the signed-in account when known so the visitor can tell which
// address to switch to; the invite address itself is never exposed here.
function emailMismatchMessage(): string {
    const email = user.value?.email;
    return email
        ? t('workspaceInvite.errors.emailMismatch', { email })
        : t('workspaceInvite.errors.emailMismatchGeneric');
}

function inviteErrorInfo(e: unknown): InviteErrorInfo {
    const fetchError = e as {
        message?: string
        statusCode?: number
        status?: number
        data?: {
            code?: string
            statusCode?: number
            data?: {
                code?: string
            }
        }
    };
    const code = fetchError.data?.data?.code || fetchError.data?.code || fetchError.message || '';
    const statusCode = fetchError.statusCode || fetchError.status || fetchError.data?.statusCode;

    const messageByCode: Record<string, string> = {
        'workspace_invite.invalid_token': t('workspaceInvite.errors.invalidToken'),
        'workspace_invite.not_found': t('workspaceInvite.errors.notFound'),
        'workspace_invite.expired': t('workspaceInvite.errors.expired'),
        'workspace_invite.auth_required': t('workspaceInvite.errors.authRequired'),
        'workspace_invite.email_mismatch': emailMismatchMessage(),
        'workspace_invite.already_claimed': t('workspaceInvite.errors.alreadyClaimed'),
        'workspace_invite.rate_limited': t('workspaceInvite.errors.rateLimited')
    };
    if (messageByCode[code]) {
        return { code, message: messageByCode[code] };
    }

    const infoByStatus: Record<number, InviteErrorInfo> = {
        401: { code: 'workspace_invite.auth_required', message: t('workspaceInvite.errors.authRequired') },
        403: { code: 'workspace_invite.email_mismatch', message: emailMismatchMessage() },
        404: { code: 'workspace_invite.not_found', message: t('workspaceInvite.errors.notFound') },
        409: { code: 'workspace_invite.already_claimed', message: t('workspaceInvite.errors.alreadyClaimed') },
        410: { code: 'workspace_invite.expired', message: t('workspaceInvite.errors.expired') },
        429: { code: 'workspace_invite.rate_limited', message: t('workspaceInvite.errors.rateLimited') }
    };
    if (statusCode && infoByStatus[statusCode]) {
        return infoByStatus[statusCode];
    }

    return { code: 'generic', message: t('workspaceInvite.errors.generic') };
}

function inviteUrl() {
    // The autoclaim marker lets the page finish the claim automatically once
    // the visitor returns authenticated from the login round trip.
    return `/workspace/invite?token=${token.value}&autoclaim=1`;
}

async function goToLogin() {
    if (!TOKEN_PATTERN.test(token.value)) return;
    await navigateTo(`/auth/login?redirect=${encodeURIComponent(inviteUrl())}`);
}

// The server kept the session: no way to the login page as the other
// account; say so next to the button.
const switchLogoutFailed = ref(false);

async function switchAccount() {
    if (switchingAccount.value) return;
    switchingAccount.value = true;
    switchLogoutFailed.value = false;
    try {
        if (!(await logout())) {
            switchLogoutFailed.value = true;
            return;
        }
        await goToLogin();
    } finally {
        switchingAccount.value = false;
    }
}

async function verifyInvite() {
    error.value = '';
    errorCode.value = '';
    invite.value = null;
    claimedEmail.value = null;
    claimedWorkspaceEntry.value = null;

    if (!TOKEN_PATTERN.test(token.value)) {
        state.value = 'error';
        error.value = t('workspaceInvite.errors.invalidToken');
        errorCode.value = 'workspace_invite.invalid_token';
        return;
    }

    state.value = 'loading';

    // Resolve the session in parallel so the pending view renders the
    // correct primary action without a flash. A failed status check is
    // non-fatal and simply leaves the visitor treated as unauthenticated.
    const verifyRequest = $fetch<WorkspaceInviteResponse>(`/api/workspace-invites/verify/${token.value}`);
    await checkStatus().catch(() => {});

    try {
        const response = await verifyRequest;
        invite.value = response.invite;
        state.value = response.status === 'claimed' ? 'claimed' : 'pending';
    } catch (e: unknown) {
        const info = inviteErrorInfo(e);
        state.value = 'error';
        error.value = info.message;
        errorCode.value = info.code;
    }

    // The visitor returned from the login redirect with intent to accept
    // already expressed; finish the claim without a second click.
    if (state.value === 'pending' && shouldAutoClaim.value && isAuthenticated.value) {
        await claimInvite();
    }
}

async function claimInvite() {
    if (!TOKEN_PATTERN.test(token.value) || state.value === 'claiming') return;

    error.value = '';
    errorCode.value = '';
    state.value = 'claiming';

    try {
        const response = await $fetch<WorkspaceInviteResponse>(`/api/workspace-invites/claim/${token.value}`, {
            method: 'POST'
        });
        invite.value = response.invite;
        if (response.status === 'claimed') {
            claimedEmail.value = response.invite.email;
            claimedWorkspaceEntry.value = response.invite.workspace ? publicAdministrationPath(response.invite.workspace) : null;
        }
        state.value = 'claimed';
    } catch (e: unknown) {
        const info = inviteErrorInfo(e);
        error.value = info.message;
        errorCode.value = info.code;

        if (info.code === 'workspace_invite.rate_limited') {
            // Transient: keep the visitor on the pending view to retry.
            state.value = 'pending';
        } else if (info.code === 'workspace_invite.already_claimed') {
            state.value = 'claimed';
        } else {
            state.value = 'error';
        }
    }
}

watch(
    token,
    () => {
        void verifyInvite();
    },
    { immediate: true }
);
</script>
