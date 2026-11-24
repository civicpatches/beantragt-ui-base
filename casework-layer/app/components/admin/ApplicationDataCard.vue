<script setup lang="ts">
import { reactive, useId, watch } from 'vue';
import type { AdminApplicationAttachment } from '~/types';
import type { ApplicationDataEditBlockedReason } from '~/types/admin';
import { TEXT_LINK_CLASS } from '~/utils/text-link';
import type { FormSchema } from '~/types/form';
import { repeatedFieldIds, type ApplicationDataSectionView } from '~~/casework-layer/app/utils/application-data-sections';
import { isOptionCheckbox, type ApplicationEditEntrySection } from '~~/casework-layer/app/utils/application-edit-data';
import { withPublicCondition, withPublicConditions } from '~/utils/form-condition-value';
import { isProtectedApplicationDataValue, isRedactedApplicationDataValue } from '~~/casework-layer/app/utils/application-data-redaction';

interface ApplicationDataDisplayRow {
    key: string
    value: unknown
}

const props = defineProps<{
    isEditing: boolean
    isSaving: boolean
    schema: FormSchema | null
    editData: Record<string, unknown>
    editFieldErrors: Record<string, string>
    editFieldErrorMessages: string[]
    showHiddenEditFieldRemovalWarning: boolean
    hiddenEditFieldRemovalLabels: string
    dataEditDisabled: boolean
    dataEditDisabledTitle?: string
    dataEditDisabledReason?: ApplicationDataEditBlockedReason | 'unavailable' | null
    dataEditNotice?: string
    correctionHistory?: { applicationId: string, query: Record<string, unknown>, origin?: string | null }
    protectedDataRedacted: boolean
    applicationDataRows: ApplicationDataDisplayRow[]
    applicationDataSections?: ApplicationDataSectionView[]
    getFieldLabel: (key: string) => string
    formatApplicationDataValue: (key: string, value: unknown, source?: 'history') => string
    /** Loaded attachments of a file field: its value line opens the attachments slide-over. */
    attachmentsForField: (fieldId: string) => AdminApplicationAttachment[]
    /** Connections of unsent transfers that saving changed data would stop. */
    pendingTransferConnections?: string[]
    /** Repeatable sections stored as entry columns (batch applications): edited entry by entry. */
    editEntrySections?: ApplicationEditEntrySection[]
    /** Errors per entry (`<sectionId>#<index>`), then per field id. */
    editEntryErrors?: Record<string, Record<string, string>>
    /** Fields that need a look, for the summary at the top of the edit form (02b, 6), each a link into its field. */
    editErrorTargets?: Array<{ label: string, fieldId: string, entryKey?: string }>
    /** The card "Anlagen" stands above on the page: the attachment line names it (02b, 3). */
    attachmentsCardShown?: boolean
}>();

const emit = defineEmits<{
    (event: 'update:editData', value: Record<string, unknown>): void
    (event: 'edit' | 'cancel' | 'save'): void
    (event: 'open-attachments', fieldId: string): void
    (event: 'focus-field', target: { fieldId: string, entryKey?: string }): void
}>();

const { t } = useI18n();
const pendingTransferWarningId = `pending-transfer-warning-${useId()}`;
const labelIdPrefix = `application-data-label-${useId()}`;
const editIdSuffix = useId();
const editReasonId = `application-data-edit-reason-${editIdSuffix}`;
const schemaAlertId = `application-data-schema-alert-${editIdSuffix}`;
const protectedAlertId = `application-data-protected-alert-${editIdSuffix}`;
const showsReasonLine = computed(() => props.dataEditDisabledReason === 'permission' || props.dataEditDisabledReason === 'transfer' || props.dataEditDisabledReason === 'unavailable');
const historyEntryFieldIds = computed(() => repeatedFieldIds(props.schema, props.correctionHistory?.origin));
/** The disabled edit button names the reason line or the alert that explains it. */
const editDescribedBy = computed(() => {
    if (!props.dataEditDisabled) return undefined;
    if (showsReasonLine.value) return editReasonId;
    if (props.dataEditDisabledReason === 'schema' || (!props.dataEditDisabledReason && !props.schema)) return schemaAlertId;
    if (props.dataEditDisabledReason === 'protected' || (!props.dataEditDisabledReason && props.protectedDataRedacted)) return protectedAlertId;
    return undefined;
});
const pendingTransferWarning = computed(() => {
    const connections = [...new Set((props.pendingTransferConnections ?? []).map(label => label || t('caseTransfers.legacyTarget')))];
    return connections.length ? t('caseTransfers.editWarning', { connections: connections.join(', ') }) : '';
});

