<script setup lang="ts">
/**
 * General Settings Page (P4.4 Config-as-Content)
 *
 * Loads the `general` config section for the current jurisdiction workspace
 * from the Drupal-backed proxy and persists the edited subset via PATCH.
 *
 * Field mapping (form -> section):
 *   orgName        -> platformName
 *   contactEmail   -> contactEmail
 *   website        -> website
 *   phone          -> phone
 *   emailFooter    -> emailFooter
 *   legalNotice    -> legalNotice
 *   privacyPolicy  -> privacyPolicy
 *
 * The `referencePrefix` field is ORG-level (field_reference_prefix) and NOT
 * part of this jurisdiction endpoint. It is rendered disabled with a hint and
 * never persisted here.
 */
import { staffFetch } from '~~/casework-layer/app/composables/api/useStaffSessionFetch';
import { SETTINGS_SECTION_REFUSAL_CODES, useSettingsLoadState } from '~~/casework-layer/app/composables/useSettingsLoadState';
import SettingsLoadNotice from '~~/casework-layer/app/components/admin/SettingsLoadNotice.vue';
import { staffOutlet } from '~~/casework-layer/app/utils/staff-extensions';
import AppCard from '~/components/app/Card.vue';

definePageMeta({
    layout: 'dashboard',
    middleware: 'admin'
});

const { t } = useI18n();
const { workspaceRoute, selectedWorkspaceSlug, currentWorkspace, loadWorkspaces } = useWorkspaceContext();

// The applicant profile switch belongs to the municipality; organisation
// workspaces never see it (Drupal also refuses non jurisdiction admins).
const showApplicantProfileCard = computed(() =>
    Boolean(currentWorkspace.value) && currentWorkspace.value?.type !== 'organisation'
);

useHead({
    title: computed(() => `${t('admin.settings.general.label')} - ${t('common.settings')} - beantragt.ai`)
});

const toast = useToast();

interface GeneralSectionData {
    platformName?: string
    contactEmail?: string
    website?: string
    phone?: string
    emailFooter?: string
    legalNotice?: string
    privacyPolicy?: string
}

// Backend PATCH is a MERGE patch: keys absent from the body are never nulled
// (the server guards each field with array_key_exists).

// Form state. orgName maps to platformName.
const form = reactive({
    orgName: '',
    contactEmail: '',
    referencePrefix: '',
    website: '',
    phone: '',
    emailFooter: '',
    legalNotice: '',
    privacyPolicy: ''
});

// Snapshot for dirty detection. referencePrefix is org-level and read-only on
// this page, so it is excluded to avoid a false-dirty footgun.
const savedSnapshot = ref('');

function editableSnapshot() {
    const { referencePrefix: _ignored, ...editable } = form;
    return JSON.stringify(editable);
}

function takeSnapshot() {
    savedSnapshot.value = editableSnapshot();
}

const isDirty = computed(() => {
    if (!savedSnapshot.value) return false;
    return editableSnapshot() !== savedSnapshot.value;
});
// The applicant profile card saves on its own but shares the leave guard.
const applicantProfileDirty = ref(false);
const hasUnsavedChanges = computed(() => isDirty.value || applicantProfileDirty.value);

const isLoading = ref(true);
const loadError = ref<string | null>(null);
// A refused load (municipality setting, organisation admin) shows its reason
// without retry and without the form.
const {
    refusal: loadRefusal,
    retryable: loadRetryable,
    begin: beginLoad,
    succeed: loadSucceeded,
    fail: loadFailed,
    failLocally: loadFailedLocally
} = useSettingsLoadState({ refusalCodes: SETTINGS_SECTION_REFUSAL_CODES });

// Inline validation/field errors keyed by the form field. Backend contract
// field keys are mapped onto these via FIELD_BY_CONTRACT_KEY.
type FieldKey = 'orgName' | 'contactEmail' | 'website' | 'phone' | 'emailFooter' | 'legalNotice' | 'privacyPolicy';
const errors = reactive<Record<FieldKey, string | undefined>>({
    orgName: undefined,
    contactEmail: undefined,
    website: undefined,
    phone: undefined,
    emailFooter: undefined,
    legalNotice: undefined,
    privacyPolicy: undefined
});

