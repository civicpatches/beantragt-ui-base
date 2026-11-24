import type { FormField, FormFieldType, FormFieldValidation } from '~/types/form';
import { FORM_FIELD_FORMATS, FORM_FIELD_TYPES } from '~/types/form';
import { normalizeFormField } from '~/utils/form-schema';

/**
 * Which inspector settings belong to which field type. THE table: the
 * inspector shows exactly these, the tests are generated from it, the n1h report prints it.
 * Derived from what the citizen form renders and what the checks enforce
 * (`validateFormFieldValue`, `useFormSubmission`, the PHP `ApplicationDataEditValidator`):
 * - placeholder: the text-like inputs, the text area and number render it (a select has a
 *   fixed one);
 * - format: text, and number for the currency format;
 * - min and max length, pattern: free text (text, text area, e-mail, telephone); e-mail and
 *   telephone bring their own pattern, which stays editable;
 * - min, max, step: number (a date has no earliest or latest date in the product);
 * - answer options: select, radio, checkbox (no limit on how many may be chosen exists);
 * - upload limits and the attachment check: file;
 * - required: every type, except a computed field (nobody enters its value).
 */
export type FieldTypeSetting
    = | 'required' | 'placeholder' | 'format'
      | 'minLength' | 'maxLength' | 'pattern'
      | 'min' | 'max' | 'step'
      | 'options' | 'uploadLimits' | 'attachmentCheck';

/**
 * The name of a setting wherever the editor names it (the leftover
 * under "Typ", the question "Feldtyp ändern?") is the label of its own input field, from the same
 * i18n key: "Höchstlänge" and "Muster" stood beside fields called "Max. Länge" and "Eingabeformat".
 * The file limits are two fields, so both labels.
 */
export const SETTING_LABEL_KEYS: Readonly<Record<FieldTypeSetting, readonly string[]>> = {
    required: ['admin.fieldInspector.required'],
    placeholder: ['admin.fieldInspector.placeholder'],
    format: ['admin.fieldInspector.format'],
    minLength: ['admin.fieldInspector.minLength'],
    maxLength: ['admin.fieldInspector.maxLength'],
    pattern: ['admin.fieldInspector.pattern'],
    min: ['admin.fieldInspector.min'],
    max: ['admin.fieldInspector.max'],
    step: ['admin.fieldInspector.step'],
    options: ['admin.fieldInspector.options'],
    uploadLimits: ['admin.fieldInspector.maxFiles', 'admin.fieldInspector.maxSizeMegabytes'],
    attachmentCheck: ['admin.fieldInspector.attachmentAnalysis.enabled']
};

export const FIELD_TYPE_SETTING_ORDER: readonly FieldTypeSetting[] = [
    'required', 'placeholder', 'format', 'minLength', 'maxLength', 'pattern', 'min', 'max', 'step', 'options', 'uploadLimits', 'attachmentCheck'
];

const FREE_TEXT: readonly FieldTypeSetting[] = ['required', 'placeholder', 'minLength', 'maxLength', 'pattern'];

export const FIELD_TYPE_SETTINGS: Readonly<Record<FormFieldType, readonly FieldTypeSetting[]>> = {
    text: [...FREE_TEXT, 'format'],
    textarea: FREE_TEXT,
    email: FREE_TEXT,
    tel: FREE_TEXT,
    number: ['required', 'placeholder', 'format', 'min', 'max', 'step'],
    date: ['required'],
    select: ['required', 'options'],
    radio: ['required', 'options'],
    checkbox: ['required', 'options'],
    address: ['required'],
    file: ['required', 'uploadLimits', 'attachmentCheck']
};

/** A computed field: its value is calculated, so none of the settings above applies. */
const COMPUTED_SETTINGS: readonly FieldTypeSetting[] = [];

export function settingsForField(field: Pick<FormField, 'type' | 'computed'>, type: FormFieldType = field.type): readonly FieldTypeSetting[] {
    return field.computed ? COMPUTED_SETTINGS : FIELD_TYPE_SETTINGS[type];
}

export function settingApplies(field: Pick<FormField, 'type' | 'computed'>, setting: FieldTypeSetting, type: FormFieldType = field.type): boolean {
    return settingsForField(field, type).includes(setting);
}

/** The inspector groups whose content depends on the type. */
export const TYPE_GROUP_SETTINGS = {
    format: ['placeholder', 'format'],
    validation: ['minLength', 'maxLength', 'pattern', 'min', 'max', 'step'],
    attachments: ['uploadLimits', 'attachmentCheck']
} as const satisfies Record<string, readonly FieldTypeSetting[]>;

export type TypeGroup = keyof typeof TYPE_GROUP_SETTINGS;

export function typeGroupShown(field: Pick<FormField, 'type' | 'computed'>, group: TypeGroup, type: FormFieldType = field.type): boolean {
    return TYPE_GROUP_SETTINGS[group].some(setting => settingApplies(field, setting, type));
}

