<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, watchEffect, type Directive, type Ref } from 'vue';
import type { ApplicationAttachmentAnalysisFeedback, ApplicationAttachmentUpload, FormAddressGroup, FormAddressValue, FormField, FormSchema, PublicAttachmentAnalysisDisclosure } from '~/types/form';
import { citizenAttachmentConsentHint, citizenAttachmentDisclosureLines } from '~/utils/attachment-analysis-disclosure-text';
import {
    getFieldAutocomplete,
    getFieldInputMode,
    getLocalizedFormFieldChoiceItems,
    getLocalizedFormFieldLabel,
    getLocalizedFormFieldPlaceholder,
    getLocalizedFormSchemaTitle,
    getLocalizedFormSectionDescription,
    getLocalizedFormSectionTitle
} from '~/utils/form-schema';
import { formatStructuredAddress, normalizeFormAddressValue } from '~/utils/form-address';
import { formatFileSize as formatFileSizeIn } from '~/utils/file-size';
import { copyFormValueOrigins, markFormFieldEdited, registerFormDefault } from '~/utils/form-value-origin';
import { conditionAnswerLabel } from '~/utils/form-condition-label';
import { dependencyAsPageValue } from '~/utils/form-condition-value';
import { isCurrencyField, withCanonicalCurrencyAmounts } from '~/utils/form-currency';
import FormDraftFieldFrame from './form/DraftFieldFrame.vue';
import FormDraftGroupNote from './form/DraftGroupNote.vue';
import FormFieldLabelTarget from './form/FieldLabelTarget';
import { sectionIsShown } from '~/utils/form-section-visibility';
import { edgeScrollDelta, verticalScrollContainer } from '~/utils/drag-edge-scroll';
import { ACCEPTED_ATTACHMENT_EXTENSIONS, ACCEPTED_ATTACHMENT_MIME_TYPES, fileFieldMaxFiles, fileFieldMaxSizeBytes } from '~/utils/attachment-limits';

/** A field or address group drop as the editor receives it. */
type DraftFieldDrop
    = | { kind: 'field', fieldId: string, sectionId: string, beforeFieldId: string | null }
      | { kind: 'addressGroup', groupId: string, fromSectionId: string, sectionId: string, beforeFieldId: string | null };

const props = withDefaults(defineProps<{
    schema: FormSchema
    fieldErrors?: Record<string, string>
    localizedCurrencyInput?: boolean
    /** Hide the built-in submit button. Use when the parent provides its own. */
    hideSubmit?: boolean
    /** Hide the built-in form title when the surrounding page owns the heading. */
    hideTitle?: boolean
    /** Let a surrounding page container define the standalone form width. */
    fullWidth?: boolean
    /** Remove section card framing in the public page layout. */
    flatSections?: boolean
    /**
     * No frame and no visible section heading: the section title stays as the fieldset legend for assistive
     * technology. For a surrounding admin surface that draws its own heading (staff edit of one entry).
     */
    bareSections?: boolean
    /**
     * Who uses the form. `'staff'` is passed only by the staff edit of the application data
     * (`ApplicationDataCard`, every renderer it renders); every difference of look between the staff edit and
     * the citizen form derives from it. Default: the citizen form.
     */
    audience?: 'citizen' | 'staff'
    /**
     * Staff only: the files of a file field as the attachment list of the application knows them (one line
     * each, 02b, 3). Without it the lines come from the stored value.
     */
    staffFileLines?: (fieldId: string) => Array<{ key: string, filename: string, size?: number }>
    /** Render the public required-field legend once before all sections. */
    showRequiredLegend?: boolean
    /** Render controls as an inspectable, non-editable preview. */
    readOnly?: boolean
    /** Remove standalone page framing when the form is embedded in an admin surface. */
    embedded?: boolean
    /** Enable admin draft selection affordances without changing public forms. */
    draftMode?: boolean
    /** Disable draft field selection while the parent applies an asynchronous editor action. */
    fieldSelectionDisabled?: boolean
    /** Currently selected field in admin draft mode. */
    selectedFieldId?: string | null
    /**
     * Admin draft mode only: fields, address groups and sections can be
     * dragged, and focused fields answer Alt+Arrow (move) and Delete. The
     * renderer only reports the gesture; the editor changes the schema.
     */
    structureEditable?: boolean
    /**
     * Admin draft mode only: one field per row in the form's order, so "earlier"
     * and "later" in the editor are what the person sees. The
     * side-by-side layout of the citizen form stays for every other mode.
     */
    draftSingleColumn?: boolean
    /**
     * Structure mode only: whether a field or address group drop on a target
     * would be accepted and change something (the field's own place is no
     * target). A refused target gets no drop marker and the browser shows the
     * drag as not droppable. Without it every target accepts.
     */
    canDrop?: ((move: DraftFieldDrop) => boolean) | null
    /** Allow public attachment uploads for file fields. */
    fileUploadsEnabled?: boolean
    /** Public form schema UUID used for attachment uploads. */
    schemaId?: string | null
    /** Local-only free-text address hints keyed by field id. */
    addressInitialQueries?: Record<string, string>
    /** Explicit jurisdiction scope for lazy address boundary loading. */
    jurisdictionSlug?: string | null
    /** Where each upload field's file goes for the pre-check (public form response), by field id. */
    attachmentAnalysisDisclosures?: Record<string, PublicAttachmentAnalysisDisclosure>
    /**
     * Let the browser check required and pattern rules on submit. A surface
     * that validates in script (useFormSubmission) switches it off: the
     * browser bubble speaks the browser's language and lands on hidden
     * inputs of choice groups instead of the field.
     */
    nativeValidation?: boolean
    /** Gives every field wrapper the id `${prefix}${field.id}`, the target of an error summary link. */
    fieldAnchorPrefix?: string | null
}>(), {
    fieldErrors: () => ({}),
    hideSubmit: false,
    hideTitle: false,
    fullWidth: false,
    flatSections: false,
    bareSections: false,
    audience: 'citizen',
    showRequiredLegend: false,
    readOnly: false,
    embedded: false,
    draftMode: false,
    fieldSelectionDisabled: false,
    selectedFieldId: null,
    structureEditable: false,
    draftSingleColumn: false,
    canDrop: null,
    fileUploadsEnabled: true,
    schemaId: null,
    addressInitialQueries: () => ({}),
    jurisdictionSlug: null,
    attachmentAnalysisDisclosures: () => ({}),
    nativeValidation: true,
    fieldAnchorPrefix: null
});

const emit = defineEmits<{
    'selectField': [{
        sectionId: string
        fieldId: string
        field: FormField
        section: FormSchema['sections'][number]
        editLabel?: boolean
    }]
    'submit': []
    'attachment-upload-active': [active: boolean]
    /** Drop of a field: sectionId is the target section, beforeFieldId null appends. */
    'moveField': [{ fieldId: string, sectionId: string, beforeFieldId: string | null }]
    'moveAddressGroup': [{ groupId: string, fromSectionId: string, sectionId: string, beforeFieldId: string | null }]
    'moveSection': [{ sectionId: string, beforeSectionId: string | null }]
    /** Alt+ArrowUp / Alt+ArrowDown on a focused draft field. */
    'moveFieldStep': [{ sectionId: string, fieldId: string, direction: 'up' | 'down' }]
    /** A drag ended over a target the editor refused (canDrop false); the editor says why. */
    'dropRefused': [DraftFieldDrop]
    /** Delete or Backspace on a focused draft field. */
    'deleteField': [{ sectionId: string, fieldId: string }]
    /** Enter on the draft field that is already selected: the editor moves on to its settings. */
    'activateField': [{ sectionId: string, fieldId: string }]
}>();

const { t, locale } = useI18n();
const formData = defineModel<Record<string, unknown>>('modelValue', { required: true });
type AttachmentAnalysisLanguage = 'de' | 'en';

const schemaRef = computed(() => props.schema);
const canonicalData = computed(() => props.localizedCurrencyInput
    ? withCanonicalCurrencyAmounts(props.schema, formData.value)
    : formData.value);
/**
 * Staff edit only: stored data can hold a typed number (a batch manifest keeps JSON numbers), while the page
 * holds a number field as text. The staff renderer reads a number dependency as text (`dependencyAsPageValue`), as
 * its check, the proxy and Drupal do, so 0 is an answer there too. The public form evaluates canonical currency amounts.
 */
const visibilityData = computed(() => props.audience === 'staff'
    ? Object.fromEntries(Object.entries(formData.value).map(([key, value]) => [key, dependencyAsPageValue(value)]))
    : canonicalData.value);
const { isFieldVisible } = useConditionalFields(schemaRef, visibilityData as unknown as Ref<Record<string, unknown>>);
const { isComputedField, getComputedPreview } = useComputedFields(schemaRef, canonicalData);
const previewReadOnly = computed(() => props.readOnly || props.draftMode);
const WIDE_FIELD_TYPES = new Set<FormField['type']>(['textarea', 'radio', 'address', 'file']);
const COMPACT_FIELD_TYPES = new Set<FormField['type']>(['email', 'tel', 'number', 'date', 'select']);
const COMPACT_FORMATS = new Set<string>(['postal_code', 'bic', 'currency', 'reference_number']);
const FORM_FIELD_UI = {
    label: 'text-highlighted',
    help: 'text-muted',
    container: 'mt-1.5'
} as const;
const CHOICE_GROUP_UI = {
    legend: 'mb-2 text-sm font-medium text-highlighted',
    fieldset: 'gap-y-2',
    item: 'border-default bg-elevated/60'
} as const;
const ACCEPTED_ATTACHMENT_TYPES = new Set<string>(ACCEPTED_ATTACHMENT_MIME_TYPES);
const uploadState = ref<Record<string, boolean>>({});
const attachmentAnalysisState = ref<Record<string, boolean>>({});
const uploadErrors = ref<Record<string, string>>({});
const attachmentAnalysisErrors = ref<Record<string, string>>({});
const attachmentAnalysisConsent = ref<Record<string, boolean>>({});
/**
 * Upload checks that outlasted the upload (status 'pending') are polled in
 * the background. Polling never touches uploadState or
 * attachmentAnalysisState: inputs, navigation and submit stay free.
 */
const ANALYSIS_POLL_DELAYS_MS = [3_000, 5_000, 8_000, 13_000] as const;
const ANALYSIS_POLL_CAP_MS = 180_000;
interface AttachmentAnalysisPoll {
    fieldId: string
    startedAt: number
    attempt: number
    timer: ReturnType<typeof setTimeout> | null
}
const attachmentAnalysisPolls = new Map<string, AttachmentAnalysisPoll>();
const attachmentAnalysisTimedOut = ref<Record<string, boolean>>({});
let attachmentAnalysisPollingStopped = false;
const addressGroupPositions = ref<Record<string, { lat: number, lng: number }>>({});
const attachmentUploadActive = computed(() => hasActiveAttachmentUploads());

watch(attachmentUploadActive, active => emit('attachment-upload-active', active), { immediate: true });

const formLayoutClass = computed(() => props.embedded
    ? 'w-full px-4 py-5 sm:px-6'
    : props.fullWidth
        ? 'w-full py-6'
        : 'mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8'
);
/** Staff edit of the application data; the citizen look stays exactly as it was. */
const isStaff = computed(() => props.audience === 'staff');
const sectionGridClass = computed(() => {
    // In structure mode the gap above every field holds the selected field's
    // action bar, so the bar covers nothing of a field. Every other mode is unchanged.
    if (structureActive.value) return 'grid grid-cols-1 gap-x-6 gap-y-14 pt-8 md:grid-cols-2';
    return isStaff.value
        ? 'grid grid-cols-1 gap-x-6 gap-y-4 lg:grid-cols-2'
        : props.embedded
            ? 'grid grid-cols-1 gap-x-6 gap-y-6 lg:grid-cols-2'
            : 'grid grid-cols-1 gap-x-6 gap-y-6 md:grid-cols-2';
});
/** Staff: fields that span both columns, by field type only (never by label). */
const STAFF_WIDE_FIELD_TYPES = new Set<FormField['type']>(['textarea', 'radio', 'address', 'file', 'checkbox']);
const activeLocale = computed(() => String(locale.value || 'de'));

function getFieldDisplay(field: FormField): { label: string, path: string[] } {
    const rawLabel = field.label.trim();
    const [pathText, labelText] = rawLabel.includes(': ')
        ? rawLabel.split(/:\s*/u).reduce<[string, string]>((acc, part, index, parts) => {
            if (index === parts.length - 1) {
                return [acc[0], part];
            }
            return [acc[0] ? `${acc[0]}: ${part}` : part, acc[1]];
        }, ['', rawLabel])
        : ['', rawLabel];

    const path = pathText
        .split(/\s\/\s/u)
        .map(part => part.trim())
        .filter(Boolean);

    return {
        label: labelText || rawLabel,
        path
    };
}

function getSchemaTitle(): string {
    return getLocalizedFormSchemaTitle(props.schema, activeLocale.value);
}

function getSectionTitle(section: FormSchema['sections'][number]): string {
    return getLocalizedFormSectionTitle(section, activeLocale.value);
}

/*
 * Also the name of a checkbox field (`aria-label`): the name Reka's CheckboxRoot gave it from the
 * label's `innerText`, a forced layout per checkbox while the form loads.
 */
function getFieldLabel(field: FormField): string {
    const fallback = props.draftMode ? getFieldDisplay(field).label : field.label;
    const label = getLocalizedFormFieldLabel(field, activeLocale.value, fallback);
    // In the editor an emptied label keeps its place, named as in the inspector's title (77).
    return isUntitledDraftField(field) ? t('admin.fieldInspector.untitledField') : label;
}

/*
 * In the editor a card whose label was emptied lost its label
 * row and got 26 px lower, and everything below it moved up; and back with the first character. In draft
 * mode the row stays, with the inspector's words for such a field ("Feld ohne Beschriftung"), muted. The
 * citizen form is unchanged.
 */
function isUntitledDraftField(field: FormField): boolean {
    return props.draftMode && !getLocalizedFormFieldLabel(field, activeLocale.value, getFieldDisplay(field).label).trim();
}

function getFieldPlaceholder(field: FormField): string | undefined {
    return getLocalizedFormFieldPlaceholder(field, activeLocale.value);
}

function isCompactField(field: FormField): boolean {
    if (WIDE_FIELD_TYPES.has(field.type)) return false;
    if (field.type === 'checkbox') return false;
    if (COMPACT_FIELD_TYPES.has(field.type)) return true;
    if (field.format && COMPACT_FORMATS.has(field.format)) return true;

    return getFieldLabel(field).length <= 28;
}

