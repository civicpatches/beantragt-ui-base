<script setup lang="ts">
import CitizenPage from '~/components/citizen/Page.vue';
import AppCard from '~/components/app/Card.vue';
import { formatDate } from '~/composables/useFormatters';
import { useApplicant, type ApplicantConsentKind, type ApplicantProfileData } from '~/composables/useApplicant';
import ErasureOverview from '~/components/citizen/ErasureOverview.vue';
import DataList, { type DataListItem } from '~/components/citizen/DataList.vue';
import { clearSubmissionDrafts } from '~/utils/submission-draft-storage';
import type { ErasurePreview, ErasureSummary } from '~/utils/citizen-erasure';
import {
    publicApplicationsPath,
    publicHomePath,
    publicWorkspaceFromRoute
} from '~/utils/public-form-path';
import { localizedPrivacyPath } from '~/utils/locale-routing';

definePageMeta({
    layout: false,
    middleware: 'auth'
});

const { t, locale } = useI18n();
const toast = useToast();
const route = useRoute();
const { resolveApiErrorMessage } = useApiErrorMessage();
const {
    isLoading,
    loadError,
    isSaving,
    saveError,
    clearSaveError,
    storedData,
    loadMyData: loadApplicantData,
    updateMyData,
    deleteMyData,
    isLoadingDeletePreview,
    deletePreviewError,
    deletePreview,
    loadDeletePreview,
    isWithdrawing,
    withdrawError,
    withdrawConsent
} = useApplicant();
const publicWorkspace = computed(() => publicWorkspaceFromRoute(route));
const homePath = computed(() => publicHomePath(publicWorkspace.value));
const applicationsPath = computed(() => publicApplicationsPath(publicWorkspace.value));
const privacyPath = computed(() => localizedPrivacyPath(locale.value, publicWorkspace.value));

useHead({
    title: computed(() => `${t('citizen.myData.title')} - beantragt.ai`)
});

const { expireSession } = useAuth();
const router = useRouter();

// Deletion state
const showDeleteDialog = ref(false);
const isDeleting = ref(false);
const deleteError = ref<string | null>(null);
const deleteSuccess = ref(false);
/** What the erasure deleted and what stays, shown after the deletion. */
const erasureSummary = ref<ErasureSummary | null>(null);
/** Preview the confirmation was given for; names the deleted profiles. */
const confirmedPreview = ref<ErasurePreview | null>(null);
/** Heading of the summary; takes the focus once the account is deleted. */
const erasureSummaryHeading = ref<HTMLElement | null>(null);
const editingProfile = ref(false);
/** "Profildaten bearbeiten"; takes the focus back when editing ends. */
const editProfileButton = ref<{ $el?: unknown } | null>(null);
const profileForm = reactive({
    fullName: '',
    phone: '',
    address: '',
    street: '',
    postalCode: '',
    city: ''
});

const loadRetryActions = computed(() => [{
    label: t('common.retry'),
    color: 'neutral' as const,
    variant: 'outline' as const,
    onClick: () => {
        void loadMyData();
    }
}]);

async function loadMyData() {
    await loadApplicantData();
    resetProfileForm();
}

function resetProfileForm() {
    const profile = storedData.value?.profile;
    profileForm.fullName = profile?.fullName || '';
    profileForm.phone = profile?.phone || '';
    profileForm.address = profile?.address || '';
    profileForm.street = profile?.street || '';
    profileForm.postalCode = profile?.postalCode || '';
    profileForm.city = profile?.city || '';
}

function beginProfileEdit() {
    clearSaveError();
    resetProfileForm();
    // The name field takes the focus through its `autofocus`.
    editingProfile.value = true;
}

// The edit form replaces the button; without this the focus lands on <body>.
async function focusEditProfileButton() {
    await nextTick();
    const element = editProfileButton.value?.$el;
    if (element instanceof HTMLElement) element.focus();
}

