<script setup lang="ts">
import { internalReturnPathForLocale } from '~/utils/global-maintenance';

definePageMeta({ layout: false });

const { t, locale, setLocale } = useI18n();
const route = useRoute();
const maintenance = useGlobalMaintenance();
const retrying = ref(false);
const retryError = ref(false);
const retryStillActive = ref(false);
const returning = ref(false);
let availabilityPoll: ReturnType<typeof setInterval> | null = null;

const returnTo = computed(() => internalReturnPathForLocale(route.query.returnTo, locale.value));
const localeItems = computed(() => [
    { label: t('language.de'), value: 'de' },
    { label: t('language.en'), value: 'en' }
]);

async function returnWhenAvailable(showProgress = false) {
    if (returning.value) return;
    if (showProgress) {
        retrying.value = true;
        retryError.value = false;
        retryStillActive.value = false;
    }

    const status = await maintenance.fetchStatus();
    if (showProgress) retrying.value = false;
    if (showProgress && maintenance.lastCheckFailed.value) {
        retryError.value = true;
    } else if (status?.maintenance === false) {
        returning.value = true;
        await navigateTo(returnTo.value, { replace: true });
    } else if (showProgress && status?.maintenance === true) {
        retryStillActive.value = true;
    }
}

function handleRecoveryComplete() {
    if (availabilityPoll) clearInterval(availabilityPoll);
}

function handleRecovered() {
    returning.value = true;
}

async function changeLocale(value: string) {
    if (value === 'de' || value === 'en') await setLocale(value);
}

onMounted(() => {
    availabilityPoll = setInterval(() => void returnWhenAvailable(), 15_000);
});

onBeforeUnmount(() => {
    if (availabilityPoll) clearInterval(availabilityPoll);
});

useHead({
    title: computed(() => `${t('maintenance.title')} | beantragt.ai`),
    meta: [
        { name: 'robots', content: 'noindex, noarchive' }
    ]
});
</script>

<template>
  <main class="min-h-screen bg-(--ui-bg) px-4 py-8 text-(--ui-text) sm:py-14">
    <div class="mx-auto w-full max-w-xl">
      <div class="mb-5 flex items-center justify-between gap-4">
        <BrandLogo
          decorative
          show-text
          size="lg"
        />
        <USelect
          :model-value="locale"
          :items="localeItems"
          value-key="value"
          class="w-28"
          :aria-label="t('nav.language')"
          @update:model-value="changeLocale"
        />
      </div>

      <section
        class="rounded-2xl border border-(--ui-border) bg-(--ui-bg-elevated) px-6 py-9 shadow-sm sm:px-10"
        aria-labelledby="maintenance-title"
      >
        <div class="text-center">
          <div class="mx-auto mb-5 flex size-14 items-center justify-center rounded-full bg-(--ui-warning)/10 text-(--ui-warning)">
            <UIcon
              name="i-lucide-wrench"
              class="size-7"
              aria-hidden="true"
            />
          </div>
          <p class="mb-2 text-sm font-medium text-(--ui-text-muted)">
            {{ t('maintenance.platformLabel') }}
          </p>
          <h1
            id="maintenance-title"
            class="text-2xl font-semibold sm:text-3xl"
          >
            {{ t('maintenance.title') }}
          </h1>
          <p class="mx-auto mt-3 max-w-md text-(--ui-text-muted)">
            {{ t('maintenance.description') }}
          </p>

          <UAlert
            v-if="retryError"
            class="mt-6 text-left"
            color="warning"
            icon="i-lucide-triangle-alert"
            :title="t('maintenance.retryUnavailable')"
            role="status"
          />

          <UAlert
            v-else-if="retryStillActive"
            class="mt-6 text-left"
            color="info"
            icon="i-lucide-info"
            :title="t('maintenance.stillActive')"
            role="status"
            aria-live="polite"
          />

          <UButton
            class="mt-7"
            icon="i-lucide-refresh-cw"
            :loading="retrying"
            :disabled="returning"
            @click="returnWhenAvailable(true)"
          >
            {{ t('maintenance.retry') }}
          </UButton>
        </div>

        <MaintenanceRecoveryPanel
          :return-to="returnTo"
          @recovery-complete="handleRecoveryComplete"
          @recovered="handleRecovered"
        />
      </section>
    </div>
  </main>
</template>
