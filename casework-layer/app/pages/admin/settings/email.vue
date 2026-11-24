<script setup lang="ts">
import { useAdminNotificationMailSettings } from '~~/casework-layer/app/composables/useAdminNotificationMailSettings';
import AccessReason from '~~/casework-layer/app/components/AccessReason.vue';
import AppCard from '~/components/app/Card.vue';

definePageMeta({
    layout: 'dashboard',
    middleware: 'admin'
});

const { t } = useI18n();

useHead({
    title: computed(() => `${t('admin.settings.email.label')} - ${t('common.settings')} - beantragt.ai`)
});

const {
    citizenTemplates,
    staffTemplates,
    isLoading,
    loadError,
    permissionError,
    activeTemplateId,
    activeTemplate,
    activeEditorLanguage,
    activeEditorLanguageLabel,
    editorLanguages,
    activeRequiredTokens,
    activeRequiredTokenItems,
    editSubject,
    editBody,
    fieldErrors,
    isToggling,
    isSaving,
    saveError,
    isTemplateDirty,
    templateVariables,
    hasTranslationOverride,
    workspaceRoute,
    subjectFieldId,
    bodyFieldId,
    selectTemplate,
    selectEditorLanguage,
    canToggleTemplate,
    templateToggleLabel,
    setTemplateEnabled,
    handleSaveTemplate,
    previewSubject,
    previewBody
} = useAdminNotificationMailSettings();

// Both recipient groups render the same rows.
const templateGroups = computed(() => [
    { id: 'citizen', label: t('admin.settings.email.citizenNotifications'), templates: citizenTemplates.value },
    { id: 'staff', label: t('admin.settings.email.staffNotifications'), templates: staffTemplates.value }
]);
// "Verfügbare Platzhalter" is a closed part under the body field.
const variablesOpen = ref(false);
</script>

