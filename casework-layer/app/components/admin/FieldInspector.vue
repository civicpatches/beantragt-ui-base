<script setup lang="ts">
import { toRef } from 'vue';
import { numberFieldIds } from '~/utils/attachment-result-schema';
import type { FieldAnalysisContext } from '../../utils/staff-form-features';
import { useEditorTextDraft, type CommitEditorText } from '../../composables/useEditorTextDraft';
import type { FormField, FormFieldFormat, FormFieldPrivacyKind, FormFieldType, FormFieldValidation, FormSchema } from '~/types/form';
import { FORM_FIELD_FORMATS, FORM_FIELD_PRIVACY_KINDS, FORM_FIELD_TYPES } from '~/types/form';
import { collectFieldAuthoringIssues, duplicateCrmKeys, inferFormFieldPrivacyKind, isSensitiveFlag, normalizeFormField, validationPatternRefusal, type SchemaAuthoringIssueCode, type ValidationPatternRefusal } from '~/utils/form-schema';
import { brokenConditions, type BrokenCondition } from '../../utils/field-condition';
import { formPrivacyContext } from '~/utils/privacy-catalog';
import { privacyHintForField } from '~/utils/privacy-suggestion';
import { docgenFieldPlaceholder } from '../../utils/docgen';
import FieldConditionSetting from './FieldConditionSetting.vue';
import FieldCrmKeySetting from './FieldCrmKeySetting.vue';
import type { RouteLocationRaw } from 'vue-router';
import InspectorGroup from './editor/InspectorGroup.vue';
import { splitFieldLabel, twinDistinction } from '../../utils/field-label-parts';
import { fieldForType, SETTING_LABEL_KEYS, settingApplies, TYPE_GROUP_SETTINGS, typeGroupShown, valuesNotForType, withoutRulesBroughtBy, type FieldTypeSetting, type TypeGroup } from '../../utils/field-type-settings';
import { ACCEPTED_ATTACHMENT_TYPE_NAMES, ATTACHMENT_MAX_FILES_PER_FIELD, ATTACHMENT_MAX_SIZE_BYTES } from '~/utils/attachment-limits';

const props = defineProps<{
    schema: FormSchema
    sectionId?: string | null
    fieldId?: string | null
    /** Saved form id: the disclosure box resolves the provider in its tenant scope. */
    formId?: string | null
    /**
     * Link to the tenant's attachment storage ("Speicher für Anlagen"); without it, the sentence only.
     * a route location as `workspaceRoute` gives it (an object with `path`), or a path.
     */
    uploadsSettingsTo?: RouteLocationRaw | null
    /** The editor's condition findings (with this session's type changes); without it, read from the schema. */
    conditionFindings?: BrokenCondition[] | null
    /** The save was refused for this field's condition: the sentence to show. */
    conditionRefusal?: string | null
}>();

const emit = defineEmits<{
    'update:schema': [schema: FormSchema]
    'text-input': [commit: CommitEditorText]
    /** Puts a request into the chat input without sending it. */
    'prefill-chat': [message: string]
    /** Closes the inspector (its one close control). */
    'close': []
    /** Escape in "Beschriftung": back to the field on the canvas. */
    'return-to-field': []
}>();

const { t } = useI18n();
const toast = useToast();

function sourceReferenceText(value: string): string {
    const position = /^part:(\d+):line:(\d+)(?:\.[a-zA-Z]+)?$/u.exec(value);
    return position ? t('admin.forms.sourcePosition', { part: position[1]!, line: position[2]! }) : value;
}

const NO_FORMAT_VALUE = '__none__';
const NO_PRIVACY_KIND_VALUE = '__none__';
const MAX_PATTERN_LENGTH = 160;
const UPLOAD_BYTES_PER_MEGABYTE = 1024 * 1024;
type NumberValidationKey = Extract<keyof FormFieldValidation, 'minLength' | 'maxLength' | 'min' | 'max' | 'step'>;
type UploadValidationKey = Extract<keyof FormFieldValidation, 'maxFiles'>;
type NumericValidationKey = NumberValidationKey | UploadValidationKey;
const numberValidationKeys: NumberValidationKey[] = ['minLength', 'maxLength', 'min', 'max', 'step'];
const uploadValidationKeys: UploadValidationKey[] = ['maxFiles'];
const numericValidationKeys: NumericValidationKey[] = [...numberValidationKeys, ...uploadValidationKeys];
const validationDrafts = reactive<Record<NumericValidationKey, string>>({
    minLength: '',
    maxLength: '',
    min: '',
    max: '',
    step: '',
    maxFiles: ''
});
const focusedValidationKey = ref<NumericValidationKey | null>(null);
const uploadSizeMegabytesDraft = ref('');
const uploadSizeFocused = ref(false);
const technicalOpen = ref(false);
const uploadLimitsOpen = ref(false);
/** Field id whose redaction was just suggested after a policy choice (session state only). */
function findSelectedField(schema: FormSchema) {
    if (!props.sectionId || !props.fieldId) return null;

    const sectionIndex = schema.sections.findIndex(section => section.id === props.sectionId);
    if (sectionIndex === -1) return null;
    const section = schema.sections[sectionIndex];
    if (!section) return null;

    const fieldIndex = section.fields.findIndex(field => field.id === props.fieldId);
    if (fieldIndex === -1) return null;
    const field = section.fields[fieldIndex];
    if (!field) return null;

    return {
        sectionIndex,
        fieldIndex,
        section,
        field
    };
}

const selectedLocation = computed(() => findSelectedField(props.schema));
const selectedField = computed(() => selectedLocation.value?.field ?? null);
const selectedSection = computed(() => selectedLocation.value?.section ?? null);

let focusResultList: (() => void) | null = null;
const analysisContext: FieldAnalysisContext = {
    schema: toRef(props, 'schema'),
    formId: toRef(props, 'formId'),
    selectedField,
    updateField: (updater, schema) => emitFieldUpdate(updater, { schema }),
    queueTextCommit,
    prefillChat: message => emit('prefill-chat', message),
    setResultListFocus(focus) {
        focusResultList = focus;
    }
};
/** Placeholder of this field in decision templates, ready to paste into Word. */
const docgenPlaceholder = computed(() => docgenFieldPlaceholder(selectedSection.value, selectedField.value));

async function copyDocgenPlaceholder() {
    if (!docgenPlaceholder.value) return;
    try {
        await navigator.clipboard.writeText(docgenPlaceholder.value.copy);
        toast.add({ title: t('docgenUi.form.copied'), description: t('docgenUi.form.copiedDescription'), color: 'success', icon: 'i-lucide-clipboard-check' });
    } catch {
        toast.add({ title: t('docgenUi.form.copyFailed'), color: 'error', icon: 'i-lucide-clipboard-x' });
    }
}
/*
 * The inspector follows the type. It shows exactly the settings of the
 * field's type (`FIELD_TYPE_SETTINGS` in `utils/field-type-settings.ts`, the one table) and
 * hides the rest; a group without any of them does not appear. Values that do not belong to
 * the type go when the type changes (`fieldForType`); a field saved earlier with such values
 * names them once, with "Entfernen".
 */
function shows(setting: FieldTypeSetting): boolean {
    return selectedField.value ? settingApplies(selectedField.value, setting) : false;
}
function groupShown(group: TypeGroup): boolean {
    return selectedField.value ? typeGroupShown(selectedField.value, group) : false;
}
const valuesNotForSelectedType = computed(() => selectedField.value ? valuesNotForType(selectedField.value) : []);
const valuesNotForTypeText = computed(() => t('admin.fieldInspector.valuesNotForType', {
    // Each leftover by the label of its own input field.
    settings: valuesNotForSelectedType.value.map(setting => SETTING_LABEL_KEYS[setting].map(key => t(key)).join(', ')).join(', ')
}));

/*
 * "Entfernen" took the leftover and the recognition note away at
 * once, and the groups below moved up 177 px under the pointer. The focus goes to "Typ", above the notes, so an anchored scroll would move "Typ" instead. The confirmation takes the
 * place: the notes keep their height and say what was removed.
 */
/*
 * The hold ended with the next change, so a control below the notes moved up under the
 * caret while it was edited. The height is held until the selection changes (another field or none).
 * The sentence is a separate thing: it stands only while the field is exactly as "Entfernen" left it.
 * After "Rückgängig" (the leftover is back) or any further change of the field it goes, because
 * "Rückgängig" would then undo something else.
 */
const typeNotes = ref<HTMLElement | null>(null);

/*
 * The inspector kept its scroll position when another field was
 * selected (set to 300, after the selection 204): the title stood, "Beschriftung" was above the edge.
 * A newly selected field starts at the inspector's top. Only a write, after the new field's content is
 * in place, so no layout is read; the same field (an update, an undo) keeps its place.
 */
