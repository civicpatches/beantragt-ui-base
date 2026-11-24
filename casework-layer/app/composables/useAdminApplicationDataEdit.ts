import type { ComputedRef, Ref } from 'vue';
import { useConditionalFields } from '~/composables/useConditionalFields';
import type { FormField, FormSchema } from '~/types/form';
import type { ApplicationDataEditBlockedReason } from '~/types/admin';
import {
    applicationDataErrorDetails,
    DATA_EDIT_REASON_MAX_LENGTH,
    DATA_EDIT_REASON_REQUIRED,
    DATA_EDIT_REASON_TOO_LONG,
    DATA_EDIT_TRANSFER_LOCKED
} from '~~/casework-layer/app/utils/application-data-corrections';
import {
    applicationEditEntryColumnIds,
    applicationEditEntrySections,
    buildApplicationEditPayload,
    collectApplicationEditValidationIssues,
    collectHiddenApplicationEditFieldRemovals,
    createApplicationEditVisibilityPredicate,
    isApplicationEditRefusalReason
} from '~~/casework-layer/app/utils/application-edit-data';

interface ApplicationDataEditState {
    data: Record<string, unknown>
    changed: string
    /** `bulk` for batch applications: only they store entry columns (Rule U). */
    origin?: string | null
}

interface ApplicationDataEditResponseState {
    meta?: {
        protectedDataRedacted?: boolean
        canEditData?: boolean
        editDataBlockedReason?: ApplicationDataEditBlockedReason | null
    }
}

type ApplicationDataEditQuery = Record<string, unknown>;
type MaybeComputedRef<T> = Ref<T> | ComputedRef<T>;

function cloneApplicationData(data: Record<string, unknown>): Record<string, unknown> {
    return JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
}

