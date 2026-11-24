<script setup lang="ts">
const props = defineProps<{
    returnTo: string
}>();

const emit = defineEmits<{
    'recovery-complete': []
    'recovered': []
}>();

const { t, locale } = useI18n();
const recovery = useMaintenanceRecovery();
const operatorOpen = ref(false);
let returnTimer: ReturnType<typeof setTimeout> | null = null;

const countdownLabel = computed(() => {
    const seconds = recovery.secondsRemaining.value;
    const minutesPart = Math.floor(seconds / 60).toString().padStart(2, '0');
    const secondsPart = (seconds % 60).toString().padStart(2, '0');
    return `${minutesPart}:${secondsPart}`;
});
const recoveryErrorKey = computed(() => {
    if (recovery.error.value === 'invalid_code') return 'maintenance.recovery.invalidCode';
    if (recovery.error.value === 'rate_limited') return 'maintenance.recovery.rateLimited';
    if (recovery.error.value === 'expired') return 'maintenance.recovery.expired';
    if (recovery.error.value === 'generic') return 'maintenance.recovery.genericError';
    return null;
});
const requestBusy = computed(() => recovery.phase.value === 'requesting');
const verifyBusy = computed(() => ['verifying', 'disabling'].includes(recovery.phase.value));

function requestRecoveryCode() {
    void recovery.requestCode(locale.value);
}

function updateCode(value: string | number) {
    recovery.code.value = String(value).replace(/\D/gu, '').slice(0, 6);
}

function retryDisable() {
    void recovery.disableMaintenance();
}

watch(() => recovery.phase.value, (phase) => {
    if (phase === 'code') {
        void nextTick(() => document.getElementById('maintenance-recovery-code')?.focus());
    }
    if (phase !== 'success') return;

    emit('recovery-complete');
    returnTimer = setTimeout(() => {
        emit('recovered');
        void navigateTo(props.returnTo, { replace: true });
    }, 4_000);
});

onBeforeUnmount(() => {
    if (returnTimer) clearTimeout(returnTimer);
});
</script>

<template>
  <div class="mt-8 border-t border-(--ui-border) pt-5 text-center">
    <UButton
      type="button"
      color="neutral"
      variant="link"
      :icon="operatorOpen ? 'i-lucide-chevron-up' : 'i-lucide-key-round'"
      :aria-expanded="operatorOpen"
      aria-controls="maintenance-recovery-panel"
      @click="operatorOpen = !operatorOpen"
    >
      {{ t('maintenance.recovery.operatorLink') }}
    </UButton>

    <div
      v-if="operatorOpen"
      id="maintenance-recovery-panel"
      class="mt-5 rounded-xl border border-(--ui-border) bg-(--ui-bg) p-5 text-left"
    >
      <div class="mb-5">
        <h2 class="font-semibold">
          {{ t('maintenance.recovery.title') }}
        </h2>
        <p class="mt-1 text-sm text-(--ui-text-muted)">
          {{ t('maintenance.recovery.description') }}
        </p>
      </div>

      <UAlert
        v-if="recoveryErrorKey"
        class="mb-4"
        color="warning"
        icon="i-lucide-triangle-alert"
        :title="t(recoveryErrorKey)"
        role="status"
      />

      <form
        v-if="recovery.phase.value === 'idle' || recovery.phase.value === 'requesting'"
        class="space-y-4"
        @submit.prevent="requestRecoveryCode"
      >
        <UFormField
          :label="t('maintenance.recovery.emailLabel')"
          name="maintenance-recovery-email"
          required
        >
          <UInput
            v-model="recovery.email.value"
            type="email"
            autocomplete="email"
            class="w-full"
            :disabled="requestBusy"
          />
        </UFormField>
        <p class="text-sm text-(--ui-text-muted)">
          {{ t('maintenance.recovery.antiEnumerationHint') }}
        </p>
        <UButton
          type="submit"
          block
          icon="i-lucide-mail"
          :loading="requestBusy"
        >
          {{ t('maintenance.recovery.requestCode') }}
        </UButton>
      </form>

      <form
        v-else-if="['code', 'verifying', 'disabling'].includes(recovery.phase.value)"
        class="space-y-4"
        @submit.prevent="recovery.verifyCode"
      >
        <UAlert
          color="success"
          icon="i-lucide-circle-check"
          :title="t('maintenance.recovery.codeRequested')"
          :description="t('maintenance.recovery.codeRequestedDescription')"
          role="status"
          aria-live="polite"
        />
        <UFormField
          :label="t('maintenance.recovery.codeLabel')"
          name="maintenance-recovery-code"
          required
        >
          <UInput
            id="maintenance-recovery-code"
            :model-value="recovery.code.value"
            inputmode="numeric"
            autocomplete="one-time-code"
            maxlength="6"
            class="w-full font-mono tracking-[0.35em]"
            :disabled="verifyBusy"
            @update:model-value="updateCode"
          />
        </UFormField>
        <p class="text-sm text-(--ui-text-muted)">
          {{ t('maintenance.recovery.expiresIn', { time: countdownLabel }) }}
        </p>
        <div class="flex flex-col gap-2 sm:flex-row-reverse">
          <UButton
            type="submit"
            class="sm:flex-1"
            icon="i-lucide-shield-check"
            :loading="verifyBusy"
            :disabled="recovery.code.value.length !== 6"
          >
            {{ verifyBusy ? t('maintenance.recovery.disabling') : t('maintenance.recovery.verifyAndDisable') }}
          </UButton>
          <UButton
            type="button"
            color="neutral"
            variant="ghost"
            :disabled="verifyBusy"
            @click="recovery.editEmail"
          >
            {{ t('maintenance.recovery.editEmail') }}
          </UButton>
        </div>
      </form>

      <div
        v-else-if="recovery.phase.value === 'disable_error'"
        class="space-y-4"
      >
        <p class="text-sm text-(--ui-text-muted)">
          {{ t('maintenance.recovery.disableRetryHint') }}
        </p>
        <p class="text-sm text-(--ui-text-muted)">
          {{ t('maintenance.recovery.expiresIn', { time: countdownLabel }) }}
        </p>
        <UButton
          block
          icon="i-lucide-refresh-cw"
          @click="retryDisable"
        >
          {{ t('maintenance.recovery.retryDisable') }}
        </UButton>
      </div>

      <UAlert
        v-else-if="recovery.phase.value === 'success'"
        color="success"
        icon="i-lucide-circle-check"
        :title="t('maintenance.recovery.successTitle')"
        :description="t('maintenance.recovery.successDescription')"
        role="status"
        aria-live="polite"
      />
    </div>
  </div>
</template>