<template>
  <AppPageLayout
    :title="t('admin.settings.email.title')"
    :description="t('admin.settings.email.subtitle')"
    :breadcrumbs="[{ label: t('common.settings'), to: workspaceRoute('/admin/settings') }, { label: t('admin.settings.email.label') }]"
  >
    <!-- Fallback warning -->
    <UAlert
      v-if="loadError"
      class="mb-6"
      icon="i-lucide-circle-x"
      color="error"
      :title="t('admin.settings.email.loadErrorTitle')"
      :description="loadError"
    />

    <UAlert
      v-if="permissionError"
      role="status"
      class="mb-6"
      icon="i-lucide-triangle-alert"
      color="warning"
      :title="t('admin.settings.email.permissionError')"
      :description="t('admin.settings.email.permissionErrorDescription')"
    />

    <!-- Loading state: rows in row height -->
    <div
      v-if="isLoading"
      class="space-y-2"
      data-testid="email-loading"
    >
      <USkeleton
        v-for="index in 5"
        :key="index"
        class="h-10 w-full"
      />
    </div>

    <div
      v-else-if="!permissionError"
      class="grid grid-cols-1 gap-6 lg:grid-cols-3"
    >
      <!-- Left: the list of templates, one card, rows without outlines -->
      <AppCard
        :title="t('admin.settings.email.templatesTitle')"
        class="lg:col-span-1 lg:self-start"
        data-testid="email-template-list"
      >
        <section
          v-for="group in templateGroups"
          :key="group.id"
          class="space-y-1"
          :aria-labelledby="`email-group-${group.id}`"
        >
          <h3
            :id="`email-group-${group.id}`"
            class="mb-2 text-sm font-semibold text-highlighted"
          >
            {{ group.label }}
          </h3>
          <div
            v-for="template in group.templates"
            :key="template.id"
            class="-mx-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-3 py-2.5"
            :class="activeTemplateId === template.id ? 'bg-elevated' : undefined"
            data-testid="email-template-row"
          >
            <!-- Name only; the sentence is read by screen readers and stands in the editor -->
            <!-- Framework button: the row's fill marks the chosen mail, so the button adds no
                 ground of its own (link variant, no padding, normal weight); the name keeps its own colours. -->
            <UButton
              color="neutral"
              variant="link"
              class="min-w-0 flex-1 justify-start p-0 text-left font-normal"
              :aria-pressed="activeTemplateId === template.id"
              data-testid="email-template-select"
              @click="selectTemplate(template.id)"
            >
              <h4
                class="text-sm"
                :class="activeTemplateId === template.id ? 'font-medium text-highlighted' : 'text-default'"
              >
                {{ template.label }}
              </h4>
              <span class="sr-only">{{ template.description }}</span>
            </UButton>
            <USwitch
              v-if="canToggleTemplate(template)"
              :model-value="template.enabled"
              :disabled="isToggling"
              :aria-label="templateToggleLabel(template)"
              @click.stop
              @update:model-value="value => setTemplateEnabled(template.id, Boolean(value))"
            />
            <!-- Always sent: the switch shows the state and stays off limits. -->
            <USwitch
              v-else
              :model-value="true"
              disabled
              :aria-label="templateToggleLabel(template)"
              :aria-describedby="`email-template-locked-${template.id}`"
            />
            <!-- The reason under the line of name and switch, across the full row -->
            <AccessReason
              v-if="!canToggleTemplate(template)"
              :id="`email-template-locked-${template.id}`"
              :text="t('admin.settings.email.lockedEnabledReason')"
              class="basis-full"
            />
          </div>
        </section>
      </AppCard>

      <!-- Right: editor and preview of the selected template -->
      <div class="min-w-0 space-y-6 lg:col-span-2">
        <template v-if="activeTemplate">
          <AppCard
            :title="activeTemplate.label"
            data-testid="email-editor"
          >
            <p class="max-w-prose text-sm text-muted">
              {{ activeTemplate.description }}
            </p>

            <UFormField :label="t('admin.settings.email.languageTabsLabel')">
              <USelect
                :model-value="activeEditorLanguage"
                :items="editorLanguages"
                value-key="value"
                class="w-full sm:w-72"
                @update:model-value="value => selectEditorLanguage(String(value))"
              >
                <template #default>
                  <span class="flex min-w-0 items-center gap-2">
                    <span class="truncate">{{ activeEditorLanguageLabel }}</span>
                    <span
                      v-if="activeEditorLanguage !== 'default' && hasTranslationOverride(activeEditorLanguage)"
                      class="size-2 shrink-0 rounded-full bg-primary"
                      :aria-label="t('admin.settings.email.translationOverride')"
                    />
                  </span>
                </template>
              </USelect>
            </UFormField>

            <p
              v-if="activeEditorLanguage !== 'default'"
              class="max-w-prose text-sm text-muted"
            >
              {{ t('admin.settings.email.translationFallbackHelp') }}
            </p>

            <UAlert
              v-if="saveError"
              role="alert"
              color="error"
              icon="i-lucide-circle-x"
              :title="t('admin.settings.email.saveError')"
              :description="saveError"
            />

            <UFormField
              :label="t('admin.settings.email.subject')"
              name="subject"
              :error="fieldErrors.subject"
            >
              <UInput
                :id="subjectFieldId"
                v-model="editSubject"
                class="w-full"
                :placeholder="t('admin.settings.email.subjectPlaceholder')"
              />
            </UFormField>

            <!-- The tokens that must stay are part of the body field's description. -->
            <UFormField
              :label="t('admin.settings.email.body')"
              name="body"
              :error="fieldErrors.body"
            >
              <template
                v-if="activeRequiredTokens.length"
                #description
              >
                <span
                  class="flex flex-wrap items-center gap-2"
                  data-testid="email-required-tokens"
                >
                  <span>{{ t('admin.settings.email.requiredTokensHelp') }}</span>
                  <UBadge
                    v-for="token in activeRequiredTokenItems"
                    :key="token.key"
                    :color="token.missing ? 'error' : 'neutral'"
                    class="font-mono"
                  >
                    {{ token.key }}
                  </UBadge>
                </span>
              </template>
              <UTextarea
                :id="bodyFieldId"
                v-model="editBody"
                :rows="12"
                class="w-full"
                :placeholder="t('admin.settings.email.bodyPlaceholder')"
              />
            </UFormField>

            <!-- Disclosure: available placeholders -->
            <UCollapsible
              v-model:open="variablesOpen"
              :unmount-on-hide="false"
              data-testid="email-variables"
            >
              <UButton
                color="neutral"
                variant="ghost"
                icon="i-lucide-chevron-right"
                class="group -ms-2.5"
                :ui="{ leadingIcon: 'transition-transform group-data-[state=open]:rotate-90' }"
              >
                {{ t('admin.settings.email.availableVariables') }}
                <span class="text-muted tabular-nums">{{ templateVariables.length }}</span>
              </UButton>
              <template #content>
                <div class="grid grid-cols-1 gap-2 pt-3 sm:grid-cols-2">
                  <div
                    v-for="variable in templateVariables"
                    :key="variable.key"
                    class="flex items-start gap-2 text-sm"
                  >
                    <UBadge
                      color="neutral"
                      class="shrink-0 font-mono"
                    >
                      {{ variable.key }}
                    </UBadge>
                    <span class="text-sm text-muted">
                      {{ variable.description }}
                    </span>
                    <UBadge
                      v-if="variable.required"
                      :color="variable.missing ? 'error' : 'neutral'"
                    >
                      {{ t('admin.settings.email.required') }}
                    </UBadge>
                  </div>
                </div>
              </template>
            </UCollapsible>

            <template #footer>
              <UButton
                :loading="isSaving"
                :disabled="!isTemplateDirty || isSaving"
                data-testid="email-save"
                @click="handleSaveTemplate"
              >
                {{ t('admin.settings.email.saveTemplate') }}
              </UButton>
            </template>
          </AppCard>

          <!-- Preview with sample values -->
          <AppCard
            :title="t('admin.settings.email.previewTitle')"
            data-test="mail-preview"
          >
            <p class="max-w-prose text-sm text-muted">
              {{ t('admin.settings.email.previewHint') }}
            </p>
            <div>
              <p class="text-sm text-muted">
                {{ t('admin.settings.email.previewSubject') }}
              </p>
              <p
                class="mt-1 font-semibold"
                data-test="mail-preview-subject"
              >
                {{ previewSubject || t('admin.settings.email.previewEmpty') }}
              </p>
            </div>
            <div>
              <p class="text-sm text-muted">
                {{ t('admin.settings.email.previewBody') }}
              </p>
              <p
                class="mt-1 whitespace-pre-wrap text-sm"
                data-test="mail-preview-body"
              >
                {{ previewBody || t('admin.settings.email.previewEmpty') }}
              </p>
            </div>
          </AppCard>
        </template>

        <!-- No selection: one sentence in the card -->
        <AppCard v-else>
          <p class="text-sm text-muted">
            {{ t('admin.settings.email.selectTemplate') }}
          </p>
        </AppCard>
      </div>
    </div>
  </AppPageLayout>
</template>
