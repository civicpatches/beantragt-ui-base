<script setup lang="ts">
import { PUBLIC_CONTENT_RETRY_STATUS_CODES } from '~/utils/public-content-fetch';
import PendingSubmissionNotice from '~/components/citizen/PendingSubmissionNotice.vue';
import CitizenPage from '~/components/citizen/Page.vue';
import SubmissionReceipt from '~/components/citizen/SubmissionReceipt.vue';
import type { FormSchema, PublicAttachmentAnalysisDisclosure, ProfileConsentOffers } from '~/types/form';
import PublicContentPlacement from '~/components/content/PublicContentPlacement.vue';
import ProfileConsent from '../../../forms/ProfileConsent.vue';
import DeliveryRouteChoice from '~/components/DeliveryRouteChoice.vue';
import {
    publicFormPath,
    publicFormStatusPath,
    publicHomePath,
    publicWorkspaceFromRoute
} from '~/utils/public-form-path';
import {
    FORM_FIELD_ANCHOR_PREFIX,
    PRIVACY_CONSENT_ANCHOR_ID,
    SUBMISSION_IDENTITY_ANCHOR_ID
} from '~/composables/useFormSubmission';
import { focusFormTarget } from '~/utils/form-focus';
import { useLeaveConfirmation } from '~/composables/useLeaveConfirmation';
import {
    getLocalizedFormSchemaDescription,
    getLocalizedFormSchemaTitle,
    parseStoredFormSchema
} from '~/utils/form-schema';
import { localizedPrivacyPath } from '~/utils/locale-routing';
import { publicSchemaDeliveryOffer } from '~/utils/delivery-offer';

definePageMeta({
    layout: false
});

interface PublicDocumentItem {
    id: string
    attributes: {
        title: string
        description?: {
            processed?: string
        }
        file?: {
            filename?: string
            mimeType?: string
            size?: number
            url?: string
        }
    }
}

interface PublicContentSectionItem {
    id: string
    attributes: {
        title: string
        body?: {
            processed?: string
        }
        placement?: string
    }
}

interface PublicDocumentResponse {
    data?: PublicDocumentItem[]
}

interface PublicContentSectionResponse {
    data?: PublicContentSectionItem[]
}

type PublicContentPlacement = 'form_intro' | 'form_downloads' | 'form_sidebar' | 'submission_success';
type PublicSectionPlacement = Exclude<PublicContentPlacement, 'form_downloads'>;

const { t, locale } = useI18n();
const route = useRoute();
const schemaId = route.params.id as string;
const routePublicWorkspace = computed(() => publicWorkspaceFromRoute(route));
const attachmentUploadActive = ref(false);
const publicSections = ref<Record<PublicContentPlacement, PublicContentSectionItem[]>>(emptyContentMap<PublicContentSectionItem>());
const publicDocuments = ref<Record<PublicContentPlacement, PublicDocumentItem[]>>(emptyContentMap<PublicDocumentItem>());
const publicContentLoading = ref(false);
/** Placements whose notes or leaflets call failed; each call stands on its own. */
const failedSections = ref(new Set<PublicContentPlacement>());
const failedDocuments = ref(new Set<PublicContentPlacement>());
let publicContentRequestId = 0;

function routeParam(value: string | string[] | undefined): string | undefined {
    return Array.isArray(value) ? value[0] : value;
}

const routeJurisdictionSlug = routeParam(route.params.workspace as string | string[] | undefined);
const routeOrganisationSlug = routeParam(route.params.organisation as string | string[] | undefined);
const schemaQuery = computed(() => {
    const query: Record<string, string> = {};
    if (routeJurisdictionSlug) query.jurisdiction = routeJurisdictionSlug;
    if (routeOrganisationSlug) query.organisation = routeOrganisationSlug;
    return query;
});

// Embed mode detection and theme handling
const { isEmbed, applyTheme, cleanupTheme } = useEmbed();

onMounted(() => {
    applyTheme();
});

onBeforeUnmount(() => {
    cleanupTheme();
});

