<script setup lang="ts">
import type { SubmissionReceipt } from '#shared/submission-receipt';
import { downloadSubmissionReceipt, printSubmissionReceipt } from '~/utils/submission-receipt-export';

const props = defineProps<{
    receipt: SubmissionReceipt
    pending?: boolean
}>();

const { t, locale } = useI18n();
const printFrame = ref<HTMLIFrameElement | null>(null);
const actionError = ref('');
const title = computed(() => t(props.pending ? 'form.receipt.pendingTitle' : 'form.receipt.title'));
const rows = computed(() => {
    const { referenceNumber, formTitle, submittedAt, jurisdictionName, organisationName } = props.receipt;
    const date = new Intl.DateTimeFormat(locale.value, { dateStyle: 'long', timeStyle: 'short' }).format(new Date(submittedAt));
    return [
        { label: t('form.referenceNumber'), value: referenceNumber },
        { label: t('form.receipt.form'), value: formTitle },
        { label: t(props.pending ? 'form.receipt.savedAt' : 'form.receipt.submittedAt'), value: date },
        ...(jurisdictionName ? [{ label: t('form.receipt.jurisdiction'), value: jurisdictionName }] : []),
        ...(organisationName ? [{ label: t('form.receipt.organisation'), value: organisationName }] : []),
        { label: t('form.receipt.nextStep'), value: t(props.pending ? 'form.receipt.pendingNextStep' : 'form.receipt.confirmedNextStep') }
    ];
});

function printReceipt(): void {
    actionError.value = '';
    try {
        if (!printFrame.value) throw new Error('Print frame unavailable');
        printSubmissionReceipt(printFrame.value, title.value, rows.value, locale.value);
    } catch {
        actionError.value = t('form.receipt.printFailed');
    }
}

async function downloadReceipt(): Promise<void> {
    actionError.value = '';
    const reference = props.receipt.referenceNumber.replace(/[^a-z0-9_-]/gi, '_');
    try {
        await downloadSubmissionReceipt(title.value, rows.value, `${t('form.receipt.filename')}-${reference}.pdf`);
    } catch {
        actionError.value = t('form.receipt.downloadFailed');
    }
}
</script>

<template>
  <section
    class="space-y-3 text-left"
    data-testid="submission-receipt"
  >
    <h2 class="font-semibold text-pretty">
      {{ title }}
    </h2>
    <dl class="space-y-1 text-sm wrap-anywhere">
      <div
        v-for="(row, index) in rows"
        :key="row.label"
      >
        <dt class="inline text-muted">
          {{ row.label }}:
        </dt>
        <dd class="inline">
          <strong
            v-if="index === 0"
            translate="no"
          >{{ row.value }}</strong>
          <template v-else>
            {{ row.value }}
          </template>
        </dd>
      </div>
    </dl>
    <div
      class="flex flex-wrap gap-2"
      data-no-print
    >
      <UButton
        type="button"
        color="neutral"
        variant="outline"
        icon="i-lucide-download"
        loading-auto
        data-testid="download-receipt"
        @click="downloadReceipt"
      >
        {{ t('form.receipt.download') }}
      </UButton>
      <UButton
        type="button"
        color="neutral"
        variant="outline"
        icon="i-lucide-printer"
        data-testid="print-receipt"
        @click="printReceipt"
      >
        {{ t('form.receipt.print') }}
      </UButton>
    </div>
    <p
      role="status"
      class="text-sm text-error"
      :class="{ 'sr-only': !actionError }"
      data-no-print
    >
      {{ actionError }}
    </p>
    <iframe
      ref="printFrame"
      :title="title"
      tabindex="-1"
      aria-hidden="true"
      class="sr-only"
      data-no-print
    />
  </section>
</template>
