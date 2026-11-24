<script setup lang="ts">
import type { FormField, FormSchema } from '~/types/form';
import { conditionAnswerLabel } from '~/utils/form-condition-label';
import {
    CONDITION_ANSWER_CHECKED,
    CONDITION_ANSWER_FILLED,
    CONDITION_ANSWER_UNCHECKED,
    conditionAnswerKey,
    conditionAnswerKind,
    conditionFitsKind,
    conditionFromAnswer,
    conditionSourceCandidates,
    conditionSourceState,
    optionAnswerKey
} from '../../utils/field-condition';
import { splitFieldLabel, twinDistinction } from '../../utils/field-label-parts';
import { fieldName } from '../../utils/field-name';

/**
 * "Anzeige" of a field: always, or only when a field of
 * the same section has a given answer. Field and answer come from the form;
 * answers read as citizens see them. Nothing is stored until both are
 * chosen, and the inspector's update path makes each stored change one undo
 * step. A stored condition the control cannot represent stays untouched.
 *
 * One searchable select names the field (its short name, with what tells a
 * twin apart; the full path stays in "Technische Angaben"), its first entry is "Immer anzeigen";
 * up to six answers stand as radio buttons. Group, select, field, answer: four clicks. The control
 * never writes a blank value: "any answer" is no value, a blank option is not offered.
 */
const props = defineProps<{
    schema: FormSchema
    sectionId: string
    field: FormField
    /** Inside the inspector's group "Anzeige" the group title names it; the legend stays for screen readers. */
    hideLegend?: boolean
}>();

const emit = defineEmits<{
    'update:condition': [condition: FormField['conditionalOn'] | undefined]
}>();

const { t, locale } = useI18n();

const ALWAYS = '__always__';
/** Answers up to this many stand as radio buttons (one click), more in a select. */
const MAX_RADIO_ANSWERS = 6;

const stored = computed(() => props.field.conditionalOn);
const storedSignature = computed(() => JSON.stringify(stored.value ?? null));
const sourceDraft = ref<string | undefined>(undefined);
const answerDraft = ref<string | undefined>(undefined);

const idBase = computed(() => `field-condition-${props.field.id}`);
const candidates = computed(() => conditionSourceCandidates(props.schema, props.sectionId, props.field.id));
const allFields = computed(() => props.schema.sections.flatMap(section => section.fields.map(candidate => ({ id: candidate.id, label: candidate.label, sectionTitle: section.title }))));
const sectionTitle = computed(() => props.schema.sections.find(section => section.id === props.sectionId)?.title ?? '');
const sourceItems = computed(() => [
    { label: t('admin.fieldInspector.condition.always'), value: ALWAYS },
    ...candidates.value.map(candidate => ({
        // A field without a label is named as the card names it, never by its key.
        label: splitFieldLabel(candidate.label).name || fieldName(candidate, t('admin.fieldInspector.untitledField')),
        description: twinDistinction(candidate, sectionTitle.value, allFields.value) || undefined,
        value: candidate.id
    }))
]);
/** "Immer anzeigen" while nothing is stored; nothing chosen while a stored condition cannot be shown. */
const sourceValue = computed(() => sourceDraft.value ?? (stored.value ? undefined : ALWAYS));
const noCandidates = computed(() => candidates.value.length === 0 && !stored.value);
const source = computed(() => candidates.value.find(candidate => candidate.id === sourceDraft.value) ?? null);
const sourceKind = computed(() => source.value ? conditionAnswerKind(source.value) : null);