const inspectorBody = ref<HTMLElement | null>(null);
watch(() => props.fieldId, (now, before) => {
    if (now !== before && inspectorBody.value) inspectorBody.value.scrollTop = 0;
}, { flush: 'post' });
const notesHold = ref<{ fieldId: string, height: number, text: string, plain: string, after: string, before: string, inference: typeof inferenceNote.value } | null>(null);
const removedTextShown = computed(() => {
    const hold = notesHold.value;
    const field = selectedField.value;
    return Boolean(hold && field && hold.fieldId === field.id && JSON.stringify(field) === hold.after);
});
/*
 * After the first keystroke the sentence went and an empty box of 160 px
 * stayed under "Typ" until another field was selected. While the place is held it says, plainly,
 * what was removed: no promise that "Rückgängig" brings it back (it would undo the keystroke), and
 * nothing moves (the height is still held until another selection).
 */
/*
 * After "Rückgängig" the leftover came back, but the recognition's sentence did
 * not, so "Entfernen" stood 68 px higher than where it was pressed. When the field is again exactly
 * as it was before "Entfernen", the sentence comes back too: the notes are as they were.
 */
watch(() => selectedField.value ? JSON.stringify(selectedField.value) : '', (json) => {
    const hold = notesHold.value;
    if (!hold || json !== hold.before || !hold.inference) return;
    inferenceNote.value = hold.inference;
});

const removedPlainShown = computed(() => {
    const hold = notesHold.value;
    const field = selectedField.value;
    return Boolean(hold && field && hold.fieldId === field.id && !removedTextShown.value && valuesNotForSelectedType.value.length === 0);
});

function removeValuesNotForType() {
    const field = selectedField.value;
    if (!field) return;
    const height = typeNotes.value?.offsetHeight ?? 0;
    const removed = valuesNotForSelectedType.value.map(setting => SETTING_LABEL_KEYS[setting].map(key => t(key)).join(', ')).join(', ');
    // What stood here before, so "Rückgängig" puts it back where it was.
    const before = JSON.stringify(field);
    const inference = inferenceNote.value;
    // As emitFieldUpdate writes it (normalised), so the comparison below holds until something changes.
    const after = normalizeFormField(fieldForType(field, field.type));
    emitFieldUpdate(current => fieldForType(current, current.type));
    notesHold.value = {
        fieldId: field.id,
        before,
        inference,
        height,
        text: t('admin.fieldInspector.valuesNotForTypeRemoved', { settings: removed }),
        plain: t('admin.fieldInspector.valuesNotForTypeRemovedPlain', { settings: removed }),
        after: JSON.stringify(after)
    };
    // The button goes with what it removed; the focus goes to "Typ", not the page.
    void focusType();
}

/* What is fixed by the form (set when it was compiled or imported), named with its value. */
const selectedAddressGroup = computed(() => {
    const field = selectedField.value;
    return field ? selectedSection.value?.addressGroups?.find(group => Object.values(group.fields).includes(field.id)) ?? null : null;
});
function onOff(value: boolean | undefined): string {
    return t(`admin.fieldInspector.fixed.${value ? 'on' : 'off'}`);
}
const fixedSettingLines = computed(() => {
    const field = selectedField.value;
    if (!field) return [];
    const lines: string[] = [];
    if (field.computed) {
        const labels = field.computed.args.map(id => props.schema.sections.flatMap(section => section.fields).find(candidate => candidate.id === id)?.label || id);
        lines.push(t('admin.fieldInspector.fixed.computed', { fields: labels.join(', ') }));
    }
    const widget = field.type === 'address' ? field.widget : selectedAddressGroup.value;
    if (widget) {
        lines.push(t('admin.fieldInspector.fixed.address', {
            group: selectedAddressGroup.value?.label || t('admin.fieldInspector.fixed.addressField'),
            search: onOff(widget.autocomplete !== false),
            map: onOff(widget.map === true),
            boundary: onOff(widget.boundary === 'advisory')
        }));
    }
    if (selectedSection.value?.repeatable) {
        lines.push(t('admin.fieldInspector.fixed.repeatable', { count: selectedSection.value.maxInstances ?? 0 }, selectedSection.value.maxInstances ?? 0));
    }
    return lines;
});
const showsOptions = computed(() => shows('options'));
/** A select or radio without any answer says so (a tick box without options is one box). */
const optionsMissing = computed(() => {
    const field = selectedField.value;
    return !!field && (field.type === 'select' || field.type === 'radio') && !(field.options?.length);
});
const showsUploadLimits = computed(() => shows('uploadLimits'));
const maxSizeMegabytesCeiling = ATTACHMENT_MAX_SIZE_BYTES / (1024 * 1024);
const uploadProductLimitsText = computed(() => t('admin.fieldInspector.uploadProductLimits', {
    types: ACCEPTED_ATTACHMENT_TYPE_NAMES.join(', '),
    files: ATTACHMENT_MAX_FILES_PER_FIELD,
    size: maxSizeMegabytesCeiling
}));
function queueTextCommit(commit: CommitEditorText) {
    emit('text-input', commit);
}

const optionsInput = useEditorTextDraft(() => selectedField.value?.options?.join('\n') ?? '', (text, schema) => {
    const options = text.split('\n').map(option => option.trim()).filter(Boolean);
    emitFieldUpdate(field => ({ ...field, options }), { schema });
    return options.join('\n');
}, queueTextCommit);
const validationSignature = computed(() => JSON.stringify(selectedField.value?.validation ?? {}));
const selectedFieldAuthoringIssues = computed(() => selectedField.value
    ? collectFieldAuthoringIssues(selectedField.value, {
        sectionId: selectedSection.value?.id,
        sectionTitle: selectedSection.value?.title,
        numberFieldIds: numberFieldIds(props.schema),
        duplicateCrmKeys: duplicateCrmKeys(props.schema)
    })
    : []
);

/*
 * The error line under the emptied label pushed "Pflichtfeld",
 * "Typ" and the groups 28 px down, and back with the first character. The framework's `UFormField` still
 * carries the error (the input's `aria-invalid` and its description), but the sentence stands in the label's
 * own row, at its end, where the framework puts a hint: nothing below the input moves. The sentence is short,
 * so it fits beside "Beschriftung" down to 320 px (about 84 + 105 of 288 px).
 */
const LABEL_FIELD_UI = { error: 'absolute bottom-full end-0 mt-0 mb-1 whitespace-nowrap' };
/*
 * The same for "Antwortmöglichkeiten", whose label row has a description below it: the
 * field itself is the positioned box (not the input's container), so the sentence stands at the top
 * end, in the label's row, over neither the description nor the input.
 */
const OPTIONS_FIELD_UI = { root: 'relative', container: 'static', error: 'absolute top-0 end-0 mt-0 whitespace-nowrap' };

/** The ids of the explanations that stand at their controls (no info buttons any more). */
const SENSITIVE_DESCRIPTION_ID = 'field-inspector-sensitive-description';

/** The field's own name and the rest of its label (the catalogue path), for head and "Technische Angaben". */
const labelParts = computed(() => splitFieldLabel(selectedField.value?.label ?? ''));
/** A twin ("Postfach" twice) carries the part that tells it apart. */
const titleDistinction = computed(() => {
    const field = selectedField.value;
    if (!field) return '';
    const others = props.schema.sections.flatMap(section => section.fields.map(candidate => ({ id: candidate.id, label: candidate.label, sectionTitle: section.title })));
    return twinDistinction(field, selectedSection.value?.title ?? '', others);
});

/*
 * Since the distinction keeps its place, the name had 146 px at
 * 1440 px, and a catalogue name like "Anschrift Inland Postfachanschrift: Postfach" was cut to
 * "Anschrift Inland P…", the same for "Postleitzahl" and "Ort" of that group. The last path segment stays
 * the name (a "Gruppe: Name" segment is kept whole, `splitFieldLabel`), but in the title its part before
 * the last ": ", which the group's fields share, is what gets cut; the part after it, the field's own
 * name, stays visible. The popover keeps the full label.
 */
const titleName = computed(() => {
    const name = labelParts.value.name || selectedField.value?.label || '';
    const index = name.lastIndexOf(': ');
    if (index <= 0 || index + 2 >= name.length) return { common: '', own: name };
    return { common: name.slice(0, index + 2), own: name.slice(index + 2) };
});

/*
 * The title's popover shows the full label once. The distinction is added only when
 * the label does not already contain it (a twin's distinction is often a part of its own label).
 */
const titleFull = computed(() => {
    const label = selectedField.value?.label.trim() ? selectedField.value.label : t('admin.fieldInspector.untitledField');
    const distinction = titleDistinction.value;
    return distinction && !label.includes(distinction) ? `${label} · ${distinction}` : label;
});

/**
 * The groups of the inspector. A group is open when something in it is set
 * or missing; each field opens them anew, and a jump from the head's findings opens the
 * group that answers the finding (`revealGroup`).
 */