type DisplayItem
    = | { kind: 'row', key: string, row: ApplicationDataDisplayRow }
      | { kind: 'section', key: string, text: string }
      | { kind: 'entry', key: string, text: string }
      | { kind: 'empty', key: string, text: string };

const displayItems = computed<DisplayItem[]>(() => {
    const items: DisplayItem[] = props.applicationDataRows.map(row => ({ kind: 'row', key: `row:${row.key}`, row }));
    for (const section of props.applicationDataSections ?? []) {
        items.push({ kind: 'section', key: `section:${section.key}`, text: section.title });
        if (section.entries.length === 0) {
            items.push({ kind: 'empty', key: `empty:${section.key}`, text: t('admin.detail.repeatedSectionEmpty') });
        }
        for (const entry of section.entries) {
            items.push({ kind: 'entry', key: `entry:${entry.key}`, text: entry.label });
            for (const row of entry.rows) items.push({ kind: 'row', key: `${entry.key}:${row.key}`, row });
        }
        for (const row of section.rows) items.push({ kind: 'row', key: `group:${section.key}:${row.key}`, row });
    }
    return items;
});

/** An upload field names its files, not "1 Anlage"; the attachment list above stays the place to download. */
function attachmentNames(row: ApplicationDataDisplayRow): string {
    const names = props.attachmentsForField(row.key).map(attachment => attachment.filename).filter(Boolean);
    return names.length ? names.join(', ') : props.formatApplicationDataValue(row.key, row.value);
}

/** Reasons shown as a line under the button (the schema and protected reasons have their own alert below). */
/** The function search gives the same reason at its entry for this card ("Antragsdaten"). */
const functionSearchNote = computed(() => props.dataEditDisabled && !props.isEditing ? props.dataEditDisabledTitle : undefined);

function requestEdit() {
    if (!props.dataEditDisabled) emit('edit');
}

/**
 * When editing existing repeatable entries, the main
 * form leaves the entry columns out; each entry gets its own renderer with a one-section schema, so conditions
 * resolve inside the entry, and writes back into the same columns, element by element, never a scalar.
 */
const entryColumnIds = computed(() => new Set((props.editEntrySections ?? []).flatMap(entry => entry.fieldIds)));
/**
 * A repeatable section is one section: the main form leaves a section with entries
 * out completely; its title stands once, over its entries and the section's other fields (its file lines).
 */
const entrySectionIds = computed(() => new Set((props.editEntrySections ?? []).map(entry => entry.section.id)));
/**
 * The renderers get every condition as the page receives it (`withPublicConditions`: a number or null value
 * means "any answer"), so they show what the check, the proxy and Drupal treat as visible.
 */
const flatEditSchema = computed<FormSchema | null>(() => {
    if (!props.schema) return null;
    const schema = withPublicConditions(props.schema);
    if (entrySectionIds.value.size === 0) return schema;
    return {
        ...schema,
        sections: schema.sections.filter(section => !entrySectionIds.value.has(section.id))
    };
});