const storedSourceState = computed(() => stored.value?.fieldId
    ? conditionSourceState(props.schema, props.sectionId, props.field.id, stored.value.fieldId)
    : null
);
const storedSourceLabel = computed(() => {
    const id = stored.value?.fieldId;
    if (!id) return '';
    const field = props.schema.sections.flatMap(section => section.fields).find(candidate => candidate.id === id);
    return field?.label || id;
});
const storedSourceField = computed(() => {
    const id = stored.value?.fieldId;
    return id ? candidates.value.find(candidate => candidate.id === id) ?? null : null;
});
/** The stored condition can be shown in the two selects as it is. */
const storedRepresentable = computed(() => Boolean(
    stored.value
    && storedSourceState.value === 'same_section'
    && storedSourceField.value
    && conditionFitsKind(stored.value, conditionAnswerKind(storedSourceField.value))
));
/** Why a stored condition cannot be shown in the two selects; empty when it can. */
const storedNotice = computed(() => {
    if (stored.value && storedSourceState.value === 'same_section' && !storedRepresentable.value) {
        const value = stored.value.value;
        return t('admin.fieldInspector.condition.unsupportedValue', {
            field: storedSourceLabel.value,
            value: value === undefined ? t('admin.fieldInspector.condition.answerAny') : String(value)
        });
    }
    switch (storedSourceState.value) {
        case 'other_section':
            return t('admin.fieldInspector.condition.otherSection', { field: storedSourceLabel.value });
        case 'missing':
            // "Not checked" of a missing source is always met: the answer is kept.
            return t(stored.value?.value === false ? 'admin.fieldInspector.condition.missingSourceKept' : 'admin.fieldInspector.condition.missingSource', { id: storedSourceLabel.value });
        case 'excluded':
            return t('admin.fieldInspector.condition.excludedSource', { field: storedSourceLabel.value });
        default:
            break;
    }
    // An answer the select or radio source no longer offers.
    const condition = stored.value;
    const field = storedSourceField.value;
    if (storedRepresentable.value && condition && field && typeof condition.value === 'string'
      && conditionAnswerKind(field) === 'option' && !(field.options ?? []).includes(condition.value)) {
        return t('admin.fieldInspector.condition.staleAnswerNotice', { field: storedSourceLabel.value, value: condition.value });
    }
    return '';
});

const answerItems = computed(() => {
    const field = source.value;
    if (!field) return [];
    const items = sourceKind.value === 'option'
        ? [
            // A blank option is never a condition value (it would be refused on save).
            ...(field.options ?? []).filter(option => option.trim() !== '').map(option => ({
                label: conditionAnswerLabel(field, option, String(locale.value || 'de')),
                value: optionAnswerKey(option)
            })),
            { label: t('admin.fieldInspector.condition.answerAny'), value: CONDITION_ANSWER_FILLED }
        ]
        : sourceKind.value === 'toggle'
            ? [
                { label: t('admin.fieldInspector.condition.answerChecked'), value: CONDITION_ANSWER_CHECKED },
                { label: t('admin.fieldInspector.condition.answerUnchecked'), value: CONDITION_ANSWER_UNCHECKED }
            ]
            : [];
    // A stored answer that is no longer an option is shown as it is stored.
    if (answerDraft.value && !items.some(item => item.value === answerDraft.value) && stored.value?.fieldId === field.id) {
        items.push({
            label: t('admin.fieldInspector.condition.staleAnswer', { value: String(stored.value.value ?? '') }),
            value: answerDraft.value
        });
    }
    return items;
});

/**
 * The stored condition read back in one plain sentence, from the stored
 * value and the answer texts citizens see. Only for a condition the control
 * can show; the notices above speak for the others.
 */
const readBack = computed(() => {
    const condition = stored.value;
    const field = storedSourceField.value;
    if (!condition || !field || !storedRepresentable.value) return '';
    const source = fieldName(field, t('admin.fieldInspector.untitledField'));
    if (condition.value === undefined) {
        return t(conditionAnswerKind(field) === 'option' ? 'admin.fieldInspector.condition.readBackAny' : 'admin.fieldInspector.condition.readBackFilled', { field: source });
    }
    if (typeof condition.value === 'boolean') {
        return t(condition.value ? 'admin.fieldInspector.condition.readBackChecked' : 'admin.fieldInspector.condition.readBackUnchecked', { field: source });
    }
    if (!(field.options ?? []).includes(condition.value)) return '';
    return t('admin.fieldInspector.condition.readBackAnswer', {
        field: source,
        answer: conditionAnswerLabel(field, condition.value, String(locale.value || 'de'))
    });
});

