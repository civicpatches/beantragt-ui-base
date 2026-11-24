<script setup lang="ts">
import type { SchemaReference, SchemaReferenceKind, StructureTarget } from '../../utils/schema-structure';
import { REQUIRED_CLEANUP_REFERENCE_KINDS } from '../../utils/schema-structure';

/**
 * Confirmation before a field, an address group or a section leaves the
 * draft. Lists what inside the schema refers to it; references Drupal
 * would reject are always cleaned up, conditions only when the author keeps
 * the box ticked. The editor mounts the dialog while a delete is pending and
 * unmounts it after `closed`, which follows the leave transition.
 */
const props = defineProps<{
    open: boolean
    targetKind: StructureTarget['kind']
    label: string
    /** Fields that disappear with the target. */
    fieldCount: number
    /** Their labels, listed for a section or an address group. */
    fieldLabels?: string[]
    references: SchemaReference[]
    /**
     * Set when the delete leaves no section or no field in the draft: Drupal
     * then refuses to publish it until a section with a field exists again.
     */
    emptyAfter?: 'sections' | 'fields' | null
}>();

const emit = defineEmits<{
    confirm: []
    cancel: []
    /** The leave transition has ended; the editor may unmount and move focus. */
    closed: []
}>();

const removeConditions = defineModel<boolean>('removeConditions', { default: true });

const { t } = useI18n();

const REFERENCE_KIND_ORDER: SchemaReferenceKind[] = ['condition', 'computed', 'compareWith', 'precheck', 'addressGroup'];

const titleKey: Record<StructureTarget['kind'], string> = {
    field: 'admin.forms.structure.deleteDialog.titleField',
    section: 'admin.forms.structure.deleteDialog.titleSection',
    addressGroup: 'admin.forms.structure.deleteDialog.titleAddressGroup'
};
const descriptionKey: Record<StructureTarget['kind'], string> = {
    field: 'admin.forms.structure.deleteDialog.descriptionField',
    section: 'admin.forms.structure.deleteDialog.descriptionSection',
    addressGroup: 'admin.forms.structure.deleteDialog.descriptionAddressGroup'
};

const referenceGroups = computed(() => REFERENCE_KIND_ORDER
    .map(kind => ({ kind, items: props.references.filter(reference => reference.kind === kind) }))
    .filter(group => group.items.length > 0)
);
const hasConditions = computed(() => props.references.some(reference => reference.kind === 'condition'));
const hasRequiredCleanup = computed(() => props.references.some(reference => REQUIRED_CLEANUP_REFERENCE_KINDS.has(reference.kind)));

// After a confirmed delete the trigger may be gone; the editor then moves
// focus itself, so the dialog must not send it back to a removed element.
let confirmed = false;

watch(() => props.open, (open) => {
    if (open) confirmed = false;
});

const listedFieldLabels = computed(() => props.targetKind === 'field' ? [] : (props.fieldLabels ?? []));

function onConfirm() {
    if (!props.open) return;
    confirmed = true;
    emit('confirm');
}

function onCloseAutoFocus(event: Event) {
    if (confirmed) event.preventDefault();
}

function referenceText(reference: SchemaReference): string {
    const key = reference.kind === 'computed' && reference.stopsComputing ? 'itemStops' : 'item';
    return t(`admin.forms.structure.deleteDialog.kinds.${reference.kind}.${key}`, {
        owner: reference.ownerLabel,
        target: reference.targetLabel,
        detail: reference.detail ?? ''
    });
}
</script>