interface EntryEditorView {
    key: string
    sectionId: string
    title: string
    entries: Array<{ key: string, index: number, label: string, schema: FormSchema }>
    fieldIds: string[]
    /** Checkboxes with options: batch intake stores one option string per entry, the renderer needs a list. */
    optionCheckboxIds: Set<string>
    /** Fields outside the section that a condition inside it reads (same value for every entry). */
    outsideDependencies: string[]
    /**
     * The section's fields that are no entry column (its file fields, a field stored flat), as one bare section on
     * the main model, after the entries (where the read view lists them too). Null when there are none.
     */
    restSchema: FormSchema | null
}

const entryEditors = computed<EntryEditorView[]>(() => (props.editEntrySections ?? []).map((entrySection) => {
    const fields = entrySection.section.fields.filter(field => entrySection.fieldIds.includes(field.id)).map(field => withPublicCondition(field));
    const outsideDependencies = [...new Set(fields
        .map(field => field.conditionalOn?.fieldId)
        .filter((id): id is string => Boolean(id) && !entrySection.fieldIds.includes(id!)))];
    const restFields = entrySection.section.fields.filter(field => !entrySection.fieldIds.includes(field.id)).map(field => withPublicCondition(field));
    return {
        restSchema: restFields.length > 0
            ? { title: props.schema?.title ?? '', sections: [{ ...entrySection.section, repeatable: false, fields: restFields }] }
            : null,
        key: entrySection.section.id,
        sectionId: entrySection.section.id,
        title: entrySection.section.title,
        fieldIds: entrySection.fieldIds,
        optionCheckboxIds: new Set(fields.filter(isOptionCheckbox).map(field => field.id)),
        outsideDependencies,
        entries: Array.from({ length: entrySection.length }, (_, index) => {
            const label = t('admin.detail.entryHeading', { section: entrySection.section.title, number: index + 1 });
            return {
                key: `${entrySection.section.id}#${index}`,
                index,
                label,
                schema: {
                    title: props.schema?.title ?? '',
                    sections: [{ ...entrySection.section, title: label, description: undefined, i18n: undefined, repeatable: false, fields }]
                }
            };
        })
    };
}));

/**
 * What the renderer shows for one element: an option string of a checkbox with options is that one option
 * ticked; a blank string is nothing ticked (and stays as stored while the clerk does not tick anything).
 */
function shownElement(editor: EntryEditorView, id: string, element: unknown): unknown {
    if (!editor.optionCheckboxIds.has(id)) return element ?? null;
    if (typeof element === 'string') return element.trim() === '' ? [] : [element];
    return Array.isArray(element) ? element : [];
}

function entryModel(editor: EntryEditorView, index: number): Record<string, unknown> {
    const model: Record<string, unknown> = {};
    for (const id of editor.fieldIds) {
        const column = props.editData[id];
        model[id] = shownElement(editor, id, Array.isArray(column) ? column[index] : null);
    }
    for (const id of editor.outsideDependencies) model[id] = props.editData[id];
    return model;
}

/**
 * One stable, reactive model per entry. The FormRenderer writes typed values into the object it was given
 * (`formData.value[field] = value`, no event for a property): a model built anew on every render was a
 * throwaway, so a typed entry value never reached its column (owner's case, 13.11.). The models live while the
 * edit is open; any change in them is written back into the columns.
 */
const entryModels = reactive<Record<string, Record<string, unknown>>>({});
function entryModelFor(editor: EntryEditorView, index: number): Record<string, unknown> {
    const key = `${editor.sectionId}#${index}`;
    if (!entryModels[key]) entryModels[key] = entryModel(editor, index);
    return entryModels[key]!;
}
/** The renderer may also replace its whole model (an emitted object): take it over into the stable one. */
function replaceEntryModel(editor: EntryEditorView, index: number, model: Record<string, unknown>) {
    Object.assign(entryModelFor(editor, index), model);
}
watch(() => props.isEditing, () => {
    for (const key of Object.keys(entryModels)) Reflect.deleteProperty(entryModels, key);
});
/**
 * A field outside the section that an entry field depends on is copied into each entry model (the renderer
 * evaluates conditions on its own model). The models live as long as the edit, so a change of such a field in the
 * main form is carried into every open entry, which then shows or hides its dependent fields.
 */
