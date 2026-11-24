<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue';
import type { AdminApplicationAttachment } from '~/types';
import type { ViewerDocument } from '~~/casework-layer/app/utils/viewer-document';
import type {
    AttachmentDetails,
    AttachmentListGroup,
    AttachmentListSummary,
    AttachmentRowState
} from '~~/casework-layer/app/composables/useAdminApplicationAttachments';
import type { CaseAttachmentInsightContext } from '~~/casework-layer/app/utils/case-attachment-insights';
import AttachmentPreview from './AttachmentPreview.vue';
import StaffExtensionOutlet from '~~/casework-layer/app/components/StaffExtensionOutlet.vue';

/**
 * All attachments of an application in one wide slide-over: the list on the left (one Tab stop), the shown
 * attachment on the right with its state, preview and details.
 * The analysis actions and details are not part of this component: a layer registers them for the outlet
 * `case-attachment-insight`, mounted in the action row and below the viewer; without one, neither shows.
 * The slide-over stays open while the attachment changes, so the slide-in does not replay; with reduced motion
 * neither the panel nor the overlay animates. Focus moves to the shown entry on opening; on closing the page's
 * composable returns it to the opener (looked up by id). A change of the shown attachment by the person is
 * announced once; a reload of the same attachment is not.
 */
const props = defineProps<{
    open: boolean
    groups: AttachmentListGroup[]
    ordered: AdminApplicationAttachment[]
    summary: AttachmentListSummary
    current: AdminApplicationAttachment | null
    details: AttachmentDetails
    rowState: (attachment: AdminApplicationAttachment) => AttachmentRowState
    fileKind: (attachment: AdminApplicationAttachment) => 'pdf' | 'image' | 'other'
    viewerDocument: (attachment: AdminApplicationAttachment) => ViewerDocument | null
    isQuarantinedAttachment: (attachment: AdminApplicationAttachment) => boolean
}>();

const emit = defineEmits<{
    'update:open': [value: boolean]
    'select': [attachment: AdminApplicationAttachment]
    'run-analysis': [attachment: AdminApplicationAttachment]
    'rerun-story': [story: 'citizen' | 'staff']
    'refresh-analysis': []
    'delete-quarantine': [attachment: AdminApplicationAttachment]
    /** After closing, when the dialog hands the focus back: the page returns it to the opener. */
    'closed': []
}>();

const { t } = useI18n();
const picker = ref<{ focusCurrent: () => void } | null>(null);

const description = computed(() => {
    const total = props.ordered.length;
    return [
        t(total === 1 ? 'admin.detail.attachmentCountOne' : 'admin.detail.attachmentCountMany', { count: total }),
        props.summary.attention ? t('admin.detail.attachmentList.attentionCount', { count: props.summary.attention }) : '',
        props.summary.quarantined ? t('admin.detail.attachmentList.quarantinedCount', { count: props.summary.quarantined }) : '',
        props.summary.missing
            ? (props.summary.missing === 1 ? t('admin.detail.attachmentList.missingOne') : t('admin.detail.attachmentList.missingMany', { count: props.summary.missing }))
            : ''
    ].filter(Boolean).join(', ');
});

const state = computed(() => props.current ? props.rowState(props.current) : null);
const fieldLabel = computed(() => props.groups.find(group => group.attachments.some(attachment => attachment.id === props.current?.id))?.label ?? '');
/** Field and size as one phrase, read the same way by eye and by screen reader. */
const meta = computed(() => [fieldLabel.value, props.details.size].filter(Boolean).join(', '));
const titleId = `attachment-details-title-${useId()}`;
/** What a registered layer reads for the shown attachment (outlet `case-attachment-insight`), per mount point. */
function insightContext(part: CaseAttachmentInsightContext['part']): CaseAttachmentInsightContext | undefined {
    if (!props.current || !state.value) return undefined;
    return {
        part,
        attachment: props.current,
        details: props.details,
        state: state.value,
        runAnalysis: () => {
            if (props.current) emit('run-analysis', props.current);
        },
        rerunStory: story => emit('rerun-story', story),
        refreshAnalysis: () => emit('refresh-analysis')
    };
}

const announcement = ref('');
let announceNext = false;
/** A selection by the person is announced once the right column shows it. */
function select(attachment: AdminApplicationAttachment) {
    if (attachment.id === props.current?.id) return;
    announceNext = true;
    emit('select', attachment);
}
watch(() => props.current?.id, () => {
    if (!announceNext || !props.current) return;
    announceNext = false;
    announcement.value = t('admin.detail.attachmentList.positionNamed', { current: position.value, total: props.ordered.length, filename: props.current.filename });
});
watch(() => props.open, (open) => {
    if (!open) {
        announcement.value = '';
        announceNext = false;
    }
});
const position = computed(() => props.current ? props.ordered.findIndex(attachment => attachment.id === props.current!.id) + 1 : 0);
const viewerDoc = computed(() => props.current ? props.viewerDocument(props.current) : null);
const quarantined = computed(() => Boolean(props.current && props.isQuarantinedAttachment(props.current)));
const compactPicker = computed(() => props.ordered.some(attachment => props.rowState(attachment).separateLine));

