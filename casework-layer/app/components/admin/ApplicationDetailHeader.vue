<script setup lang="ts">
import type { AdminApplicationEventCounts } from '~/types';
import type { DropdownMenuItem } from '@nuxt/ui';
import type { RouteLocationRaw } from 'vue-router';
import AppPageLayout from '~/components/app/PageLayout.vue';
import { formatDateTime } from '~/composables/useFormatters';
import UnreadApplicantMessageLink from './UnreadApplicantMessageLink.vue';

/**
 * The page frame of the application page: the
 * shared `AppPageLayout` with its breadcrumb, the composite `h1` (reference
 * number above the form name), the status badge on the name's line, the who
 * and when line, and the three header controls. The page's content (loading,
 * error and the case) is the default slot, so there is one frame for every state.
 */

type HeaderApplication = {
    id: string
    referenceNumber?: string
    status: string
    statusLabel?: string
    statusColor?: string
    statusIcon?: string
    /** Text applicants see instead of the internal label, when it differs. */
    statusCitizenHint?: string
    /** When the application came in (who and when stand in the header). */
    created?: string | null
};

const props = withDefaults(defineProps<{
    /** `null` while loading or after a load error: the frame shows breadcrumb and title only. */
    application: HeaderApplication | null
    events?: AdminApplicationEventCounts
    unreadMessageCount?: number
    schemaLabel: string
    /** The list page, first crumb. */
    listTo: RouteLocationRaw
    /** Last crumb: the reference number, or the start of the id before it is known. */
    breadcrumbLabel: string
    /** The first load runs: a skeleton stands in the title. */
    loading?: boolean
    /** Title without an application: "Antrag hier nicht vorhanden" for a 404, "Antrag" for a failed load. Never "Anträge". */
    fallbackTitle?: string
    /** Name from the contact data of the application, never from a form field. */
    applicantName?: string | null
    hasStatus: boolean
    transitionCount: number
    mayChangeStatus?: boolean
    showRollbackAction?: boolean
    isSavingStatus: boolean
    statusActionBusy: boolean
    printTo: string | { path: string }
    canDelete?: boolean
    isDeleting?: boolean
    deleteDisabled?: boolean
}>(), { mayChangeStatus: true });

const emit = defineEmits<{
    (event: 'change-status' | 'delete' | 'focus-messages'): void
}>();

const { t, locale } = useI18n();

const applicationReference = computed(() =>
    props.application?.referenceNumber || props.application?.id.slice(0, 8) || props.breadcrumbLabel
);
const breadcrumbs = computed(() => [
    { label: t('nav.applications'), to: props.listTo },
    { label: props.breadcrumbLabel }
]);
const canChangeStatus = computed(() =>
    props.mayChangeStatus !== false && props.hasStatus && props.transitionCount > 0
);
const showNoStatusTransitions = computed(() =>
    props.mayChangeStatus !== false && props.hasStatus && props.transitionCount === 0 && !props.showRollbackAction
);
const receivedText = computed(() =>
    props.application?.created ? t('admin.detail.receivedOn', { date: formatDateTime(props.application.created, locale?.value) }) : ''
);
const showDescription = computed(() =>
    Boolean(props.application && (props.applicantName || receivedText.value || props.application.statusCitizenHint))
);

/**
 * "Antrag löschen" stands apart from the everyday actions: one step away in "Weitere Aktionen".
 * The dialog behind it still asks before anything is deleted.
 */
const moreActionItems = computed<DropdownMenuItem[]>(() => [{
    label: t('admin.detail.deleteApplication'),
    icon: 'i-lucide-trash-2',
    color: 'error',
    slot: 'delete',
    disabled: Boolean(props.deleteDisabled || props.isDeleting),
    onSelect: () => emit('delete')
}]);

const moreActionsTrigger = ref<{ $el?: HTMLElement } | null>(null);
/** Focus goes back to the menu trigger when the delete dialog closes: the menu item is gone by then. */
function focusMoreActions() {
    const element = moreActionsTrigger.value?.$el;
    if (element instanceof HTMLElement) element.focus();
}
defineExpose({ focusMoreActions });
</script>