// Load schema via server proxy (avoids CORS)
const { data: rawResponse, status, error: fetchError, refresh: refreshSchema } = await useFetch<{
    data: {
        id: string
        attributes: {
            label: string
            field_description?: { value: string } | string
            field_schema: { value: string } | string
            field_workflow_status?: string
            field_jurisdiction_slug?: string | null
            field_organisation_slug?: string | null
            field_public_path?: string
            /** Where each upload field's file goes for the pre-check, by field id. */
            field_attachment_analysis_disclosures?: Record<string, PublicAttachmentAnalysisDisclosure>
            /** Delivery offer; read through publicSchemaDeliveryOffer(). */
            deliveryOffer?: unknown
            profileConsentOffers?: ProfileConsentOffers | null
        }
    }
}>(`/api/schema/${schemaId}`, {
    key: `form-schema-${schemaId}-${routeJurisdictionSlug || 'global'}-${routeOrganisationSlug || 'none'}`,
    query: schemaQuery
});

/**
 * Why the form is not shown, when it is not "not found": the UI's own request limit (429) or another failure. Only a
 * 404 (or an answer without a schema) says the form does not exist; the other two offer "Erneut versuchen".
 */
const schemaFailure = computed<'rateLimited' | 'failed' | null>(() => {
    if (!fetchError.value || fetchError.value.statusCode === 404) return null;
    return fetchError.value.statusCode === 429 ? 'rateLimited' : 'failed';
});

const schemaPublicPath = computed(() => {
    const attrs = rawResponse.value?.data.attributes;
    if (!attrs) return '';
    return attrs.field_public_path || publicFormPath({
        id: schemaId,
        jurisdictionSlug: attrs.field_jurisdiction_slug,
        organisationSlug: attrs.field_organisation_slug
    });
});

const formWorkspace = computed(() => {
    const attrs = rawResponse.value?.data.attributes;
    return {
        jurisdictionSlug: attrs?.field_jurisdiction_slug || routePublicWorkspace.value.jurisdictionSlug,
        organisationSlug: attrs?.field_organisation_slug || routePublicWorkspace.value.organisationSlug
    };
});
const consentOffers = computed(() => rawResponse.value?.data.attributes.profileConsentOffers ?? null);
const deliveryOffer = computed(() => publicSchemaDeliveryOffer(rawResponse.value?.data.attributes));
const attachmentAnalysisDisclosures = computed<Record<string, PublicAttachmentAnalysisDisclosure>>(() =>
    rawResponse.value?.data.attributes.field_attachment_analysis_disclosures ?? {}
);
const homePath = computed(() => publicHomePath(formWorkspace.value));
const privacyPath = computed(() => localizedPrivacyPath(locale.value, formWorkspace.value));

onMounted(() => {
    const canonicalPath = schemaPublicPath.value;
    if (canonicalPath && canonicalPath !== route.path) {
        navigateTo({ path: canonicalPath, query: route.query }, { replace: true });
    }
});

const schema = computed<FormSchema | null>(() => {
    if (!rawResponse.value?.data) return null;

    const attrs = rawResponse.value.data.attributes;
    try {
        const fieldValue = typeof attrs.field_schema === 'string'
            ? attrs.field_schema
            : attrs.field_schema?.value;

        if (!fieldValue) return null;

        return parseStoredFormSchema(fieldValue, rawResponse.value.data.id, { requireCurrencyMetadata: true });
    } catch (e) {
        console.error('[form] Failed to parse schema:', e);
        return null;
    }
});

const localizedSchemaTitle = computed(() => schema.value
    ? getLocalizedFormSchemaTitle(schema.value, locale.value)
    : t('common.forms')
);
const localizedSchemaDescription = computed(() => schema.value
    ? getLocalizedFormSchemaDescription(schema.value, locale.value)
    : undefined
);

const publicSectionPlacements: PublicSectionPlacement[] = ['form_intro', 'form_sidebar', 'submission_success'];
const publicDocumentPlacements: PublicContentPlacement[] = ['form_intro', 'form_downloads', 'form_sidebar', 'submission_success'];

function emptyContentMap<T>(): Record<PublicContentPlacement, T[]> {
    return {
        form_intro: [],
        form_downloads: [],
        form_sidebar: [],
        submission_success: []
    };
}

function publicContentQuery(placement: PublicContentPlacement) {
    const workspace = formWorkspace.value;
    return {
        lang: locale.value,
        form: schemaId,
        placement,
        ...(workspace.organisationSlug ? { organisation: workspace.organisationSlug } : {})
    };
}

async function fetchPublicSections(placement: PublicSectionPlacement): Promise<PublicContentSectionItem[]> {
    const workspace = formWorkspace.value;
    const response = await $fetch<PublicContentSectionResponse>(
        `/api/jurisdictions/${workspace.jurisdictionSlug}/sections`,
        { query: publicContentQuery(placement), retryStatusCodes: PUBLIC_CONTENT_RETRY_STATUS_CODES }
    );
    return response.data || [];
}