type InspectorGroupName = 'format' | 'display' | 'privacy' | 'profile' | 'validation' | 'attachments' | 'docgen' | 'technical';
const ISSUE_GROUP: Record<SchemaAuthoringIssueCode, InspectorGroupName> = {
    high_risk_unmarked: 'privacy',
    personal_data_classification_missing: 'privacy',
    risky_crm_key: 'profile',
    duplicate_crm_key: 'profile',
    purpose_bound_needs_sovereign: 'attachments',
    purpose_bound_compare_invalid: 'attachments',
    staff_prompt_inactive: 'attachments'
};
const groupsOpen = reactive<Record<InspectorGroupName, boolean>>({
    format: false,
    display: false,
    privacy: false,
    profile: false,
    validation: false,
    attachments: false,
    docgen: false,
    technical: false
});

function groupIssues(group: InspectorGroupName) {
    return selectedFieldAuthoringIssues.value.filter(issue => ISSUE_GROUP[issue.code] === group);
}

function groupIssueText(group: InspectorGroupName): string {
    return groupIssues(group).map(issue => t(`admin.fieldInspector.authoringIssues.${issue.code}`)).join(' ');
}

/*
 * A broken condition is named at both fields: at the field that carries it (why it does not
 * work) and at its source (which fields depend on this answer, and which of them no longer fit).
 */
const conditionFindings = computed(() => props.conditionFindings ?? brokenConditions(props.schema, [], t('admin.fieldInspector.untitledField')));
function conditionFindingText(item: BrokenCondition): string {
    const key = item.reason === 'missing' && item.value === false ? 'missingKept' : item.reason;
    return t(`admin.forms.conditionBroken.${key}`, { field: item.fieldLabel, source: item.sourceLabel, value: String(item.value ?? '') });
}
const selectedConditionFinding = computed(() => {
    const field = selectedField.value;
    const item = field ? conditionFindings.value.find(condition => condition.fieldId === field.id) : undefined;
    return item ? conditionFindingText(item) : '';
});
const selectedFieldDependents = computed(() => {
    const field = selectedField.value;
    if (!field) return [];
    return props.schema.sections.flatMap(section => section.fields)
        .filter(candidate => candidate.conditionalOn?.fieldId === field.id)
        .map(candidate => candidate.label || candidate.id);
});
const selectedFieldDependentFindings = computed(() => {
    const field = selectedField.value;
    return field ? conditionFindings.value.filter(condition => condition.sourceId === field.id).map(conditionFindingText) : [];
});

const selectedFieldHasBrokenCondition = computed(() => {
    const field = selectedField.value;
    return !!field && conditionFindings.value.some(condition => condition.fieldId === field.id);
});

const effectiveMaxFiles = computed(() => selectedField.value?.validation?.maxFiles ?? selectedField.value?.maxFiles);
const effectiveMaxBytes = computed(() => selectedField.value?.validation?.maxSizeBytes ?? selectedField.value?.validation?.maxFileSizeBytes
  ?? selectedField.value?.maxSizeBytes ?? selectedField.value?.maxFileSizeBytes);
const uploadLimitsDiffer = computed(() => (effectiveMaxFiles.value !== undefined && effectiveMaxFiles.value !== ATTACHMENT_MAX_FILES_PER_FIELD)
  || (effectiveMaxBytes.value !== undefined && effectiveMaxBytes.value !== ATTACHMENT_MAX_SIZE_BYTES));
watch(uploadLimitsDiffer, (different) => {
    if (different) uploadLimitsOpen.value = true;
});
watch(() => selectedField.value?.id, () => {
    const field = selectedField.value;
    uploadLimitsOpen.value = uploadLimitsDiffer.value;
    technicalOpen.value = false;
    const validation = field?.validation ?? {};
    groupsOpen.format = Boolean(field?.placeholder || field?.format);
    groupsOpen.display = Boolean(field?.conditionalOn) || selectedFieldHasBrokenCondition.value || selectedFieldDependentFindings.value.length > 0;
    groupsOpen.privacy = Boolean(field?.privacy?.kind) || isSensitiveFlag(field?.sensitive) || groupIssues('privacy').length > 0;
    groupsOpen.profile = Boolean(field?.crm_key) || groupIssues('profile').length > 0;
    groupsOpen.validation = (['minLength', 'maxLength', 'min', 'max', 'step', 'pattern'] as const)
        .some(key => validation[key] !== undefined && validation[key] !== '');
    groupsOpen.attachments = field?.type === 'file' && (
        Boolean(field.analysis)
        || uploadLimitsDiffer.value
        || validation.maxFiles !== undefined
        || validation.maxSizeBytes !== undefined
        || groupIssues('attachments').length > 0
    );
    groupsOpen.docgen = false;
    groupsOpen.technical = false;
}, { immediate: true });

// The type changes on the same field: every group the new type brings in opens at once,
// the others keep their state (a group never closes by itself).
watch(() => [selectedField.value?.id, selectedField.value?.type] as const, ([id, type], [previousId, previousType]) => {
    const field = selectedField.value;
    if (!field || !type || !previousType || id !== previousId || type === previousType) return;
    for (const group of Object.keys(TYPE_GROUP_SETTINGS) as TypeGroup[]) {
        if (typeGroupShown(field, group) && !typeGroupShown(field, group, previousType)) groupsOpen[group] = true;
    }
});

// Something goes missing while the field is edited: its group opens (it never closes by itself).
watch(() => selectedFieldAuthoringIssues.value.map(issue => ISSUE_GROUP[issue.code]), (now, before) => {
    for (const group of now) {
        if (!before?.includes(group)) groupsOpen[group] = true;
    }
});
watch(selectedFieldHasBrokenCondition, (broken) => {
    if (broken) groupsOpen.display = true;
});
watch(() => props.conditionRefusal, (refusal) => {
    if (refusal) groupsOpen.display = true;
}, { immediate: true });

/**
 * Opens a group and brings it into view, the focus on its first control: "wer wegen einer
 * bestimmten Angabe kommt, landet bei ihr" (rule 6). Called by the editor after a jump.
 */
async function revealGroup(group: string) {
    if (group === 'resultList') {
        groupsOpen.attachments = true;
        await nextTick();
        focusResultList?.();
        return;
    }
    if (!(group in groupsOpen)) return;
    groupsOpen[group as InspectorGroupName] = true;
    await nextTick();
    const element = document.querySelector<HTMLElement>(`[data-inspector-group="${group}"]`);
    if (!element) return;
    // Centred, so the setting is in view below the list of findings that stays open.
    element.scrollIntoView?.({ block: 'center' });
    // The setting that carries the finding first, else the group's first control.
    const content = '[data-inspector-group-content]';
    const control = element.querySelector<HTMLElement>(`${content} [aria-invalid="true"]`)
      ?? element.querySelector<HTMLElement>(`${content} :is(input, select, textarea, button, [role="combobox"]):not([disabled])`);
    control?.focus();
}

/**
 * After the question "Feldtyp ändern?" and after "Entfernen" the focus
 * goes back to "Typ" (the control that started it), not to the page.
 */
async function focusType() {
    await nextTick();
    document.querySelector<HTMLElement>('[data-inspector-type]')?.focus();
}

defineExpose({ revealGroup, focusType });

/*
 * When typing a label makes the editor infer the type, the
 * input check or the privacy class (the inference itself is unchanged), the inspector says
 * so where the label was typed. The note names what changed from the catalogues of types,
 * formats and privacy classes, and it lives until another setting of the field is changed
 * or another field is selected.
 */
interface InferredValues {
    type: FormField['type']
    format: FormField['format']
    validation: string
    privacyKind: FormFieldPrivacyKind | undefined
}
/**
 * `baseField` is the field as it was before the typing burst: every keystroke
 * recognises from it and the label typed so far, so what an earlier part of the label made
 * the recognition try (a detour via "IBAN") leaves nothing behind once the label no longer says it.
 */
const inferenceNote = ref<{ fieldId: string, before: InferredValues, baseField: FormField, written: FormField } | null>(null);

function inferredValues(field: FormField): InferredValues {
    return {
        type: field.type,
        format: field.format,
        validation: JSON.stringify(field.validation ?? {}),
        privacyKind: field.privacy?.kind
    };
}

function inferenceChanges(before: InferredValues, after: InferredValues) {
    return {
        type: before.type !== after.type,
        format: before.format !== after.format,
        validation: before.validation !== after.validation,
        privacy: before.privacyKind !== after.privacyKind
    };
}

/*
 * The note was four sentences and 120 px high under "Typ". One
 * sentence says what was recognised and what was set; what can still be changed is on demand
 * (`holds`, in a popover behind one link).
 */