const outsideDependencyValues = computed(() => JSON.stringify(entryEditors.value.map(editor =>
    editor.outsideDependencies.map(id => props.editData[id] ?? null))));
watch(outsideDependencyValues, () => {
    for (const editor of entryEditors.value) {
        for (const entry of editor.entries) {
            const model = entryModels[entry.key];
            if (!model) continue;
            for (const id of editor.outsideDependencies) {
                if (JSON.stringify(model[id] ?? null) !== JSON.stringify(props.editData[id] ?? null)) model[id] = props.editData[id];
            }
        }
    }
});
watch(entryModels, () => {
    let next: Record<string, unknown> | null = null;
    for (const editor of entryEditors.value) {
        for (const entry of editor.entries) {
            const model = entryModels[entry.key];
            if (model) next = writeEntry(editor, entry.index, model, next);
        }
    }
    // One update for all entries changed in this tick, so no entry's change overwrites another's.
    if (next) emit('update:editData', next);
}, { deep: true });

/**
 * Writes back only what the clerk changed: a field whose value still equals what was shown keeps its stored
 * element byte for byte (an option string stays a string); a changed field takes the renderer's value.
 */
function writeEntry(editor: EntryEditorView, index: number, model: Record<string, unknown>, pending: Record<string, unknown> | null): Record<string, unknown> | null {
    const shown = entryModel(editor, index);
    let next = pending;
    for (const id of editor.fieldIds) {
        if (JSON.stringify(model[id] ?? null) === JSON.stringify(shown[id] ?? null)) continue;
        next ??= { ...props.editData };
        const base = next[id];
        const column = Array.isArray(base) ? [...base as unknown[]] : [];
        column[index] = model[id] ?? null;
        next[id] = column;
    }
    return next;
}

/** Files cannot be changed in this form: one reason line above it when it holds a file field (02b, 3). */
const editFormHasFileField = computed(() => (props.schema?.sections ?? []).some(section => section.fields.some(field => field.type === 'file')));
const errorTargets = computed(() => props.editErrorTargets ?? []);
/** The file lines of the edit form name the files the attachment list knows (as the read view does). */
function staffFileLines(fieldId: string) {
    return props.attachmentsForField(fieldId).map(attachment => ({ key: attachment.id, filename: attachment.filename, size: attachment.size }));
}

/**
 * Edit mode with a schema: the form and its save row are shown. The card is one of the page's cards
 * (AppCard). In edit mode its root clips with `overflow-clip` instead of
 * `overflow-hidden`, so the save row at the end of the field block can stick (pattern "Sticky save row").
 */
const editing = computed(() => props.isEditing && !!props.schema);

const editableData = computed({
    get: () => props.editData,
    set: (value: Record<string, unknown>) => emit('update:editData', value)
});
</script>