function fieldLayoutClasses(field: FormField): Record<string, boolean> {
    if (isStaff.value) {
        const wide = STAFF_WIDE_FIELD_TYPES.has(field.type);
        return { 'lg:col-span-1': !wide, 'lg:col-span-2': wide, 'scroll-mb-20': true };
    }
    const compact = !(props.draftMode && props.draftSingleColumn) && isCompactField(field);
    return {
        'md:col-span-1': !props.embedded && compact,
        'md:col-span-2': !props.embedded && !compact,
        'lg:col-span-1': props.embedded && compact,
        'lg:col-span-2': props.embedded && !compact
    };
}

/** Width of the control. Staff: by type (02b, 5): date `w-40`, number `w-32`, select `w-full sm:w-72`; citizen unchanged. */
function controlWidthClass(field: FormField): string {
    if (!isStaff.value) return 'w-full';
    if (field.type === 'date') return 'w-40';
    if (field.type === 'number') return 'w-32';
    if (field.type === 'select') return 'w-full sm:w-72';
    return 'w-full';
}

/** Staff: one line per file of a file field (02b, 3); stored values may carry `id`, `attachmentId` or `fileUuid`. */
function staffFileEntries(field: FormField): Array<{ key: string, filename: string, size?: number }> {
    if (props.staffFileLines) return props.staffFileLines(field.id);
    const value = formData.value[field.id];
    const values = Array.isArray(value) ? value : [value];
    return values.flatMap((entry, position) => {
        if (!entry || typeof entry !== 'object') return [];
        const raw = entry as Record<string, unknown>;
        if (typeof raw.filename !== 'string' || !raw.filename) return [];
        const key = [raw.attachmentId, raw.id, raw.fileUuid].find(candidate => typeof candidate === 'string' && candidate) as string | undefined;
        return [{ key: key ?? `${field.id}-${position}`, filename: raw.filename, size: typeof raw.size === 'number' ? raw.size : undefined }];
    });
}

function getFieldHelp(field: FormField): string | undefined {
    if (field.format === 'iban') return t('form.fieldHelp.iban');
    if (props.localizedCurrencyInput && isCurrencyField(field)) {
        return props.fieldErrors[field.id] ? undefined : t('form.fieldHelp.localizedCurrency');
    }
    if (field.format === 'currency') return t('form.fieldHelp.currency');
    if (
        field.validation?.maxLength
        && (field.type === 'textarea' || field.validation.maxLength > 300)
    ) {
        return t('form.fieldHelp.maxLength', { count: field.validation.maxLength });
    }

    return undefined;
}

/** Required state for assistive technology; the asterisk alone is only visual. */
function getAriaRequired(field: FormField): 'true' | undefined {
    return field.required && !previewReadOnly.value ? 'true' : undefined;
}

function getFieldAnchorId(field: FormField): string | undefined {
    return props.fieldAnchorPrefix && !props.draftMode ? `${props.fieldAnchorPrefix}${field.id}` : undefined;
}

function getSectionDescription(section: FormSchema['sections'][number]): string | undefined {
    return getLocalizedFormSectionDescription(section, activeLocale.value);
}

/**
 * Keeps string type assertions out of the template.
 */
function stringField(fieldId: string) {
    return computed({
        get: () => (formData.value[fieldId] as string) ?? '',
        set: (val: string) => {
            invalidateAddressGroupPosition(fieldId);
            markFormFieldEdited(formData.value, fieldId);
            formData.value[fieldId] = val;
        }
    });
}

function booleanField(fieldId: string) {
    return computed({
        get: () => (formData.value[fieldId] as boolean) ?? false,
        set: (val: boolean) => {
            markFormFieldEdited(formData.value, fieldId);
            formData.value[fieldId] = val;
        }
    });
}

function arrayField(fieldId: string) {
    return computed<string[]>({
        get: () => {
            const value = formData.value[fieldId];
            return Array.isArray(value) ? value.map(String) : [];
        },
        set: (val: string[]) => {
            markFormFieldEdited(formData.value, fieldId);
            formData.value[fieldId] = val;
        }
    });
}

function addressField(fieldId: string) {
    return computed({
        get: () => formData.value[fieldId] ?? null,
        set: (value: unknown) => {
            markFormFieldEdited(formData.value, fieldId);
            formData.value[fieldId] = value;
        }
    });
}

const addressGroupAnchors = computed(() => {
    const anchors = new Map<string, FormAddressGroup>();
    for (const section of props.schema.sections) {
        const order = new Map(section.fields.map((field, index) => [field.id, index]));
        for (const group of section.addressGroups ?? []) {
            const firstFieldId = Object.values(group.fields)
                .sort((left, right) => (order.get(left) ?? Number.MAX_SAFE_INTEGER) - (order.get(right) ?? Number.MAX_SAFE_INTEGER))[0];
            if (firstFieldId) anchors.set(`${section.id}:${firstFieldId}`, group);
        }
    }
    return anchors;
});

function addressGroupFor(sectionId: string, fieldId: string): FormAddressGroup | undefined {
    return addressGroupAnchors.value.get(`${sectionId}:${fieldId}`);
}

// The editor preview is read-only, so a condition can never be met there.
// Draft mode therefore shows every field and labels the conditional ones.
function isFieldShown(fieldId: string): boolean {
    return props.draftMode || isFieldVisible(fieldId);
}

/**
 * A section is hidden only when it has no visible field and no description;
 * an information block (title and description) stays. Follows the answers live. In structure
 * mode the editor shows every section, also an empty one with its "+ Feld".
 */
function isSectionShown(section: FormSchema['sections'][number]): boolean {
    return structureActive.value || sectionIsShown(section, field => isFieldShown(field.id), getSectionDescription(section));
}

function getDraftConditionHint(field: FormField): string {
    const condition = field.conditionalOn;
    if (!props.draftMode || !condition) return '';
    const source = props.schema.sections
        .flatMap(section => section.fields)
        .find(candidate => candidate.id === condition.fieldId);
    const sourceLabel = source ? getFieldDisplay(source).label : condition.fieldId;
    if (condition.value === undefined) return t('form.draftConditionFilled', { field: sourceLabel });
    if (typeof condition.value === 'boolean') {
        return t(condition.value ? 'form.draftConditionChecked' : 'form.draftConditionUnchecked', { field: sourceLabel });
    }
    // The answer text citizens see, not the stored option value.
    return t('form.draftConditionEquals', { field: sourceLabel, value: conditionAnswerLabel(source, condition.value, activeLocale.value) });
}

function isAddressGroupVisible(group: FormAddressGroup): boolean {
    return Object.values(group.fields).every(fieldId => isFieldShown(fieldId));
}

function addressGroupContaining(fieldId: string): FormAddressGroup | undefined {
    for (const section of props.schema.sections) {
        const group = section.addressGroups?.find(candidate => Object.values(candidate.fields).includes(fieldId));
        if (group) return group;
    }
    return undefined;
}

function invalidateAddressGroupPosition(fieldId: string): void {
    const group = addressGroupContaining(fieldId);
    if (!group || !addressGroupPositions.value[group.id]) return;
    const next = { ...addressGroupPositions.value };
    Reflect.deleteProperty(next, group.id);
    addressGroupPositions.value = next;
}

function addressGroupValue(group: FormAddressGroup): FormAddressValue | null {
    const component = (fieldId: string) => {
        const value = formData.value[fieldId];
        return typeof value === 'string' ? value : '';
    };
    const address = {
        street: component(group.fields.street),
        houseNumber: component(group.fields.houseNumber),
        postcode: component(group.fields.postcode),
        city: component(group.fields.city)
    };
    const formatted = formatStructuredAddress(address);
    if (!formatted) return null;
    return normalizeFormAddressValue({
        ...address,
        formatted,
        ...addressGroupPositions.value[group.id]
    });
}

function updateAddressGroup(group: FormAddressGroup, value: FormAddressValue | null): void {
    if (!value) {
        const patch = Object.values(group.fields).reduce<Record<string, string>>((values, fieldId) => {
            values[fieldId] = '';
            return values;
        }, {});
        for (const fieldId of Object.keys(patch)) markFormFieldEdited(formData.value, fieldId);
        formData.value = copyFormValueOrigins(formData.value, { ...formData.value, ...patch });
        const next = { ...addressGroupPositions.value };
        Reflect.deleteProperty(next, group.id);
        addressGroupPositions.value = next;
        return;
    }

    const patch: Record<string, string> = {};
    for (const [component, fieldId] of Object.entries(group.fields)) {
        const nextValue = value[component as keyof FormAddressValue];
        patch[fieldId] = typeof nextValue === 'string' ? nextValue.trim() : '';
    }
    for (const fieldId of Object.keys(patch)) markFormFieldEdited(formData.value, fieldId);
    formData.value = copyFormValueOrigins(formData.value, { ...formData.value, ...patch });
    if (value.lat !== undefined && value.lng !== undefined) {
        addressGroupPositions.value = {
            ...addressGroupPositions.value,
            [group.id]: { lat: value.lat, lng: value.lng }
        };
    } else {
        const next = { ...addressGroupPositions.value };
        Reflect.deleteProperty(next, group.id);
        addressGroupPositions.value = next;
    }
}

function attachmentField(fieldId: string) {
    return computed<ApplicationAttachmentUpload[]>({
        get: () => {
            const value = formData.value[fieldId];
            return Array.isArray(value)
                ? value.filter((item): item is ApplicationAttachmentUpload => Boolean(
                    item
                    && typeof item === 'object'
                    && !Array.isArray(item)
                    && typeof (item as ApplicationAttachmentUpload).attachmentId === 'string'
                    && typeof (item as ApplicationAttachmentUpload).filename === 'string'
                ))
                : [];
        },
        set: (val: ApplicationAttachmentUpload[]) => {
            markFormFieldEdited(formData.value, fieldId);
            formData.value[fieldId] = val;
        }
    });
}

function uploadSchemaId(): string | null {
    return props.schemaId || props.schema.id || null;
}

function fieldInputId(field: FormField): string {
    return `attachment-${field.id}`;
}

function fieldHelpId(field: FormField): string {
    return `${fieldInputId(field)}-help`;
}

function fieldUploadStatusId(field: FormField): string {
    return `${fieldInputId(field)}-status`;
}

function fieldUploadErrorId(field: FormField): string {
    return `${fieldInputId(field)}-error`;
}

function fieldAttachmentAnalysisConsentHintId(field: FormField): string {
    return `${fieldInputId(field)}-analysis-consent-hint`;
}

function fieldAttachmentAnalysisErrorId(field: FormField): string {
    return `${fieldInputId(field)}-analysis-error`;
}

function fieldAttachmentAnalysisDisclosureId(field: FormField): string {
    return `${fieldInputId(field)}-analysis-disclosure`;
}

/** Server-computed disclosure of an enabled pre-check; absent in previews. */
function attachmentAnalysisDisclosure(field: FormField): PublicAttachmentAnalysisDisclosure | undefined {
    if (field.analysis?.enabled !== true) return undefined;
    return props.attachmentAnalysisDisclosures[field.id];
}

/** Static helper text: where the file goes. Never inside a live region. */
function attachmentAnalysisDisclosureLines(field: FormField): string[] {
    const disclosure = attachmentAnalysisDisclosure(field);
    if (!disclosure && canManageAttachments()) {
        const lines = [t('form.attachmentAnalysis.disclosure.administration')];
        if (field.analysis?.enabled && (field.analysis.egressPolicy === 'external_redacted'
          || (field.analysis.redaction === 'when_possible' && field.analysis.egressPolicy !== 'external_allowed' && field.analysis.egressPolicy !== 'no_ai'))) {
            lines.push(t('form.attachmentAnalysis.disclosure.redactedFallback'));
        }
        return lines;
    }
    return citizenAttachmentDisclosureLines(t, field.analysis?.egressPolicy, disclosure, {
        consentBoxShown: attachmentAnalysisConsentOffered(field) && showAttachmentAnalysisConsent(field)
    });
}

/**
 * The consent box is offered unless the server says the file would not
 * leave the system anyway (service not set up or not allowed): asking for
 * consent to a transfer that cannot happen would mislead.
 */
function attachmentAnalysisConsentOffered(field: FormField): boolean {
    return attachmentAnalysisRequiresExternalConsent(field)
      && attachmentAnalysisDisclosure(field)?.state !== 'stays';
}

function attachmentAnalysisConsentHint(field: FormField): string {
    return citizenAttachmentConsentHint(t, attachmentAnalysisDisclosure(field));
}

function fieldUploadAriaLabel(field: FormField): string {
    return `${getFieldLabel(field)}: ${uploadState.value[field.id] ? t('form.fileUploading') : fileSelectLabel(field)}`;
}

function fieldUploadAriaDescribedBy(field: FormField): string {
    const error = props.fieldErrors[field.id] || uploadErrors.value[field.id];
    return [
        fieldHelpId(field),
        attachmentAnalysisConsentOffered(field) ? fieldAttachmentAnalysisConsentHintId(field) : undefined,
        attachmentAnalysisDisclosureLines(field).length > 0 ? fieldAttachmentAnalysisDisclosureId(field) : undefined,
        uploadState.value[field.id] ? fieldUploadStatusId(field) : undefined,
        error ? fieldUploadErrorId(field) : undefined
    ].filter(Boolean).join(' ');
}

function fieldUploadError(field: FormField): string {
    return props.fieldErrors[field.id] || uploadErrors.value[field.id] || '';
}

function formatFileSize(size: number): string {
    return formatFileSizeIn(size, activeLocale.value);
}

function attachmentAnalysisFeedback(attachment: ApplicationAttachmentUpload): ApplicationAttachmentAnalysisFeedback | undefined {
    return attachment.analysis;
}

function attachmentAnalysisLanguage(attachment: ApplicationAttachmentUpload): AttachmentAnalysisLanguage {
    return attachmentAnalysisFeedback(attachment)?.language === 'en' ? 'en' : 'de';
}

function attachmentAnalysisNotice(attachment: ApplicationAttachmentUpload) {
    const feedback = attachment.analysis;
    if (feedback?.status === 'not_checked_redaction_impossible') {
        return {
            label: t('form.attachmentAnalysis.notChecked'), icon: 'i-lucide-shield-off',
            description: t('form.attachmentAnalysis.redactionImpossible')
        };
    }
    if (feedback?.status === 'skipped' && feedback.code === 'analysis_after_submit') {
        return {
            label: t('form.attachmentAnalysis.notCheckedAtUpload'), icon: 'i-lucide-info',
            description: t('form.attachmentAnalysis.submitForHumanReview')
        };
    }
    if (feedback?.status === 'failed' && feedback.code === 'guard_unavailable') {
        return {
            label: t('form.attachmentAnalysis.guardUnavailable'), icon: 'i-lucide-circle-pause',
            description: t('form.attachmentAnalysis.submitForHumanReview')
        };
    }
}