async function fetchPublicDocuments(placement: PublicContentPlacement): Promise<PublicDocumentItem[]> {
    const workspace = formWorkspace.value;
    const response = await $fetch<PublicDocumentResponse>(
        `/api/jurisdictions/${workspace.jurisdictionSlug}/documents`,
        { query: publicContentQuery(placement), retryStatusCodes: PUBLIC_CONTENT_RETRY_STATUS_CODES }
    );
    return (response.data || []).filter(item => Boolean(item.attributes.file?.url));
}

async function loadPublicContent() {
    const workspace = formWorkspace.value;
    const requestId = ++publicContentRequestId;
    publicSections.value = emptyContentMap();
    publicDocuments.value = emptyContentMap();
    failedSections.value = new Set();
    failedDocuments.value = new Set();
    if (!workspace.jurisdictionSlug || !schema.value) {
        publicContentLoading.value = false;
        return;
    }

    publicContentLoading.value = true;
    // Each call settles on its own: what loaded is shown, a refused call empties only its own place.
    const [sectionResults, documentResults] = await Promise.all([
        Promise.allSettled(publicSectionPlacements.map(fetchPublicSections)),
        Promise.allSettled(publicDocumentPlacements.map(fetchPublicDocuments))
    ]);
    if (requestId !== publicContentRequestId) return;
    const sections = emptyContentMap<PublicContentSectionItem>();
    const documents = emptyContentMap<PublicDocumentItem>();
    const sectionsFailed = new Set<PublicContentPlacement>();
    const documentsFailed = new Set<PublicContentPlacement>();
    sectionResults.forEach((result, index) => {
        const placement = publicSectionPlacements[index]!;
        if (result.status === 'fulfilled') sections[placement] = result.value;
        else sectionsFailed.add(placement);
    });
    documentResults.forEach((result, index) => {
        const placement = publicDocumentPlacements[index]!;
        if (result.status === 'fulfilled') documents[placement] = result.value;
        else documentsFailed.add(placement);
    });
    publicSections.value = sections;
    publicDocuments.value = documents;
    failedSections.value = sectionsFailed;
    failedDocuments.value = documentsFailed;
    publicContentLoading.value = false;
}

watch([schema, formWorkspace, locale], loadPublicContent, { immediate: true });

const introSections = computed(() => publicSections.value.form_intro);
const introDocuments = computed(() => [
    ...publicDocuments.value.form_intro,
    ...publicDocuments.value.form_downloads
]);
const sidebarSections = computed(() => publicSections.value.form_sidebar);
const sidebarDocuments = computed(() => publicDocuments.value.form_sidebar);
const successSections = computed(() => publicSections.value.submission_success);
// A box says "konnte nicht geladen werden" only when every call that fills it failed.
const introContentError = computed(() => failedSections.value.has('form_intro'));
const sidebarContentError = computed(() => failedSections.value.has('form_sidebar') && failedDocuments.value.has('form_sidebar'));
const successContentError = computed(() => failedSections.value.has('submission_success') && failedDocuments.value.has('submission_success'));
const successDocuments = computed(() => publicDocuments.value.submission_success);
const hasMobileSidebarContent = computed(() =>
    sidebarSections.value.some(section => Boolean(section.attributes.body?.processed))
    || sidebarDocuments.value.length > 0
);
const hasSidebarContent = computed(() =>
    !publicContentLoading.value
    && (
        introDocuments.value.length > 0
        || sidebarSections.value.length > 0
        || sidebarDocuments.value.length > 0
    )
);
const staffSessionActive = ref(false);

// Form state, validation and native submit live in the shared composable so
// the self-fill slideover submits through the exact same pipeline.
const {
    formData,
    isSubmitting,
    submitError,
    fieldErrors,
    identityData,
    identityErrors,
    identityRequirements,
    submitBlockedByAuth,
    privacyConsent,
    profileConsent,
    bankConsent,
    profileConsentText,
    bankConsentText,
    deliveryRoute,
    deliveryRoutes,
    deliveryChoiceVisible,
    applicationResult,
    validationSummary,
    privacyConsentError,
    hasEnteredValues,
    emailConfirmationExpected,
    formLength,
    revalidateOnLeave,
    onSubmit
} = useFormSubmission({ schema, schemaId, workspace: formWorkspace, consentOffers, deliveryOffer });

