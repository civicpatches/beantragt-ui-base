<script setup lang="ts">
import { requestErrorStatus } from '~/utils/global-maintenance';

const props = defineProps<{
    heading: 'h1' | 'h2'
    referenceNumber: string
    recipientEmail?: string
}>();

const { t } = useI18n();
const headingElement = ref<HTMLElement | null>(null);
const sending = ref(false);
const feedback = ref('');
onMounted(() => {
    headingElement.value?.focus();
});

async function resendLink() {
    if (sending.value || !props.recipientEmail) return;
    sending.value = true;
    feedback.value = '';
    try {
        await $fetch('/api/confirm/resend', {
            method: 'POST',
            body: { reference: props.referenceNumber, email: props.recipientEmail }
        });
        feedback.value = 'confirmation.resend.accepted';
    } catch (error) {
        feedback.value = requestErrorStatus(error) === 429
            ? 'confirmation.rateLimited.description'
            : 'form.emailConfirmationResendFailed';
    } finally {
        sending.value = false;
    }
}
</script>

<template>
  <div class="space-y-2 text-left [overflow-wrap:anywhere]">
    <component
      :is="heading"
      ref="headingElement"
      tabindex="-1"
      class="-ms-2.5 border-s-2 border-transparent ps-2 text-xl font-semibold outline-none focus-visible:border-primary"
    >
      {{ t('form.emailConfirmationTitle') }}
    </component>
    <UAlert
      role="status"
      icon="i-lucide-triangle-alert"
      color="warning"
      :title="recipientEmail
        ? t('form.emailConfirmationDescriptionWithRecipient', { email: recipientEmail })
        : t('form.emailConfirmationDescription')"
      :description="t(recipientEmail ? 'form.emailConfirmationHelp' : 'form.emailConfirmationHelpWithoutRecipient')"
      :actions="recipientEmail ? [{
        label: t('confirmation.resend.submit'),
        size: 'md',
        loading: sending,
        onClick: resendLink,
      }] : []"
    />
    <p
      role="status"
      class="text-sm"
    >
      {{ feedback ? t(feedback) : '' }}
    </p>
  </div>
</template>