function attachmentAnalysisPresentation(attachment: ApplicationAttachmentUpload) {
    const outcome = attachment.analysis?.result?.outcome;
    if (outcome === 'pass') {
        return { label: t('form.attachmentAnalysis.pass'), color: 'success', icon: 'i-lucide-circle-check' } as const;
    }
    if (outcome === 'fail') {
        return { label: t('form.attachmentAnalysis.fail'), color: 'warning', icon: 'i-lucide-triangle-alert' } as const;
    }
    const key = outcome === 'needs_review' ? 'needsReview' : 'unknown';
    return { label: t(`form.attachmentAnalysis.${key}`), color: 'warning', icon: 'i-lucide-circle-help' } as const;
}

function attachmentAnalysisCriteria(attachment: ApplicationAttachmentUpload) {
    const criteria = attachmentAnalysisFeedback(attachment)?.result?.criteria;
    return Array.isArray(criteria) ? criteria.slice(0, 12) : [];
}

/** Facts about the checked source: truncated PDF, unredacted scan. */
function attachmentAnalysisNotices(attachment: ApplicationAttachmentUpload): string[] {
    const result = attachmentAnalysisFeedback(attachment)?.result;
    const notices = Array.isArray(result?.notices) ? result.notices : [];
    return notices.flatMap((notice) => {
        if (notice === 'pages_truncated') {
            return [t('form.attachmentAnalysis.notices.pagesTruncated', { count: result?.pagesChecked ?? 3 })];
        }
        if (notice === 'unredacted_scan') return [t('form.attachmentAnalysis.notices.unredactedScan')];
        return [];
    });
}

function attachmentAnalysisCriterionIcon(status: 'confirmed' | 'missing' | 'unclear'): string {
    if (status === 'confirmed') return 'i-lucide-circle-check';
    if (status === 'missing') return 'i-lucide-circle-alert';
    return 'i-lucide-circle-help';
}

function attachmentAnalysisCriterionClass(status: 'confirmed' | 'missing' | 'unclear'): string {
    if (status === 'confirmed') return 'text-success';
    if (status === 'missing') return 'text-warning';
    return 'text-muted';
}

function attachmentAnalysisHasResult(attachment: ApplicationAttachmentUpload): boolean {
    return attachmentAnalysisFeedback(attachment)?.status === 'complete'
      && Boolean(attachmentAnalysisFeedback(attachment)?.result);
}

function attachmentAnalysisUnavailable(attachment: ApplicationAttachmentUpload): boolean {
    return attachmentAnalysisFeedback(attachment)?.status === 'failed';
}

function attachmentAnalysisPending(attachment: ApplicationAttachmentUpload): boolean {
    return attachmentAnalysisFeedback(attachment)?.status === 'pending'
      && attachmentAnalysisTimedOut.value[attachment.attachmentId] !== true;
}

function attachmentAnalysisPollTimedOut(attachment: ApplicationAttachmentUpload): boolean {
    return attachmentAnalysisFeedback(attachment)?.status === 'pending'
      && attachmentAnalysisTimedOut.value[attachment.attachmentId] === true;
}

function startAttachmentAnalysisPoll(fieldId: string, attachment: ApplicationAttachmentUpload): void {
    if (
        attachmentAnalysisPollingStopped
        || attachmentAnalysisPolls.has(attachment.attachmentId)
        || typeof attachment.claimToken !== 'string'
        || attachment.claimToken.length === 0
    ) {
        return;
    }
    attachmentAnalysisPolls.set(attachment.attachmentId, {
        fieldId,
        startedAt: Date.now(),
        attempt: 0,
        timer: null
    });
    scheduleAttachmentAnalysisPoll(attachment.attachmentId);
}

function stopAttachmentAnalysisPoll(attachmentId: string): void {
    const poll = attachmentAnalysisPolls.get(attachmentId);
    if (poll?.timer) clearTimeout(poll.timer);
    attachmentAnalysisPolls.delete(attachmentId);
}

/** Next poll with backoff, or the neutral end once the cap is reached. */
function scheduleAttachmentAnalysisPoll(attachmentId: string): void {
    const poll = attachmentAnalysisPolls.get(attachmentId);
    if (!poll || attachmentAnalysisPollingStopped) return;
    const remaining = ANALYSIS_POLL_CAP_MS - (Date.now() - poll.startedAt);
    if (remaining <= 0) {
        stopAttachmentAnalysisPoll(attachmentId);
        attachmentAnalysisTimedOut.value = { ...attachmentAnalysisTimedOut.value, [attachmentId]: true };
        return;
    }
    const delay = ANALYSIS_POLL_DELAYS_MS[Math.min(poll.attempt, ANALYSIS_POLL_DELAYS_MS.length - 1)] ?? 13_000;
    poll.timer = setTimeout(() => {
        void pollAttachmentAnalysis(attachmentId);
    }, Math.min(delay, remaining));
}

function errorStatusCode(error: unknown): number | undefined {
    const candidate = error as { statusCode?: unknown, status?: unknown, response?: { status?: unknown } } | null;
    const status = candidate?.statusCode ?? candidate?.status ?? candidate?.response?.status;
    return typeof status === 'number' ? status : undefined;
}

async function pollAttachmentAnalysis(attachmentId: string): Promise<void> {
    const poll = attachmentAnalysisPolls.get(attachmentId);
    if (!poll || attachmentAnalysisPollingStopped) return;
    poll.timer = null;
    poll.attempt += 1;
    const attachment = attachmentField(poll.fieldId).value.find(item => item.attachmentId === attachmentId);
    if (!attachment?.claimToken) {
        stopAttachmentAnalysisPoll(attachmentId);
        return;
    }

    let response: { data?: { id?: string, analysisStatus?: string, analysis?: ApplicationAttachmentAnalysisFeedback } } | undefined;
    try {
        response = await $fetch(`/api/attachments/${encodeURIComponent(attachmentId)}/analysis`, {
            method: 'GET',
            headers: { 'X-Attachment-Claim-Token': attachment.claimToken }
        });
    } catch (error: unknown) {
        if (attachmentAnalysisPolls.get(attachmentId) !== poll) return;
        const status = errorStatusCode(error);
        if (status !== undefined && status >= 400 && status < 500 && status !== 429) {
            // The upload is gone, claimed or no longer ours: stop calmly.
            stopAttachmentAnalysisPoll(attachmentId);
            attachmentAnalysisTimedOut.value = { ...attachmentAnalysisTimedOut.value, [attachmentId]: true };
            return;
        }
        scheduleAttachmentAnalysisPoll(attachmentId);
        return;
    }
    // Removed, unmounted or restarted while the request was on its way.
    if (attachmentAnalysisPolls.get(attachmentId) !== poll) return;

    const analysis = response?.data?.id === attachmentId ? response.data.analysis : undefined;
    if (!analysis || analysis.status === 'pending') {
        scheduleAttachmentAnalysisPoll(attachmentId);
        return;
    }
    stopAttachmentAnalysisPoll(attachmentId);
    attachmentField(poll.fieldId).value = attachmentField(poll.fieldId).value.map(item =>
        item.attachmentId === attachmentId
            ? { ...item, analysisStatus: response?.data?.analysisStatus || analysis.status, analysis }
            : item
    );
}

function resumeAttachmentAnalysisPolls(): void {
    for (const section of props.schema.sections) {
        for (const field of section.fields) {
            if (field.type !== 'file') continue;
            for (const attachment of attachmentField(field.id).value) {
                if (attachmentAnalysisPending(attachment)) {
                    startAttachmentAnalysisPoll(field.id, attachment);
                }
            }
        }
    }
}

onMounted(() => {
    if (canManageAttachments()) resumeAttachmentAnalysisPolls();
});

onBeforeUnmount(() => {
    attachmentAnalysisPollingStopped = true;
    for (const attachmentId of [...attachmentAnalysisPolls.keys()]) {
        stopAttachmentAnalysisPoll(attachmentId);
    }
});

function attachmentAnalysisRequiresExternalConsent(field: FormField): boolean {
    return field.analysis?.enabled === true && field.analysis.egressPolicy === 'external_allowed';
}

function attachmentAnalysisConsentValue(fieldId: string): boolean {
    return attachmentAnalysisConsent.value[fieldId] === true;
}

function pendingAttachmentAnalysisCount(field: FormField): number {
    return attachmentField(field.id).value.filter(attachment =>
        typeof attachment.claimToken === 'string'
        && attachment.claimToken.length > 0
        && attachment.analysisStatus !== 'complete'
        && attachment.analysisStatus !== 'pending'
    ).length;
}

function showAttachmentAnalysisConsent(field: FormField): boolean {
    return pendingAttachmentAnalysisCount(field) > 0
      || attachmentField(field.id).value.length < fileFieldMaxFiles(field);
}

function attachmentAnalysisConsentLabel(field: FormField): string {
    const count = pendingAttachmentAnalysisCount(field);
    if (count === 1) return t('form.attachmentAnalysis.consentLabelUploaded');
    if (count > 1) return t('form.attachmentAnalysis.consentLabelUploadedMultiple', { count });
    if (attachmentField(field.id).value.length > 0) {
        return t('form.attachmentAnalysis.consentLabelNextUpload');
    }
    return t('form.attachmentAnalysis.consentLabel');
}

function attachmentAnalysisInProgressLabel(field: FormField): string {
    const count = pendingAttachmentAnalysisCount(field);
    return count > 1
        ? t('form.attachmentAnalysis.inProgressMultiple', { count })
        : t('form.attachmentAnalysis.inProgress');
}

function attachmentAnalysisConsentDescribedBy(field: FormField): string {
    return [
        fieldAttachmentAnalysisConsentHintId(field),
        attachmentAnalysisErrors.value[field.id] ? fieldAttachmentAnalysisErrorId(field) : undefined
    ].filter(Boolean).join(' ');
}

async function updateAttachmentAnalysisConsent(field: FormField, value: unknown): Promise<void> {
    if (attachmentAnalysisState.value[field.id]) return;
    const consented = value === true;
    attachmentAnalysisConsent.value[field.id] = consented;
    if (!consented || !canManageAttachments()) return;

    const attachments = attachmentField(field.id).value.filter(attachment =>
        typeof attachment.claimToken === 'string'
        && attachment.claimToken.length > 0
        && attachment.analysisStatus !== 'complete'
        && attachment.analysisStatus !== 'pending'
    );
    if (attachments.length === 0) return;

    attachmentAnalysisState.value[field.id] = true;
    attachmentAnalysisErrors.value[field.id] = '';
    const language: AttachmentAnalysisLanguage = activeLocale.value.toLowerCase().startsWith('en') ? 'en' : 'de';
    try {
        for (const attachment of attachments) {
            const response = await $fetch<{
                data?: {
                    id?: string
                    analysisStatus?: string
                    analysis?: ApplicationAttachmentAnalysisFeedback
                }
            }>(`/api/attachments/${encodeURIComponent(attachment.attachmentId)}/analysis`, {
                method: 'POST',
                body: {
                    formId: attachment.formId || uploadSchemaId(),
                    fieldId: attachment.fieldId || field.id,
                    claimToken: attachment.claimToken,
                    analysisConsent: true,
                    language
                }
            });
            if (!response.data?.id || response.data.id !== attachment.attachmentId) {
                throw new Error('invalid_attachment_analysis_response');
            }
            attachmentField(field.id).value = attachmentField(field.id).value.map(item =>
                item.attachmentId === attachment.attachmentId
                    ? {
                        ...item,
                        analysisStatus: response.data?.analysisStatus || 'failed',
                        analysis: response.data?.analysis
                    }
                    : item
            );
        }
    } catch (error: unknown) {
        attachmentAnalysisErrors.value[field.id] = uploadErrorMessage(error, 'errors.attachments.analysisUnavailable');
    } finally {
        attachmentAnalysisState.value[field.id] = false;
        attachmentAnalysisConsent.value[field.id] = false;
    }
}

function fileSelectLabel(field: FormField): string {
    return attachmentAnalysisRequiresExternalConsent(field) && attachmentAnalysisConsentValue(field.id)
        ? t('form.fileSelectWithAnalysis')
        : t('form.fileSelect');
}

function allowsMultipleAttachmentSelection(field: FormField): boolean {
    return !attachmentAnalysisRequiresExternalConsent(field) || !attachmentAnalysisConsentValue(field.id);
}

function fileFieldConstraints(field: FormField): string {
    const count = fileFieldMaxFiles(field);
    return t('form.fileConstraintsWithLimits', {
        max: formatFileSize(fileFieldMaxSizeBytes(field)),
        count
    }, count);
}

function validateAttachmentFile(field: FormField, file: File): string | null {
    const extension = file.name.includes('.') ? `.${file.name.split('.').pop()?.toLowerCase()}` : '';
    if (!ACCEPTED_ATTACHMENT_TYPES.has(file.type) && !(ACCEPTED_ATTACHMENT_EXTENSIONS as readonly string[]).includes(extension)) {
        return t('form.fileUnsupportedType');
    }
    const maxSizeBytes = fileFieldMaxSizeBytes(field);
    if (file.size > maxSizeBytes) {
        return t('form.fileTooLargeWithLimit', { max: formatFileSize(maxSizeBytes) });
    }
    return null;
}

async function uploadAttachment(
    field: FormField,
    file: File,
    language: AttachmentAnalysisLanguage = activeLocale.value.toLowerCase().startsWith('en') ? 'en' : 'de',
    externalAnalysisConsent = false
): Promise<void> {
    if (!canManageAttachments()) return;

    const schemaId = uploadSchemaId();
    if (!schemaId) {
        uploadErrors.value[field.id] = t('form.fileUploadUnavailable');
        return;
    }

    const current = attachmentField(field.id).value;
    const maxFiles = fileFieldMaxFiles(field);
    if (current.length >= maxFiles) {
        uploadErrors.value[field.id] = t('form.fileTooManyWithLimit', { count: maxFiles });
        return;
    }

    const validationError = validateAttachmentFile(field, file);
    if (validationError) {
        uploadErrors.value[field.id] = validationError;
        return;
    }

    uploadState.value[field.id] = true;
    uploadErrors.value[field.id] = '';
    attachmentAnalysisErrors.value[field.id] = '';
    try {
        const body = new FormData();
        body.append('formId', schemaId);
        body.append('fieldId', field.id);
        body.append('language', language);
        if (attachmentAnalysisRequiresExternalConsent(field) && externalAnalysisConsent) {
            body.append('analysisConsent', 'true');
        }
        body.append('file', file);
        const response = await $fetch<{
            data?: {
                id?: string
                claimToken?: string
                filename?: string
                size?: number
                mimeType?: string
                fieldId?: string
                formId?: string
                analysisStatus?: string
                analysis?: ApplicationAttachmentAnalysisFeedback
            }
        }>('/api/attachments', {
            method: 'POST',
            body
        });
        const data = response.data;
        if (!data?.id || !data.claimToken) {
            throw new Error('invalid_attachment_response');
        }
        const uploaded: ApplicationAttachmentUpload = {
            attachmentId: data.id,
            claimToken: data.claimToken,
            filename: data.filename || file.name,
            size: data.size || file.size,
            mimeType: data.mimeType || file.type,
            fieldId: data.fieldId || field.id,
            formId: data.formId || schemaId,
            analysisStatus: data.analysisStatus || 'not_requested',
            analysis: data.analysis
        };
        attachmentField(field.id).value = [...attachmentField(field.id).value, uploaded];
        uploadErrors.value[field.id] = '';
        if (uploaded.analysis?.status === 'pending') {
            // The check outlasted the upload; the form stays free meanwhile.
            startAttachmentAnalysisPoll(field.id, uploaded);
        }
    } catch (error) {
        uploadErrors.value[field.id] = uploadErrorMessage(error);
    } finally {
        uploadState.value[field.id] = false;
    }
}