// Error summary: names every missing entry, links to it and takes the
// focus after a failed submit, so the citizen starts where they can act.
const errorSummaryRef = ref<HTMLElement | null>(null);
async function submitForm(): Promise<void> {
    await onSubmit();
    if (validationSummary.value.length === 0) return;
    await nextTick();
    errorSummaryRef.value?.focus();
}

function jumpToError(event: Event, targetId: string): void {
    event.preventDefault();
    focusFormTarget(targetId);
}

// Length of the form before typing, counted from the schema.
const formLengthText = computed(() => {
    const length = formLength.value;
    if (length.sections === 0) return '';
    const summary = t('form.length.summary', {
        sections: t('form.length.sections', { count: length.sections }, length.sections),
        requiredFields: t(
            length.hasConditionalFields ? 'form.length.requiredFieldsAtLeast' : 'form.length.requiredFields',
            { count: length.requiredFields },
            length.requiredFields
        )
    });
    return length.hasConditionalFields ? `${summary} ${t('form.length.conditional')}` : summary;
});

// Leaving with typed entries asks first. The form keeps no draft, so
// the e-mail login, a header link or BundID would drop every entry.
type LeaveKind = 'login' | 'leave' | 'logout';
const leaveDialogOpen = ref(false);
const leaveDialogKind = ref<LeaveKind>('leave');
let resolveLeave: ((leave: boolean) => void) | null = null;

function askToLeave(kind: LeaveKind): Promise<boolean> {
    resolveLeave?.(false);
    leaveDialogKind.value = kind;
    leaveDialogOpen.value = true;
    return new Promise((resolve) => {
        resolveLeave = resolve;
    });
}

function answerLeave(leave: boolean): void {
    const resolve = resolveLeave;
    resolveLeave = null;
    leaveDialogOpen.value = false;
    resolve?.(leave);
}

watch(leaveDialogOpen, (open) => {
    if (!open && resolveLeave) answerLeave(false);
});

function confirmExternalLogin(): boolean | Promise<boolean> {
    return hasEnteredValues.value ? askToLeave('login') : true;
}

// "Abmelden" and the demo persona switch in the header ask here before the
// session ends; the navigation that follows a yes passes the guard.
const leaveConfirmation = useLeaveConfirmation();
leaveConfirmation.register(intent => hasEnteredValues.value ? askToLeave(intent) : true);

onBeforeRouteLeave((to) => {
    if (!hasEnteredValues.value || leaveConfirmation.alreadyConfirmed()) return true;
    return askToLeave(to.path.endsWith('/auth/login') ? 'login' : 'leave');
});

// Status tracking URL for the confirmation page
const statusUrl = computed(() => {
    if (!applicationResult.value) return '';
    return publicFormStatusPath({
        id: schemaId,
        path: schemaPublicPath.value,
        statusToken: applicationResult.value.statusToken
    });
});
const emailConfirmationRequired = computed(() => applicationResult.value?.confirmation?.required === true);
const successHeading = ref<HTMLHeadingElement | null>(null);

// Keep the existing acknowledgement for backends that predate the saved receipt.
const submittedAt = ref<Date | null>(null);
watch(applicationResult, (result) => {
    submittedAt.value = result && !result.receipt ? new Date() : null;
});
watch(successHeading, heading => heading?.focus(), { flush: 'post' });
const submittedAtText = computed(() => submittedAt.value
    ? new Intl.DateTimeFormat(locale.value, { dateStyle: 'long', timeStyle: 'short' }).format(submittedAt.value)
    : ''
);

const referenceCopied = ref(false);
const copyFeedback = ref('');
let copyFeedbackTimer: ReturnType<typeof setTimeout> | null = null;

async function copyReference(): Promise<void> {
    const reference = applicationResult.value?.referenceNumber;
    if (!reference) return;
    try {
        await navigator.clipboard.writeText(reference);
        referenceCopied.value = true;
        copyFeedback.value = t('form.referenceCopied');
    } catch {
        referenceCopied.value = false;
        copyFeedback.value = t('form.referenceCopyFailed');
    }
    if (copyFeedbackTimer) clearTimeout(copyFeedbackTimer);
    copyFeedbackTimer = setTimeout(() => {
        referenceCopied.value = false;
    }, 3000);
}

function printLegacyReceipt(): void {
    window.print();
}