function cancelProfileEdit() {
    clearSaveError();
    resetProfileForm();
    editingProfile.value = false;
    void focusEditProfileButton();
}

async function saveProfile() {
    try {
        await updateMyData({ ...profileForm });
        editingProfile.value = false;
        void focusEditProfileButton();
        toast.add({
            title: t('citizen.myData.saveSuccess'),
            color: 'success',
            icon: 'i-lucide-check-circle'
        });
    } catch {
        // The composable exposes the localized error for the inline alert.
    }
}

function profileAddress(): string {
    const profile = storedData.value?.profile;
    if (!profile) return '';
    const place = [profile.postalCode, profile.city].filter(Boolean).join(' ');
    // The profile sync writes the address group to `address`; `street` may
    // stay empty, and a formatted address may already name the place.
    const street = profile.street || profile.address || '';
    if (!profile.street && place && street.includes(place)) return street;
    return [street, place].filter(Boolean).join(', ');
}

const profileItems = computed<DataListItem[]>(() => {
    const profile = storedData.value?.profile;
    if (!profile) return [];
    return [
        { key: 'email', label: t('citizen.myData.email'), value: profile.email },
        { key: 'name', label: t('citizen.myData.name'), value: profile.fullName },
        { key: 'phone', label: t('citizen.myData.phone'), value: profile.phone },
        { key: 'address', label: t('citizen.myData.address'), value: profileAddress() },
        ...(profile.createdAt
            ? [{ key: 'registeredSince', label: t('citizen.myData.registeredSince'), value: formatDate(profile.createdAt) }]
            : [])
    ];
});

const applicationItems = computed<DataListItem[]>(() => {
    const data = storedData.value;
    if (!data) return [];
    return [
        { key: 'count', label: t('citizen.myData.applicationCount'), value: data.applicationCount },
        ...(data.lastActivity
            ? [{ key: 'lastActivity', label: t('citizen.myData.lastActivity'), value: formatDate(data.lastActivity) }]
            : [])
    ];
});

interface ConsentOverview {
    kind: ApplicantConsentKind
    title: string
    icon: string
    at: string | null
    textVersion: string | null
    scopeLabel: string | null
    withdrawnAt: string | null
}

interface ConsentGroup {
    profileId: number
    scopeLabel: string | null
    items: ConsentOverview[]
}

function consentItems(profile: ApplicantProfileData): ConsentOverview[] {
    return [
        {
            kind: 'contact',
            title: t('citizen.myData.consentContact'),
            icon: 'i-lucide-contact',
            at: profile.consentAt || null,
            textVersion: profile.consentTextVersion || null,
            scopeLabel: profile.consentScopeLabel || null,
            withdrawnAt: profile.consentWithdrawnAt || null
        },
        {
            kind: 'bank',
            title: t('citizen.myData.consentBank'),
            icon: 'i-lucide-landmark',
            at: profile.bankConsentAt || null,
            textVersion: profile.bankConsentTextVersion || null,
            scopeLabel: profile.bankConsentScopeLabel || null,
            withdrawnAt: profile.bankConsentWithdrawnAt || null
        }
    ];
}

type ConsentStatus = 'given' | 'withdrawn' | 'none';

function consentStatus(consent: ConsentOverview): ConsentStatus {
    if (consent.at) return 'given';
    if (consent.withdrawnAt) return 'withdrawn';
    return 'none';
}

// Always an explicit colour: the badge default is the tenant's primary
// colour, and on a red tenant "Erteilt" would read like a warning.
const CONSENT_STATUS_BADGE: Record<ConsentStatus, { color: 'success' | 'neutral' | 'warning', labelKey: string }> = {
    given: { color: 'success', labelKey: 'citizen.myData.consentStatusGiven' },
    withdrawn: { color: 'neutral', labelKey: 'citizen.myData.consentStatusWithdrawn' },
    // One coloured badge only, for the given consent.
    none: { color: 'neutral', labelKey: 'citizen.myData.consentStatusNone' }
};