async function onFileSelected(field: FormField, event: Event): Promise<void> {
    if (!canManageAttachments()) return;
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files || []);
    input.value = '';
    if (files.length === 0) return;
    const maxFiles = fileFieldMaxFiles(field);
    const remaining = maxFiles - attachmentField(field.id).value.length;
    const usedExternalAnalysisConsent = attachmentAnalysisRequiresExternalConsent(field)
      && attachmentAnalysisConsentValue(field.id);
    const uploadLanguage: AttachmentAnalysisLanguage = activeLocale.value.toLowerCase().startsWith('en') ? 'en' : 'de';
    let firstError = '';
    const filesToUpload = files.slice(0, Math.max(0, remaining));
    for (const file of filesToUpload) {
        await uploadAttachment(field, file, uploadLanguage, usedExternalAnalysisConsent);
        const currentError = uploadErrors.value[field.id] || '';
        if (!firstError && currentError) {
            firstError = currentError;
        }
    }
    if (usedExternalAnalysisConsent) {
        attachmentAnalysisConsent.value[field.id] = false;
    }
    if (files.length > remaining) {
        uploadErrors.value[field.id] = t('form.fileTooManyWithLimit', { count: maxFiles });
        return;
    }
    if (firstError) {
        uploadErrors.value[field.id] = firstError;
    }
}

function removeAttachment(field: FormField, attachmentId: string): void {
    if (!canManageAttachments() || attachmentAnalysisState.value[field.id]) return;
    stopAttachmentAnalysisPoll(attachmentId);
    if (attachmentAnalysisTimedOut.value[attachmentId]) {
        attachmentAnalysisTimedOut.value = Object.fromEntries(
            Object.entries(attachmentAnalysisTimedOut.value).filter(([id]) => id !== attachmentId)
        );
    }
    attachmentField(field.id).value = attachmentField(field.id).value
        .filter(item => item.attachmentId !== attachmentId);
    uploadErrors.value[field.id] = '';
    attachmentAnalysisErrors.value[field.id] = '';
    attachmentAnalysisConsent.value[field.id] = false;
}

function canManageAttachments(): boolean {
    return !previewReadOnly.value && props.fileUploadsEnabled;
}

function uploadErrorMessage(error: unknown, fallback = 'form.fileUploadFailed'): string {
    const responseData = (error as { data?: { code?: unknown, data?: { code?: unknown } } })?.data;
    const code = responseData?.data?.code ?? responseData?.code;
    return typeof code === 'string' && code.startsWith('errors.')
        ? t(code)
        : t(fallback);
}

function getChoiceItems(field: FormField): Array<{ label: string, value: string }> {
    return getLocalizedFormFieldChoiceItems(field, activeLocale.value);
}

function getSingleLineInputType(field: FormField): 'text' | 'email' | 'tel' {
    if (field.type === 'email' || field.type === 'tel') return field.type;
    return 'text';
}

function onFormSubmit() {
    if (previewReadOnly.value) {
        return;
    }
    if (hasActiveAttachmentUploads()) {
        markActiveAttachmentUploads();
        return;
    }

    emit('submit');
}

function hasActiveAttachmentUploads(): boolean {
    return Object.values(uploadState.value).some(Boolean)
      || Object.values(attachmentAnalysisState.value).some(Boolean);
}

function markActiveAttachmentUploads(): void {
    for (const [fieldId, active] of Object.entries(uploadState.value)) {
        if (active) {
            uploadErrors.value[fieldId] = t('form.fileUploadInProgress');
        }
    }
    for (const [fieldId, active] of Object.entries(attachmentAnalysisState.value)) {
        if (active) {
            uploadErrors.value[fieldId] = t('form.attachmentAnalysis.inProgress');
        }
    }
}

function getFieldAttrs(field: FormField): Record<string, string | number | undefined> {
    return {
        autocomplete: getFieldAutocomplete(field),
        inputmode: getFieldInputMode(field),
        pattern: field.validation?.pattern,
        minlength: field.validation?.minLength,
        maxlength: field.validation?.maxLength,
        min: field.validation?.min,
        max: field.validation?.max,
        step: field.validation?.step
    };
}

function getTextareaAttrs(field: FormField): Record<string, string | number | undefined> {
    return {
        autocomplete: getFieldAutocomplete(field),
        minlength: field.validation?.minLength,
        maxlength: field.validation?.maxLength
    };
}

function getDraftFieldAriaLabel(field: FormField): string | undefined {
    return props.draftMode
        ? t('form.selectFieldForEditing', { label: getFieldLabel(field) })
        : undefined;
}

function onFieldSelect(section: FormSchema['sections'][number], field: FormField, editLabel = false) {
    if (!props.draftMode || props.fieldSelectionDisabled) return;

    emit('selectField', {
        sectionId: section.id,
        fieldId: field.id,
        field,
        section,
        ...(editLabel ? { editLabel: true } : {})
    });
}

function onFieldKeydown(event: KeyboardEvent, section: FormSchema['sections'][number], field: FormField) {
    if (!props.draftMode || props.fieldSelectionDisabled) return;

    // Structure shortcuts act on the focused field card only. A key pressed in
    // a control inside the card (a read-only preview input, a select) bubbles
    // up here too, and Backspace there must never delete the field.
    const onCard = event.target === event.currentTarget;

    if (onCard && structureInteractive.value && event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault();
        emit('moveFieldStep', { sectionId: section.id, fieldId: field.id, direction: event.key === 'ArrowUp' ? 'up' : 'down' });
        return;
    }

    // Delete acts only on the SELECTED field. After a delete the
    // focus goes to the next card, which is not selected; a second press used to delete that one
    // too, and with one undo step the first deletion was then gone for good. To delete it, the
    // person selects it first (Enter or Space), deliberately.
    if (onCard && structureInteractive.value && !event.altKey && !event.ctrlKey && !event.metaKey && (event.key === 'Delete' || event.key === 'Backspace')) {
        event.preventDefault();
        if (props.selectedFieldId === field.id) emit('deleteField', { sectionId: section.id, fieldId: field.id });
        return;
    }

    if (event.key !== 'Enter' && event.key !== ' ') return;

    event.preventDefault();
    if (onCard && event.key === 'Enter' && props.selectedFieldId === field.id) {
        emit('activateField', { sectionId: section.id, fieldId: field.id });
        return;
    }
    onFieldSelect(section, field, onCard && event.key === 'Enter');
}

/*
 * Draft structure editing: native HTML5 drag and drop. The drag item
 * lives in component state, so dragover never reads dataTransfer, and the
 * schema changes only on drop (in the editor), never while dragging.
 *
 * One function decides the target from the pointer's height
 * inside a section (`fieldDropAt`), the line shows that target and the drop
 * applies exactly it: no line, no drop. The whole card is the handle, the
 * area scrolls by itself near its edges, and a target the editor refuses is
 * explained at the end of a drag that did not drop.
 */
type DraftDragItem
    = | { kind: 'field', fieldId: string, sectionId: string }
      | { kind: 'addressGroup', groupId: string, sectionId: string, fieldIds: string[] }
      | { kind: 'section', sectionId: string };
type DraftDropTarget
    = | { kind: 'field', fieldId: string, position: 'before' | 'after' }
      | { kind: 'sectionEnd', sectionId: string }
      | { kind: 'section', sectionId: string, position: 'before' | 'after' };
/** What a drop applies; null means no drop. */
type DraftDropMove
    = | { kind: 'field', sectionId: string, beforeFieldId: string | null }
      | { kind: 'section', beforeSectionId: string | null };

const structureActive = computed(() => props.draftMode && props.structureEditable);
const structureInteractive = computed(() => structureActive.value && !props.fieldSelectionDisabled);
const draftDrag = ref<DraftDragItem | null>(null);
/*
 * The template asked every row for the drop state, so each change of
 * the target re-rendered all fields of all sections. Target and move are plain state (only the
 * drop reads them); what a row SHOWS is kept per key in `draftLines` and `draftNotes`, which only
 * that row reads (its `v-draft-mark` and its `FormDraftGroupNote`). A change of the target updates
 * the old and the new row, nothing else.
 */
let draftDropTarget: DraftDropTarget | null = null;
let draftDropMove: DraftDropMove | null = null;
/** Row or section key -> its line class (`draft-drop-before`, `-after`, `-into`). */
const draftLines = reactive(new Map<string, string>());
/**
 * The row (a card or the search block) of an address group the pointer is over,
 * which takes no foreign fields; it says so while the line stands before or after the group.
 */
let draftGroupNoteRow: string | null = null;
const draftNotes = reactive(new Set<string>());
/**
 * The rows being dragged (a card, or an address block with its cards), dimmed through the
 * same per-row mark, so starting and ending a drag render no part of the form either.
 */
const draftDragged = reactive(new Set<string>());
/** The last target the pointer was over that the editor refused; said if the drag ends there. */
let refusedFieldDrop: DraftFieldDrop | null = null;
let refusedDragoverEvent: Event | null = null;
let draftDropped = false;

/** Controls whose text a person may select and drag. */
const TEXT_DRAG_SOURCES = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

function dragEventElement(event: Event): Element | null {
    const target = event.target;
    if (target instanceof Element) return target;
    return (target as Node | null)?.parentElement ?? null;
}

function startDraftDrag(event: DragEvent, item: DraftDragItem, dataId: string): boolean {
    // Never cancel a drag the renderer does not own (text in an input, a link).
    if (!structureInteractive.value) return false;
    event.stopPropagation();
    draftDrag.value = item;
    draftDragged.clear();
    if (item.kind === 'field') draftDragged.add(item.fieldId);
    if (item.kind === 'addressGroup') [`group:${item.groupId}`, ...item.fieldIds].forEach(key => draftDragged.add(key));
    draftDropped = false;
    refusedFieldDrop = null;
    canDropAnswers.clear();
    resetDragoverFrames();
    if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        // Firefox starts a drag only when some data is set.
        event.dataTransfer.setData('text/plain', dataId);
    }
    beginDragSession(dragEventElement(event));
    return true;
}

/*
 * Every dragover assigned a NEW object here, also over
 * the same target, so the whole form re-rendered at every event (8 to 10 ms for 51 fields). A
 * target or move equal to the current one changes nothing.
 */
function sameDropValue(a: object | null, b: object | null): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    const keysA = Object.keys(a) as Array<keyof typeof a>;
    return keysA.length === Object.keys(b).length && keysA.every(key => a[key] === b[key]);
}

/** The key (`v-draft-mark`) and the line class a target shows. */
function draftLineFor(target: DraftDropTarget | null): { key: string, line: string } | null {
    if (!target) return null;
    if (target.kind === 'field') return { key: target.fieldId, line: target.position === 'before' ? 'draft-drop-before' : 'draft-drop-after' };
    const key = `section:${target.sectionId}`;
    if (target.kind === 'sectionEnd') return { key, line: 'draft-drop-into' };
    return { key, line: target.position === 'before' ? 'draft-drop-before' : 'draft-drop-after' };
}

function setDropTarget(target: DraftDropTarget | null, move: DraftDropMove | null) {
    draftDropMove = target ? move : null;
    if (sameDropValue(draftDropTarget, target)) return;
    const previous = draftLineFor(draftDropTarget);
    const next = draftLineFor(target);
    draftDropTarget = target;
    if (previous && previous.key !== next?.key) draftLines.delete(previous.key);
    if (next) draftLines.set(next.key, next.line);
}

function setGroupNoteRow(row: string | null) {
    if (row === draftGroupNoteRow) return;
    if (draftGroupNoteRow) draftNotes.delete(draftGroupNoteRow);
    draftGroupNoteRow = row;
    if (row) draftNotes.add(row);
}

/*
 * The line and the dragged state is a class of the row (or section) it stands at, toggled
 * by the row's own effect. Vue
 * writes `className` again only when that element's bound class changes; `updated` puts the line
 * back after such a write. Without a key (citizen form, preview) the directive does nothing.
 */
const DRAFT_LINE_CLASSES = ['draft-drop-before', 'draft-drop-after', 'draft-drop-into'];
const draftMarkEffects = new WeakMap<HTMLElement, { key: string, stop: () => void }>();

function applyDraftMark(element: HTMLElement, key: string) {
    const line = draftLines.get(key);
    for (const name of DRAFT_LINE_CLASSES) {
        if (element.classList.contains(name) !== (name === line)) element.classList.toggle(name, name === line);
    }
    const dragged = draftDragged.has(key);
    if (element.classList.contains('draft-dragging') !== dragged) element.classList.toggle('draft-dragging', dragged);
}

function startDraftMark(element: HTMLElement, key: string | null | undefined) {
    if (!key) return;
    const stop = watchEffect(() => applyDraftMark(element, key), { flush: 'sync' });
    draftMarkEffects.set(element, { key, stop });
}

function stopDraftMark(element: HTMLElement) {
    draftMarkEffects.get(element)?.stop();
    draftMarkEffects.delete(element);
}

const vDraftMark: Directive<HTMLElement, string | null | undefined> = {
    mounted: (element, binding) => startDraftMark(element, binding.value),
    updated: (element, binding) => {
        const current = draftMarkEffects.get(element);
        if ((current?.key ?? null) !== (binding.value ?? null)) {
            stopDraftMark(element);
            startDraftMark(element, binding.value);
        } else if (current) {
            applyDraftMark(element, current.key);
        }
    },
    beforeUnmount: element => stopDraftMark(element),
    getSSRProps: () => ({})
};

function endDraftDrag() {
    endDragSession();
    const refused = draftDrag.value && !draftDropped ? refusedFieldDrop : null;
    draftDrag.value = null;
    draftDragged.clear();
    canDropAnswers.clear();
    resetDragoverFrames();
    setDropTarget(null, null);
    setGroupNoteRow(null);
    refusedFieldDrop = null;
    draftDropped = false;
    if (refused) emit('dropRefused', refused);
}

function onDraftFormDragLeave(event: DragEvent) {
    const next = event.relatedTarget as Node | null;
    if (!next || !(event.currentTarget as HTMLElement | null)?.contains(next)) {
        dropPendingDragovers();
        setDropTarget(null, null);
        setGroupNoteRow(null);
    }
}

