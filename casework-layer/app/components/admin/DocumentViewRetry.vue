<script setup lang="ts">
defineProps<{ error: string, loading: boolean, disabled: boolean }>();
const emit = defineEmits<{ retry: [] }>();
const { t } = useI18n();
</script>

<template>
  <div class="space-y-2">
    <p
      role="alert"
      class="text-sm text-error"
    >
      {{ error }}
    </p>
    <UButton
      color="neutral"
      variant="outline"
      :loading="loading"
      :disabled="disabled"
      data-testid="docgen-retry-viewed"
      @click="emit('retry')"
    >
      {{ t('docgenUi.case.retryViewed') }}
    </UButton>
  </div>
</template>