<template>
  <AppCard
    class="mb-6"
    :title="t('admin.detail.formData')"
    icon="i-lucide-file-text"
    :class="editing ? 'overflow-clip' : undefined"
    :data-function-search-note="functionSearchNote"
  >
    <template #actions>
      <span
        v-if="isEditing"
        class="text-sm text-muted"
        data-testid="application-data-editing"
      >
        <!-- The heading shows the editing state while the actions move out of the heading. -->
        {{ t('admin.detail.editingNow') }}
      </span>
      <!-- Locked, not disabled: the button stays reachable by keyboard and reads its reason on focus.
           A labelled button carries no pencil. -->
      <UButton
        v-else
        id="application-data-edit"
        color="neutral"
        variant="outline"
        :aria-disabled="dataEditDisabled ? 'true' : undefined"
        :class="dataEditDisabled ? 'cursor-not-allowed opacity-75' : undefined"
        :title="editDescribedBy ? undefined : dataEditDisabledTitle"
        :aria-describedby="editDescribedBy"
        data-testid="application-data-edit"
        @click="requestEdit"
      >
        {{ t('admin.detail.editData') }}
      </UButton>
      <AdminApplicationDataCorrectionHistory
        v-if="correctionHistory && !isEditing"
        :key="JSON.stringify([correctionHistory.applicationId, correctionHistory.query])"
        :application-id="correctionHistory.applicationId"
        :query="correctionHistory.query"
        :field-label="getFieldLabel"
        :format-value="(key, value) => formatApplicationDataValue(key, value, 'history')"
        :entry-field-ids="historyEntryFieldIds"
      />
    </template>

    <!-- Cancels the card body padding (page: p-4, from sm px-6 pt-4 pb-6) so the save row sits on the card edge. -->
    <div
      v-if="isEditing && schema"
      class="-mx-4 -my-4 sm:-mx-6 sm:-mb-6"
    >
      <div
        v-if="editFieldErrorMessages.length > 0 || showHiddenEditFieldRemovalWarning || pendingTransferWarning"
        class="mx-4 mt-4 space-y-3 sm:mx-6"
      >
        <UAlert
          v-if="pendingTransferWarning"
          :id="pendingTransferWarningId"
          role="status"
          color="warning"
          icon="i-lucide-triangle-alert"
          data-testid="pending-transfer-warning"
          :title="t('caseTransfers.editWarningTitle')"
          :description="pendingTransferWarning"
        />
        <!-- The summary counts invalid fields and links to each one. -->
        <UAlert
          v-if="editFieldErrorMessages.length > 0 && errorTargets.length > 0"
          color="warning"
          role="status"
          icon="i-lucide-triangle-alert"
          data-testid="application-data-error-summary"
        >
          <!-- Use one sentence for the alert title so it does not repeat "prüfen". -->
          <template #title>
            <span>{{ errorTargets.length === 1 ? t('admin.detail.errorSummaryOne') : t('admin.detail.errorSummaryMany', { count: errorTargets.length }) }}</span>
            <template
              v-for="(target, position) in errorTargets"
              :key="`${target.entryKey ?? ''}:${target.fieldId}`"
            >
              {{ ' ' }}<ULink
                as="button"
                type="button"
                class="text-default underline underline-offset-2"
                data-testid="application-data-error-link"
                @click="emit('focus-field', { fieldId: target.fieldId, entryKey: target.entryKey })"
              >{{ target.label }}</ULink>{{ position < errorTargets.length - 1 ? ',' : '.' }}
            </template>
          </template>
        </UAlert>
        <!-- A refusal without a field (conflict, busy, the server's generic sentence): one sentence. -->
        <UAlert
          v-else-if="editFieldErrorMessages.length > 0"
          color="warning"
          role="status"
          icon="i-lucide-triangle-alert"
          :title="editFieldErrorMessages[0]"
          data-testid="application-data-error-sentence"
        />
        <UAlert
          v-if="showHiddenEditFieldRemovalWarning"
          role="status"
          color="warning"
          icon="i-lucide-triangle-alert"
          :title="t('admin.detail.hiddenValuesRemovedTitle')"
          :description="t('admin.detail.hiddenValuesRemovedDescription', { fields: hiddenEditFieldRemovalLabels })"
        />
      </div>
      <AccessReason
        v-if="editFormHasFileField"
        :id="`${labelIdPrefix}-files`"
        class="mx-4 mt-4 sm:mx-6"
        :text="attachmentsCardShown ? t('admin.detail.editFilesReasonCard') : t('admin.detail.editFilesReason')"
      />
      <FormRenderer
        v-if="flatEditSchema && (entryColumnIds.size === 0 || flatEditSchema.sections.length > 0)"
        v-model="editableData"
        :schema="flatEditSchema"
        :field-errors="editFieldErrors"
        :file-uploads-enabled="false"
        audience="staff"
        :staff-file-lines="staffFileLines"
        embedded
        flat-sections
        hide-submit
        @submit="emit('save')"
      />
      <section
        v-for="editor in entryEditors"
        :key="editor.key"
        class="mx-4 mt-6 sm:mx-6"
        :aria-labelledby="`entry-editor-${editor.sectionId}`"
        data-testid="application-data-entry-editor"
      >
        <h3
          :id="`entry-editor-${editor.sectionId}`"
          class="mb-3 text-sm font-semibold text-highlighted"
        >
          {{ editor.title }}
        </h3>
        <div class="space-y-6">
          <div
            v-for="entry in editor.entries"
            :key="entry.key"
            class="border-s-2 border-default ps-4"
            :data-entry-key="entry.key"
            data-testid="application-data-entry"
          >
            <h4 class="mb-2 text-sm font-medium">
              <span class="sr-only">{{ editor.title }}, </span>{{ t('admin.detail.entryNumber', { number: entry.index + 1 }) }}
            </h4>
            <!-- The renderer's own inset (embedded: px-4 py-5 sm:px-6) is cancelled: an entry's fields start on the
                 line of its heading and end on the line of the other sections' fields. -->
            <div class="-mx-4 -my-5 sm:-mx-6">
              <FormRenderer
                :model-value="entryModelFor(editor, entry.index)"
                :schema="entry.schema"
                :field-errors="editEntryErrors?.[entry.key] ?? {}"
                :file-uploads-enabled="false"
                :field-anchor-prefix="`entry-${editor.sectionId}-${entry.index}-`"
                audience="staff"
                embedded
                bare-sections
                hide-submit
                @update:model-value="(model: Record<string, unknown>) => replaceEntryModel(editor, entry.index, model)"
                @submit="emit('save')"
              />
            </div>
          </div>
        </div>
        <div
          v-if="editor.restSchema"
          class="mt-1 -mx-4 -mb-5 sm:-mx-6"
          data-testid="application-data-entry-section-rest"
        >
          <FormRenderer
            v-model="editableData"
            :schema="editor.restSchema"
            :field-errors="editFieldErrors"
            :file-uploads-enabled="false"
            audience="staff"
            :staff-file-lines="staffFileLines"
            embedded
            bare-sections
            hide-submit
            @submit="emit('save')"
          />
        </div>
      </section>
      <!-- Put the correction action first in the bottom row. It sticks to the lower edge of the
           dashboard panel that scrolls (-bottom-4 sm:-bottom-6 = the panel's padding),
           and only while the block with the fields is in view, never over the card's heading. -->
      <div
        class="sticky -bottom-4 z-10 mt-6 flex flex-wrap gap-2 border-t border-default bg-default px-4 py-3 sm:-bottom-6 sm:px-6"
        data-testid="application-data-save-row"
      >
        <UButton
          id="application-data-save"
          :loading="isSaving"
          :disabled="isSaving"
          :aria-describedby="pendingTransferWarning ? pendingTransferWarningId : undefined"
          data-testid="application-data-save"
          @click="emit('save')"
        >
          {{ t('admin.detail.reviewDataCorrection') }}
        </UButton>
        <UButton
          color="neutral"
          variant="ghost"
          :disabled="isSaving"
          data-testid="application-data-cancel"
          @click="emit('cancel')"
        >
          {{ t('common.cancel') }}
        </UButton>
      </div>
    </div>
    <template v-else>
      <UAlert
        v-if="dataEditNotice"
        icon="i-lucide-triangle-alert"
        color="warning"
        :title="dataEditNotice"
        role="status"
      />
      <!-- The reason of a locked card action is the first line of the card body (AppCard's
           body spaces its blocks with space-y-4). -->
      <AccessReason
        v-if="dataEditDisabled && showsReasonLine"
        :id="editReasonId"
        :text="dataEditDisabledTitle"
      />
      <UAlert
        v-if="dataEditDisabledReason === 'schema' || (!dataEditDisabledReason && !schema)"
        :id="schemaAlertId"
        role="status"
        color="warning"
        icon="i-lucide-triangle-alert"
        :title="t('admin.detail.schemaUnavailableTitle')"
        :description="t('admin.detail.schemaUnavailableDescription')"
      />
      <UAlert
        v-else-if="dataEditDisabledReason === 'protected' || protectedDataRedacted"
        :id="protectedAlertId"
        role="status"
        color="warning"
        icon="i-lucide-triangle-alert"
        :title="t('admin.detail.protectedDataRedactedTitle')"
        :description="t(dataEditDisabledReason === 'protected' ? 'admin.detail.protectedDataEditUnavailableDescription' : 'admin.detail.protectedDataRedactedDescription')"
      />
      <div
        v-if="displayItems.length > 0"
        class="grid"
      >
        <template
          v-for="(item, position) in displayItems"
          :key="item.key"
        >
          <h3
            v-if="item.kind === 'section'"
            class="mt-5 mb-1 break-words text-sm font-semibold"
            data-testid="application-data-section-title"
          >
            {{ item.text }}
          </h3>
          <h4
            v-else-if="item.kind === 'entry'"
            class="mt-3 mb-1 break-words text-sm font-medium"
            data-testid="application-data-entry-label"
          >
            {{ item.text }}
          </h4>
          <p
            v-else-if="item.kind === 'empty'"
            class="py-2 text-sm text-(--ui-text-muted)"
            data-testid="application-data-section-empty"
          >
            {{ item.text }}
          </p>
          <div
            v-else
            class="grid min-w-0 gap-1 border-t border-default py-2.5 first:border-t-0 first:pt-0 sm:grid-cols-3 sm:gap-4"
            data-testid="application-data-row"
          >
            <span
              :id="`${labelIdPrefix}-${position}`"
              class="min-w-0 break-words text-sm font-medium text-(--ui-text-muted)"
              data-testid="application-data-label"
            >
              {{ getFieldLabel(item.row.key) }}
            </span>
            <div class="min-w-0 flex-1 sm:col-span-2">
              <p
                v-if="isRedactedApplicationDataValue(item.row.value) || isProtectedApplicationDataValue(item.row.value)"
                class="inline-flex items-center gap-1.5 text-sm text-(--ui-text-muted)"
                :title="t('admin.detail.protectedValueHint')"
                data-protected-value
              >
                <UIcon
                  name="i-lucide-lock"
                  class="size-3.5 shrink-0"
                  aria-hidden="true"
                />
                <span>{{ t('admin.detail.protectedValue') }}</span>
                <span class="sr-only">{{ t('admin.detail.protectedValueHint') }}</span>
              </p>
              <!-- The framework button allows file names to wrap and keeps the framework focus ring.
                   Vertical padding gives it a 24 px target, and the shared text-link style keeps it underlined. -->
              <UButton
                v-else-if="attachmentsForField(item.row.key).length"
                color="neutral"
                variant="link"
                class="inline min-w-0 break-words px-0 py-0.5 text-left text-sm"
                :class="TEXT_LINK_CLASS"
                data-testid="application-data-attachments-link"
                :data-attachments-field="item.row.key"
                :aria-describedby="`${labelIdPrefix}-${position}`"
                @click="emit('open-attachments', item.row.key)"
              >
                {{ attachmentNames(item.row) }}
              </UButton>
              <p
                v-else
                class="min-w-0 break-words text-sm font-medium text-(--ui-text)"
              >
                {{ formatApplicationDataValue(item.row.key, item.row.value) || '-' }}
              </p>
            </div>
          </div>
        </template>
      </div>
      <p
        v-else
        class="text-sm text-(--ui-text-muted)"
      >
        {{ t('citizen.applicationDetail.noData') }}
      </p>
    </template>
  </AppCard>
</template>