/**
 * Over the form but not over a section (the gap between two sections): for a field no line and
 * no drop; for a section the gap is a boundary like any other.
 */
function onDraftFormDragOver(event: DragEvent) {
    const item = draftDrag.value;
    if (!item || event.defaultPrevented) return;
    if (item.kind === 'section') {
        const form = event.currentTarget as HTMLElement;
        const clientY = event.clientY;
        gateDragover(event, () => {
            const found = sectionDropAt(form, item.sectionId, clientY);
            if (found) {
                setDropTarget(found.target, { kind: 'section', beforeSectionId: found.beforeSectionId });
                return { allowed: true, refusedField: false };
            }
            setDropTarget(null, null);
            refusedFieldDrop = null;
            setGroupNoteRow(null);
            return { allowed: false, refusedField: false };
        });
        return;
    }
    setDropTarget(null, null);
    if (refusedDragoverEvent !== event) {
        // In the gap between two sections: no line, and nothing left over from a section.
        dropPendingDragovers();
        refusedFieldDrop = null;
        setGroupNoteRow(null);
    }
}

/** A section dropped in the gap between two sections lands on the boundary the line shows. */
function onDraftFormDrop(event: DragEvent) {
    if (draftDrag.value?.kind !== 'section' || event.defaultPrevented) return;
    onSectionDrop(event);
}

function draggedFieldIds(): string[] {
    const item = draftDrag.value;
    if (!item) return [];
    if (item.kind === 'field') return [item.fieldId];
    if (item.kind === 'addressGroup') return item.fieldIds;
    return [];
}

/*
 * The whole card is the handle. In structure mode the card's content takes no pointer
 * events and no text selection (`.draft-draggable`), so a press anywhere on the card lands on
 * the card: moving starts the drag (the browser's own threshold), a press without movement
 * stays a click and selects. A drag out of a text control stays the browser's own.
 */
function onFieldDragStart(event: DragEvent, section: FormSchema['sections'][number], field: FormField) {
    if (dragEventElement(event)?.closest(TEXT_DRAG_SOURCES)) return;
    startDraftDrag(event, { kind: 'field', fieldId: field.id, sectionId: section.id }, field.id);
}

function onAddressGroupDragStart(event: DragEvent, section: FormSchema['sections'][number], group: FormAddressGroup) {
    // Text dragged out of the address search input is not a group move.
    if (dragEventElement(event)?.closest(TEXT_DRAG_SOURCES)) return;
    const componentIds = new Set(Object.values(group.fields));
    startDraftDrag(event, {
        kind: 'addressGroup',
        groupId: group.id,
        sectionId: section.id,
        fieldIds: section.fields.filter(field => componentIds.has(field.id)).map(field => field.id)
    }, group.id);
}

function fieldDropFor(sectionId: string, beforeFieldId: string | null): DraftFieldDrop | null {
    const item = draftDrag.value;
    if (item?.kind === 'field') return { kind: 'field', fieldId: item.fieldId, sectionId, beforeFieldId };
    if (item?.kind === 'addressGroup') {
        return { kind: 'addressGroup', groupId: item.groupId, fromSectionId: item.sectionId, sectionId, beforeFieldId };
    }
    return null;
}

/*
 * `canDrop` ran on every dragover, and the editor answers it by running the whole
 * move on the schema. The schema does not change while dragging, so each destination is asked once
 * per drag; the answers are dropped when a drag starts or ends and when the schema or `canDrop`
 * change.
 */
const canDropAnswers = new Map<string, boolean>();
// The editor's answer also depends on whether it is editable at all (a save in progress, "Nur
// ansehen"); it says so through these props, so a change of them asks again.
watch(
    [() => props.schema, () => props.canDrop, () => props.draftMode, () => props.structureEditable, () => props.fieldSelectionDisabled],
    () => canDropAnswers.clear()
);

/** Asks the editor whether the schema layer would take this drop (and change something). */
function fieldDropAllowed(sectionId: string, beforeFieldId: string | null): boolean {
    const drop = fieldDropFor(sectionId, beforeFieldId);
    if (!drop || !props.canDrop) return true;
    const key = `${sectionId}\n${beforeFieldId ?? ''}`;
    let allowed = canDropAnswers.get(key);
    if (allowed === undefined) {
        allowed = props.canDrop(drop);
        canDropAnswers.set(key, allowed);
    }
    return allowed;
}

/** The search block stands before the group's first field. */
function addressGroupDropBefore(section: FormSchema['sections'][number], group: FormAddressGroup): string | null {
    const componentIds = new Set(Object.values(group.fields));
    const dragged = new Set(draggedFieldIds());
    return section.fields.find(field => componentIds.has(field.id) && !dragged.has(field.id))?.id ?? null;
}

/**
 * Over an address group the line stood behind the WHOLE group,
 * up to 400 px from the pointer and outside the window, because the group's cards are no targets
 * of their own. A group takes no foreign fields; while the pointer is over one (its search block,
 * its cards or the gaps between them), the target is the nearer of its two edges: before its
 * first row or after its last one. The row under the pointer says why (`draftGroupNoteRow`). The
 * group being dragged, or holding the dragged field, is not such a group.
 */
function addressGroupUnderPointer(
    section: FormSchema['sections'][number],
    rows: Array<{ key: string, element: HTMLElement }>,
    clientY: number
): { target: DraftDropTarget, beforeFieldId: string | null, noteRow: string } | null {
    const dragged = new Set(draggedFieldIds());
    for (const group of section.addressGroups ?? []) {
        const members = new Set(Object.values(group.fields));
        if ([...members].some(id => dragged.has(id))) continue;
        const groupRows = rows
            .filter(row => row.key === `group:${group.id}` || members.has(row.key))
            .map(row => ({ ...row, rect: row.element.getBoundingClientRect() }));
        const first = groupRows[0];
        const last = groupRows.at(-1);
        if (!first || !last) continue;
        const top = Math.min(...groupRows.map(row => row.rect.top));
        const bottom = Math.max(...groupRows.map(row => row.rect.bottom));
        if (clientY < top || clientY > bottom) continue;
        // The row under the pointer; in a gap between two of its rows, the nearer one.
        const distance = (rect: DOMRect) => clientY < rect.top ? rect.top - clientY : Math.max(0, clientY - rect.bottom);
        const under = groupRows.reduce((nearest, row) => distance(row.rect) < distance(nearest.rect) ? row : nearest);
        if (clientY - top <= bottom - clientY) {
            return {
                target: { kind: 'field', fieldId: first.key, position: 'before' },
                beforeFieldId: addressGroupDropBefore(section, group),
                noteRow: under.key
            };
        }
        // After the group: before the next row that is not part of it, else at the section's end.
        const after = rows.slice(rows.findIndex(row => row.key === last.key) + 1)
            .find(row => row.key !== `group:${group.id}` && !members.has(row.key));
        const nextGroup = after?.key.startsWith('group:')
            ? section.addressGroups?.find(candidate => `group:${candidate.id}` === after.key)
            : undefined;
        return {
            target: { kind: 'field', fieldId: last.key, position: 'after' },
            beforeFieldId: after ? (nextGroup ? addressGroupDropBefore(section, nextGroup) : after.key) : null,
            noteRow: under.key
        };
    }
    return null;
}

/**
 * The target of a field or address group drag at the pointer's height inside a section:
 * before the first card (or address block) whose middle is below the pointer, else at the
 * end. The gaps between cards, the section head and the "+ Feld" row all resolve to the
 * nearest place, never to "the end" by accident. The cards of an address group are no
 * targets of their own: the group's block stands for them.
 */
function fieldDropAt(fieldset: HTMLElement, section: FormSchema['sections'][number], clientY: number): { target: DraftDropTarget, beforeFieldId: string | null, noteRow?: string } {
    const item = draftDrag.value;
    const dragged = new Set(draggedFieldIds());
    if (item?.kind === 'addressGroup') dragged.add(`group:${item.groupId}`);
    const groupMembers = new Set((section.addressGroups ?? []).flatMap(group => Object.values(group.fields)));
    const rows = [...fieldset.querySelectorAll<HTMLElement>('[data-draft-row]')]
        .filter(element => element.style.display !== 'none')
        .map(element => ({ key: element.dataset.draftRow ?? '', element }))
        .filter(row => row.key && !dragged.has(row.key));
    const over = addressGroupUnderPointer(section, rows, clientY);
    if (over) return over;
    const next = rows
        .filter(row => !groupMembers.has(row.key))
        .find((row) => {
            const rect = row.element.getBoundingClientRect();
            return clientY < rect.top + rect.height / 2;
        });
    if (next) {
        const group = next.key.startsWith('group:')
            ? section.addressGroups?.find(candidate => `group:${candidate.id}` === next.key)
            : undefined;
        return {
            target: { kind: 'field', fieldId: next.key, position: 'before' },
            beforeFieldId: group ? addressGroupDropBefore(section, group) : next.key
        };
    }
    const last = rows.at(-1);
    return {
        target: last ? { kind: 'field', fieldId: last.key, position: 'after' } : { kind: 'sectionEnd', sectionId: section.id },
        beforeFieldId: null
    };
}

/**
 * The target of a section drag is the nearest section boundary, read at the
 * section heads (as the cards for a field): before the first other section whose head's middle
 * is below the pointer, else at the end. A tall section no longer hides its "lower half" outside
 * the window; aiming at a head is enough, and the edge auto-scroll brings heads into reach.
 */
function sectionDropAt(form: HTMLElement, movingId: string, clientY: number): { target: DraftDropTarget, beforeSectionId: string | null } | null {
    const fieldsets = [...form.querySelectorAll<HTMLElement>('fieldset[data-draft-section-id]')]
        .filter(element => element.style.display !== 'none' && element.dataset.draftSectionId !== movingId);
    const next = fieldsets.find((element) => {
        const head = element.querySelector<HTMLElement>('[data-draft-section-head]') ?? element;
        const rect = head.getBoundingClientRect();
        return clientY < rect.top + rect.height / 2;
    });
    const sectionId = next?.dataset.draftSectionId ?? fieldsets.at(-1)?.dataset.draftSectionId;
    if (!sectionId) return null;
    const beforeSectionId = next ? sectionId : null;
    // Where it stands is no target (no line, no drop).
    const order = props.schema.sections.map(candidate => candidate.id);
    const reduced = order.filter(id => id !== movingId);
    const insertAt = beforeSectionId ? reduced.indexOf(beforeSectionId) : reduced.length;
    if (insertAt === order.indexOf(movingId)) return null;
    return { target: { kind: 'section', sectionId, position: next ? 'before' : 'after' }, beforeSectionId };
}

function onSectionDragOver(event: DragEvent, section: FormSchema['sections'][number]) {
    const item = draftDrag.value;
    if (!item) return;
    const element = event.currentTarget as HTMLElement;
    const clientY = event.clientY;
    gateDragover(event, () => sectionDragoverAnswer(item, element, section, clientY));
}

/** The target at the pointer's height over a section, shown and remembered for the drop. */
function sectionDragoverAnswer(item: DraftDragItem, element: HTMLElement, section: FormSchema['sections'][number], clientY: number): DragoverAnswer {
    if (item.kind === 'section') {
        setGroupNoteRow(null);
        const form = element.closest('form') ?? element.parentElement;
        const found = form ? sectionDropAt(form, item.sectionId, clientY) : null;
        if (!found) {
            setDropTarget(null, null);
            return { allowed: false, refusedField: false };
        }
        setDropTarget(found.target, { kind: 'section', beforeSectionId: found.beforeSectionId });
        return { allowed: true, refusedField: false };
    }
    const { target, beforeFieldId, noteRow } = fieldDropAt(element, section, clientY);
    setGroupNoteRow(noteRow ?? null);
    if (!fieldDropAllowed(section.id, beforeFieldId)) {
        refusedFieldDrop = fieldDropFor(section.id, beforeFieldId);
        setDropTarget(null, null);
        return { allowed: false, refusedField: true };
    }
    refusedFieldDrop = null;
    setDropTarget(target, { kind: 'field', sectionId: section.id, beforeFieldId });
    return { allowed: true, refusedField: false };
}

/*
 * Every dragover read the rows' boxes and decided the target, and a real mouse fires
 * dragover far more often than the screen draws. The work runs at most once per animation frame
 * and listener (the section under the pointer, or the form for a section in a gap). An event in a
 * frame that already decided reuses that answer, because the browser needs it on EVERY event
 * (`preventDefault` and `dropEffect`, or the drop is refused); its own position is decided at the
 * start of the next frame (`runDragoverFrame`, in the drag session's frame loop). The drop applies
 * the line that is shown.
 */
type DragoverAnswer = { allowed: boolean, refusedField: boolean };
const dragoverAnswers = new Map<EventTarget, DragoverAnswer>();
let pendingDragovers: Array<{ key: EventTarget, decide: () => DragoverAnswer }> = [];
let pendingDragoverEvent: Event | null = null;

function gateDragover(event: DragEvent, decide: () => DragoverAnswer) {
    const key = event.currentTarget;
    if (!key) return;
    // Only the latest event's position is decided later.
    if (pendingDragoverEvent !== event) {
        pendingDragovers = [];
        pendingDragoverEvent = event;
    }
    let answer = dragoverAnswers.get(key);
    if (answer) {
        pendingDragovers.push({ key, decide });
    } else {
        answer = decide();
        dragoverAnswers.set(key, answer);
    }
    if (answer.allowed) {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    } else if (answer.refusedField) {
        // The form's listener keeps the refusal and the note of this event (see onDraftFormDragOver).
        refusedDragoverEvent = event;
    }
}

function dropPendingDragovers() {
    pendingDragovers = [];
    pendingDragoverEvent = null;
}

/** A new frame: earlier answers are void; the latest event's position is decided. */
function runDragoverFrame() {
    dragoverAnswers.clear();
    const pending = pendingDragovers;
    dropPendingDragovers();
    for (const { key, decide } of pending) dragoverAnswers.set(key, decide());
}

function resetDragoverFrames() {
    dragoverAnswers.clear();
    dropPendingDragovers();
}

function onSectionDrop(event: DragEvent) {
    const item = draftDrag.value;
    if (!item) return;
    event.preventDefault();
    const move = draftDropMove;
    if (move?.kind === 'section' && item.kind === 'section') {
        emit('moveSection', { sectionId: item.sectionId, beforeSectionId: move.beforeSectionId });
    } else if (move?.kind === 'field') {
        const drop = fieldDropFor(move.sectionId, move.beforeFieldId);
        if (drop?.kind === 'field') {
            emit('moveField', { fieldId: drop.fieldId, sectionId: drop.sectionId, beforeFieldId: drop.beforeFieldId });
        } else if (drop?.kind === 'addressGroup') {
            emit('moveAddressGroup', { groupId: drop.groupId, fromSectionId: drop.fromSectionId, sectionId: drop.sectionId, beforeFieldId: drop.beforeFieldId });
        }
    }
    draftDropped = true;
    endDraftDrag();
}