const inferenceNoteText = computed(() => {
    const note = inferenceNote.value;
    const field = selectedField.value;
    if (!note || !field || note.fieldId !== field.id) return '';
    const changed = inferenceChanges(note.before, inferredValues(field));
    const parts: string[] = [];
    // The note says what is stored: the type, the format, and the check by its name
    // when it is the one the type or format brings ("Als Text erkannt" alone hid the format).
    if (changed.type) parts.push(t('admin.fieldInspector.inference.type', { type: t(`admin.fieldInspector.fieldTypes.${field.type}`) }));
    if (changed.format) parts.push(t('admin.fieldInspector.inference.format', { format: t(`admin.fieldInspector.fieldFormats.${field.format ?? 'none'}`) }));
    if (changed.validation) {
        const ownCheck = normalizeFormField({ id: 'probe', type: field.type, label: '', format: field.format }).validation ?? {};
        const named = Object.keys(ownCheck).length > 0 && stableJson(ownCheck) === stableJson(field.validation ?? {});
        parts.push(named
            ? t('admin.fieldInspector.inference.validationFor', {
                name: field.format ? t(`admin.fieldInspector.fieldFormats.${field.format}`) : t(`admin.fieldInspector.fieldTypes.${field.type}`)
            })
            : t('admin.fieldInspector.inference.validation'));
    }
    if (changed.privacy) {
        parts.push(field.privacy?.kind
            ? t('admin.fieldInspector.inference.privacy', { kind: t(`admin.fieldInspector.privacyKinds.${field.privacy.kind}`) })
            : t('admin.fieldInspector.inference.privacyNone'));
    }
    if (parts.length === 0) return null;
    // What the person can change today, and what not (the inference runs again on every
    // edit and every load; probed against the same functions, see the).
    const holds: string[] = [];
    if (changed.type && normalizeFormField({ ...field, type: 'text' }).type !== 'text') {
        holds.push(t('admin.fieldInspector.inference.keepType', { type: t(`admin.fieldInspector.fieldTypes.${field.type}`) }));
    }
    if (changed.validation && Object.keys(normalizeFormField({ ...field, validation: {} }).validation ?? {}).length > 0) {
        holds.push(t('admin.fieldInspector.inference.keepValidation'));
    }
    if (changed.privacy && field.privacy?.kind) {
        holds.push(inferFormFieldPrivacyKind({ ...field, privacy: { kind: 'not_personal' } }) !== 'not_personal'
            ? t('admin.fieldInspector.inference.keepPrivacyExceptNone', { none: t('admin.fieldInspector.privacyKinds.not_personal') })
            : t('admin.fieldInspector.inference.keepPrivacy'));
    }
    return { main: t('admin.fieldInspector.inference.note', { changes: parts.join(', ') }), holds: holds.join(' ') };
});

/*
 * "Text" chosen for "Telefon für Rückfragen" jumped back to
 * "Telefon" without a word. The recognition runs again wherever a form is read and on every save
 * (`normalizeFormField`, also in the save route), so a hand-set "Text" against a recognised label
 * cannot stay without a stored marker (an open decision of the owner). Until then the choice does
 * not vanish silently: what will be saved, why, and the way out stand under "Typ" until the next
 * change of type or label. A type the recognition does not override stays as chosen, as before.
 */
const typeKept = ref<{ fieldId: string, chosen: FormFieldType, saved: FormFieldType, byLabel: boolean } | null>(null);

const typeKeptText = computed(() => {
    const kept = typeKept.value;
    const field = selectedField.value;
    if (!kept || !field || kept.fieldId !== field.id || field.type !== kept.saved) return '';
    const names = {
        chosen: t(`admin.fieldInspector.fieldTypes.${kept.chosen}`),
        saved: t(`admin.fieldInspector.fieldTypes.${kept.saved}`)
    };
    return kept.byLabel
        ? t('admin.fieldInspector.typeKept.label', { ...names, label: field.label })
        : t('admin.fieldInspector.typeKept.other', names);
});

watch(() => selectedField.value?.id, () => {
    inferenceNote.value = null;
    typeKept.value = null;
    notesHold.value = null;
});

/** The notes under "Typ" are there (one wrapper, so its height can be held, N8 point 74). */
const hasTypeNotes = computed(() => [typeKeptText.value, inferenceNoteText.value, fixedSettingLines.value.length, valuesNotForSelectedType.value.length, notesHold.value]
    .some(Boolean));

function updateLabel(label: string) {
    const field = selectedField.value;
    if (!field) return;
    typeKept.value = null;
    // The burst goes on only while the field is still what it last wrote. Changed from outside in
    // the meantime ("Rückgängig", the chat, a move, a condition rewritten), the burst ends and a new
    // one starts from the field as it is, so the next keystroke never reverts that change. The
    // autosave's canonical field compares equal (`sameField`: key order and unset keys aside).
    const running = inferenceNote.value?.fieldId === field.id ? inferenceNote.value : null;
    const burst = running && sameField(field, running.written) ? running : null;
    const baseField = burst?.baseField ?? field;
    const base = burst?.before ?? inferredValues(field);
    const relabelled = recognisedField(baseField, label);
    const written = normalizeFormField(relabelled);
    const changed = inferenceChanges(base, inferredValues(written));
    inferenceNote.value = Object.values(changed).some(Boolean) ? { fieldId: field.id, before: base, baseField, written } : null;
    // From the field before the burst, never from what the burst recognised so far.
    emitFieldUpdate(() => relabelled, { keepInferenceNote: true });
}

/**
 * When the label makes the recognition choose another type or format, the rules the
 * earlier one brought go with it. Without this, "Telefon für Rückfragen IBAN" stored the IBAN format
 * on top of the telephone pattern and length 6 to 20.
 * Remove only those rules. A full type change runs the whole type change (`fieldForType`), which also dropped what a
 * person had set by hand (a maximum length 50) without a word. A hand-set value stays; where the
 * new type has no use for it, it is named below "Typ" as a leftover with "Entfernen". An
 * explicit type change by the person keeps its question "Feldtyp ändern?".
 */
function recognisedField(baseField: FormField, label: string): FormField {
    const relabelled = { ...baseField, label };
    const recognised = normalizeFormField(relabelled);
    if (recognised.type === baseField.type && recognised.format === baseField.format) return relabelled;
    return withoutRulesBroughtBy(relabelled, baseField.type, baseField.format);
}

const fieldTypeItems = computed(() => FORM_FIELD_TYPES.map(type => ({
    label: t(`admin.fieldInspector.fieldTypes.${type}`),
    value: type
})));

const fieldFormatItems = computed(() => [
    { label: t('admin.fieldInspector.fieldFormats.none'), value: NO_FORMAT_VALUE },
    ...FORM_FIELD_FORMATS.map(format => ({
        label: t(`admin.fieldInspector.fieldFormats.${format}`),
        value: format
    }))
]);

const privacyKindItems = computed(() => [
    { label: t('admin.fieldInspector.privacyKinds.none'), value: NO_PRIVACY_KIND_VALUE },
    ...FORM_FIELD_PRIVACY_KINDS.map(kind => ({
        label: t(`admin.fieldInspector.privacyKinds.${kind}`),
        value: kind
    }))
]);

function emitFieldUpdate(updater: (field: FormField) => FormField, options: { keepInferenceNote?: boolean, schema?: FormSchema } = {}) {
    const schema = options.schema ?? props.schema;
    const location = findSelectedField(schema);
    if (!location) return;
    // Another setting of the field changed: the note about the inference has been read.
    if (!options.keepInferenceNote) inferenceNote.value = null;

    const updated = normalizeFormField(updater(location.field));
    emit('update:schema', {
        ...schema,
        sections: schema.sections.map((section, sectionIndex) => {
            if (sectionIndex !== location.sectionIndex) return section;

            return {
                ...section,
                fields: section.fields.map((field, fieldIndex) =>
                    fieldIndex === location.fieldIndex ? updated : field
                )
            };
        })
    });
    return updated;
}

function updateField(patch: Partial<FormField>) {
    emitFieldUpdate(field => ({
        ...field,
        ...patch
    }));
}

/** The same field whatever the order of its keys (an unset key counts as absent). */
function stableJson(value: unknown): string {
    return JSON.stringify(value, (_key, inner: unknown) =>
        inner && typeof inner === 'object' && !Array.isArray(inner)
            ? Object.fromEntries(Object.entries(inner).filter(([, entry]) => entry !== undefined).sort(([a], [b]) => a.localeCompare(b)))
            : inner);
}

function sameField(left: FormField, right: FormField): boolean {
    return stableJson(left) === stableJson(right);
}

function updateType(value: unknown) {
    const type = value as FormFieldType;
    const field = selectedField.value;
    if (!FORM_FIELD_TYPES.includes(type) || !field) return;

    // A type chosen by hand is another setting: the note on the label has been read.
    inferenceNote.value = null;
    // The recognition would put another type back; say so under "Typ", whether
    // the label is what it reads (else the field id, placeholder or profile entry).
    const next = normalizeFormField(fieldForType(field, type, field.type));
    typeKept.value = next.type === type
        ? null
        : {
            fieldId: field.id,
            chosen: type,
            saved: next.type,
            byLabel: normalizeFormField(fieldForType({ ...field, label: '', i18n: undefined }, type, field.type)).type === type
        };
    // Nothing changes: nothing to save, and the undo step of the last real change stays.
    if (typeKept.value && sameField(next, field)) return;
    // What does not belong to the new type goes, at the type change, not on load.
    emitFieldUpdate(current => fieldForType(current, type, current.type));
}