const FIELD_BY_CONTRACT_KEY: Record<string, FieldKey> = {
    platformName: 'orgName',
    contactEmail: 'contactEmail',
    website: 'website',
    phone: 'phone',
    emailFooter: 'emailFooter',
    legalNotice: 'legalNotice',
    privacyPolicy: 'privacyPolicy'
};

// Stable DOM ids let a server field-error move focus to the offending input
// without depending on Nuxt UI component-ref internals.
const FIELD_IDS: Record<FieldKey, string> = {
    orgName: 'settings-general-orgName',
    contactEmail: 'settings-general-contactEmail',
    website: 'settings-general-website',
    phone: 'settings-general-phone',
    emailFooter: 'settings-general-emailFooter',
    legalNotice: 'settings-general-legalNotice',
    privacyPolicy: 'settings-general-privacyPolicy'
};

function focusField(field: FieldKey) {
    nextTick(() => {
        if (!import.meta.client) return;
        document.getElementById(FIELD_IDS[field])?.focus();
    });
}

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

watch(() => form.orgName, () => {
    errors.orgName = undefined;
});
watch(() => form.contactEmail, () => {
    errors.contactEmail = undefined;
});
watch(() => form.website, () => {
    errors.website = undefined;
});
watch(() => form.phone, () => {
    errors.phone = undefined;
});
watch(() => form.emailFooter, () => {
    errors.emailFooter = undefined;
});
watch(() => form.legalNotice, () => {
    errors.legalNotice = undefined;
});
watch(() => form.privacyPolicy, () => {
    errors.privacyPolicy = undefined;
});

const isSaving = ref(false);

useUnsavedChangesGuard(hasUnsavedChanges);

function applySection(data: GeneralSectionData) {
    form.orgName = typeof data.platformName === 'string' ? data.platformName : '';
    form.contactEmail = typeof data.contactEmail === 'string' ? data.contactEmail : '';
    form.website = typeof data.website === 'string' ? data.website : '';
    form.phone = typeof data.phone === 'string' ? data.phone : '';
    form.emailFooter = typeof data.emailFooter === 'string' ? data.emailFooter : '';
    form.legalNotice = typeof data.legalNotice === 'string' ? data.legalNotice : '';
    form.privacyPolicy = typeof data.privacyPolicy === 'string' ? data.privacyPolicy : '';
}

async function loadSettings() {
    isLoading.value = true;
    loadError.value = null;
    beginLoad();

    // Settings apply to the jurisdiction (not the org segment of the workspace).
    if (!selectedWorkspaceSlug.value) {
        await loadWorkspaces();
    }
    const slug = selectedWorkspaceSlug.value;
    if (!slug) {
        loadError.value = t('admin.settings.selectWorkspace');
        loadFailedLocally();
        isLoading.value = false;
        return;
    }

    try {
        const response = await staffFetch<{ section: string, data: GeneralSectionData }>(
            `/api/admin/jurisdictions/${slug}/settings/general`
        );
        applySection(response.data || {});
        takeSnapshot();
        loadSucceeded();
    } catch (e: unknown) {
        if (loadFailed(e) === 'technical') {
            loadError.value = t('admin.settings.general.loadError');
        }
    } finally {
        isLoading.value = false;
    }
}

/** Map a backend field error onto the inline field, focus it. Returns true if mapped. */
function applyFieldError(field: string | null, detail: string | null): boolean {
    if (!field) return false;
    const formField = FIELD_BY_CONTRACT_KEY[field];
    if (!formField) return false;
    errors[formField] = detail || t('admin.settings.general.saveError');
    focusField(formField);
    return true;
}