/** Opening focuses the shown entry of the list instead of the first control. */
function openAutoFocus(event: Event) {
    event.preventDefault();
    void nextTick(() => picker.value?.focusCurrent());
}
/** Closing leaves the focus to the page, which returns it to the opener. */
function closeAutoFocus(event: Event) {
    event.preventDefault();
    emit('closed');
}
// No slide-in or fade with reduced motion; Nuxt UI's theme has no such variant.
const reducedMotion = 'motion-reduce:animate-none!';
</script>

<template>
  <USlideover
    :open="open"
    :title="t('admin.detail.attachmentList.slideoverTitle')"
    :description="description"
    :content="{ onOpenAutoFocus: openAutoFocus, onCloseAutoFocus: closeAutoFocus }"
    :ui="{
      overlay: reducedMotion,
      content: `max-w-6xl ${reducedMotion}`,
      body: 'flex min-h-0 flex-col overflow-y-auto p-0 sm:p-0 md:flex-row md:overflow-hidden',
      footer: 'gap-3',
    }"
    @update:open="value => emit('update:open', value)"
  >
    <template #body>
      <p
        class="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="attachment-announcement"
      >
        {{ announcement }}
      </p>
      <div
        :class="[
          compactPicker ? 'max-h-[25vh]' : 'max-h-[40vh]',
          'shrink-0 overflow-y-auto border-b border-default p-2 md:max-h-none md:w-80 md:border-b-0 md:border-e',
        ]"
        data-testid="attachment-picker-column"
      >
        <AdminApplicationAttachmentPicker
          ref="picker"
          :groups="groups"
          :current-id="current?.id ?? null"
          :row-state="rowState"
          :file-kind="fileKind"
          @select="select"
        />
      </div>
      <div
        v-if="current && state"
        class="grid min-w-0 flex-1 content-start gap-4 p-4 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary sm:p-6 md:overflow-y-auto"
        tabindex="0"
        role="group"
        :aria-labelledby="titleId"
        data-testid="attachment-details"
      >
        <div class="min-w-0">
          <h3
            :id="titleId"
            class="break-words text-base font-semibold text-highlighted"
          >
            {{ current.filename }}
          </h3>
          <p
            class="mt-1 text-sm text-muted"
            data-testid="attachment-details-meta"
          >
            {{ meta }}
          </p>
        </div>

        <div
          v-if="state.kind !== 'none' && (!details.panelBeforePreview || quarantined)"
          class="grid gap-2"
          data-testid="attachment-details-state"
        >
          <AdminApplicationAttachmentState
            :state="state"
            verbose
          />
          <p
            v-if="state.sentence || state.explanation"
            class="break-words text-sm text-default"
          >
            {{ state.sentence || state.explanation }}
          </p>
        </div>

        <div
          v-if="quarantined || details.canStartAnalysis || details.canRerunAnalysis"
          class="flex flex-wrap gap-2"
        >
          <UButton
            v-if="quarantined && current.canResolveQuarantine"
            color="error"
            variant="outline"
            icon="i-lucide-trash-2"
            :loading="details.deleting"
            :disabled="details.deleteDisabled"
            :aria-label="t('admin.detail.deleteQuarantinedAttachmentNamed', { filename: current.filename })"
            data-testid="attachment-delete-quarantine"
            @click="emit('delete-quarantine', current)"
          >
            {{ t('admin.detail.deleteQuarantinedAttachment') }}
          </UButton>
          <UBadge
            v-else-if="quarantined"
            color="neutral"
          >
            {{ t('admin.detail.quarantinedAttachmentLocked') }}
          </UBadge>
          <StaffExtensionOutlet
            name="case-attachment-insight"
            :context="insightContext('actions')"
          />
        </div>

        <StaffExtensionOutlet
          v-if="details.panelBeforePreview"
          name="case-attachment-insight"
          :context="insightContext('panel')"
        />

        <!-- A bounded height, so the details below start within reach (the batch review's full-page height is too tall here). -->
        <div
          v-if="viewerDoc"
          class="flex h-96 min-h-0 flex-col lg:h-128"
          data-testid="attachment-viewer"
        >
          <AttachmentPreview
            :document="viewerDoc"
          />
        </div>
        <p
          v-else-if="!quarantined"
          class="text-sm text-muted"
          data-testid="attachment-no-viewer"
        >
          {{ t('admin.detail.attachmentPreviewUnavailable') }}
        </p>

        <StaffExtensionOutlet
          v-if="!details.panelBeforePreview"
          name="case-attachment-insight"
          :context="insightContext('panel')"
        />
      </div>
    </template>

    <template #footer>
      <span
        v-if="current"
        class="text-sm text-muted"
        data-testid="attachment-position"
      >
        {{ t('admin.detail.attachmentList.position', { current: position, total: ordered.length }) }}
      </span>
      <span class="flex-1" />
      <UButton
        v-if="current && details.canDownload"
        :to="current.url"
        target="_blank"
        rel="noopener noreferrer"
        color="neutral"
        variant="outline"
        icon="i-lucide-download"
        :aria-label="t('admin.detail.openAttachmentNamed', { filename: current.filename })"
        data-testid="attachment-download"
      >
        {{ t('common.download') }}
      </UButton>
      <UButton
        v-else
        color="neutral"
        variant="outline"
        icon="i-lucide-download"
        disabled
        data-testid="attachment-download"
      >
        {{ t('common.download') }}
      </UButton>
    </template>
  </USlideover>
</template>