function updateFormat(value: unknown) {
    const format = value === NO_FORMAT_VALUE ? undefined : value as FormFieldFormat;
    if (format !== undefined && !FORM_FIELD_FORMATS.includes(format)) return;

    updateField({ format });
}

function updatePrivacyKind(value: unknown) {
    const kind = value === NO_PRIVACY_KIND_VALUE ? undefined : value as FormFieldPrivacyKind;
    if (kind !== undefined && !FORM_FIELD_PRIVACY_KINDS.includes(kind)) return;

    updateField({
        privacy: kind ? { kind } : undefined
    });
}

// Catalog suggestion for an unclassified field. A hint only: the editor
// confirms it, and nothing is set until they click "accept".
const privacySuggestion = computed(() => {
    const field = selectedField.value;
    if (!field) return null;
    return privacyHintForField(field, selectedSection.value?.title ?? '', formPrivacyContext(props.schema));
});

const privacySuggestionDescription = computed(() => {
    const suggestion = privacySuggestion.value;
    if (!suggestion) return '';
    const reasonKey = suggestion.source === 'purpose'
        ? (suggestion.concept === 'free_text.health'
            ? 'admin.fieldInspector.privacySuggestionReasonPurposeHealth'
            : 'admin.fieldInspector.privacySuggestionReasonPurposeSocial')
        : suggestion.source === 'section'
            ? 'admin.fieldInspector.privacySuggestionReasonSection'
            : 'admin.fieldInspector.privacySuggestionReason';
    const parts = [t(reasonKey, { match: suggestion.match })];
    if (suggestion.gateHighRisk) parts.push(t('admin.fieldInspector.privacySuggestionGateHighRisk'));
    parts.push(t('admin.fieldInspector.privacySuggestionResponsibility'));
    if (suggestion.organisationContext) parts.push(t('admin.fieldInspector.privacySuggestionOrganisation'));
    return parts.join(' ');
});

function acceptPrivacySuggestion() {
    const suggestion = privacySuggestion.value;
    if (!suggestion) return;
    const highRisk = suggestion.kind === 'special_category' || suggestion.kind === 'criminal_offense';
    updateField({
        privacy: { kind: suggestion.kind },
        ...(highRisk ? { sensitive: true } : {})
    });
}

function updateSensitive(value: unknown) {
    const sensitive = value === true;
    const currentPrivacyKind = selectedField.value?.privacy?.kind;
    const inferredPrivacyKind = selectedField.value
        ? inferFormFieldPrivacyKind({ ...selectedField.value, sensitive: true })
        : undefined;

    updateField({
        sensitive: sensitive ? true : undefined,
        privacy: sensitive && !currentPrivacyKind && inferredPrivacyKind
            ? { kind: inferredPrivacyKind }
            : selectedField.value?.privacy
    });
}

function updateValidation(key: keyof FormFieldValidation, value: unknown): boolean {
    const stringValue = String(value ?? '').trim();
    const currentValidation = selectedField.value?.validation ?? {};
    const validation: FormFieldValidation = { ...currentValidation };

    if (stringValue === '') {
        Reflect.deleteProperty(validation, key);
    } else if (key === 'pattern') {
        validation[key] = stringValue.slice(0, MAX_PATTERN_LENGTH);
    } else {
        const numericValue = Number(stringValue);
        if (!Number.isFinite(numericValue)) return false;
        validation[key] = numericValue;
    }

    const clearAliases: Partial<FormField> = {};
    if (key === 'maxSizeBytes') {
        delete validation.maxFileSizeBytes;
        clearAliases.maxSizeBytes = undefined;
        clearAliases.maxFileSizeBytes = undefined;
    } else if (key === 'maxFiles') clearAliases.maxFiles = undefined;
    updateField({
        ...clearAliases,
        validation: Object.keys(validation).length > 0 ? validation : undefined
    });
    return true;
}

function numberInputValue(value: number | undefined): string {
    return typeof value === 'number' ? String(value) : '';
}

function megabytesInputValue(value: number | undefined): string {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '';
    const megabytes = value / UPLOAD_BYTES_PER_MEGABYTE;
    return Number.isInteger(megabytes) ? String(megabytes) : String(Number(megabytes.toFixed(2)));
}

function syncValidationDrafts() {
    const validation = selectedField.value?.validation;
    for (const key of numericValidationKeys) {
        validationDrafts[key] = numberInputValue(key === 'maxFiles' ? effectiveMaxFiles.value : validation?.[key]);
    }

    if (!uploadSizeFocused.value) {
        uploadSizeMegabytesDraft.value = megabytesInputValue(effectiveMaxBytes.value);
    }
}

/*
 * Escape in a text field must not save. These fields keep a draft
 * that is committed on blur or Enter; below 1280 px Escape also closes the sheet, which could end in
 * that blur. Escape gives the draft back to what is stored, so whatever follows saves nothing.
 */
function discardValidationDraft(key: NumericValidationKey) {
    validationDrafts[key] = numberInputValue(key === 'maxFiles' ? effectiveMaxFiles.value : selectedField.value?.validation?.[key]);
}

function discardPatternDraft() {
    patternDraft.value = selectedField.value?.validation?.pattern ?? '';
    patternRefusal.value = null;
}

function discardUploadSizeDraft() {
    uploadSizeMegabytesDraft.value = megabytesInputValue(effectiveMaxBytes.value);
}

function updateValidationDraft(key: NumericValidationKey, value: unknown) {
    validationDrafts[key] = String(value ?? '');
}

function focusValidationDraft(key: NumericValidationKey) {
    focusedValidationKey.value = key;
}

function commitValidationDraft(key: NumericValidationKey) {
    const currentValue = numberInputValue(key === 'maxFiles' ? effectiveMaxFiles.value : selectedField.value?.validation?.[key]);
    if (validationDrafts[key].trim() === currentValue) {
        focusedValidationKey.value = null;
        return;
    }

    // More files than the product allows would be cut at runtime; the field takes the ceiling.
    if (key === 'maxFiles' && Number(validationDrafts[key]) > ATTACHMENT_MAX_FILES_PER_FIELD) {
        validationDrafts[key] = String(ATTACHMENT_MAX_FILES_PER_FIELD);
    }
    const committed = updateValidation(key, validationDrafts[key]);
    focusedValidationKey.value = null;

    if (!committed) {
        validationDrafts[key] = numberInputValue(key === 'maxFiles' ? effectiveMaxFiles.value : selectedField.value?.validation?.[key]);
    }
}

/* The pattern as typed, its refusal, and the commit. */
const patternDraft = ref('');
const patternRefusal = ref<ValidationPatternRefusal | null>(null);

function updatePatternDraft(value: unknown) {
    patternDraft.value = String(value ?? '');
    patternRefusal.value = null;
}

function commitPatternDraft() {
    const draft = patternDraft.value.trim();
    if (draft === (selectedField.value?.validation?.pattern ?? '')) return;
    const refusal = validationPatternRefusal(draft);
    if (refusal) {
        patternRefusal.value = refusal;
        return;
    }
    updateValidation('pattern', draft);
}

watch(() => [selectedField.value?.id, selectedField.value?.validation?.pattern] as const, () => {
    patternDraft.value = selectedField.value?.validation?.pattern ?? '';
    patternRefusal.value = null;
}, { immediate: true });

function updateUploadSizeDraft(value: unknown) {
    uploadSizeMegabytesDraft.value = String(value ?? '');
}

function focusUploadSizeDraft() {
    uploadSizeFocused.value = true;
}

function commitUploadSizeDraft() {
    const currentValue = megabytesInputValue(effectiveMaxBytes.value);
    const draft = uploadSizeMegabytesDraft.value.trim();
    if (draft === currentValue) {
        uploadSizeFocused.value = false;
        return;
    }

    if (draft === '') {
        updateValidation('maxSizeBytes', '');
        uploadSizeFocused.value = false;
        return;
    }

    const megabytes = Math.min(Number(draft.replace(',', '.')), maxSizeMegabytesCeiling);
    if (!Number.isFinite(megabytes) || megabytes <= 0) {
        uploadSizeMegabytesDraft.value = currentValue;
        uploadSizeFocused.value = false;
        return;
    }

    updateValidation('maxSizeBytes', String(Math.round(megabytes * UPLOAD_BYTES_PER_MEGABYTE)));
    uploadSizeFocused.value = false;
}

watch(() => selectedField.value?.id, () => {
    optionsInput.discard();
    focusedValidationKey.value = null;
    uploadSizeFocused.value = false;
    syncValidationDrafts();
}, { immediate: true });

watch(validationSignature, () => {
    if (!focusedValidationKey.value && !uploadSizeFocused.value) {
        syncValidationDrafts();
    }
});
</script>