const incomplete = computed(() => Boolean(source.value) && sourceKind.value !== 'filled' && !answerDraft.value);

function syncFromStored() {
    const condition = stored.value;
    const representable = condition && storedRepresentable.value;
    sourceDraft.value = representable ? condition.fieldId : undefined;
    answerDraft.value = representable ? conditionAnswerKey(condition) : undefined;
}

watch([() => props.field.id, storedSignature], syncFromStored, { immediate: true });

function commit() {
    const field = source.value;
    if (!field) return;
    const answer = sourceKind.value === 'filled' ? CONDITION_ANSWER_FILLED : answerDraft.value;
    if (!answer) return;
    const next = conditionFromAnswer(field.id, answer);
    if (!next || JSON.stringify(next) === storedSignature.value) return;
    emit('update:condition', next);
}

function onSourceChange(value: unknown) {
    if (typeof value !== 'string') return;
    if (value === ALWAYS) {
        sourceDraft.value = undefined;
        answerDraft.value = undefined;
        if (stored.value) emit('update:condition', undefined);
        return;
    }
    sourceDraft.value = value;
    answerDraft.value = undefined;
    commit();
}

function onAnswerChange(value: unknown) {
    if (typeof value !== 'string') return;
    answerDraft.value = value;
    commit();
}
</script>

<template>
  <div
    class="space-y-3"
    data-testid="field-condition"
  >
    <p
      v-if="storedNotice"
      class="text-sm text-(--ui-text-muted)"
      data-testid="field-condition-notice"
    >
      {{ storedNotice }}
    </p>

    <UFormField
      :label="hideLegend ? t('admin.fieldInspector.condition.showWhen') : t('admin.fieldInspector.condition.title')"
      :description="noCandidates ? t('admin.fieldInspector.condition.noCandidates') : undefined"
      :name="`${idBase}-source`"
    >
      <USelectMenu
        :model-value="sourceValue"
        :items="sourceItems"
        value-key="value"
        :filter-fields="['label', 'description']"
        :search-input="{ placeholder: t('admin.fieldInspector.condition.searchPlaceholder') }"
        :placeholder="t('admin.fieldInspector.condition.sourcePlaceholder')"
        :disabled="noCandidates"
        class="w-full"
        data-testid="field-condition-source"
        @update:model-value="onSourceChange"
      />
    </UFormField>

    <div
      v-if="source"
      class="space-y-3 border-s-2 border-(--ui-border) ps-3"
    >
      <UFormField
        v-if="sourceKind !== 'filled'"
        :label="t('admin.fieldInspector.condition.answer')"
        :name="`${idBase}-answer`"
      >
        <URadioGroup
          v-if="answerItems.length <= MAX_RADIO_ANSWERS"
          :model-value="answerDraft"
          :items="answerItems"
          data-testid="field-condition-answer"
          @update:model-value="onAnswerChange"
        />
        <USelect
          v-else
          :model-value="answerDraft"
          :items="answerItems"
          :placeholder="t('admin.fieldInspector.condition.answerPlaceholder')"
          class="w-full"
          data-testid="field-condition-answer"
          @update:model-value="onAnswerChange"
        />
      </UFormField>
      <p
        v-else-if="!readBack"
        class="text-sm text-(--ui-text-muted)"
        data-testid="field-condition-filled"
      >
        {{ t('admin.fieldInspector.condition.filledOnly', { field: fieldName(source, t('admin.fieldInspector.untitledField')) }) }}
      </p>
    </div>

    <p
      v-if="readBack && !incomplete"
      class="text-sm text-(--ui-text-highlighted)"
      data-testid="field-condition-readback"
    >
      {{ readBack }}
    </p>

    <p
      v-if="incomplete"
      class="text-sm text-(--ui-text-muted)"
      role="status"
      data-testid="field-condition-incomplete"
    >
      {{ t('admin.fieldInspector.condition.incomplete') }}
    </p>
  </div>
</template>
