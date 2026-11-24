<script setup lang="ts">
import { publicMyDataPath, publicWorkspaceFromRoute } from '~/utils/public-form-path';

/**
 * Optional consents to reuse contact data (and bank details) for future
 * applications. Shared by the public form page and the assistant's submit
 * surfaces. Each checkbox uses the exact wording supplied by the backend.
 */
const props = defineProps<{
    contactText: string | null
    bankText?: string | null
    workspace?: { jurisdictionSlug?: string | null, organisationSlug?: string | null } | null
}>();
const consent = defineModel<boolean>('consent', { required: true });
const bankConsent = defineModel<boolean>('bankConsent', { default: false });
const { t } = useI18n();
const route = useRoute();
const { authenticated } = useAuth();
const myDataPath = computed(() => publicMyDataPath(props.workspace ?? publicWorkspaceFromRoute(route)));

function onBankConsentChange(value: boolean | 'indeterminate') {
    // The submission model only accepts bank consent after contact consent.
    if (value === true) consent.value = true;
    bankConsent.value = value === true;
}
</script>

<template>
  <div
    v-if="contactText"
    class="space-y-3"
    data-testid="profile-consent"
  >
    <p
      class="text-sm font-medium text-highlighted"
      data-testid="profile-consent-optional"
    >
      {{ t('form.profileConsentOptional') }}
    </p>
    <UFormField :description="authenticated ? undefined : t('form.profileConsentLoginHint')">
      <UCheckbox
        v-model="consent"
        :label="contactText"
        data-testid="profile-consent-contact"
      />
    </UFormField>
    <UFormField
      v-if="bankText"
      :help="t('form.profileConsentBankHint')"
    >
      <UCheckbox
        :model-value="bankConsent"
        :label="bankText"
        data-testid="profile-consent-bank"
        @update:model-value="onBankConsentChange"
      />
    </UFormField>
    <p class="text-sm">
      <NuxtLink
        :to="myDataPath"
        target="_blank"
        class="text-primary hover:underline"
        data-testid="profile-consent-manage"
      >
        {{ t('form.profileConsentManageLink') }}<span class="sr-only"> {{ t('form.opensInNewWindow') }}</span>
      </NuxtLink>
    </p>
  </div>
</template>
