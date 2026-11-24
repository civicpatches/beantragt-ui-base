<script setup lang="ts">
import CitizenPage from '~/components/citizen/Page.vue';
import AppCard from '~/components/app/Card.vue';
import type { TimelineEntry } from '~/components/StatusTimeline.vue';
import { publicApplicationsPath, publicWorkspaceFromRoute } from '~/utils/public-form-path';

definePageMeta({
    layout: false
});

const { t, locale } = useI18n();
const route = useRoute();
const publicWorkspace = computed(() => publicWorkspaceFromRoute(route));
const applicationsPath = computed(() => publicApplicationsPath(publicWorkspace.value));
// From the header's shared session probe; no request of this page.
const { authenticated, isStaff } = useAuth();
const showApplicationsHint = computed(() => authenticated.value && !isStaff.value);

interface StatusResponse {
    referenceNumber: string
    formTitle?: string | null
    orgName?: string | null
    status: string
    statusLabel?: string | null
    statusColor?: string | null
    statusIcon?: string | null
    createdAt: string
    updatedAt: string
    timeline?: TimelineEntry[]
}

const referenceNumber = ref(typeof route.query.ref === 'string' ? route.query.ref.toUpperCase() : '');
// Read once, then out of the address bar and the history entry.
if (route.query.ref !== undefined) void useRouter().replace({ query: { ...route.query, ref: undefined } });
const email = ref('');
const statusCode = ref('');
const referenceError = ref<string | null>(null);
const emailError = ref<string | null>(null);
const codeError = ref<string | null>(null);
const requestSent = ref(false);
const requestMessage = ref<string | null>(null);
const submitError = ref<string | null>(null);
const isRequesting = ref(false);
const isVerifying = ref(false);
const statusData = ref<StatusResponse | null>(null);
const requestedReference = ref('');
const requestedEmail = ref('');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REF_PATTERN = /^[A-Z0-9][A-Z0-9-]{2,63}$/i;

const resultHeading = ref<HTMLElement | null>(null);

const timelineEntries = computed<TimelineEntry[]>(() => statusData.value?.timeline ?? []);

watch([referenceNumber, email], ([nextReference, nextEmail]) => {
    if (!requestSent.value) return;
    const normalizedReference = nextReference.trim().toUpperCase();
    const normalizedEmail = nextEmail.trim().toLowerCase();
    if (normalizedReference === requestedReference.value && normalizedEmail === requestedEmail.value) return;

    requestSent.value = false;
    requestMessage.value = null;
    statusCode.value = '';
    codeError.value = null;
    statusData.value = null;
});

function resetErrors() {
    referenceError.value = null;
    emailError.value = null;
    codeError.value = null;
    submitError.value = null;
}

// The click answers at the field with message and focus.
function focusField(id: string) {
    void nextTick(() => document.getElementById(id)?.focus());
}

function validateLookupBase(): string | null {
    const trimmed = referenceNumber.value.trim().toUpperCase();
    if (!trimmed) {
        referenceError.value = t('statusPage.lookup.required');
        focusField('status-lookup-reference');
        return null;
    }

    if (!REF_PATTERN.test(trimmed)) {
        referenceError.value = t('statusPage.lookup.invalidFormat');
        focusField('status-lookup-reference');
        return null;
    }

    referenceNumber.value = trimmed;

    if (!EMAIL_PATTERN.test(email.value.trim())) {
        emailError.value = t('statusPage.lookup.emailInvalid');
        focusField('status-lookup-email');
        return null;
    }

    return trimmed;
}

async function requestCode() {
    resetErrors();
    const trimmed = validateLookupBase();
    if (!trimmed || isRequesting.value) return;

    isRequesting.value = true;
    statusData.value = null;
    try {
        await $fetch(`/api/status/${trimmed}/request-code`, {
            method: 'POST',
            body: { email: email.value.trim(), langcode: locale.value }
        });
        requestedReference.value = trimmed;
        requestedEmail.value = email.value.trim().toLowerCase();
        requestSent.value = true;
        requestMessage.value = t('statusPage.lookup.codeSent');
    } catch {
        submitError.value = t('statusPage.lookup.codeRequestFailed');
    } finally {
        isRequesting.value = false;
    }
}

async function verifyCode() {
    resetErrors();
    const trimmed = validateLookupBase();
    if (!trimmed || isVerifying.value) return;

    const code = statusCode.value.trim();
    if (!/^\d{6}$/.test(code)) {
        codeError.value = t('statusPage.lookup.codeInvalid');
        focusField('status-lookup-code');
        return;
    }

    isVerifying.value = true;
    try {
        statusData.value = await $fetch<StatusResponse>(`/api/status/${trimmed}/verify-code`, {
            method: 'POST',
            body: {
                email: email.value.trim(),
                code
            }
        });
        requestMessage.value = null;
        // The answer stands first; the person lands on it.
        await nextTick();
        resultHeading.value?.focus();
    } catch (e: unknown) {
        const statusCode = errorStatusCode(e);
        submitError.value = statusCode === 401 || statusCode === 400
            ? t('statusPage.lookup.verifyFailed')
            : t('statusPage.lookup.loadFailed');
    } finally {
        isVerifying.value = false;
    }
}

function submitLookup() {
    if (requestSent.value) {
        void verifyCode();
        return;
    }
    void requestCode();
}

function errorStatusCode(error: unknown): number | null {
    if (!error || typeof error !== 'object') return null;
    const directStatus = (error as { statusCode?: unknown }).statusCode;
    if (typeof directStatus === 'number') return directStatus;
    const status = (error as { status?: unknown }).status;
    if (typeof status === 'number') return status;
    const nestedStatus = (error as { data?: { statusCode?: unknown } }).data?.statusCode;
    return typeof nestedStatus === 'number' ? nestedStatus : null;
}