export function useAdminApplicationDataEdit(options: {
    applicationId: string
    application: MaybeComputedRef<ApplicationDataEditState | null>
    applicationResponse: MaybeComputedRef<ApplicationDataEditResponseState | null | undefined>
    schema: MaybeComputedRef<FormSchema | null>
    applicationQuery: MaybeComputedRef<ApplicationDataEditQuery>
    refreshApplication: () => Promise<unknown>
}) {
    const { t } = useI18n();
    const toast = useToast();
    const { resolveApiErrorMessage } = useApiErrorMessage();

    const isEditingData = ref(false);
    const isSavingData = ref(false);
    const isDataEditReasonOpen = ref(false);
    const dataEditReason = ref('');
    const dataEditReasonError = ref('');
    const dataEditNotice = ref('');
    const transferLocked = ref(false);
    let originalApplication: ApplicationDataEditState | null = null;
    const editData = ref<Record<string, unknown>>({});
    const editFieldErrors = ref<Record<string, string>>({});
    /**
     * The message shown under a flat field (02b, 6): what to do, without quoting the label, because the label
     * stands right above it. `editFieldErrors` keeps the sentence with the label (the summary).
     */
    const editFieldInlineErrors = ref<Record<string, string>>({});
    const editInitialVisibleFieldIds = ref<Set<string>>(new Set());

    const protectedDataRedacted = computed(() => options.applicationResponse.value?.meta?.protectedDataRedacted === true);
    const dataEditDisabledReason = computed<ApplicationDataEditBlockedReason | 'unavailable' | null>(() => {
        const meta = options.applicationResponse.value?.meta;
        if (transferLocked.value) return 'transfer';
        if (meta?.canEditData !== true) return meta?.editDataBlockedReason ?? 'unavailable';
        if (protectedDataRedacted.value) return 'protected';
        if (!options.schema.value) return 'schema';
        return null;
    });
    const dataEditDisabled = computed(() => dataEditDisabledReason.value !== null);
    watch(options.applicationResponse, (response) => {
        if (response?.meta?.canEditData === true || response?.meta?.editDataBlockedReason) transferLocked.value = false;
    });
    watch([dataEditDisabled, isSavingData], ([disabled, saving]) => {
        if (disabled && !saving && isEditingData.value) cancelDataEdit();
    });
    const dataEditDisabledTitle = computed(() => {
        switch (dataEditDisabledReason.value) {
            case 'permission': return t('admin.detail.dataEditPermissionRequired');
            case 'unavailable': return t('admin.detail.dataEditUnavailable');
            case 'transfer': return t('admin.detail.dataEditTransferLocked');
            case 'schema': return t('admin.detail.schemaUnavailableDescription');
            case 'protected': return t('admin.detail.protectedDataEditUnavailableDescription');
            default: return undefined;
        }
    });

    const editVisibilitySchema = computed<FormSchema>(() => options.schema.value ?? { title: '', sections: [] });
    const { isFieldVisible: isFlatFieldVisible } = useConditionalFields(editVisibilitySchema, editData);

    /**
     * Repeatable sections whose STORED data hold entry columns (batch applications). They are edited entry by
     * entry and validated per element; as a whole a column counts as visible (its elements decide).
     */
    const editEntrySections = computed(() => options.schema.value && options.application.value
        ? applicationEditEntrySections(options.schema.value, options.application.value.data, options.application.value.origin)
        : []);
    const editEntryColumnIds = computed(() => applicationEditEntryColumnIds(editEntrySections.value));
    /** Fields of an entry section that are no column (file fields) with a condition on a sibling column. */
    const columnDependentIds = computed(() => new Set(editEntrySections.value.flatMap(entrySection => entrySection.section.fields
        .filter(field => !entrySection.fieldIds.includes(field.id) && field.conditionalOn && entrySection.fieldIds.includes(field.conditionalOn.fieldId))
        .map(field => field.id))));
    /** The rule the proxy and Drupal apply to them: visible when at least one entry meets the condition. */
    const columnAwareVisibility = computed(() => createApplicationEditVisibilityPredicate(editVisibilitySchema.value, editData.value, editEntryColumnIds.value));
    function isEditFieldVisible(fieldId: string): boolean {
        if (editEntryColumnIds.value.has(fieldId)) return true;
        if (columnDependentIds.value.has(fieldId)) return columnAwareVisibility.value(fieldId);
        return isFlatFieldVisible(fieldId);
    }

    /** Errors of entry fields, keyed by entry (`<sectionId>#<index>`), then field id: shown at that entry only. */
    const editEntryErrors = ref<Record<string, Record<string, string>>>({});
    /** The summary, one line per issue; entry issues name section, entry and field. */
    const editErrorSummary = ref<string[]>([]);
    const editFieldErrorMessages = computed(() => editErrorSummary.value);
    /**
     * One entry per field that needs a look, for the summary at the top of the form (02b, 6): the name to show
     * (for an entry the field, then section and entry number) and where the focus goes.
     */
    const editErrorTargets = ref<Array<{ label: string, fieldId: string, entryKey?: string }>>([]);
    /** Where the first error is, for the focus after a refused save. */
    let firstErrorTarget: { fieldId: string, entryKey?: string } | null = null;

    const hiddenEditFieldRemovals = computed(() => {
        if (!options.schema.value || !options.application.value || !isEditingData.value) return [];
        return collectHiddenApplicationEditFieldRemovals(
            options.schema.value,
            options.application.value.data,
            editData.value,
            isEditFieldVisible,
            isEditFieldInitiallyVisible,
            options.application.value.origin ?? null
        );
    });

    const hiddenEditFieldRemovalLabels = computed(() =>
        hiddenEditFieldRemovals.value.map(field => field.label).join(', ')
    );

    function startDataEdit() {
        const formSchema = options.schema.value;
        if (!options.application.value || !formSchema || dataEditDisabled.value) return;
        originalApplication = { ...options.application.value, data: cloneApplicationData(options.application.value.data) };
        editData.value = cloneApplicationData(originalApplication.data);
        dataEditNotice.value = '';
        editInitialVisibleFieldIds.value = collectVisibleFieldIds(formSchema);
        editFieldErrors.value = {};
        editFieldInlineErrors.value = {};
        editEntryErrors.value = {};
        editErrorSummary.value = [];
        editErrorTargets.value = [];
        isEditingData.value = true;
    }

    function cancelDataEdit() {
        originalApplication = null;
        isDataEditReasonOpen.value = false;
        dataEditReason.value = '';
        dataEditReasonError.value = '';
        editData.value = {};
        editFieldErrors.value = {};
        editFieldInlineErrors.value = {};
        editEntryErrors.value = {};
        editErrorSummary.value = [];
        editErrorTargets.value = [];
        isEditingData.value = false;
    }

    function collectVisibleFieldIds(formSchema: FormSchema): Set<string> {
        const visible = new Set<string>();
        for (const section of formSchema.sections) {
            for (const field of section.fields) {
                if (isEditFieldVisible(field.id)) {
                    visible.add(field.id);
                }
            }
        }
        return visible;
    }

    function isEditFieldInitiallyVisible(fieldId: string): boolean {
        return editInitialVisibleFieldIds.value.has(fieldId);
    }

    async function focusFirstEditError() {
        if (firstErrorTarget) await focusEditField(firstErrorTarget);
    }

    /** Puts the focus into a field of the edit form (an entry field inside its entry); the summary links use it. */
    async function focusEditField(target: { fieldId: string, entryKey?: string }) {
        if (typeof document === 'undefined') return;

        await nextTick();
        const escape = (value: string) => typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
            ? CSS.escape(value)
            : value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"');
        // An entry field exists once per entry: look inside that entry.
        const scope = target.entryKey ? `[data-entry-key="${escape(target.entryKey)}"] ` : '';
        const field = document.querySelector<HTMLElement>(`${scope}[data-field-id="${escape(target.fieldId)}"]`);
        field?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        const control = field?.querySelector<HTMLElement>('input, textarea, select, button, [tabindex]:not([tabindex="-1"])');
        control?.focus({ preventScroll: true });
    }

    type EditIssue = ReturnType<typeof collectApplicationEditValidationIssues>[number];

    function formatEditValidationError(field: FormField, issue: EditIssue['issue']): string {
        switch (issue.code) {
            case 'required':
                return t('form.requiredField', { label: field.label });
            case 'minLength':
                return t('form.minLengthField', { label: field.label, value: issue.value });
            case 'maxLength':
                return t('form.maxLengthField', { label: field.label, value: issue.value });
            case 'min':
                return t('form.minValueField', { label: field.label, value: issue.value });
            case 'max':
                return t('form.maxValueField', { label: field.label, value: issue.value });
            case 'step':
                return t('form.stepValueField', { label: field.label, value: issue.value });
            case 'format':
                return t('form.invalidFormatField', { label: field.label });
            case 'pattern':
            default:
                return t('form.invalidField', { label: field.label });
        }
    }

    /** Tell the user how to fix the entry without repeating its label. */
    function formatEntryFieldError(issue: EditIssue['issue']): string {
        switch (issue.code) {
            case 'required': return t('admin.detail.entryError.required');
            case 'minLength': return t('admin.detail.entryError.minLength', { value: issue.value ?? '' });
            case 'maxLength': return t('admin.detail.entryError.maxLength', { value: issue.value ?? '' });
            case 'min': return t('admin.detail.entryError.min', { value: issue.value ?? '' });
            case 'max': return t('admin.detail.entryError.max', { value: issue.value ?? '' });
            case 'step': return t('admin.detail.entryError.step', { value: issue.value ?? '' });
            case 'option': return t('admin.detail.entryError.option');
            default: return t('admin.detail.entryError.format');
        }
    }

    function validateEditData(formSchema: FormSchema): string[] {
        const storedData = originalApplication?.data ?? {};
        const issues = collectApplicationEditValidationIssues(formSchema, editData.value, isEditFieldVisible, storedData, options.application.value?.origin ?? null);
        const messages: string[] = [];
        const nextFieldErrors: Record<string, string> = {};
        const nextInlineErrors: Record<string, string> = {};
        const nextEntryErrors: Record<string, Record<string, string>> = {};
        const targets: Array<{ label: string, fieldId: string, entryKey?: string }> = [];
        firstErrorTarget = null;

        for (const { field, issue, entry } of issues) {
            if (issue.code === 'entryCount' || issue.code === 'entryColumn') {
                const section = formSchema.sections.find(candidate => candidate.fields.some(item => item.id === field.id));
                messages.push(t('admin.detail.entryShape', { section: section?.title ?? '' }));
                continue;
            }
            if (entry) {
                const entryKey = `${entry.sectionId}#${entry.index}`;
                const message = formatEntryFieldError(issue);
                messages.push(t('admin.detail.entryErrorSummary', { section: entry.sectionTitle, number: entry.index + 1, label: field.label, message }));
                nextEntryErrors[entryKey] ??= {};
                if (!nextEntryErrors[entryKey][field.id]) {
                    nextEntryErrors[entryKey][field.id] = message;
                    targets.push({ label: t('admin.detail.entryFieldName', { section: entry.sectionTitle, number: entry.index + 1, label: field.label }), fieldId: field.id, entryKey });
                }
                firstErrorTarget ??= { fieldId: field.id, entryKey };
                continue;
            }
            // The summary names the field; the message under the field says what to do without quoting the
            // label.
            const message = formatEditValidationError(field, issue);
            messages.push(message);
            if (!nextFieldErrors[field.id]) {
                nextFieldErrors[field.id] = message;
                nextInlineErrors[field.id] = formatEntryFieldError(issue);
                targets.push({ label: field.label, fieldId: field.id });
            }
            firstErrorTarget ??= { fieldId: field.id };
        }

        editFieldErrors.value = nextFieldErrors;
        editFieldInlineErrors.value = nextInlineErrors;
        editEntryErrors.value = nextEntryErrors;
        editErrorSummary.value = messages;
        editErrorTargets.value = targets;
        return messages;
    }

    /**
     * A refusal that names a field (the proxy's own check or Drupal's message read back): the hint says what to
     * do at the field (or the entry's field) when it is on the page, the summary names it. Returns the summary.
     */
    function placeServerRefusal(error: unknown): string | null {
        const data = applicationDataErrorDetails(error);
        if (!data || typeof data.field !== 'string' || !isApplicationEditRefusalReason(data.reason)) return null;
        const hint = t(`admin.detail.fieldHint.${data.reason}`);
        const label = typeof data.label === 'string' ? data.label : data.field;
        let summary: string;
        if (typeof data.number === 'number' && typeof data.sectionId === 'string') {
            const entryKey = `${data.sectionId}#${data.number - 1}`;
            editEntryErrors.value = { [entryKey]: { [data.field]: hint } };
            editFieldErrors.value = {};
            editFieldInlineErrors.value = {};
            summary = t('admin.detail.entryErrorSummary', { section: data.section ?? '', number: data.number, label, message: hint });
            firstErrorTarget = { fieldId: data.field, entryKey };
            editErrorTargets.value = [{ label: t('admin.detail.entryFieldName', { section: data.section ?? '', number: data.number, label }), fieldId: data.field, entryKey }];
        } else {
            editFieldErrors.value = { [data.field]: hint };
            editFieldInlineErrors.value = { [data.field]: hint };
            editEntryErrors.value = {};
            summary = t('admin.detail.fieldRefusedSummary', { label, hint });
            firstErrorTarget = { fieldId: data.field };
            editErrorTargets.value = [{ label, fieldId: data.field }];
        }
        editErrorSummary.value = [summary];
        return summary;
    }

    async function validateBeforeSave(formSchema: FormSchema): Promise<boolean> {
        if (validateEditData(formSchema).length > 0) {
            isDataEditReasonOpen.value = false;
            await focusFirstEditError();
            return false;
        }
        return true;
    }

    async function openDataEditReason() {
        const formSchema = options.schema.value;
        if (!originalApplication || !formSchema || isSavingData.value || dataEditDisabled.value) return;
        if (!await validateBeforeSave(formSchema)) return;
        dataEditReasonError.value = '';
        isDataEditReasonOpen.value = true;
    }

    function showReasonError(code: string | undefined): boolean {
        if (code !== DATA_EDIT_REASON_REQUIRED && code !== DATA_EDIT_REASON_TOO_LONG) return false;
        dataEditReasonError.value = t(code === DATA_EDIT_REASON_REQUIRED
            ? 'admin.detail.dataEditReasonRequired'
            : 'admin.detail.dataEditReasonTooLong');
        return true;
    }

    /** Resolves to true only when the data was stored. */
    async function saveApplicationData(reasonInput: string): Promise<boolean> {
        const formSchema = options.schema.value;
        const original = originalApplication;
        if (!original || !formSchema || isSavingData.value || dataEditDisabled.value) return false;
        if (!await validateBeforeSave(formSchema) || isSavingData.value || original !== originalApplication || dataEditDisabled.value) return false;
        const reason = reasonInput.trim();
        if (showReasonError(!reason ? DATA_EDIT_REASON_REQUIRED : reasonInput.length > DATA_EDIT_REASON_MAX_LENGTH ? DATA_EDIT_REASON_TOO_LONG : undefined)) return false;

        isSavingData.value = true;
        try {
            const data = buildApplicationEditPayload(
                formSchema,
                original.data,
                editData.value,
                isEditFieldVisible,
                isEditFieldInitiallyVisible,
                original.origin ?? null
            );
            await $fetch(`/api/admin/applications/${options.applicationId}/data`, {
                method: 'PATCH',
                query: options.applicationQuery.value,
                body: {
                    data,
                    expectedChanged: original.changed,
                    reason
                }
            });
        } catch (e: unknown) {
            const code = applicationDataErrorDetails(e)?.code;
            if (typeof code === 'string' && showReasonError(code)) return false;
            isDataEditReasonOpen.value = false;
            if (code === DATA_EDIT_TRANSFER_LOCKED || code === 'errors.applications.dataConflict') {
                cancelDataEdit();
                if (code === DATA_EDIT_TRANSFER_LOCKED) transferLocked.value = true;
                else dataEditNotice.value = t('admin.detail.dataEditConflict');
                await options.refreshApplication();
                return false;
            }
            // A refusal that names a field goes to the field and the summary; any other refusal (conflict, busy,
            // the server's generic sentence) is the card's one-sentence alert. No toast either way.
            const placed = placeServerRefusal(e);
            if (!placed) {
                editFieldErrors.value = {};
                editFieldInlineErrors.value = {};
                editEntryErrors.value = {};
                editErrorTargets.value = [];
                editErrorSummary.value = [resolveApiErrorMessage(e, 'admin.detail.dataSaveError')];
            }
            if (placed) await focusFirstEditError();
            return false;
        } finally {
            isSavingData.value = false;
        }
        cancelDataEdit();
        toast.add({ title: t('admin.detail.dataSaved'), color: 'success' });
        await options.refreshApplication();
        return true;
    }

    return {
        isEditingData,
        isSavingData,
        isDataEditReasonOpen,
        dataEditReason,
        dataEditReasonError,
        dataEditNotice,
        openDataEditReason,
        editData,
        editFieldErrors,
        editFieldInlineErrors,
        editFieldErrorMessages,
        editErrorTargets,
        focusEditField,
        editEntryErrors,
        editEntrySections,
        hiddenEditFieldRemovals,
        hiddenEditFieldRemovalLabels,
        protectedDataRedacted,
        dataEditDisabled,
        dataEditDisabledReason,
        dataEditDisabledTitle,
        startDataEdit,
        cancelDataEdit,
        saveApplicationData
    };
}