type ValidationKey = keyof FormFieldValidation;
const VALIDATION_SETTING: Record<ValidationKey, FieldTypeSetting> = {
    minLength: 'minLength',
    maxLength: 'maxLength',
    pattern: 'pattern',
    min: 'min',
    max: 'max',
    step: 'step',
    maxFiles: 'uploadLimits',
    maxSizeBytes: 'uploadLimits',
    maxFileSizeBytes: 'uploadLimits'
};
const LEGACY_UPLOAD_KEYS = ['maxFiles', 'maxSizeBytes', 'maxFileSizeBytes'] as const;

/** The rules a type brings by itself (e-mail and telephone patterns, the date's ISO pattern). */
function ownRules(type: FormFieldType, format?: FormField['format']): FormFieldValidation {
    return normalizeFormField({ id: 'probe', type, label: '', format }).validation ?? {};
}

function sameRule(left: unknown, right: unknown): boolean {
    return left !== undefined && String(left) === String(right);
}

/** Every rule set the product brings by itself: one per type, one per format (with its type). */
let productRuleSets: FormFieldValidation[] | null = null;
function allProductRuleSets(): FormFieldValidation[] {
    productRuleSets ??= [
        ...FORM_FIELD_TYPES.map(type => ownRules(type)),
        ...FORM_FIELD_FORMATS.map(format => ownRules('text', format))
    ].filter(set => Object.values(set).some(value => value !== undefined));
    return productRuleSets;
}

/**
 * Rules the product brings for ANOTHER type or format than the
 * one given. "Telefon für Rückfragen IBAN" was stored as text with format IBAN and still the
 * telephone pattern and length 6 to 20: no IBAN could ever pass. Such rules are leftovers by
 * definition. A set counts only when the field carries ALL of its rules, so a single length set
 * by hand that happens to equal one is not taken for a leftover; a rule equal to the given
 * type's own stays.
 */
function foreignRuleKeys(field: FormField, type: FormFieldType, format?: FormField['format']): Set<ValidationKey> {
    const own = ownRules(type, format);
    const validation = (field.validation ?? {}) as Record<string, unknown>;
    const keys = new Set<ValidationKey>();
    for (const set of allProductRuleSets()) {
        const entries = (Object.entries(set) as Array<[ValidationKey, unknown]>).filter(([, value]) => value !== undefined);
        if (!entries.every(([key, value]) => sameRule(value, validation[key]))) continue;
        for (const [key, value] of entries) {
            if (!sameRule(own[key], value)) keys.add(key);
        }
    }
    return keys;
}

function defaultFits(field: FormField, type: FormFieldType): boolean {
    const value = field.defaultValue;
    if (value === undefined) return true;
    if (type === 'checkbox') return typeof value === 'boolean' && !(field.options?.length);
    if (type === 'number') return typeof value === 'number' || (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value.replace(',', '.'))));
    if (type === 'select' || type === 'radio') return typeof value === 'string' && (field.options ?? []).includes(value);
    if (type === 'file' || type === 'address') return false;
    return typeof value === 'string';
}

/**
 * The one rule for values that do not belong to a type: they go when the type changes
 * in the editor, never silently on load. Gone are: settings the new type does not have
 * (placeholder, format, options, rules, upload limits), rules the earlier type or its format
 * brought by themselves (an e-mail pattern on what is a text), and a default value that
 * does not fit. The attachment check and the address widget are already dropped by
 * `normalizeFormField` for every other type. Kept: label, required, privacy, profile key,
 * display condition, computation and everything the new type has.
 *
 * Without `previousType` (cleaning a field as it is) only the first part applies.
 */
export function fieldForType(field: FormField, type: FormFieldType, previousType?: FormFieldType): FormField {
    const next: FormField = { ...field, type };
    const applies = (setting: FieldTypeSetting) => settingApplies(next, setting, type);
    const brought = previousType ? { ...ownRules(previousType), ...(field.format ? ownRules(previousType, field.format) : {}) } : {};
    const keepsFormat = applies('format') && Boolean(field.format) && normalizeFormField({ ...next }).type === type;

    if (!applies('placeholder')) {
        delete next.placeholder;
        if (next.i18n) {
            next.i18n = Object.fromEntries(Object.entries(next.i18n).map(([locale, texts]) => {
                const { placeholder: _placeholder, ...rest } = texts ?? {};
                return [locale, rest];
            })) as FormField['i18n'];
        }
    }
    if (!keepsFormat) delete next.format;
    if (applies('options')) next.options = field.options ?? [];
    else delete next.options;
    if (!applies('uploadLimits')) {
        delete next.maxFiles;
        delete next.maxSizeBytes;
        delete next.maxFileSizeBytes;
    }
    if (field.validation) {
        const validation: FormFieldValidation = {};
        // The rules of another type or format go as well (see `foreignRuleKeys`).
        const foreign = foreignRuleKeys(field, type, keepsFormat ? field.format : undefined);
        for (const [key, value] of Object.entries(field.validation) as Array<[ValidationKey, FormFieldValidation[ValidationKey]]>) {
            if (!applies(VALIDATION_SETTING[key])) continue;
            if (foreign.has(key)) continue;
            if (previousType && previousType !== type && sameRule(brought[key], value)) continue;
            (validation as Record<string, unknown>)[key] = value;
        }
        if (Object.keys(validation).length > 0) next.validation = validation;
        else delete next.validation;
    }
    if (!defaultFits(next, type)) delete next.defaultValue;
    return next;
}