/*
 * The drag session. While a drag runs, a capture listener on the document follows the
 * pointer (cards no longer stop the event), and a frame loop scrolls the editor's scrolling
 * area near its top and bottom edge. Everything is removed when the drag ends or the
 * renderer goes away; a citizen form never starts a session.
 */
let dragScroller: HTMLElement | null = null;
let dragPointerY: number | null = null;
let dragScrollFrame: number | null = null;
let dragSessionActive = false;
/** The time of the last frame and the fraction of a pixel not yet scrolled. */
let dragScrollLastTime: number | null = null;
let dragScrollCarry = 0;

function onDocumentDragOver(event: DragEvent) {
    dragPointerY = event.clientY;
}

function onDocumentDragEnd() {
    if (draftDrag.value) endDraftDrag();
}

function dragScrollStep(now: number) {
    dragScrollFrame = null;
    if (!dragSessionActive) return;
    runDragoverFrame();
    // The speed is per millisecond (the time since the last frame), the same at 60 and
    // 120 Hz; the first frame of a session starts the clock.
    const elapsed = dragScrollLastTime === null ? 0 : now - dragScrollLastTime;
    dragScrollLastTime = now;
    if (dragPointerY !== null) {
        const rect = dragScroller?.getBoundingClientRect();
        const top = Math.max(rect?.top ?? 0, 0);
        const bottom = Math.min(rect?.bottom ?? window.innerHeight, window.innerHeight);
        const delta = edgeScrollDelta(dragPointerY, top, bottom, elapsed);
        dragScrollCarry = delta === 0 ? 0 : dragScrollCarry + delta;
        const whole = Math.trunc(dragScrollCarry);
        if (whole !== 0) {
            dragScrollCarry -= whole;
            if (dragScroller) dragScroller.scrollTop += whole;
            else window.scrollBy(0, whole);
        }
    }
    dragScrollFrame = requestAnimationFrame(dragScrollStep);
}

function beginDragSession(source: Element | null) {
    if (dragSessionActive) endDragSession();
    dragSessionActive = true;
    dragScroller = verticalScrollContainer(source);
    dragPointerY = null;
    dragScrollLastTime = null;
    dragScrollCarry = 0;
    document.addEventListener('dragover', onDocumentDragOver, true);
    document.addEventListener('dragend', onDocumentDragEnd, true);
    dragScrollFrame = requestAnimationFrame(dragScrollStep);
}

function endDragSession() {
    if (!dragSessionActive) return;
    dragSessionActive = false;
    document.removeEventListener('dragover', onDocumentDragOver, true);
    document.removeEventListener('dragend', onDocumentDragEnd, true);
    if (dragScrollFrame !== null) cancelAnimationFrame(dragScrollFrame);
    dragScrollFrame = null;
    dragScroller = null;
    dragPointerY = null;
}

onBeforeUnmount(endDragSession);

/*
 * The drag and drop listeners exist only while the structure is editable,
 * so a citizen form and a plain preview keep every native drag untouched.
 */
function formDragListeners(): Record<string, (event: DragEvent) => void> {
    return structureActive.value ? { dragleave: onDraftFormDragLeave, dragover: onDraftFormDragOver, drop: onDraftFormDrop } : {};
}

function sectionDropListeners(section: FormSchema['sections'][number]): Record<string, (event: DragEvent) => void> {
    if (!structureActive.value) return {};
    return {
        dragover: (event: DragEvent) => onSectionDragOver(event, section),
        drop: (event: DragEvent) => onSectionDrop(event)
    };
}

function fieldDragListeners(section: FormSchema['sections'][number], field: FormField): Record<string, (event: DragEvent) => void> {
    if (!structureActive.value) return {};
    return {
        dragstart: (event: DragEvent) => onFieldDragStart(event, section, field),
        dragend: endDraftDrag
    };
}

function addressGroupDragListeners(section: FormSchema['sections'][number], group: FormAddressGroup): Record<string, (event: DragEvent) => void> {
    if (!structureActive.value) return {};
    return {
        dragstart: (event: DragEvent) => onAddressGroupDragStart(event, section, group),
        dragend: endDraftDrag
    };
}

/** Attributes for the drag handle of the selected field's action bar. */
function fieldDragHandle(section: FormSchema['sections'][number], field: FormField) {
    return {
        'draggable': structureInteractive.value ? 'true' : 'false',
        'data-draft-field-handle': field.id,
        'onDragstart': (event: DragEvent) => {
            if (!startDraftDrag(event, { kind: 'field', fieldId: field.id, sectionId: section.id }, field.id)) return;
            // The drag image is the field, not the grip.
            const card = (event.currentTarget as Element | null)
                ?.closest('[data-test="draft-field-frame"]')
                ?.querySelector<HTMLElement>('[data-draft-row]');
            if (card) event.dataTransfer?.setDragImage?.(card, 24, 16);
        },
        'onDragend': endDraftDrag
    };
}

/** Attributes for the drag handle the editor puts into the section actions slot. */
function sectionDragHandle(section: FormSchema['sections'][number]) {
    return {
        'draggable': structureInteractive.value ? 'true' : 'false',
        'data-draft-section-handle': section.id,
        'onDragstart': (event: DragEvent) => startDraftDrag(event, { kind: 'section', sectionId: section.id }, section.id),
        'onDragend': endDraftDrag
    };
}

/*
 * A section drags from its head like a field from its card. While a text control in
 * the head has the focus (the title changed in place), the head is not draggable, so the
 * text can be selected.
 */
const sectionHeadTextFocus = ref<string | null>(null);

function sectionHeadDrag(section: FormSchema['sections'][number]) {
    return {
        'draggable': (structureInteractive.value && sectionHeadTextFocus.value !== section.id ? 'true' : 'false') as 'true' | 'false',
        'data-draft-section-head': section.id,
        'onDragstart': (event: DragEvent) => {
            if (dragEventElement(event)?.closest(TEXT_DRAG_SOURCES)) return;
            startDraftDrag(event, { kind: 'section', sectionId: section.id }, section.id);
        },
        'onDragend': endDraftDrag,
        'onFocusin': (event: FocusEvent) => {
            if (dragEventElement(event)?.closest(TEXT_DRAG_SOURCES)) sectionHeadTextFocus.value = section.id;
        },
        'onFocusout': () => {
            if (sectionHeadTextFocus.value === section.id) sectionHeadTextFocus.value = null;
        }
    };
}

function initializeFormData(schema: FormSchema, current: Record<string, unknown> = {}): Record<string, unknown> {
    const data = copyFormValueOrigins(current, { ...current });
    for (const section of schema.sections) {
        for (const field of section.fields) {
            if (Object.prototype.hasOwnProperty.call(data, field.id)) {
                continue;
            } else if (field.defaultValue !== undefined) {
                data[field.id] = field.defaultValue;
                registerFormDefault(data, field.id, field.defaultValue);
            } else if (field.type === 'file') {
                data[field.id] = [];
            } else if (field.type === 'address') {
                data[field.id] = null;
            } else if (field.type === 'checkbox' && field.options?.length) {
                data[field.id] = [];
            } else if (field.type === 'checkbox') {
                data[field.id] = false;
            } else {
                data[field.id] = '';
            }
        }
    }
    return data;
}

// Preserve object identity on reordering or renaming to avoid rendering both the editor and form again.
// The initial copy isolates the field setters until the parent receives its v-model value.
let formDataInitialized = false;
watch(() => props.schema, (newSchema) => {
    const current = formData.value;
    const complete = formDataInitialized && newSchema.sections.every(section => section.fields.every(field => Object.prototype.hasOwnProperty.call(current, field.id)));
    formDataInitialized = true;
    if (complete) return;
    formData.value = initializeFormData(newSchema, current);
}, { immediate: true });
</script>

