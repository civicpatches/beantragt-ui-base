<script setup lang="ts">
import type { FormSchemaCollectionResponse, FormSchemaGroupCollectionResponse, JsonApiResource, FormSchemaAttributes } from '~/types';

interface SchemaOption {
    id: string
    label: string
    status: string
}

interface FormSchemaGroupListItem {
    id: string
    label: string
    description: string
    status: string
    created: string
    schemas: SchemaOption[]
}

definePageMeta({
    layout: 'dashboard',
    middleware: 'admin'
});

const { t, locale } = useI18n();
const toast = useToast();
const { resolveApiErrorMessage } = useApiErrorMessage();
const { currentWorkspace, selectedWorkspaceKey, withWorkspaceQuery, workspaceRoute } = useWorkspaceContext();
const canCreateGroup = computed(() => currentWorkspace.value?.canCreateFormSchema === true);

useHead({
    title: computed(() => `${t('nav.formGroups')} - beantragt.ai`)
});

const title = ref('');
const description = ref('');
const schemaToAdd = ref<string | undefined>();
const selectedSchemaIds = ref<string[]>([]);
const isCreating = ref(false);
const isSlideoverOpen = ref(false);

const groupsQuery = computed(() => withWorkspaceQuery());
const { data: groupsResponse, status: groupsStatus, error: groupsError, refresh: refreshGroups } = await useFetch<FormSchemaGroupCollectionResponse>(
    '/api/admin/form-schema-groups',
    {
        key: `admin-form-schema-groups-${selectedWorkspaceKey.value ?? 'none'}`,
        query: groupsQuery,
        watch: [selectedWorkspaceKey]
    }
);

const schemasQuery = computed(() => withWorkspaceQuery({
    all: 'true',
    fields: 'label,field_workflow_status,created,changed'
}));
const { data: schemasResponse, error: schemasError } = await useFetch<FormSchemaCollectionResponse>(
    '/api/admin/schemas',
    {
        key: `admin-schemas-for-groups-${selectedWorkspaceKey.value ?? 'none'}`,
        query: schemasQuery,
        watch: [selectedWorkspaceKey]
    }
);

const schemas = computed<SchemaOption[]>(() => {
    if (!schemasResponse.value?.data) return [];
    return schemasResponse.value.data.map(item => ({
        id: item.id,
        label: item.attributes.label ?? '',
        status: item.attributes.field_workflow_status ?? 'draft'
    }));
});

const schemaLookup = computed(() => new Map(schemas.value.map(schema => [schema.id, schema])));

const availableSchemaItems = computed(() =>
    schemas.value
        .filter(schema => !selectedSchemaIds.value.includes(schema.id))
        .map(schema => ({
            label: schema.label,
            value: schema.id
        }))
);

const selectedSchemas = computed(() =>
    selectedSchemaIds.value
        .map(id => schemaLookup.value.get(id))
        .filter((schema): schema is SchemaOption => Boolean(schema))
);

const includedSchemaLookup = computed(() => {
    const included = groupsResponse.value?.included ?? [];
    return new Map(
        included
            .filter((item): item is JsonApiResource<Partial<FormSchemaAttributes>> => item.type === 'form_schema--form_schema')
            .map(item => [
                item.id,
                {
                    id: item.id,
                    label: item.attributes.label ?? '',
                    status: item.attributes.field_workflow_status ?? 'draft'
                }
            ])
    );
});

const groups = computed<FormSchemaGroupListItem[]>(() => {
    if (!groupsResponse.value?.data) return [];

    return groupsResponse.value.data.map((item) => {
        const relationshipData = item.relationships?.field_schemas?.data;
        const schemaRefs = Array.isArray(relationshipData) ? relationshipData : [];
        const relatedSchemas = schemaRefs
            .map(ref => includedSchemaLookup.value.get(ref.id))
            .filter((schema): schema is SchemaOption => Boolean(schema));

        return {
            id: item.id,
            label: item.attributes.label ?? '',
            description: getLongTextValue(item.attributes.field_description),
            status: item.attributes.field_workflow_status ?? 'draft',
            created: item.attributes.created ?? '',
            schemas: relatedSchemas
        };
    });
});