/**
 * What the label recognition may drop when it chooses another type
 * or format. Only the rules the earlier type or format brought by itself (the telephone pattern and
 * lengths when "IBAN" is recognised, N4 point 62). A value a person set by hand stays: where the new
 * type has no use for it, the inspector names it as a leftover with "Entfernen", instead of it
 * vanishing without a word (a hand-set maximum length 50 on "Betrag in Euro").
 */
export function withoutRulesBroughtBy(field: FormField, type: FormFieldType, format?: FormField['format']): FormField {
    if (!field.validation) return field;
    const brought = { ...ownRules(type), ...(format ? ownRules(type, format) : {}) } as Record<string, unknown>;
    const validation = Object.fromEntries(Object.entries(field.validation)
        .filter(([key, value]) => !sameRule(brought[key], value))) as FormFieldValidation;
    const next: FormField = { ...field };
    if (Object.keys(validation).length > 0) next.validation = validation;
    else delete next.validation;
    return next;
}

/**
 * Values a field carries that its type does not have (an existing or compiled form). The rules the type brings by itself are not counted.
 */
export function valuesNotForType(field: FormField): FieldTypeSetting[] {
    const found = new Set<FieldTypeSetting>();
    const own = ownRules(field.type, field.format);
    const applies = (setting: FieldTypeSetting) => settingApplies(field, setting);
    if (field.placeholder?.trim() && !applies('placeholder')) found.add('placeholder');
    if (field.format && !applies('format')) found.add('format');
    if ((field.options?.length ?? 0) > 0 && !applies('options')) found.add('options');
    for (const [key, value] of Object.entries(field.validation ?? {}) as Array<[ValidationKey, unknown]>) {
        if (value === undefined || value === '') continue;
        if (!applies(VALIDATION_SETTING[key]) && !sameRule(own[key], value)) found.add(VALIDATION_SETTING[key]);
    }
    // The rules of another type or format count as well, also where the type has the setting.
    for (const key of foreignRuleKeys(field, field.type, field.format)) found.add(VALIDATION_SETTING[key]);
    if (!applies('uploadLimits') && LEGACY_UPLOAD_KEYS.some(key => field[key] !== undefined)) found.add('uploadLimits');
    return FIELD_TYPE_SETTING_ORDER.filter(setting => found.has(setting));
}

/** One setting with a value that a type change drops. */
export interface TypeChangeLoss {
    setting: FieldTypeSetting
    /** The dropped value as the person set it: a text, a count, or none (a switch that was on). */
    value?: string | number
}

/**
 * What a type change drops, said before it happens: every setting that carried a value on the
 * field and is gone after `fieldForType` and normalize, also the rules the earlier type or format
 * brought by itself (they are dropped too, so they are named).
 */
export function typeChangeLosses(before: FormField, after: FormField): TypeChangeLoss[] {
    const losses: TypeChangeLoss[] = [];
    if (before.placeholder?.trim() && !after.placeholder?.trim()) losses.push({ setting: 'placeholder', value: before.placeholder.trim() });
    if (before.format && !after.format) losses.push({ setting: 'format', value: before.format });
    if ((before.options?.length ?? 0) > 0 && !(after.options?.length)) losses.push({ setting: 'options', value: before.options!.length });
    // "Min." and "Schritt" a format brought along (currency: 0 and 0.01) were
    // dropped without a word, because they were the format's own. Every rule the change drops is named.
    for (const key of ['minLength', 'maxLength', 'pattern', 'min', 'max', 'step'] as const) {
        const value = before.validation?.[key];
        if (value === undefined || value === '') continue;
        if (after.validation?.[key] === undefined) losses.push({ setting: key, value });
    }
    const maxFiles = before.validation?.maxFiles;
    if (maxFiles !== undefined && after.validation?.maxFiles === undefined) losses.push({ setting: 'uploadLimits', value: maxFiles });
    const maxSize = before.validation?.maxSizeBytes;
    if (maxSize !== undefined && after.validation?.maxSizeBytes === undefined) {
        losses.push({ setting: 'uploadLimits', value: `${Math.round((maxSize / (1024 * 1024)) * 10) / 10} MB` });
    }
    if (before.analysis && !after.analysis) losses.push({ setting: 'attachmentCheck' });
    return losses;
}