function consentDetails(consent: ConsentOverview): DataListItem[] {
    if (consent.at) {
        return [
            { key: 'givenAt', label: t('citizen.myData.consentGivenAt'), value: formatDate(consent.at) },
            // The API supplies the recorded version. The current template may contain different wording.
            { key: 'textVersion', label: t('citizen.myData.consentTextVersion'), value: consent.textVersion },
            { key: 'scope', label: t('citizen.myData.consentScope'), value: consent.scopeLabel }
        ];
    }
    if (consent.withdrawnAt) {
        return [
            { key: 'withdrawnAt', label: t('citizen.myData.consentWithdrawnAt'), value: formatDate(consent.withdrawnAt) }
        ];
    }
    return [];
}

function withdrawAriaLabel(consent: ConsentOverview, groupScopeLabel: string | null): string {
    const stelle = groupScopeLabel || consent.scopeLabel;
    return stelle
        ? t('citizen.myData.consentWithdrawAria', { consent: consent.title, stelle })
        : t('citizen.myData.consentWithdrawAriaNoScope', { consent: consent.title });
}

// One block per own profile: profiles are kept per Stelle, and each
// consent is withdrawn on the profile it belongs to.
const consentGroups = computed<ConsentGroup[]>(() => {
    const data = storedData.value;
    if (!data?.profile) return [];
    const profiles = data.profiles?.length ? data.profiles : [data.profile];
    return profiles
        .filter((profile): profile is ApplicantProfileData & { id: number } => typeof profile.id === 'number')
        .map(profile => ({
            profileId: profile.id,
            scopeLabel: profile.scopeLabel || null,
            items: consentItems(profile)
        }));
});

// Consent withdrawal (Art. 7(3) GDPR): one confirmation dialog per consent.
const withdrawTarget = ref<{ profileId: number, kind: ApplicantConsentKind, scopeLabel: string | null } | null>(null);
const withdrawKind = computed(() => withdrawTarget.value?.kind ?? null);
const showWithdrawDialog = computed({
    get: () => withdrawTarget.value !== null,
    set: (open: boolean) => {
        if (!open && !isWithdrawing.value) withdrawTarget.value = null;
    }
});

function askWithdraw(profileId: number, kind: ApplicantConsentKind, scopeLabel: string | null) {
    withdrawError.value = null;
    withdrawTarget.value = { profileId, kind, scopeLabel };
}

async function confirmWithdraw() {
    const target = withdrawTarget.value;
    if (!target) return;
    try {
        await withdrawConsent(target.profileId, target.kind);
        withdrawTarget.value = null;
        resetProfileForm();
        toast.add({
            title: t('citizen.myData.consentWithdrawSuccess'),
            color: 'success',
            icon: 'i-lucide-check-circle'
        });
    } catch {
        // The composable exposes the localized error inside the dialog.
    }
}

const loginConfirmation = computed(() => {
    const confirmed = storedData.value?.profile?.loginConfirmed;
    if (!confirmed?.fields.length) return null;
    return {
        text: t('citizen.myData.loginConfirmedText', {
            provider: confirmed.providerLabel,
            date: confirmed.at ? formatDate(confirmed.at) : '-'
        }),
        fields: confirmed.fields.map(field => t(`citizen.myData.loginField.${field}`)).join(', ')
    };
});

/**
 * Opens the confirmation and loads what the deletion removes and keeps.
 */
async function openDeleteDialog() {
    deleteError.value = null;
    showDeleteDialog.value = true;
    try {
        await loadDeletePreview();
    } catch {
        // The composable exposes the localized error inside the dialog.
    }
}

function profileLabels(preview: ErasurePreview | null): string[] {
    return (preview?.deletes.profiles || [])
        .map(profile => profile.scopeLabel)
        .filter((label): label is string => Boolean(label));
}

