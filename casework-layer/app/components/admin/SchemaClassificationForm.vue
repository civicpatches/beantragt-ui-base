<script setup lang="ts">
import { computed, nextTick, reactive, ref, useId, watch } from 'vue';
import { FORM_FIELD_PRIVACY_KINDS, type FormFieldPrivacyKind } from '~/types/form';
import { isHighRiskPrivacyKind } from '~/utils/form-schema';
import { classificationFieldKey, needsClassification, type DraftClassificationChoice, type DraftClassificationField } from '~~/casework-layer/shared/schema-classification';

const props = defineProps<{
    formId: string
    fields: DraftClassificationField[]
    rejected: DraftClassificationField[]
    editable: boolean
    pending: boolean
}>();
const emit = defineEmits<{ save: [choices: DraftClassificationChoice[]] }>();
const { t, n } = useI18n();
const id = useId();
const classes = reactive<Partial<Record<string, FormFieldPrivacyKind>>>({});
const protection = reactive<Partial<Record<string, boolean>>>({});
const corrected = reactive(new Set<string>());
const attempted = ref(false);

const options = computed(() => FORM_FIELD_PRIVACY_KINDS.map(value => ({
    value,
    label: t(`admin.fieldInspector.privacyKinds.${value}`)
})));
const sections = computed(() => {
    const groups = new Map<number, { title: string, fields: DraftClassificationField[] }>();
    for (const field of props.fields) {
        if (!groups.has(field.sectionIndex)) groups.set(field.sectionIndex, { title: field.sectionTitle, fields: [] });
        groups.get(field.sectionIndex)!.fields.push(field);
    }
    return groups;
});
const rejectedByKey = computed(() => new Map(props.rejected.map(field => [classificationFieldKey(field), field])));

function requiresProtection(field: DraftClassificationField) {
    return !field.protected && (field.highRisk || isHighRiskPrivacyKind(classes[classificationFieldKey(field)]));
}

function reason(field: DraftClassificationField, code: DraftClassificationField['reasons'][number]) {
    const key = code === 'personal_data_classification_missing' && field.highRisk ? 'highRiskClass' : code;
    return t(`admin.forms.classification.reasons.${key}`);
}

function description(field: DraftClassificationField) {
    return [t('admin.forms.classification.position', { position: n(field.fieldIndex + 1) }),
        ...field.reasons.map(code => reason(field, code))].join(' ');
}

function selectError(field: DraftClassificationField) {
    const key = classificationFieldKey(field);
    if (attempted.value && !classes[key]) return t('admin.forms.classification.missingClass');
    if (!corrected.has(key) && rejectedByKey.value.has(key)) {
        return t(field.highRisk ? 'admin.forms.classification.invalidHighRiskClass' : 'admin.forms.classification.invalidClass');
    }
    return undefined;
}

function protectionError(field: DraftClassificationField) {
    return attempted.value && requiresProtection(field) && !protection[classificationFieldKey(field)]
        ? t('admin.forms.classification.missingProtection')
        : undefined;
}

function focusField(field: DraftClassificationField, control: 'class' | 'protection' = 'class') {
    document.getElementById(`${id}-${control}-${classificationFieldKey(field)}`)?.focus();
}

function selectClass(key: string, value: FormFieldPrivacyKind | undefined) {
    classes[key] = value;
    corrected.add(key);
}

watch(() => props.rejected, async ([first]) => {
    corrected.clear();
    if (!first) return;
    await nextTick();
    focusField(first);
});

async function submit() {
    if (!props.editable || props.pending) return;
    attempted.value = true;
    const choices: DraftClassificationChoice[] = [];
    for (const field of props.fields.filter(needsClassification)) {
        const { sectionIndex, fieldIndex } = field;
        const kind = classes[classificationFieldKey(field)];
        const sensitive = requiresProtection(field);
        if (!kind || protectionError(field)) {
            await nextTick();
            focusField(field, kind ? 'protection' : 'class');
            return;
        }
        choices.push({ sectionIndex, fieldIndex, kind, ...(sensitive ? { sensitive: true } : {}) });
    }
    if (choices.length) emit('save', choices);
}
</script>

<template>
  <form
    :id="formId"
    class="space-y-4"
    autocomplete="off"
    @submit.prevent="submit"
  >
    <section
      v-for="[sectionIndex, section] in sections"
      :key="sectionIndex"
      class="space-y-3"
    >
      <h3 class="text-sm font-semibold wrap-anywhere">
        {{ t(section.title ? 'admin.forms.classification.sectionTitle' : 'admin.forms.classification.section', { position: n(sectionIndex + 1), title: section.title }) }}
      </h3>
      <ul class="space-y-3">
        <li
          v-for="field in section.fields"
          :key="classificationFieldKey(field)"
          class="space-y-2 wrap-anywhere"
        >
          <template v-if="editable && needsClassification(field)">
            <UFormField
              :label="field.fieldLabel"
              :description="description(field)"
              :error="selectError(field)"
            >
              <USelect
                :id="`${id}-class-${classificationFieldKey(field)}`"
                :name="`privacy-${classificationFieldKey(field)}`"
                :model-value="classes[classificationFieldKey(field)]"
                :items="options"
                :placeholder="t('admin.forms.classification.placeholder')"
                :disabled="pending"
                class="w-full"
                @update:model-value="selectClass(classificationFieldKey(field), $event)"
              />
            </UFormField>
            <UFormField
              v-if="requiresProtection(field)"
              :error="protectionError(field)"
            >
              <UCheckbox
                :id="`${id}-protection-${classificationFieldKey(field)}`"
                v-model="protection[classificationFieldKey(field)]"
                :name="`protected-${classificationFieldKey(field)}`"
                :label="t('admin.forms.classification.markProtected')"
                :aria-label="t('admin.forms.classification.markFieldProtected', { field: field.fieldLabel })"
                :disabled="pending"
              />
            </UFormField>
          </template>
          <template v-else>
            <p class="text-sm font-medium">
              {{ field.fieldLabel }}
            </p>
            <p class="text-sm text-muted">
              {{ description(field) }}
            </p>
          </template>
        </li>
      </ul>
    </section>
  </form>
</template>