useHead({
    title: `${t('statusPage.lookup.title')} - beantragt.ai`
});
</script>

<template>
  <CitizenPage
    width="narrow"
    :title="t('statusPage.lookup.title')"
    :lead="t('statusPage.lookup.description')"
  >
    <!--
      The narrow column of the citizen frame, the fields on the page
      (no card around the only content), and after a successful check the
      answer first, the form for another application under it.
    -->
    <!-- Signed-in citizens see their applications without a code. -->
    <template
      v-if="showApplicationsHint"
      #meta
    >
      <p data-testid="status-lookup-applications-hint">
        {{ t('statusPage.lookup.signedInHint') }}
        <ULink
          :to="applicationsPath"
          class="font-medium text-default underline underline-offset-2"
        >
          {{ t('nav.myApplications') }}
        </ULink>
      </p>
    </template>

    <AppCard
      v-if="statusData"
      class="mb-10"
      data-testid="status-lookup-result"
    >
      <div class="flex flex-wrap items-start justify-between gap-2">
        <h2
          ref="resultHeading"
          tabindex="-1"
          class="-ms-2.5 min-w-0 border-s-2 border-transparent ps-2 text-base font-semibold break-words text-highlighted outline-none focus-visible:border-primary"
          data-testid="status-lookup-result-heading"
        >
          {{ statusData.formTitle || t('statusPage.title') }}
        </h2>
        <StatusBadge
          :status="statusData.status"
          :label="statusData.statusLabel ?? undefined"
          :color="statusData.statusColor ?? undefined"
          :icon="statusData.statusIcon ?? undefined"
          type="application"
        />
      </div>
      <p class="mt-1 text-sm break-words text-muted">
        <span class="font-mono break-all">{{ statusData.referenceNumber }}</span>
        <template v-if="statusData.orgName">
          · {{ statusData.orgName }}
        </template>
      </p>

      <template v-if="timelineEntries.length">
        <h3 class="mt-4 border-t border-default pt-4 text-base font-semibold text-highlighted">
          {{ t('statusPage.timeline.title') }}
        </h3>
        <StatusTimeline
          class="mt-3"
          :entries="timelineEntries"
        />
      </template>
    </AppCard>

    <h2
      v-if="statusData"
      class="mb-4 text-base font-semibold text-highlighted"
    >
      {{ t('statusPage.lookup.another') }}
    </h2>

    <!-- The button is never disabled for an empty field; the click answers at the field. -->
    <form
      class="space-y-6"
      novalidate
      data-testid="status-lookup-form"
      @submit.prevent="submitLookup"
    >
      <!--
        Where the number is found, above the field. No
        example: the format is the municipality's own.
      -->
      <UFormField
        :label="t('statusPage.referenceNumber')"
        :description="t('statusPage.lookup.formatHint')"
        :error="referenceError ?? undefined"
        size="xl"
      >
        <UInput
          id="status-lookup-reference"
          v-model="referenceNumber"
          size="xl"
          autocomplete="off"
          autocapitalize="characters"
          spellcheck="false"
          class="w-full font-mono"
          data-testid="status-lookup-reference"
        />
      </UFormField>

      <!--
        The backend sends a code only for an application whose address is
        confirmed and answers the same either way, so the page states the
        rule instead of guessing the case.
      -->
      <UFormField
        :label="t('statusPage.lookup.email')"
        :description="t('statusPage.lookup.confirmationRequired')"
        :error="emailError ?? undefined"
        size="xl"
      >
        <UInput
          id="status-lookup-email"
          v-model="email"
          size="xl"
          type="email"
          autocomplete="email"
          inputmode="email"
          class="w-full"
          data-testid="status-lookup-email"
        />
      </UFormField>

      <UAlert
        v-if="requestMessage"
        role="status"
        color="success"
        icon="i-lucide-circle-check"
        :title="requestMessage"
      />

      <!-- One field for the code from the mail. -->
      <UFormField
        v-if="requestSent"
        :label="t('statusPage.lookup.code')"
        :description="t('statusPage.lookup.codeHint')"
        :error="codeError ?? undefined"
        size="xl"
      >
        <UInput
          id="status-lookup-code"
          v-model="statusCode"
          size="xl"
          inputmode="numeric"
          autocomplete="one-time-code"
          maxlength="6"
          class="w-40 font-mono"
          data-testid="status-lookup-code"
        />
      </UFormField>

      <UAlert
        v-if="submitError"
        role="alert"
        color="error"
        icon="i-lucide-circle-x"
        :title="submitError"
      />

      <UButton
        v-if="!requestSent"
        type="submit"
        size="xl"
        class="w-full justify-center sm:w-auto"
        :loading="isRequesting"
        data-testid="status-lookup-request"
      >
        {{ t('statusPage.lookup.requestCode') }}
      </UButton>

      <div
        v-else
        class="flex flex-wrap gap-2"
      >
        <UButton
          type="submit"
          size="xl"
          class="w-full justify-center sm:w-auto"
          :loading="isVerifying"
          :disabled="isRequesting"
          data-testid="status-lookup-verify"
        >
          {{ t('statusPage.lookup.verifyCode') }}
        </UButton>
        <UButton
          color="neutral"
          variant="ghost"
          size="lg"
          type="button"
          :loading="isRequesting"
          :disabled="isVerifying"
          class="max-sm:-ms-3"
          data-testid="status-lookup-resend"
          @click="requestCode"
        >
          {{ t('statusPage.lookup.resendCode') }}
        </UButton>
      </div>
    </form>
  </CitizenPage>
</template>
