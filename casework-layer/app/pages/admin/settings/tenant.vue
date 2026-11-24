<script setup lang="ts">
import { EDIT_ICON } from '~/utils/action-icons';
import { useAdminTenantSettings } from '~~/casework-layer/app/composables/useAdminTenantSettings';
import AccessReason from '~~/casework-layer/app/components/AccessReason.vue';
import WorkspaceInviteForm from '~~/casework-layer/app/components/admin/WorkspaceInviteForm.vue';
import AppCard from '~/components/app/Card.vue';
import { renderReferencePatternPreview } from '~~/casework-layer/app/utils/reference-pattern';

definePageMeta({
    layout: 'dashboard',
    middleware: 'admin'
});

const { t } = useI18n();
const { user } = useAuth();
/** The organisation form sits in the dialog body, its "Speichern" in the footer. */
const organisationFormId = 'admin-organisation-form';
const archiveCancelId = 'admin-organisation-archive-cancel';
/** Archiving asks first: the dialog opens on "Abbrechen", not on the close button of its header. */
function focusArchiveCancel(event: Event) {
    event.preventDefault();
    void nextTick(() => document.getElementById(archiveCancelId)?.focus());
}

useHead({
    title: computed(() => `${t('admin.settings.tenant.label')} - ${t('common.settings')} - beantragt.ai`)
});

const {
    FIELD_IDS,
    ORGANISATION_FIELD_IDS,
    form,
    errors,
    organisationForm,
    organisationErrors,
    workspaceDetails,
    isLoading,
    isSaving,
    loadError,
    organisations,
    isOrganisationsLoading,
    isOrganisationSaving,
    organisationLoadError,
    organisationStructureForbidden,
    isOrganisationModalOpen,
    organisationMode,
    archiveTarget,
    isArchiveModalOpen,
    isOrganisationWorkspace,
    isDirty,
    organisationParentItems,
    workspaceRoute,
    loadSettings,
    loadOrganisationStructure,
    handleSave,
    openCreateOrganisation,
    openEditOrganisation,
    closeOrganisationModal,
    saveOrganisation,
    openArchiveOrganisation,
    closeArchiveModal,
    archiveOrganisation
} = useAdminTenantSettings();

const inviteWorkspace = computed(() => {
    const workspace = workspaceDetails.value;
    if (!user.value?.roles.includes('workspace_inviter') || !workspace) return null;
    const parentId = workspace.jurisdictionInternalId ?? (workspace.type === 'jurisdiction' ? workspace.internalId : null);
    if (!parentId || (workspace.type === 'organisation' && !(workspace.organisationInternalId ?? workspace.internalId))) return null;
    return workspace;
});

// "Ergibt zum Beispiel MS-BB-2026-00001.": the current prefix and pattern as a sample.
const referenceExample = computed(() => form.referencePattern?.trim()
    ? renderReferencePatternPreview(form.referencePattern, { orgPrefix: form.referencePrefix || undefined, sequence: 1 })
    : '');
const parentLabel = computed(() => workspaceDetails.value?.parentOrganisation?.label
  || workspaceDetails.value?.parentJurisdiction?.label
  || workspaceDetails.value?.parentLabel
  || t('admin.settings.tenant.noParent'));
</script>