<template>
  <UForm
    :state="formData"
    :class="formLayoutClass"
    :novalidate="nativeValidation ? undefined : true"
    @submit="onFormSubmit"
    v-on="formDragListeners()"
  >
    <header
      v-if="!embedded && !hideTitle"
      class="mb-6"
    >
      <h2 class="text-2xl font-semibold tracking-normal text-(--ui-text-highlighted)">
        {{ getSchemaTitle() }}
      </h2>
    </header>

    <slot name="before-fields" />

    <p
      v-if="showRequiredLegend && schema.sections.length"
      class="mb-6 text-sm text-muted"
    >
      <span aria-hidden="true">*</span>
      {{ t('form.requiredFieldLegend') }}
    </p>

    <div :class="flatSections ? (isStaff ? 'space-y-8' : 'space-y-10') : 'space-y-6'">
      <!-- A section with no visible field and no description is not shown;
           an information block stays (isSectionShown). -->
      <fieldset
        v-for="(section, sectionIndex) in schema.sections"
        v-show="isSectionShown(section)"
        :key="section.id"
        v-draft-mark="structureActive ? `section:${section.id}` : null"
        :class="[
          flatSections || bareSections ? 'min-w-0' : 'rounded-lg bg-default p-4 ring ring-default sm:p-5',
          structureActive ? 'draft-section' : undefined,
        ]"
        :data-draft-section-id="structureActive ? section.id : undefined"
        v-on="sectionDropListeners(section)"
      >
        <!-- The hidden legend names the fieldset. The visible title sits inside the frame. -->
        <legend class="sr-only">
          {{ getSectionTitle(section) }}
        </legend>

        <h2
          v-if="!flatSections && !bareSections && !(structureActive && $slots['draft-section-actions'])"
          class="mb-4 break-words text-base font-semibold text-highlighted"
        >
          {{ getSectionTitle(section) }}
        </h2>

        <!-- Staff edit (02b, 1): a quiet h3 inside the card; the citizen page keeps its h2. -->
        <h3
          v-if="flatSections && isStaff"
          class="mb-3 text-sm font-semibold text-highlighted"
        >
          {{ getSectionTitle(section) }}
        </h3>
        <h2
          v-else-if="flatSections"
          class="mb-2 text-lg font-semibold text-highlighted"
        >
          {{ getSectionTitle(section) }}
        </h2>

        <!-- The head is the section's handle, like the card is the field's. -->
        <div
          v-if="structureActive && $slots['draft-section-actions']"
          class="mb-4 flex flex-wrap items-center gap-1"
          :class="{ 'draft-section-head': structureInteractive }"
          data-test="draft-section-actions"
          v-bind="sectionHeadDrag(section)"
        >
          <slot
            name="draft-section-actions"
            :section="section"
            :title="getSectionTitle(section)"
            :index="sectionIndex"
            :count="schema.sections.length"
            :disabled="fieldSelectionDisabled"
            :drag-handle="sectionDragHandle(section)"
          />
        </div>

        <p
          v-if="getSectionDescription(section)"
          class="mb-5 mt-1 max-w-2xl text-sm leading-6 text-muted"
        >
          {{ getSectionDescription(section) }}
        </p>

        <div :class="sectionGridClass">
          <template
            v-for="field in section.fields"
            :key="field.id"
          >
            <div
              v-if="addressGroupFor(section.id, field.id) && isAddressGroupVisible(addressGroupFor(section.id, field.id)!)"
              v-draft-mark="structureActive ? `group:${addressGroupFor(section.id, field.id)!.id}` : null"
              class="md:col-span-2 lg:col-span-2"
              :class="[
                { 'draft-draggable': structureInteractive },
                { relative: structureActive },
              ]"
              :data-address-group-id="addressGroupFor(section.id, field.id)!.id"
              :data-draft-row="structureActive ? `group:${addressGroupFor(section.id, field.id)!.id}` : undefined"
              :draggable="structureInteractive ? 'true' : undefined"
              v-on="addressGroupDragListeners(section, addressGroupFor(section.id, field.id)!)"
            >
              <UFormField
                :label="t('form.address.searchActionLabel')"
                :ui="FORM_FIELD_UI"
              >
                <FormAddressInput
                  :model-value="addressGroupValue(addressGroupFor(section.id, field.id)!)"
                  :autocomplete="addressGroupFor(section.id, field.id)!.autocomplete !== false"
                  :map="addressGroupFor(section.id, field.id)!.map === true"
                  :boundary-mode="addressGroupFor(section.id, field.id)!.boundary ?? 'off'"
                  :jurisdiction-slug="jurisdictionSlug"
                  :initial-query="addressInitialQueries[addressGroupFor(section.id, field.id)!.id]"
                  :disabled="previewReadOnly"
                  :readonly="previewReadOnly"
                  :label="addressGroupFor(section.id, field.id)!.label || t('form.address.searchActionLabel')"
                  external-fields
                  @update:model-value="updateAddressGroup(addressGroupFor(section.id, field.id)!, $event)"
                />
              </UFormField>
              <FormDraftGroupNote
                v-if="structureActive"
                :row="`group:${addressGroupFor(section.id, field.id)!.id}`"
                :notes="draftNotes"
                :text="t('form.draftGroupNoDrop')"
              />
            </div>

            <!-- In structure mode a frame holds the card and, for the
                 selected field, its action bar beside it; otherwise nothing changes. -->
            <FormDraftFieldFrame
              :active="structureActive"
              :class="structureActive ? fieldLayoutClasses(field) : undefined"
            >
              <!-- The card keeps its indentation from before the draft frame, so the
                   shared renderer's diff stays small; the frame only wraps it. -->
              <!-- eslint-disable vue/html-indent -->
            <!-- Conditional visibility wrapper: v-show preserves form state -->
            <div
              v-show="isFieldShown(field.id)"
              :id="getFieldAnchorId(field)"
              v-draft-mark="structureActive ? field.id : null"
              class="form-field-wrapper"
              :class="[
                structureActive ? undefined : fieldLayoutClasses(field),
                {
                  'form-field-hidden': !isFieldShown(field.id),
                  'form-field-wrapper--draft': draftMode,
                  'form-field-wrapper--structure': structureActive,
                  'form-field-wrapper--selected': draftMode && selectedFieldId === field.id,
                  'form-field-wrapper--untitled': isUntitledDraftField(field),
                  'draft-draggable': structureInteractive,
                },
              ]"
              :data-field-id="field.id"
              :data-draft-row="structureActive ? field.id : undefined"
              :data-draft-selected="draftMode && selectedFieldId === field.id ? 'true' : undefined"
              :role="draftMode ? 'button' : undefined"
              :aria-label="getDraftFieldAriaLabel(field)"
              :aria-describedby="structureActive && $slots['draft-field-mark'] ? `draft-field-mark-${field.id}` : undefined"
              :aria-pressed="draftMode ? selectedFieldId === field.id : undefined"
              :aria-disabled="draftMode && fieldSelectionDisabled ? 'true' : undefined"
              :aria-keyshortcuts="structureInteractive ? (selectedFieldId === field.id ? 'Alt+ArrowUp Alt+ArrowDown Delete Backspace Alt+Z' : 'Alt+ArrowUp Alt+ArrowDown Alt+Z') : undefined"
              :tabindex="draftMode ? (fieldSelectionDisabled ? -1 : 0) : undefined"
              :draggable="structureInteractive ? 'true' : undefined"
              @click="onFieldSelect(section, field)"
              @keydown="onFieldKeydown($event, section, field)"
              v-on="fieldDragListeners(section, field)"
            >
              <!-- The finding mark stands at the thing, inside the card at the end of
                   its head row, in room the card keeps free for it (pe-8): it moves with the card,
                   lies in its click target and never touches its frame, ring or the field bar. The
                   card's name is a label, so the mark's text reaches screen readers as its description. -->
              <!-- Over a card of an address group, why nothing is dropped into it. -->
              <FormDraftGroupNote
                v-if="structureActive"
                :row="field.id"
                :notes="draftNotes"
                :text="t('form.draftGroupNoDrop')"
              />
              <span
                v-if="structureActive && $slots['draft-field-mark']"
                :id="`draft-field-mark-${field.id}`"
                class="draft-field-mark absolute end-2 top-2.5 inline-flex"
                data-test="draft-field-mark-slot"
              >
                <slot
                  name="draft-field-mark"
                  :section="section"
                  :field="field"
                />
              </span>
              <div
                v-if="draftMode && (getFieldDisplay(field).path.length || field.conditionalOn)"
                class="mb-3 space-y-1"
              >
                <div class="flex flex-wrap gap-1">
                  <span
                    v-for="pathItem in getFieldDisplay(field).path.slice(-3)"
                    :key="pathItem"
                    class="rounded bg-default px-1.5 py-0.5 text-xs leading-4 text-muted"
                  >
                    {{ pathItem }}
                  </span>
                  <span
                    v-if="field.conditionalOn"
                    class="inline-flex items-center gap-1 rounded border border-dashed border-default px-1.5 py-0.5 text-xs leading-4 text-muted"
                    data-test="draft-condition-hint"
                  >
                    <UIcon
                      name="i-lucide-git-branch"
                      class="size-3 shrink-0"
                      aria-hidden="true"
                    />
                    {{ getDraftConditionHint(field) }}
                  </span>
                </div>
              </div>

              <!-- Computed (server-authoritative, live preview only) -->
              <UFormField
                v-if="isComputedField(field.id)"
                :name="field.id"
                :label="getFieldLabel(field)"
                :ui="FORM_FIELD_UI"
              >
                <div
                  class="flex min-h-9 w-full items-center gap-2 rounded-md border border-dashed border-default bg-elevated/40 px-3 py-2"
                  :aria-label="getFieldLabel(field)"
                  aria-readonly="true"
                >
                  <span
                    v-if="getComputedPreview(field.id) !== undefined"
                    class="text-sm text-highlighted"
                  >
                    {{ getComputedPreview(field.id) }}
                  </span>
                  <span
                    v-else
                    class="text-sm text-muted"
                  >
                    {{ t('form.computedPending') }}
                  </span>
                  <UIcon
                    name="i-lucide-calculator"
                    class="ml-auto size-3.5 shrink-0 text-muted"
                    :title="t('form.computedHint')"
                  />
                </div>
              </UFormField>

              <!-- Text / Email / Tel / Number -->
              <UFormField
                v-else-if="field.type === 'address'"
                :name="field.id"
                :label="getFieldLabel(field)"
                :required="field.required"
                :error="fieldErrors[field.id]"
                :ui="FORM_FIELD_UI"
              >
                <FormAddressInput
                  :model-value="addressField(field.id).value"
                  :autocomplete="field.widget?.autocomplete !== false"
                  :map="field.widget?.map === true"
                  :boundary-mode="field.widget?.boundary ?? 'off'"
                  :jurisdiction-slug="jurisdictionSlug"
                  :initial-query="addressInitialQueries[field.id]"
                  :disabled="previewReadOnly"
                  :readonly="previewReadOnly"
                  :label="getFieldLabel(field)"
                  :required="field.required"
                  :error="fieldErrors[field.id]"
                  @update:model-value="addressField(field.id).value = $event"
                />
              </UFormField>

              <!-- Text / Email / Tel / Number -->
              <UFormField
                v-else-if="['text', 'email', 'tel', 'number'].includes(field.type)"
                :name="field.id"
                :label="getFieldLabel(field)"
                :required="field.required"
                :error="fieldErrors[field.id]"
                :help="getFieldHelp(field)"
                :ui="FORM_FIELD_UI"
              >
                <UInput
                  :model-value="stringField(field.id).value"
                  :type="getSingleLineInputType(field)"
                  :placeholder="getFieldPlaceholder(field)"
                  :class="controlWidthClass(field)"
                  :readonly="previewReadOnly"
                  :aria-readonly="previewReadOnly ? 'true' : undefined"
                  :aria-required="getAriaRequired(field)"
                  :tabindex="draftMode ? -1 : undefined"
                  v-bind="getFieldAttrs(field)"
                  @update:model-value="stringField(field.id).value = $event as string"
                />
              </UFormField>

              <!-- Textarea -->
              <UFormField
                v-else-if="field.type === 'textarea'"
                :name="field.id"
                :label="getFieldLabel(field)"
                :required="field.required"
                :error="fieldErrors[field.id]"
                :help="getFieldHelp(field)"
                :ui="FORM_FIELD_UI"
              >
                <UTextarea
                  :model-value="stringField(field.id).value"
                  :placeholder="getFieldPlaceholder(field)"
                  :rows="3"
                  class="w-full"
                  :readonly="previewReadOnly"
                  :aria-readonly="previewReadOnly ? 'true' : undefined"
                  :aria-required="getAriaRequired(field)"
                  :tabindex="draftMode ? -1 : undefined"
                  v-bind="getTextareaAttrs(field)"
                  @update:model-value="stringField(field.id).value = $event as string"
                />
              </UFormField>

              <!-- Select -->
              <UFormField
                v-else-if="field.type === 'select'"
                :name="field.id"
                :label="getFieldLabel(field)"
                :required="field.required"
                :error="fieldErrors[field.id]"
                :help="getFieldHelp(field)"
                :ui="FORM_FIELD_UI"
              >
                <USelect
                  :model-value="stringField(field.id).value"
                  :items="getChoiceItems(field)"
                  :placeholder="t('form.selectPlaceholder')"
                  :class="controlWidthClass(field)"
                  :disabled="previewReadOnly"
                  :required="field.required && !previewReadOnly"
                  :tabindex="draftMode ? -1 : undefined"
                  @update:model-value="stringField(field.id).value = $event as string"
                />
              </UFormField>

              <!-- Radio group -->
              <UFormField
                v-else-if="field.type === 'radio'"
                :name="field.id"
                :error="fieldErrors[field.id]"
                :help="getFieldHelp(field)"
                :ui="FORM_FIELD_UI"
              >
                <URadioGroup
                  :model-value="stringField(field.id).value"
                  :name="field.id"
                  :legend="getFieldLabel(field)"
                  :required="field.required"
                  :aria-required="getAriaRequired(field)"
                  :items="getChoiceItems(field)"
                  variant="card"
                  :disabled="previewReadOnly"
                  :tabindex="draftMode ? -1 : undefined"
                  :ui="CHOICE_GROUP_UI"
                  @update:model-value="stringField(field.id).value = $event as string"
                />
              </UFormField>

              <!-- Checkbox with options (multi-select) -->
              <UFormField
                v-else-if="field.type === 'checkbox' && field.options?.length"
                :name="field.id"
                :error="fieldErrors[field.id]"
                :help="getFieldHelp(field)"
                :ui="FORM_FIELD_UI"
              >
                <UCheckboxGroup
                  :model-value="arrayField(field.id).value"
                  :name="field.id"
                  :legend="getFieldLabel(field)"
                  :required="field.required"
                  :items="getChoiceItems(field)"
                  variant="card"
                  :disabled="previewReadOnly"
                  :tabindex="draftMode ? -1 : undefined"
                  :ui="CHOICE_GROUP_UI"
                  @update:model-value="arrayField(field.id).value = $event as string[]"
                />
              </UFormField>

              <!-- Simple checkbox (boolean) -->
              <UFormField
                v-else-if="field.type === 'checkbox'"
                :name="field.id"
                :error="fieldErrors[field.id]"
                :help="getFieldHelp(field)"
                :ui="FORM_FIELD_UI"
              >
                <UCheckbox
                  :model-value="booleanField(field.id).value"
                  :label="getFieldLabel(field)"
                  :aria-label="getFieldLabel(field)"
                  :name="field.id"
                  :required="field.required"
                  :aria-required="getAriaRequired(field)"
                  :variant="isStaff ? undefined : 'card'"
                  :disabled="previewReadOnly"
                  :tabindex="draftMode ? -1 : undefined"
                  :ui="isStaff ? undefined : { root: 'border-default bg-elevated/60' }"
                  @update:model-value="booleanField(field.id).value = $event === true"
                />
              </UFormField>

              <!-- Date -->
              <UFormField
                v-else-if="field.type === 'date'"
                :name="field.id"
                :label="getFieldLabel(field)"
                :required="field.required"
                :error="fieldErrors[field.id]"
                :help="getFieldHelp(field)"
                :ui="FORM_FIELD_UI"
              >
                <UInput
                  :model-value="stringField(field.id).value"
                  type="date"
                  :class="controlWidthClass(field)"
                  :readonly="previewReadOnly"
                  :aria-readonly="previewReadOnly ? 'true' : undefined"
                  :aria-required="getAriaRequired(field)"
                  :tabindex="draftMode ? -1 : undefined"
                  v-bind="getFieldAttrs(field)"
                  @update:model-value="stringField(field.id).value = $event as string"
                >
                  <!-- Chrome hides the picker icon of a read-only date input,
                     so the preview draws one; the editable field keeps the
                     browser's own and gets no slot (no extra end padding). -->
                  <template
                    v-if="previewReadOnly"
                    #trailing="{ ui }"
                  >
                    <UIcon
                      name="i-lucide-calendar"
                      :class="ui.trailingIcon()"
                      aria-hidden="true"
                      data-test="date-preview-icon"
                    />
                  </template>
                </UInput>
              </UFormField>

              <!-- File in the staff edit (02b, 3): files cannot change here, one quiet line per file. No required
                   mark (it would ask for an input this form does not offer); a missing required file says so. -->
              <UFormField
                v-else-if="field.type === 'file' && isStaff && !canManageAttachments()"
                :name="field.id"
                :label="getFieldLabel(field)"
                :error="fieldErrors[field.id] || undefined"
                :help="getFieldHelp(field)"
                :ui="FORM_FIELD_UI"
              >
                <!-- No file input here, so the label points at nothing (no `for`). -->
                <FormFieldLabelTarget />
                <ul
                  v-if="staffFileEntries(field).length > 0"
                  class="space-y-1"
                  data-test="staff-file-lines"
                >
                  <li
                    v-for="attachment in staffFileEntries(field)"
                    :key="attachment.key"
                    class="flex min-w-0 items-center gap-2 text-sm"
                  >
                    <UIcon
                      name="i-lucide-paperclip"
                      class="size-4 shrink-0 text-muted"
                      aria-hidden="true"
                    />
                    <span class="min-w-0 truncate text-default">{{ attachment.filename }}</span>
                    <template v-if="attachment.size && attachment.size > 0">
                      <span
                        class="shrink-0 text-muted"
                        aria-hidden="true"
                      >·</span>
                      <span class="shrink-0 text-muted">{{ formatFileSize(attachment.size) }}</span>
                    </template>
                  </li>
                </ul>
                <p
                  v-else-if="field.required"
                  class="text-sm text-error"
                  data-test="staff-file-missing"
                >
                  {{ t('form.fileMissingRequired') }}
                </p>
                <p
                  v-else
                  class="text-sm text-muted"
                  data-test="staff-file-none"
                >
                  {{ t('form.fileNone') }}
                </p>
              </UFormField>

              <!-- File -->
              <UFormField
                v-else-if="field.type === 'file'"
                :name="field.id"
                :label="getFieldLabel(field)"
                :required="field.required"
                :error="fieldErrors[field.id] || uploadErrors[field.id] || undefined"
                :help="getFieldHelp(field)"
                :ui="FORM_FIELD_UI"
              >
                <!-- Where no file input is rendered (the editor, a read-only view) the label loses its `for`
                     instead of naming an id no element carries; with the input, the target beside it. -->
                <FormFieldLabelTarget v-if="!canManageAttachments()" />
                <div class="space-y-3 rounded-md border border-dashed border-default bg-elevated/40 p-3">
                  <div
                    v-if="attachmentAnalysisDisclosureLines(field).length"
                    :id="fieldAttachmentAnalysisDisclosureId(field)"
                    class="space-y-1 text-sm text-muted"
                    data-testid="attachment-analysis-disclosure"
                  >
                    <p
                      v-for="(line, lineIndex) in attachmentAnalysisDisclosureLines(field)"
                      :key="lineIndex"
                    >
                      {{ line }}
                    </p>
                  </div>

                  <div
                    v-if="canManageAttachments()"
                    class="space-y-2"
                  >
                    <div
                      v-if="attachmentAnalysisConsentOffered(field) && showAttachmentAnalysisConsent(field)"
                      class="rounded-md border border-default bg-default px-3 py-2 text-sm"
                      role="group"
                      :aria-label="attachmentAnalysisConsentLabel(field)"
                      :aria-describedby="attachmentAnalysisConsentDescribedBy(field)"
                      :aria-invalid="attachmentAnalysisErrors[field.id] ? 'true' : undefined"
                      data-testid="attachment-analysis-consent"
                    >
                      <!-- WCAG 4.1.2, 3.3.2: the consent stood in the file field's UFormField and took
                           that field's id, so the field's label "for" pointed at it and it was announced with
                           the FILE field's label; the field's help and error were attached to it as well. Its
                           own UFormField (no label, help or error) gives it its own id and keeps the file
                           field's description away; its name is the consent text it shows. -->
                      <UFormField>
                        <UCheckbox
                          :model-value="attachmentAnalysisConsentValue(field.id)"
                          :label="attachmentAnalysisConsentLabel(field)"
                          :aria-label="attachmentAnalysisConsentLabel(field)"
                          :disabled="uploadState[field.id] || attachmentAnalysisState[field.id]"
                          :aria-describedby="attachmentAnalysisConsentDescribedBy(field)"
                          :aria-invalid="attachmentAnalysisErrors[field.id] ? 'true' : undefined"
                          @update:model-value="updateAttachmentAnalysisConsent(field, $event)"
                        />
                      </UFormField>
                      <p
                        :id="fieldAttachmentAnalysisConsentHintId(field)"
                        class="mt-1 text-muted"
                      >
                        {{ attachmentAnalysisConsentHint(field) }}
                      </p>
                      <details
                        class="mt-2 text-muted"
                        data-testid="attachment-analysis-consent-details"
                      >
                        <summary class="cursor-pointer select-none font-medium text-highlighted">
                          {{ t('form.attachmentAnalysis.consentMore') }}
                        </summary>
                        <p class="mt-2">
                          {{ t('form.attachmentAnalysis.consentDetails') }}
                        </p>
                      </details>
                      <div
                        v-if="attachmentAnalysisErrors[field.id]"
                        :id="fieldAttachmentAnalysisErrorId(field)"
                        class="mt-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-sm text-highlighted"
                        role="alert"
                      >
                        <p class="font-medium">
                          {{ attachmentAnalysisErrors[field.id] }}
                        </p>
                        <p class="mt-1 text-muted">
                          {{ t('form.attachmentAnalysis.retryHint') }}
                        </p>
                      </div>
                      <p
                        v-if="attachmentAnalysisState[field.id]"
                        class="mt-2 flex items-center gap-2 font-medium text-primary"
                        role="status"
                        aria-live="polite"
                      >
                        <UIcon
                          name="i-lucide-loader-circle"
                          class="size-4 animate-spin"
                          aria-hidden="true"
                        />
                        {{ attachmentAnalysisInProgressLabel(field) }}
                      </p>
                    </div>
                    <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <!-- Since the consent has its own UFormField the field's label
                           pointed at an id no control carried; it belongs to the file input (a click on
                           it opens the file chooser). The input keeps its own name (`aria-label`). -->
                      <FormFieldLabelTarget :id="fieldInputId(field)" />
                      <input
                        :id="fieldInputId(field)"
                        type="file"
                        class="peer sr-only"
                        :name="field.id"
                        :accept="ACCEPTED_ATTACHMENT_EXTENSIONS.join(',')"
                        :multiple="allowsMultipleAttachmentSelection(field)"
                        :disabled="uploadState[field.id] || attachmentAnalysisState[field.id] || attachmentField(field.id).value.length >= fileFieldMaxFiles(field)"
                        :aria-label="fieldUploadAriaLabel(field)"
                        :aria-describedby="fieldUploadAriaDescribedBy(field)"
                        :aria-invalid="fieldUploadError(field) ? 'true' : undefined"
                        :aria-required="getAriaRequired(field)"
                        :tabindex="draftMode ? -1 : undefined"
                        @change="onFileSelected(field, $event)"
                      >
                      <label
                        :for="fieldInputId(field)"
                        class="inline-flex min-h-9 w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-default bg-default px-3 py-1.5 text-center text-sm font-medium leading-tight text-highlighted hover:bg-elevated peer-focus-visible:ring-2 peer-focus-visible:ring-primary peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-default sm:w-auto sm:whitespace-nowrap"
                        :class="{
                          'pointer-events-none opacity-50': uploadState[field.id] || attachmentAnalysisState[field.id] || attachmentField(field.id).value.length >= fileFieldMaxFiles(field),
                        }"
                      >
                        <UIcon
                          :name="uploadState[field.id] ? 'i-lucide-loader-circle' : 'i-lucide-upload'"
                          class="size-4"
                          :class="{ 'animate-spin': uploadState[field.id] }"
                        />
                        <span>{{ uploadState[field.id] ? t('form.fileUploading') : fileSelectLabel(field) }}</span>
                      </label>
                      <span
                        :id="fieldHelpId(field)"
                        class="text-sm text-muted"
                      >
                        {{ fileFieldConstraints(field) }}
                      </span>
                      <p
                        v-if="uploadState[field.id]"
                        :id="fieldUploadStatusId(field)"
                        class="sr-only"
                        aria-live="polite"
                      >
                        {{ t('form.fileUploading') }}
                      </p>
                      <p
                        v-if="fieldUploadError(field)"
                        :id="fieldUploadErrorId(field)"
                        class="sr-only"
                        aria-live="assertive"
                      >
                        {{ fieldUploadError(field) }}
                      </p>
                    </div>
                  </div>

                  <div
                    v-if="attachmentField(field.id).value.length > 0"
                    class="space-y-2"
                  >
                    <div
                      v-for="attachment in attachmentField(field.id).value"
                      :key="attachment.attachmentId"
                      class="space-y-2 rounded-md border border-default bg-default px-3 py-2"
                    >
                      <div class="flex min-w-0 items-center gap-3">
                        <UIcon
                          name="i-lucide-paperclip"
                          class="size-4 shrink-0 text-muted"
                        />
                        <div class="min-w-0 flex-1">
                          <div class="truncate text-sm font-medium text-highlighted">
                            {{ attachment.filename }}
                          </div>
                          <div class="text-xs text-muted">
                            {{ formatFileSize(attachment.size) }}
                          </div>
                        </div>
                        <span
                          class="sr-only"
                          role="status"
                          aria-live="polite"
                        >
                          {{ t('form.fileUploaded', { filename: attachment.filename }) }}
                        </span>
                        <UButton
                          v-if="canManageAttachments()"
                          type="button"
                          color="neutral"
                          variant="ghost"
                          icon="i-lucide-x"
                          :disabled="attachmentAnalysisState[field.id]"
                          :aria-label="t('form.fileRemove', { filename: attachment.filename })"
                          @click.stop="removeAttachment(field, attachment.attachmentId)"
                        />
                      </div>
                      <div
                        v-if="attachmentAnalysisNotice(attachment)"
                        class="space-y-2 text-sm"
                        data-testid="attachment-analysis-not-checked"
                        role="status"
                        aria-live="polite"
                      >
                        <UBadge
                          as="h4"
                          color="neutral"
                          :label="attachmentAnalysisNotice(attachment)?.label"
                          :icon="attachmentAnalysisNotice(attachment)?.icon"
                        />
                        <p>{{ attachmentAnalysisNotice(attachment)?.description }}</p>
                      </div>
                      <div
                        v-else-if="attachmentAnalysisHasResult(attachment)"
                        class="space-y-2 text-sm"
                        data-testid="attachment-analysis-result"
                      >
                        <div
                          role="status"
                          aria-live="polite"
                        >
                          <UBadge
                            as="h4"
                            v-bind="attachmentAnalysisPresentation(attachment)"
                          />
                        </div>
                        <p v-if="attachment.analysis?.result?.documentType">
                          {{ t('form.attachmentAnalysis.expectedDocument') }}
                          <span :lang="attachment.analysis.result.documentTypeLanguage || attachmentAnalysisLanguage(attachment)">{{ attachment.analysis.result.documentType }}</span>
                        </p>
                        <div
                          v-if="attachmentAnalysisCriteria(attachment).length"
                          class="mt-2"
                        >
                          <p class="font-medium text-highlighted">
                            {{ t('form.attachmentAnalysis.criteria') }}
                          </p>
                          <ul
                            class="mt-1 space-y-1.5"
                            data-testid="attachment-analysis-criteria"
                          >
                            <li
                              v-for="(criterion, criterionIndex) in attachmentAnalysisCriteria(attachment)"
                              :key="`${criterion.label}:${criterionIndex}`"
                              class="flex items-start gap-2"
                            >
                              <UIcon
                                :name="attachmentAnalysisCriterionIcon(criterion.status)"
                                class="mt-0.5 size-4 shrink-0"
                                :class="attachmentAnalysisCriterionClass(criterion.status)"
                                aria-hidden="true"
                              />
                              <span class="min-w-0 flex-1">
                                <span class="block">{{ t(`form.attachmentAnalysis.criterionStatus.${criterion.status}`) }}</span>
                                <span
                                  class="block break-words text-muted"
                                  :lang="attachmentAnalysisLanguage(attachment)"
                                >{{ criterion.label }}</span>
                              </span>
                            </li>
                          </ul>
                        </div>
                        <ul
                          v-if="attachmentAnalysisNotices(attachment).length"
                          class="mt-2 space-y-1"
                          data-testid="attachment-analysis-notices"
                        >
                          <li
                            v-for="notice in attachmentAnalysisNotices(attachment)"
                            :key="notice"
                            class="flex items-start gap-2 text-muted"
                          >
                            <UIcon
                              name="i-lucide-info"
                              class="mt-0.5 size-4 shrink-0 text-warning"
                              aria-hidden="true"
                            />
                            <span class="min-w-0 flex-1 break-words">{{ notice }}</span>
                          </li>
                        </ul>
                        <p class="mt-2 text-muted">
                          {{ t('form.attachmentAnalysis.disclaimer') }}
                        </p>
                      </div>
                      <p
                        v-else-if="attachmentAnalysisUnavailable(attachment)"
                        class="rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-sm text-muted"
                        role="status"
                        aria-live="polite"
                      >
                        {{ t('form.attachmentAnalysis.unavailable') }}
                      </p>
                      <p
                        v-else-if="attachmentAnalysisPending(attachment)"
                        class="flex items-start gap-2 rounded-md border border-default bg-elevated/60 px-3 py-2 text-sm text-muted"
                        role="status"
                        aria-live="polite"
                        data-testid="attachment-analysis-pending"
                      >
                        <UIcon
                          name="i-lucide-clock"
                          class="mt-0.5 size-4 shrink-0"
                          aria-hidden="true"
                        />
                        <span class="min-w-0 flex-1">{{ t('form.attachmentAnalysis.pendingHint') }}</span>
                      </p>
                      <p
                        v-else-if="attachmentAnalysisPollTimedOut(attachment)"
                        class="rounded-md border border-default bg-elevated/60 px-3 py-2 text-sm text-muted"
                        role="status"
                        aria-live="polite"
                        data-testid="attachment-analysis-timed-out"
                      >
                        {{ t('form.attachmentAnalysis.pendingTimedOut') }}
                      </p>
                    </div>
                  </div>

                  <div
                    v-else-if="previewReadOnly || !fileUploadsEnabled"
                    class="flex items-center gap-2 text-sm text-muted"
                  >
                    <UIcon
                      name="i-lucide-paperclip"
                      class="size-4"
                    />
                    <span>{{ t('form.fileNone') }}</span>
                  </div>
                </div>
              </UFormField>
            </div>
              <!-- eslint-enable vue/html-indent -->
              <template
                v-if="structureActive && selectedFieldId === field.id && $slots['draft-field-actions']"
                #overlay
              >
                <slot
                  v-if="selectedFieldId === field.id"
                  name="draft-field-actions"
                  :section="section"
                  :field="field"
                  :disabled="fieldSelectionDisabled"
                  :drag-handle="fieldDragHandle(section, field)"
                />
              </template>
            </FormDraftFieldFrame>
          </template>
        </div>

        <!-- "+ Feld" at the end of every section, where the new field appears. -->
        <slot
          v-if="structureActive"
          name="draft-section-end"
          :section="section"
          :index="sectionIndex"
        />
      </fieldset>
    </div>

    <!-- "+ Abschnitt" under the last section. -->
    <slot
      v-if="structureActive"
      name="draft-form-end"
    />

    <slot name="actions" />

    <!-- Submit (optional, hidden when parent handles application) -->
    <div
      v-if="!hideSubmit"
      class="mt-8 border-t border-(--ui-border) pt-6"
    >
      <UButton
        type="submit"
        size="lg"
        icon="i-lucide-send"
      >
        {{ t('form.submit') }}
      </UButton>
    </div>
  </UForm>