onBeforeUnmount(() => {
    if (copyFeedbackTimer) clearTimeout(copyFeedbackTimer);
});

// Page title
useHead({
    title: localizedSchemaTitle
});
</script>

<template>
  <CitizenPage
    :container="false"
    :back-to="false"
    :embed="isEmbed"
    main-id="public-form-main"
    :main-label="localizedSchemaTitle"
    :busy="status === 'pending'"
    :class="{
      'pb-12': !isEmbed,
      'embed-mode': isEmbed,
    }"
  >
    <!-- The embed mode hides the shared header and footer to fit the host page. -->
    <div class="public-form-main">
      <!-- Loading skeleton -->
      <div
        v-if="status === 'pending'"
        class="max-w-3xl mx-auto p-8"
      >
        <USkeleton class="h-8 w-2/3 mb-4" />
        <USkeleton class="h-4 w-full mb-8" />
        <div
          v-for="i in 3"
          :key="i"
          class="mb-8"
        >
          <USkeleton class="h-6 w-1/3 mb-4" />
          <div class="space-y-4">
            <USkeleton
              v-for="j in 3"
              :key="j"
              class="h-10 w-full"
            />
          </div>
        </div>
      </div>

      <!-- Error: too many requests or another failure; the person can try again -->
      <div
        v-else-if="schemaFailure"
        class="max-w-lg mx-auto p-8 mt-12 text-center"
        data-testid="form-load-failure"
      >
        <UIcon
          :name="schemaFailure === 'rateLimited' ? 'i-lucide-clock' : 'i-lucide-cloud-off'"
          class="text-5xl mb-4 block mx-auto text-(--ui-text-muted)"
        />
        <h1 class="text-xl font-semibold mb-2">
          {{ t(schemaFailure === 'rateLimited' ? 'form.schemaRateLimited' : 'form.schemaLoadFailed') }}
        </h1>
        <p class="text-(--ui-text-muted) mb-6">
          {{ t(schemaFailure === 'rateLimited' ? 'form.schemaRateLimitedDescription' : 'form.schemaLoadFailedDescription') }}
        </p>
        <UButton
          variant="soft"
          icon="i-lucide-refresh-cw"
          @click="refreshSchema()"
        >
          {{ t('common.retry') }}
        </UButton>
      </div>

      <!-- Error: schema not found -->
      <div
        v-else-if="fetchError || !schema"
        class="max-w-lg mx-auto p-8 mt-12 text-center"
      >
        <UIcon
          name="i-lucide-file-x"
          class="text-5xl mb-4 block mx-auto text-(--ui-text-muted)"
        />
        <h1 class="text-xl font-semibold mb-2">
          {{ t('form.formNotFound') }}
        </h1>
        <p class="text-(--ui-text-muted) mb-6">
          {{ t('form.formNotFoundDescription') }}
        </p>
        <UButton
          v-if="!isEmbed"
          :to="homePath"
          variant="soft"
          icon="i-lucide-arrow-left"
        >
          {{ t('common.backToHome') }}
        </UButton>
      </div>

      <!-- Application confirmation -->
      <div
        v-else-if="applicationResult"
        class="max-w-lg mx-auto px-4 py-2 sm:px-8 print:max-w-none print:p-0"
      >
        <UCard>
          <div class="text-center">
            <PendingSubmissionNotice
              v-if="emailConfirmationRequired"
              heading="h1"
              :reference-number="applicationResult.referenceNumber"
              :recipient-email="applicationResult.confirmation?.recipientEmail"
              class="mb-2"
            />
            <div
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              <template v-if="!emailConfirmationRequired">
                <div class="w-16 h-16 mx-auto mb-4 rounded-full bg-(--ui-color-primary-50) dark:bg-(--ui-color-primary-950) flex items-center justify-center print:hidden">
                  <UIcon
                    name="i-lucide-check-circle"
                    class="text-3xl text-(--ui-primary)"
                  />
                </div>

                <h1
                  ref="successHeading"
                  tabindex="-1"
                  class="-ms-2.5 mb-2 border-s-2 border-transparent ps-2 text-xl font-semibold outline-none focus-visible:border-primary"
                >
                  {{ t('form.successTitle') }}
                </h1>

                <p class="text-(--ui-text-muted) mb-6 [overflow-wrap:anywhere]">
                  {{ t('form.successDescription') }}
                </p>
              </template>

              <div
                v-if="!applicationResult.receipt"
                class="bg-(--ui-bg-elevated) rounded-lg p-4 mb-3"
              >
                <p class="text-sm text-default mb-1">
                  {{ t('form.referenceNumber') }}
                </p>
                <p class="text-2xl font-bold font-mono tracking-normal sm:tracking-wide break-words [overflow-wrap:anywhere]">
                  {{ applicationResult.referenceNumber }}
                </p>
              </div>
            </div>

            <SubmissionReceipt
              v-if="applicationResult.receipt"
              :receipt="applicationResult.receipt"
              :pending="emailConfirmationRequired"
              class="mb-4"
            />
            <dl
              v-else
              class="mb-4 space-y-1 text-sm text-(--ui-text-muted)"
              data-testid="submission-receipt"
            >
              <div>
                <dt class="inline">
                  {{ t('form.receipt.form') }}:
                </dt>
                <dd class="inline text-(--ui-text) [overflow-wrap:anywhere]">
                  {{ localizedSchemaTitle }}
                </dd>
              </div>
              <div v-if="submittedAtText">
                <dt class="inline">
                  {{ t(emailConfirmationRequired ? 'form.receipt.savedAt' : 'form.receipt.submittedAt') }}:
                </dt>
                <dd class="inline text-(--ui-text)">
                  {{ submittedAtText }}
                </dd>
              </div>
            </dl>

            <div class="mb-6 flex flex-wrap justify-center gap-2 print:hidden">
              <UButton
                color="neutral"
                variant="outline"
                :icon="referenceCopied ? 'i-lucide-check' : 'i-lucide-copy'"
                data-testid="copy-reference"
                @click="copyReference"
              >
                {{ t('form.copyReference') }}
              </UButton>
              <UButton
                v-if="!emailConfirmationRequired && !applicationResult.receipt"
                color="neutral"
                variant="outline"
                icon="i-lucide-printer"
                data-testid="print-receipt"
                @click="printLegacyReceipt"
              >
                {{ t('form.printReceipt') }}
              </UButton>
            </div>
            <p
              class="-mt-4 mb-6 min-h-5 text-sm text-(--ui-text-muted) print:hidden"
              aria-live="polite"
              data-testid="copy-reference-feedback"
            >
              {{ copyFeedback }}
            </p>

            <!-- Status tracking link -->
            <div
              v-if="!emailConfirmationRequired"
              class="mb-6 print:hidden"
            >
              <UButton
                :to="statusUrl"
                variant="soft"
                icon="i-lucide-external-link"
                class="text-default"
              >
                {{ t('form.trackStatus') }}
              </UButton>
              <p class="text-xs text-(--ui-text-muted) mt-1">
                {{ t('form.trackStatusHint') }}
              </p>
            </div>

            <p
              v-if="!applicationResult.receipt"
              class="text-sm text-(--ui-text-muted)"
            >
              {{ t(emailConfirmationRequired ? 'form.emailConfirmationReferenceHint' : 'form.noteReferenceNumber') }}
            </p>

            <PublicContentPlacement
              v-if="!emailConfirmationRequired"
              class="mt-6 text-left"
              :title="t('form.publicSuccessContentTitle')"
              :description="t('form.publicSuccessContentDescription')"
              icon="i-lucide-clipboard-check"
              :sections="successSections"
              :documents="successDocuments"
              :loading="publicContentLoading"
              :error="successContentError"
            />

            <!-- Back to home (not in embed mode) -->
            <UButton
              v-if="!isEmbed"
              :to="homePath"
              color="neutral"
              variant="soft"
              icon="i-lucide-arrow-left"
              class="mt-6 print:hidden"
            >
              {{ t('common.backToHome') }}
            </UButton>
          </div>
        </UCard>
      </div>

      <!-- Form -->
      <div v-else>
        <header class="mx-auto max-w-6xl px-4 pt-8 sm:px-6 lg:px-8">
          <h1 class="text-3xl font-semibold tracking-tight text-(--ui-text-highlighted)">
            {{ localizedSchemaTitle }}
          </h1>
          <p
            v-if="localizedSchemaDescription"
            class="mt-3 max-w-2xl text-sm leading-relaxed text-(--ui-text-muted)"
          >
            {{ localizedSchemaDescription }}
          </p>
          <p
            v-if="formLengthText"
            class="mt-2 max-w-2xl text-sm text-(--ui-text-muted)"
            data-testid="form-length"
          >
            {{ formLengthText }}
          </p>
        </header>

        <div
          v-if="staffSessionActive"
          class="mx-auto max-w-6xl px-4 pt-6 sm:px-6 lg:px-8"
        >
          <UAlert
            color="info"
            icon="i-lucide-info"
            :title="t('form.identityStaffSession')"
            class="w-full"
          />
        </div>

        <!-- Form Renderer; a field with an error is checked again when the person leaves it -->
        <div
          class="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8"
          :class="hasSidebarContent ? 'grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start' : ''"
          @focusout="revalidateOnLeave"
        >
          <FormRenderer
            v-model="formData"
            :schema="schema"
            :schema-id="schemaId"
            :field-errors="fieldErrors"
            :file-uploads-enabled="!submitBlockedByAuth"
            :jurisdiction-slug="formWorkspace.jurisdictionSlug"
            :attachment-analysis-disclosures="attachmentAnalysisDisclosures"
            :native-validation="false"
            localized-currency-input
            :field-anchor-prefix="FORM_FIELD_ANCHOR_PREFIX"
            hide-submit
            hide-title
            full-width
            flat-sections
            show-required-legend
            @attachment-upload-active="attachmentUploadActive = $event"
            @submit="submitForm"
          >
            <template #before-fields>
              <PublicContentPlacement
                class="mb-6"
                :title="t('form.publicIntroContentTitle')"
                :description="t('form.publicIntroContentDescription')"
                icon="i-lucide-info"
                icon-class="text-(--ui-text-muted)"
                :sections="introSections"
                :loading="publicContentLoading"
                :error="introContentError"
              />

              <PublicContentPlacement
                v-if="introDocuments.length"
                class="mb-6 lg:hidden"
                :documents="introDocuments"
                inline-documents
              />

              <UAccordion
                v-if="hasMobileSidebarContent"
                class="mb-6 lg:hidden"
                :items="[{ label: t('form.publicSidebarDisclosureLabel') }]"
              >
                <template #body>
                  <PublicContentPlacement
                    :title="t('form.publicSidebarContentTitle')"
                    :sections="sidebarSections"
                    :documents="sidebarDocuments"
                    compact
                  />
                </template>
              </UAccordion>

              <SubmissionIdentity
                v-if="identityRequirements.show"
                :id="SUBMISSION_IDENTITY_ANCHOR_ID"
                v-model:identity="identityData"
                :requirements="identityRequirements"
                :errors="identityErrors"
                :workspace="formWorkspace"
                :before-external-login="confirmExternalLogin"
                hide-staff-notice
                class="mb-6"
                @staff-session-change="staffSessionActive = $event"
              />
            </template>

            <template #actions>
              <div class="mt-8 border-t border-(--ui-border) pt-6">
                <!-- Error summary: every missing entry, linked to its field -->
                <div
                  v-if="validationSummary.length"
                  ref="errorSummaryRef"
                  role="group"
                  tabindex="-1"
                  class="mb-4 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-error"
                  aria-labelledby="form-error-summary-title"
                  data-testid="form-error-summary"
                >
                  <UAlert
                    color="error"
                    icon="i-lucide-circle-x"
                  >
                    <template #title>
                      <h2
                        id="form-error-summary-title"
                        class="text-sm font-semibold"
                      >
                        {{ t('form.errorSummary.title', { count: validationSummary.length }, validationSummary.length) }}
                      </h2>
                    </template>
                    <template #description>
                      <ul class="mt-2 list-disc space-y-1 ps-5">
                        <li
                          v-for="item in validationSummary"
                          :key="item.key"
                        >
                          <ULink
                            :to="`#${item.targetId}`"
                            class="text-error underline underline-offset-2"
                            @click="jumpToError($event, item.targetId)"
                          >
                            {{ item.message }}
                          </ULink>
                        </li>
                      </ul>
                    </template>
                  </UAlert>
                </div>

                <!-- Other submit errors -->
                <UAlert
                  v-else-if="submitError"
                  role="alert"
                  color="error"
                  icon="i-lucide-circle-x"
                  :title="submitError"
                  :close="true"
                  class="mb-4"
                  @update:open="submitError = null"
                />

                <div
                  v-if="submitBlockedByAuth"
                  class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <UAlert
                    role="status"
                    color="warning"
                    icon="i-lucide-triangle-alert"
                    :title="t('form.identityLoginRequired')"
                    class="min-w-0 flex-1"
                  />
                  <UButton
                    v-if="identityRequirements.show"
                    to="#submission-identity"
                    color="neutral"
                    variant="soft"
                    icon="i-lucide-shield-check"
                  >
                    {{ t('form.identityGoToLogin') }}
                  </UButton>
                </div>

                <!-- Required acknowledgement of the privacy notice -->
                <UFormField
                  :id="PRIVACY_CONSENT_ANCHOR_ID"
                  :error="privacyConsentError ?? undefined"
                  class="mb-5"
                >
                  <UCheckbox
                    v-model="privacyConsent"
                    name="privacyConsent"
                    required
                  >
                    <template #label>
                      <span class="text-sm text-(--ui-text-muted) leading-relaxed">
                        {{ t('form.privacyConsent') }}
                        <NuxtLink
                          :to="privacyPath"
                          target="_blank"
                          class="text-default underline hover:text-highlighted"
                          @click.stop
                        >{{ t('form.privacyPolicy') }}</NuxtLink>{{ t('form.privacyConsentSuffix') }}
                      </span>
                    </template>
                  </UCheckbox>
                </UFormField>

                <ProfileConsent
                  v-model:consent="profileConsent"
                  v-model:bank-consent="bankConsent"
                  :contact-text="profileConsentText"
                  :bank-text="bankConsentText"
                  :workspace="formWorkspace"
                  class="mb-5"
                />

                <DeliveryRouteChoice
                  v-model:route="deliveryRoute"
                  :routes="deliveryRoutes"
                  :visible="deliveryChoiceVisible"
                  :disabled="isSubmitting"
                  class="mb-5"
                />

                <p
                  v-if="emailConfirmationExpected && !submitBlockedByAuth"
                  class="mb-3 text-sm text-(--ui-text-muted)"
                  data-testid="email-confirmation-ahead"
                >
                  {{ t('form.emailConfirmationAhead') }}
                </p>

                <UButton
                  type="submit"
                  size="lg"
                  icon="i-lucide-send"
                  :loading="isSubmitting"
                  :disabled="isSubmitting || submitBlockedByAuth || attachmentUploadActive"
                >
                  {{ isSubmitting ? t('form.submitting') : t('form.submitApplication') }}
                </UButton>
              </div>
            </template>
          </FormRenderer>

          <aside
            v-if="hasSidebarContent"
            class="hidden space-y-4 pb-6 lg:sticky lg:top-20 lg:block lg:pt-6"
          >
            <PublicContentPlacement
              v-if="introDocuments.length"
              :title="introSections.length ? t('form.publicDocumentsTitle') : t('form.publicIntroContentTitle')"
              :description="introSections.length ? undefined : t('form.publicIntroContentDescription')"
              icon="i-lucide-info"
              icon-class="text-(--ui-text-muted)"
              :documents="introDocuments"
              compact
            />
            <PublicContentPlacement
              v-if="sidebarSections.length || sidebarDocuments.length"
              :title="t('form.publicSidebarContentTitle')"
              :description="t('form.publicSidebarContentDescription')"
              icon="i-lucide-panel-right"
              :sections="sidebarSections"
              :documents="sidebarDocuments"
              :loading="publicContentLoading"
              :error="sidebarContentError"
              compact
            />
          </aside>
        </div>
      </div>
    </div>

    <UModal
      v-model:open="leaveDialogOpen"
      :title="t(`form.leaveDialog.${leaveDialogKind}Title`)"
      :description="t(`form.leaveDialog.${leaveDialogKind}Description`)"
      :ui="{ header: 'items-start', wrapper: 'min-w-0 flex-1', close: 'static shrink-0', footer: 'justify-end' }"
    >
      <template #footer>
        <UButton
          color="neutral"
          variant="ghost"
          data-testid="leave-dialog-stay"
          @click="answerLeave(false)"
        >
          {{ t('form.leaveDialog.stay') }}
        </UButton>
        <UButton
          data-testid="leave-dialog-leave"
          @click="answerLeave(true)"
        >
          {{ t(`form.leaveDialog.${leaveDialogKind}`) }}
        </UButton>
      </template>
    </UModal>
  </CitizenPage>
</template>

<style scoped>
.public-form-main :deep([data-slot="placeholder"].text-dimmed) {
  color: var(--ui-text-muted);
}
</style>

<style scoped>
.embed-mode {
  /* In embed mode: remove any extra padding, ensure clean edges */
  padding-top: 0;
}
</style>