async function handleSave() {
    errors.orgName = undefined;
    errors.contactEmail = undefined;
    errors.website = undefined;
    errors.phone = undefined;
    errors.emailFooter = undefined;
    errors.legalNotice = undefined;
    errors.privacyPolicy = undefined;

    let hasError = false;

    if (!form.orgName.trim()) {
        errors.orgName = t('admin.settings.general.validation.orgNameRequired');
        hasError = true;
    }

    if (!form.contactEmail.trim()) {
        errors.contactEmail = t('admin.settings.general.validation.emailRequired');
        hasError = true;
    } else if (!emailRegex.test(form.contactEmail.trim())) {
        errors.contactEmail = t('admin.settings.general.validation.emailInvalid');
        hasError = true;
    }

    if (hasError) return;

    const slug = selectedWorkspaceSlug.value;
    if (!slug) {
        toast.add({
            title: t('admin.settings.selectWorkspace'),
            icon: 'i-lucide-circle-x',
            color: 'error'
        });
        return;
    }

    isSaving.value = true;

    try {
        const response = await staffFetch<{ section: string, data: GeneralSectionData }>(
            `/api/admin/jurisdictions/${slug}/settings/general`,
            {
                method: 'PATCH',
                body: {
                    data: {
                        platformName: form.orgName.trim(),
                        contactEmail: form.contactEmail.trim(),
                        website: form.website.trim(),
                        phone: form.phone.trim(),
                        emailFooter: form.emailFooter.trim(),
                        legalNotice: form.legalNotice.trim(),
                        privacyPolicy: form.privacyPolicy.trim()
                    }
                }
            }
        );
        applySection(response.data || {});
        takeSnapshot();

        toast.add({
            title: t('common.success'),
            description: t('admin.settings.general.saved'),
            color: 'success'
        });
    } catch (e: unknown) {
        const { status, field, detail } = parseSettingsError(e);

        if (status === 401) {
            return;
        }

        // Field-level validation error: surface inline on the offending field.
        if (applyFieldError(field, detail)) return;

        toast.add({
            title: t('admin.settings.general.saveError'),
            description: detail || undefined,
            icon: 'i-lucide-circle-x',
            color: 'error'
        });
    } finally {
        isSaving.value = false;
    }
}

onMounted(() => {
    loadSettings();
});
</script>