<template>
  <UModal
    :open="open"
    :title="t(titleKey[targetKind], { label })"
    :description="t(descriptionKey[targetKind], { count: fieldCount })"
    :content="{ onCloseAutoFocus }"
    @update:open="(value: boolean) => !value && open && emit('cancel')"
    @after:leave="emit('closed')"
  >
    <template #body>
      <div
        class="space-y-4"
        data-testid="structure-delete-body"
      >
        <section
          v-if="listedFieldLabels.length > 0"
          aria-labelledby="structure-delete-fields"
          data-testid="structure-delete-fields"
        >
          <h3
            id="structure-delete-fields"
            class="text-sm font-semibold text-(--ui-text-highlighted)"
          >
            {{ t('admin.forms.structure.deleteDialog.fieldsTitle') }}
          </h3>
          <ul class="mt-1 max-h-40 list-disc space-y-1 overflow-y-auto ps-5 text-sm text-(--ui-text-muted)">
            <li
              v-for="(fieldLabel, index) in listedFieldLabels"
              :key="`${index}:${fieldLabel}`"
            >
              {{ fieldLabel }}
            </li>
          </ul>
        </section>

        <p
          v-if="references.length === 0"
          class="text-sm text-(--ui-text-muted)"
        >
          {{ t('admin.forms.structure.deleteDialog.noReferences') }}
        </p>

        <template v-else>
          <p class="text-sm text-(--ui-text-highlighted)">
            {{ t('admin.forms.structure.deleteDialog.referencesIntro') }}
          </p>
          <div class="max-h-72 space-y-4 overflow-y-auto">
            <section
              v-for="group in referenceGroups"
              :key="group.kind"
              :aria-labelledby="`structure-delete-kind-${group.kind}`"
              :data-testid="`structure-delete-kind-${group.kind}`"
            >
              <h3
                :id="`structure-delete-kind-${group.kind}`"
                class="text-sm font-semibold text-(--ui-text-highlighted)"
              >
                {{ t(`admin.forms.structure.deleteDialog.kinds.${group.kind}.title`) }}
              </h3>
              <ul class="mt-1 list-disc space-y-1 ps-5 text-sm text-(--ui-text-muted)">
                <li
                  v-for="reference in group.items"
                  :key="`${reference.ownerId}:${reference.targetFieldId}:${reference.detail ?? ''}`"
                >
                  {{ referenceText(reference) }}
                </li>
              </ul>
              <p
                v-if="group.kind !== 'condition'"
                class="mt-1 text-sm text-(--ui-text-muted)"
              >
                {{ t(`admin.forms.structure.deleteDialog.kinds.${group.kind}.cleanup`) }}
              </p>
            </section>
          </div>

          <UCheckbox
            v-if="hasConditions"
            v-model="removeConditions"
            :label="t('admin.forms.structure.deleteDialog.removeConditions')"
            :aria-label="t('admin.forms.structure.deleteDialog.removeConditions')"
            :description="t('admin.forms.structure.deleteDialog.removeConditionsHelp')"
            data-testid="structure-delete-remove-conditions"
          />

          <p
            v-if="hasRequiredCleanup"
            class="text-sm text-(--ui-text-muted)"
          >
            {{ t('admin.forms.structure.deleteDialog.requiredCleanup') }}
          </p>
        </template>

        <UAlert
          v-if="emptyAfter"
          role="status"
          color="warning"
          icon="i-lucide-triangle-alert"
          :title="t(emptyAfter === 'sections' ? 'admin.forms.structure.deleteDialog.emptyAfterSections' : 'admin.forms.structure.deleteDialog.emptyAfterFields')"
          data-testid="structure-delete-empty-after"
        />

        <UAlert
          icon="i-lucide-info"
          :title="t('admin.forms.structure.deleteDialog.externalHint')"
        />

        <p class="text-sm text-(--ui-text-muted)">
          {{ t('admin.forms.structure.deleteDialog.undoHint') }}
        </p>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-3">
        <UButton
          color="neutral"
          variant="ghost"
          data-testid="structure-delete-cancel"
          @click="open && emit('cancel')"
        >
          {{ t('common.cancel') }}
        </UButton>
        <UButton
          color="error"
          icon="i-lucide-trash-2"
          data-testid="structure-delete-confirm"
          @click="onConfirm"
        >
          {{ t('admin.forms.structure.deleteDialog.confirm') }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