async function requestDeletion() {
    if (!deletePreview.value) return;
    try {
        isDeleting.value = true;
        deleteError.value = null;
        confirmedPreview.value = deletePreview.value;
        erasureSummary.value = await deleteMyData();
        clearSubmissionDrafts();

        deleteSuccess.value = true;
        showDeleteDialog.value = false;
        // The dialog and its trigger are gone; move the focus to the summary
        // so screen reader users hear that the account is deleted.
        await nextTick();
        erasureSummaryHeading.value?.focus();

        // Drupal already ended every session of the account and sent the
        // expired cookie; a logout call would only meet a 403. Clear the
        // client state. The summary stays on screen until the citizen leaves.
        expireSession();
    } catch (e: unknown) {
        deleteError.value = resolveApiErrorMessage(e, 'citizen.myData.deleteError');
    } finally {
        isDeleting.value = false;
    }
}

function leaveAfterDeletion() {
    router.push(homePath.value);
}

function printSummary() {
    if (typeof window !== 'undefined') window.print();
}

onMounted(() => {
    loadMyData();
});
</script>

<template>
  <CitizenPage
    main-id="my-data-main"
    :back-to="false"
    :title="deleteSuccess ? undefined : t('citizen.myData.title')"
    :lead="deleteSuccess ? undefined : t('citizen.myData.subtitle')"
  >
    <!--
      One column of cards in the outline look, no heading icons, no
      brand colour; the explanation of rights is text, the delete card last.
      Behaviour, confirmations and the texts about what is deleted are
      unchanged.
    -->

    <!-- After deleting: the heading takes the focus and is the page title. -->
    <template
      v-if="deleteSuccess"
      #title
    >
      <h1
        ref="erasureSummaryHeading"
        tabindex="-1"
        class="-ms-2.5 border-s-2 border-transparent ps-2 text-2xl font-bold tracking-tight break-words hyphens-auto text-highlighted outline-none focus-visible:border-primary sm:text-3xl"
        data-testid="my-data-erasure-summary-heading"
      >
        {{ t('citizen.myData.deleteSuccessTitle') }}
      </h1>
    </template>
    <template
      v-if="deleteSuccess"
      #description
    >
      <p class="mt-2 max-w-prose text-base text-muted">
        {{ t('citizen.myData.deleteSuccessText') }}
      </p>
      <p
        v-if="erasureSummary?.erasedAt"
        class="mt-1 text-sm text-muted"
      >
        {{ t('citizen.myData.deleteSuccessAt', { date: formatDate(erasureSummary.erasedAt) }) }}
      </p>
    </template>

    <!-- Success: account deleted, summary of what stays -->
    <div
      v-if="deleteSuccess"
      class="space-y-6"
      role="status"
      aria-live="polite"
      data-testid="my-data-erasure-summary"
    >
      <AppCard
        v-if="erasureSummary"
        class="print:ring-0"
      >
        <ErasureOverview
          mode="summary"
          :heading-level="3"
          :account="erasureSummary.deleted.account"
          :account-email="confirmedPreview?.deletes.accountEmail"
          :profile-labels="profileLabels(confirmedPreview)"
          :profile-count="erasureSummary.deleted.profiles"
          :unconfirmed-applications="erasureSummary.deleted.unconfirmedApplications"
          :unconfirmed-uploads="erasureSummary.deleted.unconfirmedUploads"
          :login-links="erasureSummary.deleted.loginLinks"
          :keeps="erasureSummary.keeps"
        />
      </AppCard>
      <div class="flex flex-wrap gap-2 print:hidden">
        <UButton
          size="xl"
          class="w-full justify-center sm:w-auto"
          :label="t('citizen.myData.deleteSuccessHome')"
          data-testid="my-data-erasure-home"
          @click="leaveAfterDeletion"
        />
        <UButton
          color="neutral"
          variant="outline"
          size="lg"
          icon="i-lucide-printer"
          :label="t('citizen.myData.deleteSuccessPrint')"
          data-testid="my-data-erasure-print"
          @click="printSummary"
        />
      </div>
    </div>

    <!-- Loading: blocks in card height -->
    <div
      v-else-if="isLoading"
      class="space-y-6"
    >
      <USkeleton class="h-48 w-full rounded-lg" />
      <USkeleton class="h-32 w-full rounded-lg" />
    </div>

    <!-- Error loading -->
    <UAlert
      v-else-if="loadError"
      color="error"
      icon="i-lucide-circle-x"
      :title="loadError"
      :actions="loadRetryActions"
      data-testid="my-data-load-error"
    />

    <!-- Data overview: one column in reading order. -->
    <div
      v-else-if="storedData"
      class="flex flex-col gap-6"
    >
      <!-- Profile Data -->
      <AppCard
        :title="t('citizen.myData.profileData')"
        data-testid="my-data-profile-card"
      >
        <template
          v-if="storedData.profile && !editingProfile"
          #actions
        >
          <UButton
            ref="editProfileButton"
            color="neutral"
            variant="outline"
            size="lg"
            :label="t('citizen.myData.editProfile')"
            data-testid="my-data-edit-profile"
            @click="beginProfileEdit"
          />
        </template>

        <template v-if="storedData.profile">
          <!-- Edit mode: fields in one column, the save row once at the end. -->
          <div
            v-if="editingProfile"
            class="space-y-6"
            data-testid="my-data-edit-form"
          >
            <p class="max-w-prose text-base text-muted">
              {{ t('citizen.myData.editDescription') }}
            </p>
            <!-- The address of the login is a fact, not a disabled field. -->
            <DataList :items="[{ key: 'email', label: t('citizen.myData.email'), value: storedData.profile.email }]" />
            <div class="max-w-xl space-y-6">
              <UFormField
                :label="t('citizen.myData.name')"
                size="xl"
              >
                <UInput
                  v-model="profileForm.fullName"
                  size="xl"
                  maxlength="255"
                  autocomplete="name"
                  autofocus
                  class="w-full"
                  data-testid="my-data-edit-name"
                />
              </UFormField>
              <UFormField
                :label="t('citizen.myData.phone')"
                size="xl"
              >
                <UInput
                  v-model="profileForm.phone"
                  size="xl"
                  type="tel"
                  maxlength="50"
                  autocomplete="tel"
                  class="w-full"
                />
              </UFormField>
              <UFormField
                :label="t('citizen.myData.address')"
                size="xl"
              >
                <UTextarea
                  v-model="profileForm.address"
                  size="xl"
                  :rows="2"
                  maxlength="500"
                  autocomplete="street-address"
                  class="w-full"
                />
              </UFormField>
              <UFormField
                :label="t('citizen.myData.street')"
                size="xl"
              >
                <UInput
                  v-model="profileForm.street"
                  size="xl"
                  maxlength="255"
                  autocomplete="address-line1"
                  class="w-full"
                />
              </UFormField>
              <UFormField
                :label="t('citizen.myData.postalCode')"
                size="xl"
              >
                <UInput
                  v-model="profileForm.postalCode"
                  size="xl"
                  maxlength="20"
                  autocomplete="postal-code"
                  class="w-32"
                />
              </UFormField>
              <UFormField
                :label="t('citizen.myData.city')"
                size="xl"
              >
                <UInput
                  v-model="profileForm.city"
                  size="xl"
                  maxlength="255"
                  autocomplete="address-level2"
                  class="w-full"
                />
              </UFormField>
            </div>

            <UAlert
              v-if="saveError"
              role="alert"
              color="error"
              icon="i-lucide-circle-x"
              :title="t('citizen.myData.saveError')"
              :description="saveError"
            />

            <div
              class="flex flex-wrap gap-2"
              data-testid="my-data-save-row"
            >
              <UButton
                size="xl"
                class="w-full justify-center sm:w-auto"
                :label="t('citizen.myData.saveProfile')"
                :loading="isSaving"
                @click="saveProfile"
              />
              <UButton
                color="neutral"
                variant="ghost"
                size="lg"
                :label="t('common.cancel')"
                :disabled="isSaving"
                @click="cancelProfileEdit"
              />
            </div>
          </div>

          <DataList
            v-else
            :items="profileItems"
            data-testid="my-data-profile"
          />

          <!-- Part of the card under a hairline, no box in the box. -->
          <div
            v-if="loginConfirmation"
            class="mt-4 border-t border-default pt-4"
            data-testid="my-data-login-confirmed"
          >
            <h3 class="text-base font-medium text-highlighted">
              {{ t('citizen.myData.loginConfirmedTitle') }}
            </h3>
            <p class="mt-2 max-w-prose text-base text-muted">
              {{ loginConfirmation.text }}
            </p>
            <p class="mt-1 text-base text-default">
              <span class="text-muted">{{ t('citizen.myData.loginConfirmedFields') }}:</span>
              {{ loginConfirmation.fields }}
            </p>
          </div>
        </template>
        <!-- Without a profile: how one comes about, no button that is not there. -->
        <div
          v-else
          class="max-w-prose space-y-2 text-base text-muted"
          data-testid="my-data-no-profile"
        >
          <p>{{ t('citizen.myData.noProfile') }}</p>
          <p>{{ t('citizen.myData.noProfileHint') }}</p>
        </div>
      </AppCard>

      <!-- Consents behind the stored profile -->
      <AppCard
        v-if="consentGroups.length > 0"
        :title="t('citizen.myData.consentTitle')"
        data-testid="my-data-consents"
      >
        <div
          v-for="group in consentGroups"
          :key="group.profileId"
          class="mt-6 first:mt-0"
          :data-testid="`my-data-consent-profile-${group.profileId}`"
        >
          <h3
            v-if="group.scopeLabel"
            class="text-base font-semibold text-highlighted"
          >
            {{ t('citizen.myData.consentProfileHeading', { stelle: group.scopeLabel }) }}
          </h3>
          <div class="divide-y divide-default">
            <div
              v-for="consent in group.items"
              :key="consent.kind"
              class="py-4 first:pt-3"
              :data-testid="`my-data-consent-${consent.kind}`"
            >
              <div class="flex flex-wrap items-center gap-2">
                <!-- h4 under the Stelle heading, h3 when there is none -->
                <component
                  :is="group.scopeLabel ? 'h4' : 'h3'"
                  class="text-base font-medium text-highlighted"
                >
                  {{ consent.title }}
                </component>
                <UBadge
                  :color="CONSENT_STATUS_BADGE[consentStatus(consent)].color"
                  :label="t(CONSENT_STATUS_BADGE[consentStatus(consent)].labelKey)"
                  :data-testid="`my-data-consent-status-${consent.kind}`"
                />
              </div>
              <DataList
                v-if="consentStatus(consent) !== 'none'"
                :items="consentDetails(consent)"
                class="mt-2"
              />
              <UButton
                v-if="consent.at"
                class="mt-3"
                color="neutral"
                variant="outline"
                size="lg"
                :label="t('citizen.myData.consentWithdraw')"
                :aria-label="withdrawAriaLabel(consent, group.scopeLabel)"
                :data-testid="`my-data-consent-withdraw-${consent.kind}`"
                @click="askWithdraw(group.profileId, consent.kind, group.scopeLabel)"
              />
            </div>
          </div>
        </div>
        <p class="mt-3 max-w-prose text-sm text-muted">
          {{ t('citizen.myData.consentHint') }}
        </p>
      </AppCard>

      <!-- Application data and the explanation of rights, in the same column. -->
      <aside
        :aria-label="t('citizen.myData.asideLabel')"
        class="flex flex-col gap-6"
        data-testid="my-data-aside"
      >
        <AppCard :title="t('citizen.myData.applicationData')">
          <DataList
            :items="applicationItems"
            data-testid="my-data-applications"
          />
          <p class="mt-3 max-w-prose text-base text-muted">
            {{ t('citizen.myData.applicationDataHint') }}
            <ULink
              :to="applicationsPath"
              class="font-medium text-default underline underline-offset-2"
            >{{ t('citizen.myApplications.title') }}</ULink>.
          </p>
        </AppCard>

        <!-- An explanation, not an object: a section without a card. -->
        <section
          aria-labelledby="my-data-privacy-title"
          data-testid="my-data-privacy"
        >
          <h2
            id="my-data-privacy-title"
            class="mb-3 text-xl font-semibold text-highlighted"
          >
            {{ t('citizen.myData.privacy') }}
          </h2>
          <p class="max-w-prose text-base text-muted">
            {{ t('citizen.myData.privacyText') }}
            <ULink
              :to="privacyPath"
              class="font-medium text-default underline underline-offset-2"
            >{{ t('citizen.myData.privacyLink') }}</ULink>
            {{ t('citizen.myData.privacySuffix') }}
          </p>
          <h3 class="mt-4 text-base font-medium text-highlighted">
            {{ t('citizen.myData.privacyRightsIntro') }}
          </h3>
          <ul
            class="mt-1 max-w-prose list-disc space-y-1 ps-5 text-base text-muted"
            data-testid="my-data-rights"
          >
            <li>{{ t('citizen.myData.privacyRightAccess') }}</li>
            <!-- Each right names a way that is on this page, or says that there is nothing to act on. -->
            <li data-testid="my-data-right-rectification">
              {{ storedData.profile ? t('citizen.myData.privacyRightRectification') : t('citizen.myData.privacyRightRectificationNoProfile') }}
            </li>
            <li data-testid="my-data-right-withdrawal">
              {{ consentGroups.length > 0 ? t('citizen.myData.privacyRightWithdrawal') : t('citizen.myData.privacyRightWithdrawalNone') }}
            </li>
            <li>{{ t('citizen.myData.privacyRightErasure') }}</li>
          </ul>
        </section>
      </aside>

      <!-- Delete: last, plain, the button with its text -->
      <AppCard
        :title="t('citizen.myData.deleteTitle')"
        data-testid="my-data-delete-section"
      >
        <p class="max-w-prose text-base text-muted">
          {{ t('citizen.myData.deleteDescription') }}
        </p>
        <p
          class="mt-2 max-w-prose text-base text-default"
          data-testid="my-data-delete-irreversible"
        >
          {{ t('citizen.myData.deleteIrreversible') }}
        </p>
        <UButton
          color="error"
          variant="ghost"
          size="lg"
          icon="i-lucide-trash-2"
          class="mt-3 w-full justify-center sm:-ms-3 sm:w-auto"
          data-testid="my-data-delete-open"
          @click="openDeleteDialog"
        >
          {{ t('citizen.myData.deleteButton') }}
        </UButton>
      </AppCard>
    </div>

    <!-- Consent withdrawal dialog -->
    <UModal
      v-model:open="showWithdrawDialog"
      :title="t('citizen.myData.consentWithdrawTitle')"
      :ui="{ footer: 'justify-end' }"
    >
      <template #body>
        <div data-testid="my-data-consent-withdraw-dialog">
          <p class="mb-2 text-base font-medium text-highlighted">
            {{ withdrawKind === 'bank' ? t('citizen.myData.consentBank') : t('citizen.myData.consentContact') }}
            <template v-if="withdrawTarget?.scopeLabel">
              ({{ withdrawTarget.scopeLabel }})
            </template>
          </p>
          <p class="mb-2 text-base text-muted">
            {{ withdrawKind === 'bank' ? t('citizen.myData.consentWithdrawBankText') : t('citizen.myData.consentWithdrawContactText') }}
          </p>
          <p class="text-base text-muted">
            {{ withdrawKind === 'bank' ? t('citizen.myData.consentWithdrawBankEffect') : t('citizen.myData.consentWithdrawContactEffect') }}
          </p>

          <UAlert
            v-if="withdrawError"
            icon="i-lucide-circle-x"
            color="error"
            role="alert"
            :title="withdrawError"
            class="mt-4"
          />
        </div>
      </template>

      <template #footer>
        <UButton
          color="neutral"
          variant="ghost"
          :disabled="isWithdrawing !== null"
          @click="showWithdrawDialog = false"
        >
          {{ t('common.cancel') }}
        </UButton>
        <UButton
          color="error"
          :loading="isWithdrawing !== null"
          :disabled="isWithdrawing !== null"
          data-testid="my-data-consent-withdraw-confirm"
          @click="confirmWithdraw"
        >
          {{ t('citizen.myData.consentWithdrawConfirm') }}
        </UButton>
      </template>
    </UModal>

    <!-- Delete confirmation dialog -->
    <UModal
      v-model:open="showDeleteDialog"
      :title="t('citizen.myData.deleteDialogTitle')"
      :description="t('citizen.myData.deleteDialogDescription')"
      :dismissible="!isDeleting"
      :close="!isDeleting"
      :ui="{ content: 'sm:max-w-2xl', footer: 'justify-end' }"
    >
      <template #body>
        <div data-testid="my-data-delete-dialog">
          <div
            v-if="isLoadingDeletePreview"
            class="space-y-3"
          >
            <p class="text-base text-muted">
              {{ t('citizen.myData.erasure.previewLoading') }}
            </p>
            <USkeleton class="h-24 w-full rounded-md" />
          </div>

          <UAlert
            v-else-if="deletePreviewError"
            color="error"
            role="alert"
            icon="i-lucide-circle-x"
            :title="deletePreviewError"
            class="mb-4"
          />

          <template v-else-if="deletePreview">
            <UAlert
              role="status"
              color="warning"
              icon="i-lucide-triangle-alert"
              class="mb-5"
              data-testid="my-data-delete-warning"
            >
              <template #description>
                <p>{{ t('citizen.myData.deleteDialogWarning') }}</p>
                <p
                  v-if="deletePreview.keeps.length > 0"
                  class="mt-2"
                  data-testid="my-data-delete-download-hint"
                >
                  {{ t('citizen.myData.deleteDialogDownload') }}
                  <NuxtLink
                    :to="applicationsPath"
                    class="font-medium underline"
                    data-testid="my-data-delete-download-link"
                  >
                    {{ t('citizen.myData.deleteDialogDownloadLink') }}
                  </NuxtLink>
                </p>
              </template>
            </UAlert>
            <ErasureOverview
              mode="preview"
              :account="deletePreview.deletes.account"
              :account-email="deletePreview.deletes.accountEmail"
              :profile-labels="profileLabels(deletePreview)"
              :profile-count="deletePreview.deletes.profiles.length"
              :unconfirmed-applications="deletePreview.deletes.unconfirmedApplications"
              :unconfirmed-uploads="deletePreview.deletes.unconfirmedUploads"
              :login-links="deletePreview.deletes.loginLinks"
              :keeps="deletePreview.keeps"
            />
          </template>

          <UAlert
            v-if="deleteError"
            role="alert"
            icon="i-lucide-circle-x"
            color="error"
            :title="deleteError"
            class="mt-4"
            data-testid="my-data-delete-error"
          />
        </div>
      </template>

      <template #footer>
        <div class="flex w-full justify-end gap-3">
          <UButton
            color="neutral"
            variant="ghost"
            :disabled="isDeleting"
            @click="showDeleteDialog = false"
          >
            {{ t('common.cancel') }}
          </UButton>
          <UButton
            color="error"
            icon="i-lucide-trash-2"
            :loading="isDeleting"
            :disabled="isDeleting || isLoadingDeletePreview || !deletePreview"
            data-testid="my-data-delete-confirm"
            @click="requestDeletion"
          >
            {{ isDeleting ? t('citizen.myData.deleting') : t('citizen.myData.deleteConfirm') }}
          </UButton>
        </div>
      </template>
    </UModal>
  </CitizenPage>
</template>