<template>
  <AppPageLayout
    :title="t('admin.settings.general.title')"
    :description="t('admin.settings.general.subtitle')"
    :breadcrumbs="[{ label: t('common.settings'), to: workspaceRoute('/admin/settings') }, { label: t('admin.settings.general.label') }]"
  >
    <div class="max-w-3xl space-y-6">
      <!-- Loading state: three fields -->
      <div
        v-if="isLoading"
        class="space-y-4"
        data-testid="settings-general-loading"
      >
        <USkeleton class="h-9 w-full max-w-xl" />
        <USkeleton class="h-9 w-full max-w-xl" />
        <USkeleton class="h-9 w-full max-w-xl" />
      </div>

      <!-- Refused load (reason, no retry) or technical error (retry) -->
      <SettingsLoadNotice
        v-else-if="loadRefusal || loadError"
        :refusal="loadRefusal"
        :error="loadError"
        :retryable="loadRetryable"
        @retry="loadSettings"
      />

      <!-- Form: one card without a heading (it would repeat the page title) -->
      <AppCard
        v-else
        data-testid="settings-general-form"
      >
        <fieldset
          :disabled="isSaving"
          class="space-y-8"
        >
          <div class="space-y-4">
            <UFormField
              :label="t('admin.settings.general.orgName')"
              name="orgName"
              required
              :error="errors.orgName"
            >
              <UInput
                :id="FIELD_IDS.orgName"
                v-model="form.orgName"
                :placeholder="t('admin.settings.general.orgNamePlaceholder')"
                :maxlength="100"
                class="w-full max-w-xl"
              />
            </UFormField>

            <UFormField
              :label="t('admin.settings.general.contactEmail')"
              :description="t('admin.settings.general.contactEmailHint')"
              name="contactEmail"
              required
              :error="errors.contactEmail"
            >
              <UInput
                :id="FIELD_IDS.contactEmail"
                v-model="form.contactEmail"
                type="email"
                placeholder="verwaltung@musterstadt.example.org"
                class="w-full max-w-xl"
              />
            </UFormField>

            <!-- Reference prefix: org-level (field_reference_prefix), set on the tenant page, not here.
                 Drawn like a field without an input. -->
            <div data-testid="settings-general-reference-prefix">
              <p class="block text-sm font-medium text-default">
                {{ t('admin.settings.general.referencePrefix') }}
              </p>
              <p class="mt-1 text-sm text-muted">
                {{ t('admin.settings.general.referencePrefixPerOrganisation') }}
                <ULink
                  :to="workspaceRoute('/admin/settings/tenant')"
                  class="inline-flex min-h-6 items-center font-medium text-default underline underline-offset-2"
                >
                  {{ t('admin.settings.general.openTenantSettings') }}
                </ULink>
              </p>
            </div>
          </div>

          <section
            class="space-y-4"
            aria-labelledby="settings-general-contact"
          >
            <h3
              id="settings-general-contact"
              class="text-sm font-semibold text-highlighted"
            >
              {{ t('admin.settings.general.contactSection') }}
            </h3>
            <!-- Inside max-w-xl: all single line fields end on one right edge. -->
            <div class="grid max-w-xl gap-4 sm:grid-cols-2">
              <UFormField
                :label="t('admin.settings.general.website')"
                name="website"
                :error="errors.website"
              >
                <UInput
                  :id="FIELD_IDS.website"
                  v-model="form.website"
                  type="url"
                  placeholder="https://www.musterstadt.example"
                  class="w-full"
                />
              </UFormField>

              <UFormField
                :label="t('admin.settings.general.phone')"
                name="phone"
                :error="errors.phone"
              >
                <UInput
                  :id="FIELD_IDS.phone"
                  v-model="form.phone"
                  type="tel"
                  placeholder="+49 123 456 789"
                  class="w-full"
                />
              </UFormField>
            </div>
          </section>

          <section
            class="space-y-4"
            aria-labelledby="settings-general-legal"
          >
            <h3
              id="settings-general-legal"
              class="text-sm font-semibold text-highlighted"
            >
              {{ t('admin.settings.general.legalSection') }}
            </h3>
            <UFormField
              :label="t('admin.settings.general.emailFooter')"
              :description="t('admin.settings.general.emailFooterHint')"
              name="emailFooter"
              :error="errors.emailFooter"
            >
              <UTextarea
                :id="FIELD_IDS.emailFooter"
                v-model="form.emailFooter"
                :rows="3"
                :maxlength="2000"
                class="w-full"
              />
            </UFormField>

            <UFormField
              :label="t('admin.settings.general.legalNotice')"
              :description="t('admin.settings.general.legalNoticeHint')"
              name="legalNotice"
              :error="errors.legalNotice"
            >
              <UTextarea
                :id="FIELD_IDS.legalNotice"
                v-model="form.legalNotice"
                :rows="6"
                class="w-full font-mono text-sm"
              />
            </UFormField>

            <UFormField
              :label="t('admin.settings.general.privacyPolicy')"
              :description="t('admin.settings.general.privacyPolicyHint')"
              name="privacyPolicy"
              :error="errors.privacyPolicy"
            >
              <UTextarea
                :id="FIELD_IDS.privacyPolicy"
                v-model="form.privacyPolicy"
                :rows="6"
                class="w-full font-mono text-sm"
              />
            </UFormField>
          </section>
        </fieldset>

        <template #footer>
          <UButton
            :loading="isSaving"
            :disabled="!isDirty"
            data-testid="settings-general-save"
            @click="handleSave"
          >
            {{ t('common.save') }}
          </UButton>
        </template>
      </AppCard>

      <template v-if="showApplicantProfileCard && !loadRefusal">
        <component
          :is="component"
          v-for="component in staffOutlet('general-applicant-profile')"
          :key="component.name"
          :jurisdiction-slug="selectedWorkspaceSlug"
          @update:dirty="applicantProfileDirty = $event"
        />
      </template>
    </div>
  </AppPageLayout>
</template>
