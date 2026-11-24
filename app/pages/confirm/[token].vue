<script setup lang="ts">
import CitizenPage from '~/components/citizen/Page.vue';
import SubmissionReceipt from '~/components/citizen/SubmissionReceipt.vue';
import { readSubmissionReceipt, type SubmissionReceipt as Receipt } from '#shared/submission-receipt';
import { usePublicJurisdictionConfig } from '~/composables/usePublicJurisdictionConfig';
import { usePublicPrimaryTheme } from '~/composables/usePublicPrimaryTheme';
import { requestErrorStatus } from '~/utils/global-maintenance';
import { publicHomePath, publicStatusLookupPath } from '~/utils/public-form-path';
import { normalizePublicJurisdictionSlug } from '~/utils/public-jurisdiction-config';

definePageMeta({
    layout: false
});

type ConfirmationState = 'loading' | 'confirmed' | 'already_confirmed' | 'invalid' | 'rate_limited' | 'error';

interface ConfirmResponse {
    status?: 'confirmed' | 'already_confirmed'
    referenceNumber?: string | null
    jurisdictionSlug?: string | null
    receipt?: Receipt | null
}

const { t } = useI18n();
const route = useRoute();
const state = ref<ConfirmationState>('loading');
const confirmation = ref<ConfirmResponse | null>(null);
const isConfirmed = computed(() => confirmation.value !== null);
const hasStatusLink = computed(() => isConfirmed.value || state.value === 'invalid');
const referenceNumber = computed(() => typeof confirmation.value?.referenceNumber === 'string'
    ? confirmation.value.referenceNumber.trim()
    : '');
const receipt = computed(() => readSubmissionReceipt(confirmation.value?.receipt, referenceNumber.value));
const urlJurisdiction = computed(() => state.value === 'invalid'
    ? normalizePublicJurisdictionSlug(route.query.workspace)
    : null);
const { config: urlJurisdictionConfig } = usePublicJurisdictionConfig(urlJurisdiction);
const confirmedJurisdiction = computed(() => normalizePublicJurisdictionSlug(confirmation.value?.jurisdictionSlug));
usePublicPrimaryTheme(confirmedJurisdiction);
const publicWorkspace = computed(() => ({
    jurisdictionSlug: urlJurisdictionConfig.value
        ? urlJurisdiction.value
        : confirmedJurisdiction.value
}));
const homePath = computed(() => publicHomePath(publicWorkspace.value));
const statusPath = computed(() => publicStatusLookupPath({
    ...publicWorkspace.value,
    referenceNumber: referenceNumber.value
}));

const stateIcon = computed(() => {
    switch (state.value) {
        case 'loading':
            return 'i-lucide-loader-circle';
        case 'confirmed':
            return 'i-lucide-circle-check';
        case 'already_confirmed':
            return 'i-lucide-badge-check';
        case 'rate_limited':
            return 'i-lucide-clock';
        default:
            return 'i-lucide-link-2-off';
    }
});

onMounted(async () => {
    const param = route.params.token;
    const token = Array.isArray(param) ? param[0] || '' : param || '';

    try {
        const response = await $fetch<ConfirmResponse>('/api/confirm', {
            method: 'POST',
            body: { token }
        });
        if (response?.status === 'confirmed' || response?.status === 'already_confirmed') {
            confirmation.value = response;
            state.value = response.status;
        } else {
            state.value = 'error';
        }
    } catch (error: unknown) {
        switch (requestErrorStatus(error)) {
            case 404:
                state.value = 'invalid';
                break;
            case 429:
                state.value = 'rate_limited';
                break;
            default:
                state.value = 'error';
        }
    }
});

useHead({
    title: computed(() => `${t('confirmation.title')} - beantragt.ai`)
});
</script>

<template>
  <CitizenPage
    width="narrow"
    title-id="confirmation-title"
    :workspace="publicWorkspace"
    :back-to="false"
    :hide-footer-status-lookup="hasStatusLink"
  >
    <div class="mb-4 flex items-center justify-center gap-2 text-center">
      <UIcon
        :name="stateIcon"
        class="size-5 shrink-0 text-primary"
        :class="{ 'motion-safe:animate-spin': state === 'loading' }"
        aria-hidden="true"
      />
      <h1
        id="confirmation-title"
        class="text-2xl font-bold"
      >
        {{ t('confirmation.title') }}
      </h1>
    </div>

    <UCard>
      <div
        role="status"
        aria-atomic="true"
        class="text-center"
      >
        <p
          v-if="state === 'loading'"
          class="text-sm text-muted"
        >
          {{ t('confirmation.loading') }}
        </p>

        <template v-else-if="isConfirmed">
          <h2 class="text-xl font-semibold mb-2">
            {{ state === 'confirmed' ? t('confirmation.confirmed.title') : t('confirmation.alreadyConfirmed.title') }}
          </h2>
          <p class="text-muted">
            {{ state === 'confirmed' ? t('confirmation.confirmed.description') : t('confirmation.alreadyConfirmed.description') }}
          </p>
          <p
            v-if="referenceNumber && !receipt"
            class="mt-4 wrap-anywhere"
          >
            {{ t('confirmation.referenceLabel') }}
            <strong translate="no">{{ referenceNumber }}</strong>
          </p>
        </template>

        <template v-else-if="state === 'invalid'">
          <h2 class="text-xl font-semibold mb-2">
            {{ t('confirmation.invalid.title') }}
          </h2>
          <p class="text-muted">
            {{ t('confirmation.invalid.description') }}
          </p>
        </template>

        <template v-else-if="state === 'rate_limited'">
          <h2 class="text-xl font-semibold mb-2">
            {{ t('confirmation.rateLimited.title') }}
          </h2>
          <p class="text-muted">
            {{ t('confirmation.rateLimited.description') }}
          </p>
        </template>

        <template v-else>
          <h2 class="text-xl font-semibold mb-2">
            {{ t('confirmation.error.title') }}
          </h2>
          <p class="text-muted">
            {{ t('confirmation.error.description') }}
          </p>
        </template>
      </div>
      <SubmissionReceipt
        v-if="receipt"
        :receipt="receipt"
        class="mt-3"
      />
      <div
        v-if="hasStatusLink"
        class="text-center mt-3"
      >
        <UButton
          :to="statusPath"
          :color="state === 'confirmed' ? 'primary' : 'neutral'"
          variant="soft"
          icon="i-lucide-search"
        >
          {{ t('confirmation.statusLink') }}
        </UButton>
      </div>
    </UCard>

    <div class="text-center mt-6">
      <NuxtLink
        :to="homePath"
        class="text-sm text-muted hover:text-default transition-colors inline-flex items-center gap-1"
      >
        <UIcon
          name="i-lucide-arrow-left"
          class="size-3.5"
          aria-hidden="true"
        />
        {{ t('common.backToHome') }}
      </NuxtLink>
    </div>
  </CitizenPage>
</template>