const canCreate = computed(() =>
    canCreateGroup.value
    && title.value.trim().length >= 3
    && selectedSchemaIds.value.length > 0
    && !isCreating.value
);

const titleError = computed(() =>
    title.value.length > 0 && title.value.trim().length < 3
        ? t('admin.formGroups.titleMinLength')
        : undefined
);

watch(availableSchemaItems, (items) => {
    if (!schemaToAdd.value || !items.some(item => item.value === schemaToAdd.value)) {
        schemaToAdd.value = items[0]?.value;
    }
}, { immediate: true });

function getLongTextValue(value: unknown): string {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'object' && 'value' in value) {
        return String((value as { value?: unknown }).value ?? '');
    }
    return '';
}

function getFormCountLabel(count: number): string {
    return count === 1
        ? t('admin.formGroups.formCountSingular')
        : t('admin.formGroups.formCount', { count });
}

function formatLocalDate(dateStr: string): string {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString(locale.value === 'en' ? 'en-US' : 'de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
}

function getMoveUpAriaLabel(schema: SchemaOption, index: number): string {
    return t('admin.formGroups.moveUpNamed', {
        label: schema.label,
        position: index + 1
    });
}

function getMoveDownAriaLabel(schema: SchemaOption, index: number): string {
    return t('admin.formGroups.moveDownNamed', {
        label: schema.label,
        position: index + 1
    });
}

function getRemoveAriaLabel(schema: SchemaOption): string {
    return t('admin.formGroups.removeFormNamed', { label: schema.label });
}

function addSelectedSchema() {
    if (!schemaToAdd.value || selectedSchemaIds.value.includes(schemaToAdd.value)) {
        return;
    }

    selectedSchemaIds.value = [...selectedSchemaIds.value, schemaToAdd.value];
}

function removeSelectedSchema(id: string) {
    selectedSchemaIds.value = selectedSchemaIds.value.filter(schemaId => schemaId !== id);
}

function moveSelectedSchema(id: string, direction: -1 | 1) {
    const currentIndex = selectedSchemaIds.value.indexOf(id);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= selectedSchemaIds.value.length) {
        return;
    }

    const nextIds = [...selectedSchemaIds.value];
    const [movedId] = nextIds.splice(currentIndex, 1);
    if (!movedId) return;
    nextIds.splice(nextIndex, 0, movedId);
    selectedSchemaIds.value = nextIds;
}

async function createFormSchemaGroup() {
    if (!canCreate.value) return;

    isCreating.value = true;
    try {
        await $fetch('/api/admin/form-schema-groups', {
            method: 'POST',
            query: withWorkspaceQuery(),
            body: {
                title: title.value.trim(),
                description: description.value.trim(),
                schemaIds: selectedSchemaIds.value
            }
        });

        toast.add({
            title: t('admin.formGroups.created'),
            color: 'success'
        });

        title.value = '';
        description.value = '';
        selectedSchemaIds.value = [];
        isSlideoverOpen.value = false;
        await refreshGroups();
    } catch (e: unknown) {
        const data = (e as { data?: { code?: unknown, data?: { code?: unknown } } } | null)?.data;
        toast.add({
            title: t('admin.formGroups.createError'),
            description: (data?.data?.code ?? data?.code) === 'errors.schema.writeForbidden'
                ? t('admin.formGroups.createAccessDenied')
                : resolveApiErrorMessage(e, 'admin.formGroups.createError'),
            color: 'error'
        });
    } finally {
        isCreating.value = false;
    }
}
</script>