<template>
  <AppPageLayout
    :title="t('admin.settings.tenant.title')"
    :description="t('admin.settings.tenant.subtitle')"
    :breadcrumbs="[{ label: t('common.settings'), to: workspaceRoute('/admin/settings') }, { label: t('admin.settings.tenant.label') }]"
  >
    <div class="max-w-3xl space-y-6">
      <div
        v-if="isLoading"
        class="space-y-4"
      >
        <USkeleton class="h-9 w-full max-w-xl" />
        <USkeleton class="h-9 w-full max-w-xl" />
        <USkeleton class="h-9 w-full max-w-xl" />
      </div>

      <UAlert
        v-else-if="loadError"
        icon="i-lucide-circle-x"
        color="error"
        :title="loadError"
        :actions="[{ label: t('common.retry'), color: 'neutral', variant: 'outline', onClick: loadSettings }]"
      />

      <!-- Form card first: this workspace -->
      <AppCard
        v-else
        :title="t('admin.settings.tenant.workspaceTitle')"
        data-testid="tenant-workspace-card"
      >
        <fieldset
          :disabled="isSaving"
          class="space-y-8"
        >
          <!-- Name and Kurzname one under the other: only the second has a sentence -->
          <div class="space-y-4">
            <div class="space-y-4">
              <UFormField
                :label="t('admin.settings.tenant.labelField')"
                name="label"
                required
                :error="errors.label"
              >
                <UInput
                  :id="FIELD_IDS.label"
                  v-model="form.label"
                  :maxlength="255"
                  class="w-full max-w-xl"
                />
              </UFormField>

              <UFormField
                :label="t('admin.settings.tenant.slugField')"
                :description="t('admin.settings.tenant.slugHint')"
                name="slug"
                required
                :error="errors.slug"
              >
                <UInput
                  :id="FIELD_IDS.slug"
                  v-model="form.slug"
                  :maxlength="127"
                  class="w-full max-w-xl font-mono"
                />
              </UFormField>
            </div>

            <!-- Facts among fields are drawn like fields without an input: label in the
                 field label style, the value as one line under it -->
            <dl
              class="space-y-4"
              data-testid="tenant-workspace-facts"
            >
              <div>
                <dt class="block text-sm font-medium text-default">
                  {{ t('admin.settings.tenant.publicPath') }}
                </dt>
                <dd class="mt-1 break-all font-mono text-sm text-muted">
                  {{ workspaceDetails?.path }}
                </dd>
              </div>
              <div>
                <dt class="block text-sm font-medium text-default">
                  {{ t('admin.settings.tenant.belongsTo') }}
                </dt>
                <dd class="mt-1 text-sm text-muted">
                  {{ parentLabel }}
                </dd>
              </div>
            </dl>
          </div>

          <section
            v-if="isOrganisationWorkspace"
            class="space-y-4"
            aria-labelledby="tenant-organisation-metadata"
          >
            <h3
              id="tenant-organisation-metadata"
              class="text-sm font-semibold text-highlighted"
            >
              {{ t('admin.settings.tenant.organisationMetadata') }}
            </h3>

            <UFormField
              :label="t('admin.settings.tenant.orgEmail')"
              name="orgEmail"
              :error="errors.orgEmail"
            >
              <UInput
                :id="FIELD_IDS.orgEmail"
                v-model="form.orgEmail"
                type="email"
                placeholder="amt@musterstadt.example.org"
                class="w-full max-w-xl"
              />
            </UFormField>

            <!-- Präfix and Muster one under the other: only the second has a sentence -->
            <div class="space-y-4">
              <UFormField
                :label="t('admin.settings.tenant.referencePrefix')"
                name="referencePrefix"
                :error="errors.referencePrefix"
              >
                <UInput
                  :id="FIELD_IDS.referencePrefix"
                  v-model="form.referencePrefix"
                  :maxlength="32"
                  class="w-40 font-mono uppercase"
                />
              </UFormField>

              <UFormField
                :label="t('admin.settings.tenant.referencePattern')"
                :description="referenceExample ? t('admin.settings.tenant.referencePatternExample', { example: referenceExample }) : undefined"
                name="referencePattern"
                :error="errors.referencePattern"
              >
                <UInput
                  :id="FIELD_IDS.referencePattern"
                  v-model="form.referencePattern"
                  :maxlength="128"
                  placeholder="{ORG}-{YEAR}-{SEQ:5}"
                  class="w-full max-w-xl font-mono"
                />
              </UFormField>
            </div>
          </section>

          <!-- Standing information, not an alert -->
          <p
            v-else
            class="max-w-prose text-sm text-muted"
            data-testid="tenant-jurisdiction-note"
          >
            {{ t('admin.settings.tenant.jurisdictionOnlyDescription') }}
          </p>
        </fieldset>

        <template #footer>
          <UButton
            :loading="isSaving"
            :disabled="!isDirty"
            data-testid="tenant-save"
            @click="handleSave"
          >
            {{ t('common.save') }}
          </UButton>
          <UButton
            variant="ghost"
            color="neutral"
            :to="workspaceRoute('/admin/settings')"
          >
            {{ t('common.cancel') }}
          </UButton>
        </template>
      </AppCard>

      <WorkspaceInviteForm
        v-if="!isLoading && !loadError && inviteWorkspace"
        :key="inviteWorkspace.key"
        :workspace="inviteWorkspace"
      />

      <AppCard
        v-if="!isLoading && !loadError"
        :title="t('admin.settings.tenant.organisationsTitle')"
        :count="organisations.length"
        data-testid="tenant-organisations-card"
      >
        <template
          v-if="!organisationStructureForbidden"
          #actions
        >
          <UButton
            icon="i-lucide-plus"
            :disabled="isOrganisationsLoading"
            @click="openCreateOrganisation"
          >
            {{ t('admin.settings.tenant.newOrganisation') }}
          </UButton>
        </template>

        <div
          v-if="isOrganisationsLoading"
          class="space-y-2"
        >
          <USkeleton
            v-for="index in 3"
            :key="index"
            class="h-10 w-full"
          />
        </div>

        <AccessReason
          v-else-if="organisationStructureForbidden"
          id="tenant-structure-forbidden"
          :text="t('admin.settings.tenant.structureForbiddenDescription')"
        />

        <UAlert
          v-else-if="organisationLoadError"
          icon="i-lucide-circle-x"
          color="error"
          :title="organisationLoadError"
          :actions="[{ label: t('common.retry'), color: 'neutral', variant: 'outline', onClick: loadOrganisationStructure }]"
        />

        <ul
          v-else-if="organisations.length"
          class="divide-y divide-default"
        >
          <li
            v-for="organisation in organisations"
            :key="organisation.id"
            class="flex items-start gap-3 py-3 first:pt-0 last:pb-0"
            data-testid="tenant-organisation-row"
          >
            <div class="min-w-0 flex-1">
              <p class="break-words text-sm font-semibold text-highlighted">
                {{ organisation.label }}
              </p>
              <p class="break-all font-mono text-sm text-muted">
                {{ organisation.path }}
              </p>
              <!-- Said only when the organisation is not directly under the municipality -->
              <p
                v-if="organisation.parentOrganisation?.label"
                class="text-sm text-muted"
                data-testid="tenant-organisation-parent"
              >
                {{ t('admin.settings.tenant.parent') }}: {{ organisation.parentOrganisation.label }}
              </p>
            </div>
            <div class="flex shrink-0 items-center gap-1">
              <UTooltip :text="t('admin.settings.tenant.editOrganisationAria', { name: organisation.label })">
                <UButton
                  :icon="EDIT_ICON"
                  color="neutral"
                  variant="ghost"
                  :aria-label="t('admin.settings.tenant.editOrganisationAria', { name: organisation.label })"
                  :disabled="isOrganisationSaving"
                  data-testid="tenant-organisation-edit"
                  @click="openEditOrganisation(organisation)"
                />
              </UTooltip>
              <UTooltip :text="t('admin.settings.tenant.archiveOrganisationAria', { name: organisation.label })">
                <UButton
                  icon="i-lucide-archive"
                  color="neutral"
                  variant="ghost"
                  :aria-label="t('admin.settings.tenant.archiveOrganisationAria', { name: organisation.label })"
                  :disabled="isOrganisationSaving"
                  data-testid="tenant-organisation-archive"
                  @click="openArchiveOrganisation(organisation)"
                />
              </UTooltip>
            </div>
          </li>
        </ul>

        <p
          v-else
          class="text-sm text-muted"
        >
          {{ t('admin.settings.tenant.emptyOrganisationsDescription') }}
        </p>
      </AppCard>
    </div>

    <UModal
      :open="isOrganisationModalOpen"
      :title="organisationMode === 'create' ? t('admin.settings.tenant.createOrganisationTitle') : t('admin.settings.tenant.editOrganisationTitle')"
      :description="t('admin.settings.tenant.organisationModalDescription')"
      :ui="{ content: 'sm:max-w-2xl' }"
      @update:open="(val: boolean) => !val && closeOrganisationModal()"
    >
      <template #body>
        <form
          :id="organisationFormId"
          class="space-y-5"
          @submit.prevent="saveOrganisation"
        >
          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField
              :label="t('admin.settings.tenant.labelField')"
              name="organisationLabel"
              required
              :error="organisationErrors.label"
            >
              <UInput
                :id="ORGANISATION_FIELD_IDS.label"
                v-model="organisationForm.label"
                :maxlength="255"
                autofocus
                class="w-full"
              />
            </UFormField>

            <UFormField
              :label="t('admin.settings.tenant.slugField')"
              name="organisationSlug"
              required
              :error="organisationErrors.slug"
            >
              <UInput
                :id="ORGANISATION_FIELD_IDS.slug"
                v-model="organisationForm.slug"
                :maxlength="127"
                class="w-full font-mono"
              />
            </UFormField>
          </div>

          <UFormField
            :label="t('admin.settings.tenant.parentOrganisation')"
            name="parentOrganisationId"
            :error="organisationErrors.parentOrganisationId"
          >
            <USelect
              :id="ORGANISATION_FIELD_IDS.parentOrganisationId"
              v-model="organisationForm.parentOrganisationId"
              :items="organisationParentItems"
              value-key="value"
              class="w-full"
            />
          </UFormField>

          <UFormField
            :label="t('admin.settings.tenant.orgEmail')"
            name="organisationEmail"
            :error="organisationErrors.orgEmail"
          >
            <UInput
              :id="ORGANISATION_FIELD_IDS.orgEmail"
              v-model="organisationForm.orgEmail"
              type="email"
              placeholder="amt@musterstadt.example.org"
              class="w-full"
            />
          </UFormField>

          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField
              :label="t('admin.settings.tenant.referencePrefix')"
              name="organisationReferencePrefix"
              :error="organisationErrors.referencePrefix"
            >
              <UInput
                :id="ORGANISATION_FIELD_IDS.referencePrefix"
                v-model="organisationForm.referencePrefix"
                :maxlength="32"
                class="w-full font-mono uppercase"
              />
            </UFormField>

            <UFormField
              :label="t('admin.settings.tenant.referencePattern')"
              name="organisationReferencePattern"
              :error="organisationErrors.referencePattern"
            >
              <UInput
                :id="ORGANISATION_FIELD_IDS.referencePattern"
                v-model="organisationForm.referencePattern"
                :maxlength="128"
                placeholder="{ORG}-{YEAR}-{SEQ:5}"
                class="w-full font-mono"
              />
            </UFormField>
          </div>
        </form>
      </template>

      <template #footer>
        <div class="flex w-full justify-end gap-3">
          <UButton
            type="button"
            color="neutral"
            variant="ghost"
            :disabled="isOrganisationSaving"
            @click="closeOrganisationModal()"
          >
            {{ t('common.cancel') }}
          </UButton>
          <!-- Outside the form element, tied to it by `form`, so Enter in a field still saves. -->
          <UButton
            type="submit"
            :form="organisationFormId"
            :loading="isOrganisationSaving"
          >
            {{ t('common.save') }}
          </UButton>
        </div>
      </template>
    </UModal>

    <UModal
      :open="isArchiveModalOpen"
      :title="t('admin.settings.tenant.archiveOrganisationTitle')"
      :description="t('admin.settings.tenant.archiveOrganisationDescription', { name: archiveTarget?.label || '' })"
      :ui="{ content: 'sm:max-w-lg' }"
      :content="{ onOpenAutoFocus: focusArchiveCancel }"
      @update:open="(val: boolean) => !val && closeArchiveModal()"
    >
      <template #footer>
        <div class="flex w-full justify-end gap-3">
          <UButton
            :id="archiveCancelId"
            type="button"
            color="neutral"
            variant="ghost"
            :disabled="isOrganisationSaving"
            autofocus
            @click="closeArchiveModal()"
          >
            {{ t('common.cancel') }}
          </UButton>
          <UButton
            type="button"
            color="error"
            icon="i-lucide-archive"
            :loading="isOrganisationSaving"
            @click="archiveOrganisation"
          >
            {{ t('admin.settings.tenant.archiveConfirm') }}
          </UButton>
        </div>
      </template>
    </UModal>
  </AppPageLayout>
</template>
