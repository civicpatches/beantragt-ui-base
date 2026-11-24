<script setup lang="ts">
import { onScopeDispose, ref, shallowRef, watch } from 'vue';
import { staffFetch } from '~~/casework-layer/app/composables/api/useStaffSessionFetch';
import { formatDateTime } from '~/composables/useFormatters';
import {
    applicationDataErrorDetails,
    DATA_EDIT_HISTORY_CURSOR_INVALID,
    type ApplicationDataCorrection,
    type ApplicationDataCorrectionPage
} from '~~/casework-layer/app/utils/application-data-corrections';

const props = defineProps<{
    applicationId: string
    query: Record<string, unknown>
    fieldLabel: (key: string) => string
    formatValue: (key: string, value: unknown) => string
    entryFieldIds: ReadonlySet<string>
}>();

const { t, locale } = useI18n();
const open = ref(false);
const corrections = shallowRef<ApplicationDataCorrection[]>([]);
const nextBefore = ref<number | null>(null);
const count = ref<number | null>(null);
const loading = ref(false);
const failed = ref(false);
let request: AbortController | undefined;

async function load(before: number | null) {
    const current = new AbortController();
    request?.abort();
    request = current;
    loading.value = true;
    failed.value = false;
    try {
        const { meta } = await staffFetch<{ meta: ApplicationDataCorrectionPage }>(`/api/admin/applications/${props.applicationId}/events`, {
            query: { ...props.query, includeDataCorrections: '1', dataCorrectionsBefore: before ?? undefined },
            signal: current.signal
        });
        if (current.signal.aborted) return;
        corrections.value = before === null ? meta.dataCorrections : [...corrections.value, ...meta.dataCorrections];
        nextBefore.value = meta.dataCorrectionsNextBefore;
        count.value = nextBefore.value === null ? corrections.value.length : null;
    } catch (error: unknown) {
        if (current.signal.aborted) return;
        if (before !== null && applicationDataErrorDetails(error)?.code === DATA_EDIT_HISTORY_CURSOR_INVALID) {
            corrections.value = [];
            nextBefore.value = null;
            return load(null);
        }
        failed.value = true;
    } finally {
        if (request === current) loading.value = false;
    }
}

watch(open, (value) => {
    if (value) void load(null);
    else {
        request?.abort();
        corrections.value = [];
        nextBefore.value = null;
        failed.value = false;
    }
});
onScopeDispose(() => request?.abort());

type Change = ApplicationDataCorrection['changes'][number];

function formatSingleValue(field: string, value: unknown): string {
    if (value === null || value === '' || (Array.isArray(value) && value.length === 0)) return t('admin.detail.correctionHistory.emptyValue');
    return props.formatValue(field, value);
}

function valueText(field: string, value: unknown): string {
    if (props.entryFieldIds.has(field) && Array.isArray(value) && value.length > 0) {
        return value.map((entry, index) => t('admin.detail.correctionHistory.entryValue', {
            entry: t('admin.detail.entryNumber', { number: index + 1 }),
            value: formatSingleValue(field, entry)
        })).join('\n');
    }
    return formatSingleValue(field, value);
}

function previousValueText(change: Change): string {
    return change.hadOldValue
        ? valueText(change.field, change.oldValue)
        : t('admin.detail.correctionHistory.noOldValue');
}

function changeText(change: Change, index: number): string {
    const value = previousValueText(change);
    const newer = corrections.value[index - 1];
    // Each old value is from the immediate predecessor of its own correction. Gaps can
    // contain non-correction or unreadable revisions, so only use consecutive revision IDs.
    const next = newer?.revisionId === corrections.value[index]!.revisionId + 1
        ? newer.changes.find(candidate => candidate.field === change.field)
        : undefined;
    return next
        ? t('admin.detail.correctionHistory.valueChange', {
            old: value,
            new: next.hadOldValue ? valueText(change.field, next.oldValue) : t('admin.detail.correctionHistory.valueRemoved')
        })
        : t('admin.detail.correctionHistory.oldValue', { value });
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="t('admin.detail.correctionHistory.title')"
    :description="t('admin.detail.correctionHistory.description')"
  >
    <UButton
      color="neutral"
      variant="outline"
      :label="count === null ? t('admin.detail.correctionHistory.title') : t('admin.detail.correctionHistory.titleWithCount', { count })"
    />
    <template #body>
      <div class="space-y-4">
        <p
          v-if="!corrections.length && !loading && !failed && nextBefore === null"
          role="status"
        >
          {{ t('admin.detail.correctionHistory.empty') }}
        </p>
        <ol
          v-if="corrections.length"
          class="divide-y divide-default"
        >
          <li
            v-for="(correction, index) in corrections"
            :key="correction.revisionId"
            class="space-y-2 py-4 first:pt-0"
          >
            <p class="text-sm text-muted wrap-break-word">
              {{ correction.author.label || t('admin.detail.correctionHistory.unknownAuthor') }}
              · <time :datetime="correction.timestamp">{{ formatDateTime(correction.timestamp, locale) }}</time>
            </p>
            <p class="whitespace-pre-wrap wrap-break-word">
              {{ correction.reason ?? t('admin.detail.correctionHistory.noReason') }}
            </p>
            <dl
              v-if="correction.changes.length"
              class="space-y-2 text-sm"
            >
              <div
                v-for="change in correction.changes"
                :key="change.field"
              >
                <dt class="font-medium wrap-break-word">
                  {{ fieldLabel(change.field) }}
                </dt>
                <dd class="whitespace-pre-wrap wrap-break-word">
                  {{ changeText(change, index) }}
                </dd>
              </div>
            </dl>
          </li>
        </ol>
        <p
          v-if="loading"
          role="status"
        >
          {{ t('admin.detail.correctionHistory.loading') }}
        </p>
        <UAlert
          v-if="failed"
          icon="i-lucide-circle-x"
          color="error"
          :title="t('admin.detail.correctionHistory.failed')"
          role="alert"
        />
        <UButton
          v-if="failed || nextBefore !== null"
          color="neutral"
          variant="outline"
          :label="failed ? t('common.retry') : t('admin.detail.correctionHistory.older')"
          :loading="loading"
          :disabled="loading"
          @click="load(nextBefore)"
        />
      </div>
    </template>
  </UModal>
</template>