</template>

<style scoped>
/* A visible field is never height-capped or clipped: a file field with several
   analysed attachments is taller than any fixed cap. Only the hidden state
   collapses. */
.form-field-wrapper {
  transition: opacity 0.2s ease, border-color 0.15s ease, box-shadow 0.15s ease, background-color 0.15s ease;
  opacity: 1;
}

.form-field-wrapper--draft {
  cursor: pointer;
  border: 1px solid transparent;
  border-radius: 0.5rem;
  padding: 0.5rem;
  margin: -0.5rem;
}

.form-field-wrapper--draft :deep(input),
.form-field-wrapper--draft :deep(textarea),
.form-field-wrapper--draft :deep(select),
.form-field-wrapper--draft :deep(button),
.form-field-wrapper--draft :deep([role="button"]),
.form-field-wrapper--draft :deep([role="radio"]),
.form-field-wrapper--draft :deep([role="checkbox"]) {
  pointer-events: none;
}

.form-field-wrapper--draft:hover,
.form-field-wrapper--draft:focus-visible {
  border-color: var(--ui-primary);
  background-color: color-mix(in srgb, var(--ui-primary) 6%, transparent);
  outline: none;
}

.form-field-wrapper--structure {
  position: relative;
  /* Room at the end of the card for its finding mark (end-2 + 16 px + 8 px clear). */
  padding-inline-end: 2rem;
  /* The opacity fade of `.form-field-wrapper` is for the citizen form's conditional
     fields (`.form-field-hidden`); in the editor every field is shown. A dropped, refused or
     cancelled card is fully there at once instead of fading back from the dragged look. */
  transition: border-color 0.15s ease, box-shadow 0.15s ease, background-color 0.15s ease;
}

/* The dragged look itself still fades in, as before. */
.form-field-wrapper--structure.draft-dragging {
  transition: opacity 0.2s ease, border-color 0.15s ease, box-shadow 0.15s ease, background-color 0.15s ease;
}

/* The stand-in for an emptied label is muted, so it is not taken for a label. */
.form-field-wrapper--untitled :deep([data-slot="labelWrapper"] > [data-slot="label"]) {
  color: var(--ui-text-muted);
  font-weight: 400;
}

.form-field-wrapper--selected {
  border-color: var(--ui-primary);
  background-color: color-mix(in srgb, var(--ui-primary) 10%, transparent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--ui-primary) 20%, transparent);
}

/* Draft structure editing: drop markers and the dragged item. The card is the handle,
   its content takes no pointer events and no text selection; the line stands in the gap. */
.draft-draggable,
.draft-section-head {
  cursor: grab;
  -webkit-user-select: none;
  user-select: none;
}

.draft-draggable * {
  pointer-events: none;
}

.draft-draggable:active {
  cursor: grabbing;
}

.draft-dragging {
  opacity: 0.5;
}

.draft-drop-before,
.draft-drop-after {
  position: relative;
}

.draft-drop-before::before,
.draft-drop-after::after {
  content: '';
  position: absolute;
  inset-inline: 0;
  height: 3px;
  border-radius: 9999px;
  background-color: var(--ui-primary);
  pointer-events: none;
  z-index: 1;
}

.draft-drop-before::before {
  top: -0.375rem;
}

.draft-drop-after::after {
  bottom: -0.375rem;
}

.draft-section.draft-drop-before::before {
  top: -0.875rem;
}

.draft-section.draft-drop-after::after {
  bottom: -0.875rem;
}

.draft-drop-into {
  outline: 2px dashed var(--ui-primary);
  outline-offset: 2px;
}

.form-field-hidden {
  max-height: 0;
  overflow: hidden;
  opacity: 0;
  margin: 0 !important;
  padding: 0 !important;
}
</style>