<template>
  <aside
    class="flex h-full min-h-0 flex-col bg-default"
    aria-labelledby="field-inspector-title"
  >
    <div class="flex items-start gap-2 border-b border-default px-4 py-3">
      <div class="min-w-0 flex-1">
        <!-- The title took one to four lines, so "Beschriftung",
             "Pflichtfeld" and "Typ" stood up to 64 px lower from field to field. Name and twin
             distinction stay in ONE line, cut at the panel's width; the full label and distinction are
             one click, Enter or tap away (the framework's popover on the title, as for the answer). -->
        <h2
          id="field-inspector-title"
          class="min-w-0 text-base font-semibold text-highlighted"
        >
          <UPopover
            v-if="selectedField"
            :content="{ align: 'start' }"
          >
            <UButton
              color="neutral"
              variant="ghost"
              class="-ms-2.5 max-w-full text-base font-semibold text-highlighted"
              data-testid="field-inspector-title-button"
            >
              <!-- A cut line lost the twins' distinction, so two
                   fields of the same name looked the same. The name is cut first; the distinction
                   stays in the line (cut itself only beyond half the line). -->
              <span class="flex min-w-0">
                <!-- An empty label left an empty button (24 instead of 36 px)
                     and everything below jumped; it names what it is then. -->
                <span
                  v-if="!selectedField.label.trim()"
                  class="truncate font-normal text-muted"
                  data-testid="field-inspector-title-empty"
                >{{ t('admin.fieldInspector.untitledField') }}</span>
                <!-- The part the group's fields share is cut, the field's own name after it
                     stays in view. The tenth task check saw the own name cut by a fraction of a pixel
                     ("Postfa…"): beside the shared part's `shrink-[1000]` it still had `shrink` 1 and gave up
                     a thousandth of the overflow. The two stand in their own box (`min-w-0`, which takes
                     what the distinction leaves): the own name does not shrink at all (`shrink-0`), so its box
                     is its text's width exactly, and only the shared part gives way (down to nothing). Only
                     when the own name alone is wider than the box does `max-w-full` cap it and `truncate`
                     cut it. Without a shared part the box holds the name alone, cut as before. -->
                <span
                  v-if="selectedField.label.trim()"
                  class="flex min-w-0"
                  data-testid="field-inspector-title-pair"
                >
                  <span
                    v-if="titleName.common"
                    class="min-w-0 overflow-hidden text-ellipsis whitespace-pre"
                    data-testid="field-inspector-title-common"
                  >{{ titleName.common }}</span>
                  <span
                    class="max-w-full shrink-0 truncate"
                    data-testid="field-inspector-title-name"
                  >{{ titleName.own }}</span>
                </span>
                <span
                  v-if="titleDistinction"
                  class="max-w-1/2 shrink-0 overflow-hidden text-ellipsis whitespace-pre font-normal text-muted"
                  data-testid="field-inspector-title-distinction"
                > · {{ titleDistinction }}</span>
              </span>
            </UButton>
            <template #content>
              <p
                class="max-w-sm p-3 text-sm"
                data-testid="field-inspector-title-full"
              >
                {{ titleFull }}
              </p>
            </template>
          </UPopover>
          <template v-else>
            {{ t('admin.fieldInspector.title') }}
          </template>
        </h2>
        <p
          v-if="!selectedField"
          class="mt-1 text-sm text-muted"
        >
          {{ t('admin.fieldInspector.empty') }}
        </p>
      </div>
      <!-- Deleting a field happens once, in the bar at the field; the
           inspector keeps its one close control. -->
      <UTooltip :text="t('admin.forms.hideInspector')">
        <UButton
          color="neutral"
          variant="ghost"
          icon="i-lucide-x"
          class="shrink-0"
          :aria-label="t('admin.forms.hideInspector')"
          data-testid="field-inspector-close"
          @click="emit('close')"
        />
      </UTooltip>
    </div>

    <!-- On top what is needed nine out of ten times (label, "Pflichtfeld",
         type); everything else in named groups, open when something in them is set or
         missing, or when a jump from the head's findings leads there.
         the app's shell could be scrolled by 104 to 252 px, and then
         the head stood at 90 instead of 179 px with no way back. A visually hidden text in here
         ("Angabe im Profil", `sr-only`, which is `position: absolute`) had its containing block outside
         this scroll area, so it was neither clipped nor scrolled by it and stuck out of the shell. The
         scroll area is positioned (`relative`): its hidden texts stay inside it. -->
    <div
      v-if="selectedField"
      ref="inspectorBody"
      class="relative flex-1 overflow-y-auto px-4 py-4"
      data-testid="field-inspector-body"
    >
      <div class="space-y-4 pb-4">
        <p
          v-if="schema.source?.type === 'text' && selectedField.semantics?.sourcePath"
          class="break-words text-sm text-muted"
          data-testid="field-source-reference"
        >
          {{ t('admin.forms.sourceReference') }}: {{ sourceReferenceText(selectedField.semantics.sourcePath) }}
        </p>
        <!-- An empty label is not saved; the field says why, at its input (in the
             label's row, so nothing below moves). -->
        <UFormField
          :label="t('admin.fieldInspector.label')"
          :error="selectedField.label.trim() ? undefined : t('admin.fieldInspector.labelRequired')"
          :ui="LABEL_FIELD_UI"
          data-testid="field-label-form-field"
        >
          <UInput
            id="field-inspector-label"
            :model-value="selectedField.label"
            class="w-full"
            data-testid="field-label"
            @update:model-value="updateLabel(String($event))"
            @keydown.esc.stop.prevent="emit('return-to-field')"
          />
        </UFormField>
        <!-- Without its own name Reka's SwitchRoot reads the label's `innerText`
             (`SwitchRoot.js:82`), which forces a layout of the whole page while the inspector mounts:
             14 ms of the drop's first frame. The same name, given directly. -->
        <USwitch
          v-if="shows('required')"
          :model-value="selectedField.required === true"
          :label="t('admin.fieldInspector.required')"
          :aria-label="t('admin.fieldInspector.required')"
          data-testid="field-required"
          @update:model-value="updateField({ required: $event === true })"
        >
          <!-- The hint is for screen readers only (rule 3); the switch's own description slot. -->
          <template #description>
            <span class="sr-only">{{ t('admin.fieldInspector.requiredHint') }}</span>
          </template>
        </USwitch>
        <slot name="structure-actions" />
        <UFormField :label="t('admin.fieldInspector.type')">
          <USelect
            :model-value="selectedField.type"
            :items="fieldTypeItems"
            class="w-full"
            data-testid="field-type"
            data-inspector-type
            @update:model-value="updateType"
          />
        </UFormField>
        <!-- One wrapper for the notes under "Typ"; after "Entfernen" it keeps its
             height and says what was removed, so nothing below moves under the pointer. -->
        <div
          v-if="hasTypeNotes"
          ref="typeNotes"
          class="space-y-4"
          :style="notesHold ? { minHeight: `${notesHold.height}px` } : undefined"
          data-testid="field-type-notes"
        >
          <!-- A chosen type the recognition puts back is said here, with the way out. -->
          <p
            v-if="typeKeptText"
            class="flex items-start gap-1.5 text-sm text-muted"
            role="status"
            aria-live="polite"
            data-testid="field-type-kept"
          >
            <UIcon
              name="i-lucide-info"
              class="mt-0.5 size-4 shrink-0"
              aria-hidden="true"
            />
            <span>{{ typeKeptText }}</span>
          </p>
          <!-- What the editor inferred from the label. below "Typ",
               which it speaks about, so label, "Pflichtfeld" and type never move while typing. -->
          <p
            v-if="inferenceNoteText"
            class="flex items-start gap-1.5 text-sm text-muted"
            role="status"
            aria-live="polite"
            data-testid="field-inference-note"
          >
            <UIcon
              name="i-lucide-sparkles"
              class="mt-0.5 size-4 shrink-0"
              aria-hidden="true"
            />
            <span>
              <span data-testid="field-inference-main">{{ inferenceNoteText.main }}</span>
              <UPopover v-if="inferenceNoteText.holds">
                <UButton
                  color="neutral"
                  variant="link"
                  class="ms-1"
                  data-testid="field-inference-more"
                >
                  {{ t('admin.fieldInspector.inference.more') }}
                </UButton>
                <template #content>
                  <p
                    class="max-w-xs p-3 text-sm"
                    data-testid="field-inference-holds"
                  >
                    {{ inferenceNoteText.holds }}
                  </p>
                </template>
              </UPopover>
            </span>
          </p>
          <!-- What the form fixes for this field (computation, address search, repeatable
               section) is named with its value; it is not a setting of the inspector. -->
          <p
            v-for="line in fixedSettingLines"
            :key="line"
            class="text-sm text-muted"
            data-testid="field-fixed-setting"
          >
            {{ line }}
          </p>
          <!-- A field saved earlier with values its type does not have says so once. -->
          <div
            v-if="valuesNotForSelectedType.length"
            class="flex flex-wrap items-baseline gap-x-2 text-sm text-muted"
            data-testid="field-values-not-for-type"
          >
            <span>{{ valuesNotForTypeText }}</span>
            <UButton
              color="neutral"
              variant="link"
              class="px-0"
              data-testid="field-values-not-for-type-remove"
              @click="removeValuesNotForType"
            >
              {{ t('admin.fieldInspector.valuesNotForTypeRemove') }}
            </UButton>
          </div>
          <p
            v-if="notesHold && removedTextShown"
            class="text-sm text-muted"
            role="status"
            data-testid="field-values-removed"
          >
            {{ notesHold.text }}
          </p>
          <p
            v-else-if="notesHold && removedPlainShown"
            class="text-sm text-muted"
            data-testid="field-values-removed-plain"
          >
            {{ notesHold.plain }}
          </p>
        </div>
        <!-- One word for the answers ("Antwortmöglichkeiten" in the
             label, the help, the card's mark), and the error line pushed the groups below 48 px when it came
             or went. As for the label: the framework's field carries the error, its short
             sentence stands at the end of the label's row, and nothing below moves. -->
        <UFormField
          v-if="showsOptions"
          :label="t('admin.fieldInspector.options')"
          :description="t('admin.fieldInspector.optionsHelp')"
          :error="optionsMissing ? t('admin.fieldInspector.optionsMissing') : undefined"
          :ui="OPTIONS_FIELD_UI"
          data-testid="field-options-setting"
        >
          <UTextarea
            v-model="optionsInput.model.value"
            :rows="5"
            class="w-full"
            @change="optionsInput.commit()"
            @blur="optionsInput.finish"
          />
        </UFormField>
      </div>

      <div class="space-y-2">
        <!-- For a file field the attachments are the main settings, so their group comes first. -->
        <InspectorGroup
          v-if="showsUploadLimits"
          v-model:open="groupsOpen.attachments"
          name="attachments"
          :title="t('admin.fieldInspector.groups.attachments')"
        >
          <p
            v-if="groupIssueText('attachments')"
            id="field-issue-attachments"
            class="flex items-start gap-1.5 text-sm"
            :class="groupIssues('attachments').some(issue => issue.severity === 'blocking') ? 'text-error' : 'text-warning'"
            data-testid="field-issue-attachments"
          >
            <UIcon
              name="i-lucide-triangle-alert"
              class="mt-0.5 size-4 shrink-0"
              aria-hidden="true"
            />
            <span>{{ groupIssueText('attachments') }}</span>
          </p>
          <div class="space-y-4 pt-3">
            <StaffExtensionOutlet
              v-if="shows('attachmentCheck')"
              name="form-field-analysis"
              :context="analysisContext"
            />
            <UCollapsible
              v-if="showsUploadLimits"
              v-model:open="uploadLimitsOpen"
              data-test="upload-limits-disclosure"
            >
              <UButton
                color="neutral"
                variant="ghost"
                :trailing-icon="uploadLimitsOpen ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
              >
                {{ t('admin.fieldInspector.uploadLimits') }}
              </UButton>
              <template #content>
                <div class="space-y-4">
                  <div>
                    <p class="mt-1 text-sm text-(--ui-text-muted)">
                      {{ t('admin.fieldInspector.uploadLimitsHelp') }}
                    </p>
                    <!-- What the product allows for every file field (not settable here) and where
                         the municipality's storage is set; named, not repeated as a second setting. -->
                    <p
                      class="mt-1 text-sm text-(--ui-text-muted)"
                      data-testid="upload-product-limits"
                    >
                      {{ uploadProductLimitsText }}
                      <template v-if="uploadsSettingsTo">
                        {{ t('admin.fieldInspector.uploadStorageNote') }}
                        <ULink
                          :to="uploadsSettingsTo"
                          class="underline"
                          data-testid="upload-storage-link"
                        >{{ t('admin.settings.uploads.title') }}</ULink>.
                      </template>
                    </p>
                  </div>

                  <div class="grid gap-4 sm:grid-cols-2">
                    <UFormField :label="t('admin.fieldInspector.maxFiles')">
                      <UInput
                        type="number"
                        class="w-full"
                        min="1"
                        :max="ATTACHMENT_MAX_FILES_PER_FIELD"
                        :model-value="validationDrafts.maxFiles"
                        @focus="focusValidationDraft('maxFiles')"
                        @update:model-value="updateValidationDraft('maxFiles', $event)"
                        @change="commitValidationDraft('maxFiles')"
                        @blur="commitValidationDraft('maxFiles')"
                        @keydown.enter.prevent="commitValidationDraft('maxFiles')"
                        @keydown.esc="discardValidationDraft('maxFiles')"
                      />
                    </UFormField>

                    <UFormField :label="t('admin.fieldInspector.maxSizeMegabytes')">
                      <UInput
                        type="number"
                        class="w-full"
                        min="0.1"
                        step="0.1"
                        :max="maxSizeMegabytesCeiling"
                        :model-value="uploadSizeMegabytesDraft"
                        @focus="focusUploadSizeDraft"
                        @update:model-value="updateUploadSizeDraft"
                        @change="commitUploadSizeDraft"
                        @blur="commitUploadSizeDraft"
                        @keydown.enter.prevent="commitUploadSizeDraft"
                        @keydown.esc="discardUploadSizeDraft"
                      />
                    </UFormField>
                  </div>
                </div>
              </template>
            </UCollapsible>
          </div>
        </InspectorGroup>

        <InspectorGroup
          v-if="groupShown('format')"
          v-model:open="groupsOpen.format"
          name="format"
          :title="t('admin.fieldInspector.groups.format')"
        >
          <UFormField
            v-if="shows('placeholder')"
            :label="t('admin.fieldInspector.placeholder')"
          >
            <UInput
              :model-value="selectedField.placeholder ?? ''"
              class="w-full"
              data-testid="field-placeholder"
              @update:model-value="updateField({ placeholder: String($event) || undefined })"
            />
          </UFormField>
          <UFormField
            v-if="shows('format')"
            :label="t('admin.fieldInspector.format')"
          >
            <USelect
              :model-value="selectedField.format ?? NO_FORMAT_VALUE"
              :items="fieldFormatItems"
              class="w-full"
              data-testid="field-format"
              @update:model-value="updateFormat"
            />
          </UFormField>
        </InspectorGroup>

        <InspectorGroup
          v-if="selectedSection"
          v-model:open="groupsOpen.display"
          name="display"
          :title="t('admin.fieldInspector.groups.display')"
        >
          <FieldConditionSetting
            :schema="schema"
            :section-id="selectedSection.id"
            :field="selectedField"
            hide-legend
            @update:condition="updateField({ conditionalOn: $event })"
          />
          <p
            v-if="conditionRefusal"
            class="mt-2 text-sm text-error"
            role="alert"
            data-testid="field-condition-refusal"
          >
            {{ conditionRefusal }}
          </p>
          <p
            v-if="selectedConditionFinding"
            class="mt-2 text-sm text-warning"
            data-testid="field-condition-finding"
          >
            {{ selectedConditionFinding }}
          </p>
          <p
            v-if="selectedFieldDependents.length"
            class="mt-2 text-sm text-muted"
            data-testid="field-condition-dependents"
          >
            {{ t('admin.fieldInspector.conditionDependents', { fields: selectedFieldDependents.join(', ') }) }}
          </p>
          <p
            v-for="finding in selectedFieldDependentFindings"
            :key="finding"
            class="mt-1 text-sm text-warning"
            data-testid="field-condition-dependent-finding"
          >
            {{ finding }}
          </p>
        </InspectorGroup>

        <InspectorGroup
          v-model:open="groupsOpen.privacy"
          name="privacy"
          :title="t('admin.fieldInspector.groups.privacy')"
        >
          <!-- Named directly (see above).
               the info button in the label made its line 32 px while the framework aligns
               the box to a 20 px line, so the box stood 6 px above its word. The label is the plain text;
               what the popover explained is the checkbox's description (the framework's place under the
               label), read with the box. The former description only repeated the label. The framework
               gives the description no id outside a UFormField, so it gets one here, for the box's
               `aria-describedby`. -->
          <UCheckbox
            :model-value="isSensitiveFlag(selectedField.sensitive)"
            :label="t('admin.fieldInspector.sensitive')"
            :aria-label="t('admin.fieldInspector.sensitive')"
            :aria-describedby="SENSITIVE_DESCRIPTION_ID"
            data-testid="field-sensitive"
            @update:model-value="updateSensitive"
          >
            <template #description>
              <span :id="SENSITIVE_DESCRIPTION_ID">{{ t('admin.fieldInspector.sensitiveHelp') }}</span>
            </template>
          </UCheckbox>
          <!-- What is missing stands at the setting that answers it, not in a box. -->
          <UFormField
            :label="t('admin.fieldInspector.privacyKind')"
            :description="t('admin.fieldInspector.privacyKindHelp')"
            :error="groupIssueText('privacy') || undefined"
            :required="groupIssues('privacy').length > 0"
          >
            <USelect
              :model-value="selectedField.privacy?.kind ?? NO_PRIVACY_KIND_VALUE"
              :items="privacyKindItems"
              class="w-full"
              data-testid="field-privacy-kind"
              @update:model-value="updatePrivacyKind"
            />
          </UFormField>
          <UAlert
            v-if="privacySuggestion"
            role="status"
            color="warning"
            icon="i-lucide-triangle-alert"
            data-testid="privacy-suggestion"
            :title="t('admin.fieldInspector.privacySuggestionTitle', { kind: t(`admin.fieldInspector.privacyKinds.${privacySuggestion.kind}`) })"
            :description="privacySuggestionDescription"
            :actions="[{ label: t('admin.fieldInspector.privacySuggestionAccept'), color: 'neutral', variant: 'outline', onClick: acceptPrivacySuggestion }]"
          />
        </InspectorGroup>

        <!-- Which profile datum the field feeds: the duplicate refusal leads here. -->
        <InspectorGroup
          v-model:open="groupsOpen.profile"
          name="profile"
          :title="t('admin.fieldInspector.groups.profile')"
        >
          <p
            v-if="groupIssueText('profile')"
            id="field-issue-profile"
            class="flex items-start gap-1.5 text-sm text-warning"
            data-testid="field-issue-profile"
          >
            <UIcon
              name="i-lucide-triangle-alert"
              class="mt-0.5 size-4 shrink-0"
              aria-hidden="true"
            />
            <span>{{ groupIssueText('profile') }}</span>
          </p>
          <FieldCrmKeySetting
            :schema="schema"
            :field="selectedField"
            hide-label
            @update:crm-key="updateField({ crm_key: $event })"
          />
        </InspectorGroup>

        <InspectorGroup
          v-if="groupShown('validation')"
          v-model:open="groupsOpen.validation"
          name="validation"
          :title="t('admin.fieldInspector.groups.validation')"
        >
          <div class="space-y-4 pt-3">
            <div class="grid gap-4 sm:grid-cols-2">
              <UFormField
                v-if="shows('minLength')"
                :label="t('admin.fieldInspector.minLength')"
              >
                <UInput
                  type="number"
                  class="w-full"
                  :model-value="validationDrafts.minLength"
                  @focus="focusValidationDraft('minLength')"
                  @update:model-value="updateValidationDraft('minLength', $event)"
                  @change="commitValidationDraft('minLength')"
                  @blur="commitValidationDraft('minLength')"
                  @keydown.enter.prevent="commitValidationDraft('minLength')"
                  @keydown.esc="discardValidationDraft('minLength')"
                />
              </UFormField>

              <UFormField
                v-if="shows('maxLength')"
                :label="t('admin.fieldInspector.maxLength')"
              >
                <UInput
                  type="number"
                  class="w-full"
                  :model-value="validationDrafts.maxLength"
                  @focus="focusValidationDraft('maxLength')"
                  @update:model-value="updateValidationDraft('maxLength', $event)"
                  @change="commitValidationDraft('maxLength')"
                  @blur="commitValidationDraft('maxLength')"
                  @keydown.enter.prevent="commitValidationDraft('maxLength')"
                  @keydown.esc="discardValidationDraft('maxLength')"
                />
              </UFormField>

              <UFormField
                v-if="shows('min')"
                :label="t('admin.fieldInspector.min')"
              >
                <UInput
                  type="number"
                  class="w-full"
                  :model-value="validationDrafts.min"
                  @focus="focusValidationDraft('min')"
                  @update:model-value="updateValidationDraft('min', $event)"
                  @change="commitValidationDraft('min')"
                  @blur="commitValidationDraft('min')"
                  @keydown.enter.prevent="commitValidationDraft('min')"
                  @keydown.esc="discardValidationDraft('min')"
                />
              </UFormField>

              <UFormField
                v-if="shows('max')"
                :label="t('admin.fieldInspector.max')"
              >
                <UInput
                  type="number"
                  class="w-full"
                  :model-value="validationDrafts.max"
                  @focus="focusValidationDraft('max')"
                  @update:model-value="updateValidationDraft('max', $event)"
                  @change="commitValidationDraft('max')"
                  @blur="commitValidationDraft('max')"
                  @keydown.enter.prevent="commitValidationDraft('max')"
                  @keydown.esc="discardValidationDraft('max')"
                />
              </UFormField>

              <UFormField
                v-if="shows('step')"
                :label="t('admin.fieldInspector.step')"
              >
                <UInput
                  type="number"
                  class="w-full"
                  :model-value="validationDrafts.step"
                  @focus="focusValidationDraft('step')"
                  @update:model-value="updateValidationDraft('step', $event)"
                  @change="commitValidationDraft('step')"
                  @blur="commitValidationDraft('step')"
                  @keydown.enter.prevent="commitValidationDraft('step')"
                  @keydown.esc="discardValidationDraft('step')"
                />
              </UFormField>
            </div>
            <UFormField
              v-if="shows('pattern')"
              :label="t('admin.fieldInspector.pattern')"
              :description="t('admin.fieldInspector.patternHelp')"
              :error="patternRefusal ? t(`admin.fieldInspector.patternRefused.${patternRefusal}`) : undefined"
              data-testid="field-pattern-setting"
            >
              <!-- The pattern is committed on leaving the field or Enter; one the product does
                   not run is refused here with the reason, never dropped in silence. -->
              <UInput
                :model-value="patternDraft"
                class="w-full"
                data-testid="field-pattern"
                :aria-invalid="patternRefusal ? 'true' : undefined"
                @update:model-value="updatePatternDraft"
                @blur="commitPatternDraft"
                @keydown.enter.prevent="commitPatternDraft"
                @keydown.esc="discardPatternDraft"
              />
            </UFormField>
          </div>
        </InspectorGroup>

        <InspectorGroup
          v-if="docgenPlaceholder"
          v-model:open="groupsOpen.docgen"
          name="docgen"
          :title="t('admin.fieldInspector.groups.docgen')"
        >
          <div class="space-y-4 pt-3">
            <div
              v-if="docgenPlaceholder"
              class="flex items-center justify-between gap-2 text-sm"
              data-testid="field-docgen-placeholder"
            >
              <div class="min-w-0">
                <p class="text-(--ui-text-muted)">
                  {{ t('docgenUi.form.fieldPlaceholder') }}
                </p>
                <code class="break-all font-mono text-highlighted">{{ docgenPlaceholder.display }}</code>
                <p
                  v-if="docgenPlaceholder.loop"
                  class="mt-0.5 text-(--ui-text-muted)"
                >
                  {{ t('docgenUi.form.fieldPlaceholderLoop', { loop: docgenPlaceholder.loop }) }}
                </p>
              </div>
              <UButton
                color="neutral"
                variant="ghost"
                icon="i-lucide-copy"
                class="shrink-0"
                :aria-label="t('docgenUi.form.fieldPlaceholderCopy')"
                data-testid="field-docgen-placeholder-copy"
                @click="copyDocgenPlaceholder"
              />
            </div>
          </div>
        </InspectorGroup>

        <!-- Rule 12: identifiers and the catalogue path, for the people who map interfaces. -->
        <InspectorGroup
          v-model:open="groupsOpen.technical"
          name="technical"
          :title="t('admin.fieldInspector.groups.technical')"
        >
          <dl
            class="space-y-3 text-sm"
            data-testid="field-technical"
          >
            <div v-if="selectedSection">
              <dt class="text-muted">
                {{ t('admin.fieldInspector.technical.section') }}
              </dt>
              <dd class="break-words text-default">
                {{ selectedSection.title || selectedSection.id }}
              </dd>
            </div>
            <div>
              <dt class="text-muted">
                {{ t('admin.fieldInspector.technical.fieldId') }}
              </dt>
              <dd
                class="break-all font-mono text-default"
                data-testid="field-technical-id"
              >
                {{ selectedField.id }}
              </dd>
            </div>
            <div v-if="labelParts.context">
              <dt class="text-muted">
                {{ t('admin.fieldInspector.technical.catalogPath') }}
              </dt>
              <dd
                class="break-words text-default"
                data-testid="field-technical-path"
              >
                {{ labelParts.context }}
              </dd>
            </div>
          </dl>
        </InspectorGroup>
      </div>
    </div>

    <div
      v-else
      class="flex-1 grid place-items-center p-6 text-center"
    >
      <div class="space-y-2">
        <UIcon
          name="i-lucide-mouse-pointer-2"
          class="mx-auto size-6 text-(--ui-text-muted)"
        />
        <p class="text-sm text-(--ui-text-muted)">
          {{ t('admin.fieldInspector.emptyDescription') }}
        </p>
      </div>
    </div>
  </aside>
</template>