<template>
  <!-- From lg the controls stay in one row and never shrink; the title takes the rest and may wrap. Below lg they wrap as a group under the who and when line. -->
  <AppPageLayout
    :title="application ? schemaLabel : (fallbackTitle || t('admin.detail.applicationCrumb'))"
    :breadcrumbs="breadcrumbs"
    data-testid="application-header-layout"
  >
    <template #title>
      <template v-if="application">
        <!-- The reference appears here on small screens because the layout hides the current breadcrumb. -->
        <span class="mb-1 block font-mono text-sm font-normal text-muted sm:sr-only">{{ application.referenceNumber }}</span>
        <span class="block">{{ schemaLabel }}</span>
      </template>
      <template v-else-if="loading">
        <span class="sr-only">{{ t('admin.detail.applicationCrumb') }}</span>
        <USkeleton
          class="h-8 w-48"
          aria-hidden="true"
        />
      </template>
      <template v-else>
        {{ fallbackTitle || t('admin.detail.applicationCrumb') }}
      </template>
    </template>

    <!-- The layout aligns a composite title to its last baseline, which lines up the badge with the form name. -->
    <template
      v-if="application"
      #titleMeta
    >
      <span
        class="inline-flex flex-wrap items-center gap-2"
        data-testid="application-header-status"
      >
        <span class="sr-only">{{ t('admin.table.setStatus') }}:</span>
        <StatusBadge
          :status="application.status"
          :label="application.statusLabel"
          :color="application.statusColor"
          :icon="application.statusIcon"
          size="md"
        />
        <UnreadApplicantMessageLink
          v-if="unreadMessageCount"
          :count="unreadMessageCount"
          to="#application-messages"
          data-test="header-unread-message-link"
          @click.prevent="emit('focus-messages')"
        />
      </span>
    </template>

    <template
      v-if="showDescription"
      #description
    >
      <!-- Below sm name and date are two lines; from sm the dot belongs to the date, so it never ends a line. -->
      <p
        v-if="applicantName || receivedText"
        data-testid="application-header-who-when"
      >
        <span
          v-if="applicantName"
          class="block font-medium text-default sm:inline"
          data-testid="application-header-name"
        >{{ applicantName }}</span>
        <span
          v-if="receivedText"
          class="block sm:inline sm:whitespace-nowrap"
          data-testid="application-header-received"
        ><span
          v-if="applicantName"
          class="hidden sm:inline"
          aria-hidden="true"
        > · </span>{{ receivedText }}</span>
      </p>
      <p
        v-if="application?.statusCitizenHint"
        data-test="status-citizen-hint"
      >
        {{ t('admin.detail.citizenSees', { label: application.statusCitizenHint }) }}
      </p>
    </template>

    <template
      v-if="application"
      #actions
    >
      <div
        class="contents"
        data-testid="application-header-actions"
      >
        <UButton
          v-if="canChangeStatus"
          :loading="isSavingStatus"
          :disabled="statusActionBusy"
          :aria-label="t('admin.detail.changeStatusFor', { ref: applicationReference })"
          data-function-search-target="status"
          @click="emit('change-status')"
        >
          {{ t('admin.detail.changeStatus') }}
        </UButton>
        <span
          v-if="showNoStatusTransitions"
          class="inline-flex min-h-8 items-center text-sm text-muted"
        >
          {{ t('admin.table.noStatusTransitions') }}
        </span>
        <slot name="event-actions" />
        <UButton
          :to="printTo"
          color="neutral"
          variant="outline"
          icon="i-lucide-printer"
          data-function-search-target="print"
        >
          {{ t('admin.applications.printView') }}
        </UButton>
        <UDropdownMenu
          v-if="canDelete"
          :items="moreActionItems"
          :content="{ align: 'end' }"
        >
          <UButton
            ref="moreActionsTrigger"
            color="neutral"
            variant="ghost"
            trailing-icon="i-lucide-chevron-down"
            :loading="isDeleting"
            data-test="more-actions-trigger"
            data-function-search-target="delete"
          >
            {{ t('admin.detail.moreActions') }}
          </UButton>
          <template #delete-label>
            <span data-test="delete-application-trigger">{{ t('admin.detail.deleteApplication') }}</span>
          </template>
        </UDropdownMenu>
      </div>
    </template>

    <slot />
  </AppPageLayout>
</template>