<template>
  <AppPageLayout :title="t('admin.formGroups.title')">
    <!-- The description, and under it the standing
         restriction as one quiet line (only while procedures are listed). -->
    <template #description>
      <p class="max-w-2xl text-base text-muted">
        {{ t('admin.formGroups.subtitle') }}
      </p>
      <AccessReason
        v-if="!groupsError && groupsStatus !== 'pending' && groups.length"
        id="form-groups-locked"
        class="mt-2 max-w-prose"
        :text="t('admin.formGroups.lockedNotice')"
        data-test="form-groups-locked"
      />
      <AccessReason
        v-if="currentWorkspace && !canCreateGroup"
        id="form-groups-create-access"
        :text="t('admin.formGroups.createAccessDenied')"
      />
    </template>

    <template
      v-if="canCreateGroup && groups.length"
      #actions
    >
      <UButton
        type="button"
        icon="i-lucide-plus"
        @click="isSlideoverOpen = true"
      >
        {{ t('admin.formGroups.createTitle') }}
      </UButton>
    </template>

    <UAlert
      v-if="groupsError"
      color="error"
      icon="i-lucide-circle-x"
      :title="t('admin.formGroups.loadError')"
      :description="resolveApiErrorMessage(groupsError, 'admin.formGroups.loadError')"
      class="max-w-3xl"
    />

    <!-- Loading: the height of a card with two forms -->
    <div
      v-else-if="groupsStatus === 'pending'"
      class="space-y-6"
    >
      <USkeleton
        v-for="i in 3"
        :key="i"
        class="h-24 w-full rounded-lg"
      />
    </div>

    <!-- Empty state -->
    <UEmpty
      v-else-if="!groups.length"
      icon="i-lucide-folder-plus"
      :title="t('admin.formGroups.empty')"
      :description="t('admin.formGroups.emptyDescription')"
      :actions="canCreateGroup ? [{
        label: t('admin.formGroups.createTitle'),
        icon: 'i-lucide-plus',
        onClick: () => { isSlideoverOpen = true; },
      }] : undefined"
    />

    <!-- One card per procedure, its forms as plain numbered rows. -->
    <ul
      v-else
      class="space-y-6"
      data-test="form-groups-list"
    >
      <li
        v-for="group in groups"
        :key="group.id"
      >
        <AppCard
          :title="group.label"
          as="h2"
          data-test="form-group-card"
        >
          <template #badge>
            <StatusBadge
              :status="group.status"
              type="schema"
            />
          </template>

          <div>
            <p
              class="text-sm text-muted"
              data-test="form-group-meta"
            >
              {{ group.schemas.length ? getFormCountLabel(group.schemas.length) : t('admin.formGroups.noForms') }} · {{ t('admin.formGroups.createdAt', { date: formatLocalDate(group.created) }) }}
            </p>
            <p
              v-if="group.description"
              class="mt-2 max-w-prose text-sm text-default"
            >
              {{ group.description }}
            </p>
          </div>

          <ol v-if="group.schemas.length">
            <li
              v-for="(schema, index) in group.schemas"
              :key="schema.id"
              class="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm border-t border-default first:border-t-0 first:pt-0 last:pb-0"
              data-test="form-group-form"
            >
              <span class="w-5 shrink-0 tabular-nums text-muted">{{ index + 1 }}</span>
              <NuxtLink
                :to="workspaceRoute(`/admin/forms/${schema.id}`)"
                class="inline-flex min-h-6 min-w-0 items-center break-words font-medium text-default underline-offset-2 hover:underline"
              >
                {{ schema.label }}
              </NuxtLink>
              <StatusBadge
                :status="schema.status"
                type="schema"
              />
            </li>
          </ol>
        </AppCard>
      </li>
    </ul>

    <!-- Sentences above their field, quiet list controls,
         the button in the footer. -->
    <USlideover
      v-if="canCreateGroup"
      v-model:open="isSlideoverOpen"
      :title="t('admin.formGroups.createTitle')"
      side="right"
    >
      <template #body>
        <form
          id="form-group-create"
          class="space-y-6"
          @submit.prevent="createFormSchemaGroup"
        >
          <!-- Said before creating: afterwards nothing here can change it. -->
          <UAlert
            role="status"
            color="warning"
            icon="i-lucide-triangle-alert"
            :title="t('admin.formGroups.permanentTitle')"
            :description="t('admin.formGroups.permanentDescription')"
            data-test="form-groups-permanent"
          />

          <UFormField
            :label="t('admin.formGroups.titleLabel')"
            :description="t('admin.formGroups.titleHint')"
            name="title"
            required
            :error="titleError"
          >
            <UInput
              v-model="title"
              name="title"
              :placeholder="t('admin.formGroups.titlePlaceholder')"
              maxlength="255"
              class="w-full"
            />
          </UFormField>

          <UFormField
            :label="t('admin.formGroups.descriptionLabel')"
            :hint="t('admin.formGroups.optionalHint')"
          >
            <UTextarea
              v-model="description"
              :placeholder="t('admin.formGroups.descriptionPlaceholder')"
              :rows="3"
              class="w-full"
              maxlength="2000"
            />
          </UFormField>

          <UAlert
            v-if="schemasError"
            color="error"
            icon="i-lucide-circle-x"
            :title="t('admin.formGroups.loadFormsError')"
          />

          <UFormField
            v-else
            :label="t('admin.formGroups.formLabel')"
            name="schemaToAdd"
          >
            <UFieldGroup class="flex w-full">
              <USelect
                v-model="schemaToAdd"
                :items="availableSchemaItems"
                value-key="value"
                class="min-w-0 flex-1"
                :disabled="availableSchemaItems.length === 0"
              />
              <UButton
                type="button"
                color="neutral"
                variant="outline"
                :disabled="!schemaToAdd"
                @click="addSelectedSchema"
              >
                {{ t('admin.formGroups.addForm') }}
              </UButton>
            </UFieldGroup>
            <p
              v-if="availableSchemaItems.length === 0"
              class="mt-2 text-sm text-muted"
            >
              {{ t('admin.formGroups.noAvailableForms') }}
            </p>
          </UFormField>

          <UFormField
            :label="t('admin.formGroups.selectedForms')"
            :description="t('admin.formGroups.formsHint')"
            name="schemaIds"
            required
            :error="selectedSchemaIds.length === 0 && title.trim().length >= 3 ? t('admin.formGroups.formsRequired') : undefined"
          >
            <p
              v-if="!selectedSchemas.length"
              class="text-sm text-muted"
              data-test="form-groups-none-selected"
            >
              {{ t('admin.formGroups.noFormsSelected') }}
            </p>
            <ol
              v-else
              data-test="form-groups-selected"
            >
              <li
                v-for="(schema, index) in selectedSchemas"
                :key="schema.id"
                class="flex items-center gap-2 py-2 text-sm border-t border-default first:border-t-0"
              >
                <span class="w-5 shrink-0 tabular-nums text-muted">{{ index + 1 }}</span>
                <span class="min-w-0 flex-1 break-words font-medium">
                  {{ schema.label }}
                </span>
                <UTooltip :text="getMoveUpAriaLabel(schema, index)">
                  <UButton
                    type="button"
                    color="neutral"
                    variant="ghost"
                    icon="i-lucide-arrow-up"
                    :disabled="index === 0"
                    :aria-label="getMoveUpAriaLabel(schema, index)"
                    @click="moveSelectedSchema(schema.id, -1)"
                  />
                </UTooltip>
                <UTooltip :text="getMoveDownAriaLabel(schema, index)">
                  <UButton
                    type="button"
                    color="neutral"
                    variant="ghost"
                    icon="i-lucide-arrow-down"
                    :disabled="index === selectedSchemas.length - 1"
                    :aria-label="getMoveDownAriaLabel(schema, index)"
                    @click="moveSelectedSchema(schema.id, 1)"
                  />
                </UTooltip>
                <UTooltip :text="getRemoveAriaLabel(schema)">
                  <UButton
                    type="button"
                    color="neutral"
                    variant="ghost"
                    icon="i-lucide-x"
                    :aria-label="getRemoveAriaLabel(schema)"
                    @click="removeSelectedSchema(schema.id)"
                  />
                </UTooltip>
              </li>
            </ol>
          </UFormField>
        </form>
      </template>
      <template #footer>
        <div class="flex w-full flex-wrap justify-end gap-2">
          <UButton
            type="button"
            color="neutral"
            variant="ghost"
            data-test="form-group-cancel"
            @click="isSlideoverOpen = false"
          >
            {{ t('common.cancel') }}
          </UButton>
          <UButton
            type="submit"
            form="form-group-create"
            :loading="isCreating"
            :disabled="!canCreate"
            data-test="form-group-submit"
          >
            {{ t('admin.formGroups.create') }}
          </UButton>
        </div>
      </template>
    </USlideover>
  </AppPageLayout>
</template>
