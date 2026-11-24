<script setup lang="ts">
import AppCard from '~/components/app/Card.vue';
import { formatDate, formatValue, type BooleanLabels } from '~/composables/useFormatters';
import type { ApplicationConsents, ApplicationConsentSummary } from '~/types/application';
import { crmDataHasBankDetails } from '~/utils/application-consent';

const props = defineProps<{
    crmData: Record<string, unknown>
    booleanLabels: BooleanLabels
    fieldLabel: (key: string) => string
    /**
     * Formats a CRM value with the schema field behind the CRM key (dates,
     * amounts, protected placeholders). Without it the value is shown plain.
     */
    formatCrmValue?: (key: string, value: unknown) => string
    consents?: ApplicationConsents | null
    /**
     * E-mail address submitted with the application.
     * Shown first, unless the contact data already carry the same address.
     */
    email?: string | null
}>();

const { t, locale } = useI18n();

const profileConsent = computed(() => props.consents?.profileConsent ?? null);
const bankConsent = computed(() => props.consents?.bankConsent ?? null);
const hasCrmData = computed(() => Object.keys(props.crmData).length > 0);
const emailRow = computed(() => {
    const email = props.email?.trim();
    if (!email) return '';
    const known = Object.values(props.crmData).some(value => typeof value === 'string' && value.trim().toLowerCase() === email.toLowerCase());
    return known ? '' : email;
});
const hasRows = computed(() => hasCrmData.value || emailRow.value !== '');
const showBankLine = computed(() => bankConsent.value?.given === true || crmDataHasBankDetails(props.crmData));
const isVisible = computed(() =>
    hasRows.value || profileConsent.value?.given === true || bankConsent.value?.given === true
);

function crmValueText(key: string, value: unknown): string {
    return props.formatCrmValue ? props.formatCrmValue(key, value) : formatValue(value, props.booleanLabels);
}

function consentGivenText(consent: ApplicationConsentSummary): string {
    const version = consent.textVersion || '-';
    const given = consent.at
        ? t('admin.detail.crmConsent.given', { date: formatDate(consent.at, locale?.value), version })
        : t('admin.detail.crmConsent.givenWithoutDate', { version });
    // An anonymous application's consent takes effect with the confirmation
    // link; name that moment when it differs from the submission.
    if (consent.effectiveAt && consent.effectiveAt !== consent.at) {
        return `${given}, ${t('admin.detail.crmConsent.effective', { date: formatDate(consent.effectiveAt, locale?.value) })}`;
    }
    return given;
}
</script>

<template>
  <!-- The label takes one third of each row and the value takes the other two thirds. -->
  <AppCard
    v-if="isVisible"
    class="mb-6"
    :title="t('admin.detail.crmData')"
    icon="i-lucide-contact"
  >
    <dl
      v-if="hasRows"
      class="divide-y divide-default"
    >
      <div
        v-if="emailRow"
        class="grid gap-1 py-2.5 first:pt-0 sm:grid-cols-3 sm:gap-4"
        data-testid="crm-email-row"
      >
        <dt class="min-w-0 break-words text-sm text-muted sm:col-span-1">
          {{ t('admin.detail.email') }}
        </dt>
        <dd class="min-w-0 break-words text-sm font-medium text-default sm:col-span-2">
          {{ emailRow }}
        </dd>
      </div>
      <div
        v-for="(value, key) in props.crmData"
        :key="key"
        class="grid gap-1 py-2.5 first:pt-0 sm:grid-cols-3 sm:gap-4"
      >
        <dt
          class="min-w-0 break-words text-sm text-muted sm:col-span-1"
          data-testid="crm-field-label"
        >
          {{ fieldLabel(String(key)) }}
        </dt>
        <dd class="min-w-0 break-words text-sm font-medium text-default sm:col-span-2">
          {{ crmValueText(String(key), value) || '-' }}
        </dd>
      </div>
    </dl>

    <dl
      v-if="profileConsent"
      class="grid gap-2 text-sm"
      :class="hasRows ? 'border-t border-default pt-4' : ''"
      data-testid="crm-consent-lines"
    >
      <div
        class="flex items-start gap-2"
        data-testid="crm-consent-profile"
      >
        <UIcon
          :name="profileConsent.given ? 'i-lucide-user-check' : 'i-lucide-user-x'"
          class="mt-0.5 size-4 shrink-0 text-(--ui-text-muted)"
        />
        <dt class="font-medium text-(--ui-text)">
          {{ t('admin.detail.crmConsent.profileLabel') }}:
        </dt>
        <dd class="text-(--ui-text-muted)">
          {{ profileConsent.given ? consentGivenText(profileConsent) : t('admin.detail.crmConsent.profileMissing') }}
        </dd>
      </div>
      <div
        v-if="bankConsent && showBankLine"
        class="flex items-start gap-2"
        data-testid="crm-consent-bank"
      >
        <UIcon
          name="i-lucide-landmark"
          class="mt-0.5 size-4 shrink-0 text-(--ui-text-muted)"
        />
        <dt class="font-medium text-(--ui-text)">
          {{ t('admin.detail.crmConsent.bankLabel') }}:
        </dt>
        <dd class="text-(--ui-text-muted)">
          {{ bankConsent.given ? consentGivenText(bankConsent) : t('admin.detail.crmConsent.bankMissing') }}
        </dd>
      </div>
    </dl>
  </AppCard>
</template>
