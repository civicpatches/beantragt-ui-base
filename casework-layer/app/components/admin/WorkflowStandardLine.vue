<script setup lang="ts">
/**
 * The standard line of the card "Ablauf": one paragraph,
 * "Dieses Formular nutzt den Standard-Ablauf: (o) A, (o) B, (o) C." and, when
 * the form has more, "Dazu kommen: (o) D." Names and colours come from data;
 * each name is preceded by the status dot (pattern: a status named in text).
 */
interface StandardLineStatus {
    machineName: string
    label: string
    color: string
}

defineProps<{
    standard: StandardLineStatus[]
    extras: StandardLineStatus[]
    /** The page's display name of a status. */
    label: (status: StandardLineStatus) => string
}>();

const { t } = useI18n();
</script>

<template>
  <p
    class="max-w-prose text-sm text-default"
    data-test="workflow-standard-line"
  >
    <span>{{ t('admin.forms.workflowStandardLead') }}</span>
    <template
      v-for="(status, index) in standard"
      :key="status.machineName"
    >
      {{ ' ' }}<span
        class="inline-flex items-baseline gap-1.5"
        data-test="workflow-standard-name"
      ><span
        class="inline-block size-3 shrink-0 self-center rounded-full ring-1 ring-accented"
        :style="{ backgroundColor: status.color }"
        aria-hidden="true"
      /><span class="font-medium text-highlighted">{{ label(status) }}</span></span>{{ index < standard.length - 1 ? ',' : '.' }}
    </template>
    <template v-if="extras.length">
      {{ ' ' }}<span>{{ t('admin.forms.workflowExtrasLead') }}</span>
      <template
        v-for="(status, index) in extras"
        :key="status.machineName"
      >
        {{ ' ' }}<span
          class="inline-flex items-baseline gap-1.5"
          data-test="workflow-extra-name"
        ><span
          class="inline-block size-3 shrink-0 self-center rounded-full ring-1 ring-accented"
          :style="{ backgroundColor: status.color }"
          aria-hidden="true"
        /><span class="font-medium text-highlighted">{{ label(status) }}</span></span>{{ index < extras.length - 1 ? ',' : '.' }}
      </template>
    </template>
  </p>
</template>
