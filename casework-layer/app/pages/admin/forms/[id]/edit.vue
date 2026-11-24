<script setup lang="ts">
import { provide, useTemplateRef, type Directive } from 'vue';
import { verticalScrollContainer } from '~/utils/drag-edge-scroll';
import { EDIT_ICON } from '~/utils/action-icons';
import type { FormContextSource, FormField, FormSchema } from '~/types/form';
import { staffFormFeatures } from '~~/casework-layer/app/utils/staff-extensions';
import type { EditorChatMessage } from '~~/casework-layer/app/utils/staff-form-features';
import type { FormSchemaSingleResponse } from '~/types';
import type { SchemaAuthoringIssue } from '~/utils/form-schema';
import { collectSchemaAuthoringIssues, parseStoredFormSchema } from '~/utils/form-schema';
import { publicFormPath } from '~/utils/public-form-path';
import { useEditorTextDraft, type CommitEditorText } from '~~/casework-layer/app/composables/useEditorTextDraft';
import { usePublishRule } from '~~/casework-layer/app/composables/usePublishRule';
import { useDashboardFullBleed } from '~~/casework-layer/app/composables/useDashboardFullBleed';
import { useEditorRowRoom, useEditorWideLayout } from '~~/casework-layer/app/composables/useEditorWideLayout';
import { VIEWPORT_BOUND_UI } from '~~/casework-layer/app/utils/viewport-bound-content';
import type { EditorHeadTool } from '~~/casework-layer/app/components/admin/editor/EditorHead.vue';
import type { EditorIssueGroup, IssueEntry } from '~~/casework-layer/app/components/admin/editor/IssueList.vue';
import EditorOverview, { type FormBlocker } from '~~/casework-layer/app/components/admin/editor/FormOverview.vue';
import { REFERENCE_NUMBER_MAX_LENGTH, REFERENCE_PATTERN_TOKENS, findUnknownReferenceTokens, normalizeReferencePattern, renderReferencePatternPreview } from '~~/casework-layer/app/utils/reference-pattern';
import type { FieldChangeKey, FieldLocation, SchemaChangeSummary } from '~~/casework-layer/app/utils/schema-change-summary';
import { cloneFormSchema, summarizeSchemaChange } from '~~/casework-layer/app/utils/schema-change-summary';
import { stableJson } from '~~/casework-layer/app/utils/stable-json';
import { loadFormApplicationCount, publishSuccessDescription } from '~~/casework-layer/app/utils/publish-success';
import { namedBlockerFields, publishBlockers, publishRefusalKind, type PublishBlockers } from '~~/casework-layer/app/utils/publish-blockers';
import { SETTING_LABEL_KEYS, typeChangeLosses } from '~~/casework-layer/app/utils/field-type-settings';
import { schemaRefusalOf } from '~/utils/schema-refusal';
import { brokenConditions, conditionTypeChangeEffects, conditionTypeChangeNotes, newlyBrokenConditions, type BrokenCondition, type ConditionTypeChange, type ConditionTypeChangeEffect } from '~~/casework-layer/app/utils/field-condition';
import type { MoveBlockedReason, MoveDirection, MoveResult, SchemaReference, StructureTarget } from '~~/casework-layer/app/utils/schema-structure';
import {
    addressGroupFieldIds,
    addressGroupLabel,
    conditionOrderHints,
    crossedRepeatableBoundary,
    deleteSchemaElement,
    fieldPosition,
    findAddressGroupOfField,
    findSchemaReferences,
    moveAddressGroup,
    moveAddressGroupByStep,
    moveAddressGroupToSection,
    moveField,
    moveFieldByStep,
    moveFieldToSection,
    moveSection,
    moveSectionByStep,
    structureTargetFieldIds
} from '~~/casework-layer/app/utils/schema-structure';

definePageMeta({
    layout: 'dashboard',
    middleware: 'admin'
});

const { t, locale } = useI18n();
const { resolveApiErrorMessage } = useApiErrorMessage();
const route = useRoute();
const router = useRouter();
const toast = useToast();
const { user } = useAuth();
const { currentWorkspace, selectedWorkspaceKey, withWorkspaceQuery, workspaceRoute } = useWorkspaceContext();
const schemaId = route.params.id as string;
const formFeatures = staffFormFeatures();

const schemaQuery = computed(() => withWorkspaceQuery(formFeatures ? {} : { capabilities: '1' }));
const { data: schemaResponse, status: schemaStatus, error: schemaError, refresh } = await useFetch<FormSchemaSingleResponse>(`/api/admin/schemas/${schemaId}`, {
    key: `admin-schema-${schemaId}`,
    query: schemaQuery
});

interface ScopedChatMessage extends EditorChatMessage {
    scopeKey: string
    aiContent?: string
}

type EditorActionKind = 'field_updated' | 'field_deleted' | 'schema_updated';
type EditorActionStatus = 'applied' | 'undone';

const editableSchema = ref<FormSchema | null>(null);
const formData = ref<Record<string, unknown>>({});
const selectedField = ref<{ sectionId: string, fieldId: string } | null>(null);
const chatMessageStore = ref<ScopedChatMessage[]>([]);
const fieldChatGenerations = ref<Record<string, number>>({});
const schemaChatScopeKey = `schema:${schemaId}`;
const activeChatScopeKey = computed(() => selectedField.value
    ? `field:${selectedField.value.fieldId}:${fieldChatGenerations.value[selectedField.value.fieldId] ?? 0}`
    : schemaChatScopeKey
);
const chatMessages = computed<EditorChatMessage[]>(() => chatMessageStore.value
    .filter(message => message.scopeKey === activeChatScopeKey.value)
);
const isProcessing = ref(false);
const isSaving = ref(false);
const schemaStatusUpdating = ref(false);
const isDeleteDraftDialogOpen = ref(false);
const isDeletingDraft = ref(false);
const publicationScope = ref<'internet' | 'intranet'>('internet');
const referencePattern = ref('');
const retentionDaysInput = ref('');
const retentionDaysError = ref<string | undefined>(undefined);
const isSettingsOpen = ref(false);
const isDecisionsOpen = ref(false);
const isDecisionsBusy = ref(false);
const hasPendingAutosave = ref(false);
const lastSavedAt = ref<number | null>(null);
const lastKnownSchemaChanged = ref<string | null>(null);
const schemaOrganisationId = computed(() => {
    const relation = schemaResponse.value?.data?.relationships?.field_organisation?.data;
    return relation && !Array.isArray(relation) ? relation.id : null;
});

// While an organisation assignment is in flight the autosave waits, so the two
// writes never race on the form's `changed` value.
const isAssigningOrganisation = ref(false);
let mutationVersionAtAssignment: number | null = null;

function onOrganisationAssignBusy(busy: boolean) {
    isAssigningOrganisation.value = busy;
    if (busy) mutationVersionAtAssignment = editorMutationVersion.value;
}

// The assignment changes only the form's organisation, so the editor adopts
// the `changed` value of its own write and keeps unsaved edits; the reload
// refreshes the shown organisation without reapplying the schema. The
// reloaded `changed` value is adopted only when it is that same write, or
// when the reloaded form still equals what the editor holds: a newer value
// with other content means another tab or person saved in between, and
// adopting it would let the next autosave overwrite that save unseen.
async function onOrganisationAssigned(result: { changed: string | null }) {
    const mutationVersionAtStart = mutationVersionAtAssignment ?? editorMutationVersion.value;
    mutationVersionAtAssignment = null;
    lastKnownSchemaChanged.value = result.changed ?? lastKnownSchemaChanged.value;
    await refresh();
    const reloadedChanged = schemaResponse.value?.data?.attributes?.changed ?? null;
    if (!reloadedChanged || reloadedChanged === lastKnownSchemaChanged.value) return;
    if (editorMutationVersion.value === mutationVersionAtStart && reloadedFormMatchesEditor()) {
        lastKnownSchemaChanged.value = reloadedChanged;
    }
}

function reloadedFormMatchesEditor(): boolean {
    const reloaded = parseResponseSchema();
    if (!reloaded || !editableSchema.value) return false;
    return stableJson({ ...reloaded, id: schemaId }) === stableJson({ ...editableSchema.value, id: schemaId })
      && parseResponsePublicationScope() === publicationScope.value
      && parseResponseReferencePattern() === normalizeReferencePattern(referencePattern.value);
}
const parseError = ref(false);
const autosaveTimer = ref<ReturnType<typeof setTimeout> | null>(null);
const editorMutationVersion = ref(0);
const authoritativeEditorStateVersion = ref(0);
const isChatOpen = ref(false);
const isInspectorOpen = ref(false);
const draftInspectEnabled = ref(true);
const chatPanel = ref<{ prefillInput: (text: string) => void } | null>(null);
const floatingChat = ref<HTMLElement | null>(null);
const floatingChatPosition = ref({ top: 96, left: 304 });
const floatingChatSize = { width: 384, height: 392 };
const isDraggingChat = ref(false);
const dragOffset = ref({ x: 0, y: 0 });
const lastSchemaChange = ref<{
    previousSchema: FormSchema
    previousSelectedField: FieldLocation | null
    previousFieldChatGenerations: Record<string, number>
    summary: SchemaChangeSummary
    /** Set for inspector edits: a typing burst on this field forms one undo step. */
    inspectorFieldId?: string
    /** Time of the latest inspector edit in that burst (Date.now). */
    inspectorEditAt?: number
} | null>(null);

/** A delete waiting for confirmation in the structure dialog. */
interface PendingStructureDelete {
    target: StructureTarget
    label: string
    fieldCount: number
    fieldLabels: string[]
    references: SchemaReference[]
    /** The delete leaves a draft that cannot be published. */
    emptyAfter: 'sections' | 'fields' | null
    origin: 'editor' | 'chat'
    chat?: { message: string, scopeKey: string }
}
const pendingStructureDelete = ref<PendingStructureDelete | null>(null);
/** The dialog stays mounted while it closes; pendingStructureDelete ends after its leave transition. */
const isStructureDeleteOpen = ref(false);
const structureDeleteRemoveConditions = ref(true);
/** Persistent live region text for moves and deletes. */
const structureAnnouncement = ref('');

let initialized = false;
let messageCounter = 0;
let applyingPersistedEditorState = false;

function recordEditorMutation() {
    if (!applyingPersistedEditorState) {
        editorMutationVersion.value += 1;
    }
}

watch(editableSchema, () => {
    recordEditorMutation();
}, { deep: true, flush: 'sync' });

watch([publicationScope, referencePattern, retentionDaysInput], () => {
    recordEditorMutation();
}, { flush: 'sync' });

// The form page links straight to the settings and the decision templates.
// `?settings=context` opens the settings at "Assistenz-Kontext".
const openSettingsAtContext = Boolean(formFeatures) && route.query.settings === 'context';
if (route.query.panel === 'settings' || openSettingsAtContext) {
    isSettingsOpen.value = true;
} else if (route.query.panel === 'decisions') {
    isDecisionsOpen.value = true;
}
// The same rule and question as the form page
// and the guided setup (`usePublishRule`, `PublishConfirm`).
const { organisationMissing: publishOrganisationMissing, receiverText: publishReceiverText } = usePublishRule(schemaOrganisationId);
const confirmingPublish = ref(false);
/** "Als Entwurf setzen" asks in a dialog, not with the browser's confirm(). */
const confirmingDraft = ref(false);

const schemaLabel = computed(() =>
    editableSchema.value?.title
    || schemaResponse.value?.data?.attributes?.label
    || t('common.forms')
);
const schemaResourceId = computed(() =>
    typeof schemaResponse.value?.data?.id === 'string'
        ? schemaResponse.value.data.id
        : schemaId
);

const fieldCount = computed(() =>
    editableSchema.value?.sections.reduce((total, section) => total + section.fields.length, 0) ?? 0
);

const schemaWorkflowStatus = computed(() =>
    schemaResponse.value?.data?.attributes?.field_workflow_status || 'unknown'
);

const isPublishedSchema = computed(() => schemaWorkflowStatus.value === 'published');
const canInspectDraftFields = computed(() => schemaWorkflowStatus.value === 'draft');
const showAiReviewNotice = computed(() =>
    canInspectDraftFields.value && schemaResponse.value?.data?.attributes?.field_ai_review_pending === true
);
/*
 * The read-only view that "Ansehen" opens (a published or archived form)
 * was titled "Formular bearbeiten: …" as page and heading. It is called what it is, as the form list and the
 * form's page call the way there: "Formular bearbeiten" for a draft, "Formular ansehen" otherwise.
 */
const editorPageName = computed(() => t(canInspectDraftFields.value ? 'admin.forms.editSchema' : 'admin.forms.viewSchema'));

const setup = formFeatures?.useSetupView(schemaId);
const setupView = setup?.data;
const draftSetupView = computed(() =>
    canInspectDraftFields.value && schemaResponse.value?.data && !schemaError.value && !setup?.error.value
        ? setupView?.value
        : null
);
const setupEligible = computed(() => draftSetupView.value?.eligible === true);
const setupWorkspaceMismatch = computed(() => {
    const view = draftSetupView.value;
    return view && 'workspaceMismatch' in view ? view.workspaceMismatch : null;
});
const setupIneligibleReason = computed(() =>
    draftSetupView.value?.eligible === false ? draftSetupView.value.ineligibleReason : null
);
const publishForbidden = computed(() => {
    const capabilities = schemaResponse.value?.capabilities;
    return (setupView?.value?.canPublish ?? (capabilities && capabilities.canEdit && capabilities.canPublish)) === false;
});
const openedFromSetup = computed(() => Boolean(formFeatures) && route.query.from === 'setup');
// Back to the setup screen the editor was opened from, or to the entry.
const setupRoute = computed(() => {
    const screen = typeof route.query.screen === 'string' ? route.query.screen : '';
    return workspaceRoute(`/admin/forms/${schemaId}/setup${screen ? `/screens/${encodeURIComponent(screen)}` : ''}`);
});
const canDeleteDraft = computed(() =>
    schemaWorkflowStatus.value === 'draft'
    && typeof lastKnownSchemaChanged.value === 'string'
    && lastKnownSchemaChanged.value.length > 0
);
// "Entwurf löschen" sits at the foot of the form settings (
// the toolbar menu "Weitere Aktionen" held only this one action).
const deleteDraftDisabled = computed(() =>
    isSaving.value || isProcessing.value || schemaStatusUpdating.value || isDeletingDraft.value
    // Not while a leaflet upload or delete in the same panel runs.
    || isSettingsAsyncBusy.value
);
const isEditorMutationLocked = computed(() => !canInspectDraftFields.value || schemaStatusUpdating.value || isDeletingDraft.value);
watch(isSettingsOpen, (open) => {
    if (!open) titleInput.finish();
});

const contextSettings = formFeatures?.useContextSettings({
    schemaId, schemaResourceId, editableSchema, canInspectDraftFields, isEditorMutationLocked, isSaving, autosaveTimer, hasPendingAutosave,
    isSettingsOpen, openSettingsAtContext, clearUndo: () => {
        lastSchemaChange.value = null;
    },
    replaceRejectedSources, scheduleAutosave, saveCurrentSchema,
    reloadPersistedSchemaAfterDeleteConflict, responseStatusCode
});
await contextSettings?.ready;
const isSettingsAsyncBusy = computed(() => contextSettings?.isSettingsAsyncBusy.value ?? false);
const isSettingsMutationLocked = computed(() => isEditorMutationLocked.value || isSettingsAsyncBusy.value);

const isDraftInspectActive = computed(() => !isEditorMutationLocked.value && draftInspectEnabled.value);
// The canvas has two named modes. "Nur ansehen" is the read-only
// rendering without editing tools, where fields whose condition is not met
// stay hidden; it is not a preview of what citizens can fill in.
const EDITOR_VIEW_REASON_ID = 'editor-view-mode-reason';
const editorModeItems = computed(() => [
    { label: t('admin.forms.editorMode.edit'), value: 'edit', icon: EDIT_ICON, disabled: isEditorMutationLocked.value },
    { label: t('admin.forms.editorMode.view'), value: 'view', icon: 'i-lucide-eye', disabled: isEditorMutationLocked.value }
]);
// UTabs 4.11 forwards attributes to its root, one level above the tablist.
const vModeTabs: Directive<HTMLElement, string> = (root, { value }) => {
    const list = root.querySelector<HTMLElement>('[role="tablist"]');
    if (!list) return;
    list.setAttribute('aria-label', value);
    const [edit, view] = list.querySelectorAll<HTMLElement>('[role="tab"]');
    if (!hasRowRoom.value) {
        if (view) view.dataset.test = 'editor-mode-menu';
        if (edit) edit.dataset.test = 'editor-view-mode-edit';
        list.dataset.test = 'editor-view-mode-line';
    } else {
        delete list.dataset.test;
        if (edit) delete edit.dataset.test;
        if (view) delete view.dataset.test;
    }
};
const editorSplit = ref<{ resetWidth: () => void } | null>(null);

function onEditorModeChange(value: unknown) {
    if (value !== 'edit' && value !== 'view') return;
    if (value === 'view') flushTextCommit(true);
    draftInspectEnabled.value = value === 'edit';
}

const canOpenPublicFormPreview = computed(() =>
    isPublishedSchema.value && publicationScope.value === 'internet'
);
const publicFormPreviewUnavailableReason = computed(() => {
    if (publicationScope.value !== 'internet') return t('admin.forms.publicPreviewIntranetUnavailable');
    if (!isPublishedSchema.value) return t('admin.forms.publicPreviewDraftRequired');
    return '';
});

const publicationScopeOptions = computed(() => [
    { label: t('admin.forms.publicationScopes.internet'), value: 'internet' },
    { label: t('admin.forms.publicationScopes.intranet'), value: 'intranet' }
]);

// Counts and origin left the head; they stand in "Formular-Einstellungen",
// group "Angaben" (the scope is the value of "Veröffentlichungsbereich" there).
const settingsFactsText = computed(() => [
    t('admin.forms.editPreviewMetaCompact', { sections: editableSchema.value?.sections.length ?? 0, fields: fieldCount.value }, editableSchema.value?.sections.length ?? 0),
    sourceTypeLabel.value
].join(' · '));

/**
 * In "Bearbeiten" the canvas shows one field per row in the
 * form's order, so "früher" and "später" are what the person sees; "Nur ansehen" keeps
 * the side-by-side layout of the citizen form. The one place to switch it back.
 */
const EDIT_MODE_ONE_FIELD_PER_ROW = true;

/** The tools of the head's second row, in the row from xl and in "Mehr" below it. */
/**
 * Tailwind `sm`: from this width row 2 of the head has room for the mode and the answer beside
 * "Rückgängig". Below it the answer is a toast and the mode has its own toolbar.
 */
const hasRowRoom = useEditorRowRoom();

const editorHeadTools = computed<EditorHeadTool[]>(() => {
    const tools: EditorHeadTool[] = [
        {
            key: 'docgen',
            icon: 'i-lucide-files',
            label: t('docgenUi.form.open'),
            expanded: isDecisionsOpen.value,
            attrs: { 'data-testid': 'docgen-form-open' },
            onSelect: () => {
                isDecisionsOpen.value = true;
            }
        },
        {
            key: 'settings',
            icon: 'i-lucide-settings-2',
            label: t('admin.forms.formSettings'),
            expanded: isSettingsOpen.value,
            attrs: { 'data-test': 'editor-open-settings' },
            onSelect: () => {
                isSettingsOpen.value = true;
            }
        }
    ];
    if (setupEligible.value && !isWideLayout.value) {
        tools.push({
            key: 'setup',
            icon: 'i-lucide-list-checks',
            label: formFeatures?.setupResumeLabel(t, openedFromSetup.value) ?? '',
            busy: leavingToSetup,
            menuOnly: true,
            onSelect: returnToSetup
        });
    }
    // The chat keeps its place in "Nur ansehen" (disabled, not removed).
    if (formFeatures && canInspectDraftFields.value) {
        tools.push({
            key: 'chat',
            icon: 'i-lucide-message-square',
            label: formFeatures.chatToggleLabel(t, isChatOpen.value),
            expanded: isChatOpen.value,
            disabled: !isDraftInspectActive.value,
            busy: isSaving,
            attrs: { 'data-test': 'chat-toggle' },
            onSelect: () => {
                if (isChatOpen.value) closeFloatingChat();
                else openFloatingChat();
            }
        });
    }
    tools.push({
        key: 'reset-width',
        label: t('admin.forms.editorHead.resetWidth'),
        icon: 'i-lucide-rotate-ccw',
        menuOnly: true,
        attrs: { 'data-test': 'editor-reset-width' },
        onSelect: () => editorSplit.value?.resetWidth()
    });
    if (isPublishedSchema.value && canOpenPublicFormPreview.value && !isWideLayout.value) {
        tools.push({
            key: 'public',
            label: t('admin.forms.openPublicForm'),
            to: publicFormPreviewPath.value,
            external: true,
            icon: 'i-lucide-external-link',
            attrs: { 'aria-label': t('admin.forms.openPublicFormNewTab') }
        });
    }
    return tools;
});

/**
 * The one reason line of row 1, only for what blocks the page's action; one line that
 * never wraps (the full text as `title`). The ids stay the targets of `aria-describedby`.
 */
const headReason = computed<{ id: string, text: string, settingsLink?: boolean, test?: string } | null>(() => {
    if (canInspectDraftFields.value && publishForbidden.value) {
        return { id: 'editor-publish-forbidden', text: t('errors.schema.publishForbidden') };
    }
    if (canInspectDraftFields.value && publishOrganisationMissing.value) {
        // The sentence is the lock's name and the description of
        // "Veröffentlichen"; it ended with "… ordnen Sie im Editor zu:", pointing at a link a screen reader
        // does not hear with it. In the editor it names the place itself; the popover's button
        // "Formular-Einstellungen" follows it. (The form's page keeps its sentence with the link inside.)
        return { id: 'editor-publish-organisation', text: t('admin.forms.publishOrganisationMissingInEditor'), settingsLink: true, test: 'publish-organisation-missing' };
    }
    if (isPublishedSchema.value) {
        return { id: 'schema-published-read-only-alert', text: t('admin.forms.publishedReadOnlyDescription') };
    }
    return null;
});

// The editor is a full bleed work mode; the panel gives its body to it while the page is open.
const dashboardFullBleed = useDashboardFullBleed();
dashboardFullBleed.value = true;
onUnmounted(() => {
    dashboardFullBleed.value = false;
});

const publicFormPreviewPath = computed(() => publicFormPath({
    id: schemaId,
    jurisdictionSlug: currentWorkspace.value?.jurisdictionSlug,
    organisationSlug: currentWorkspace.value?.organisationSlug
}));

const referencePatternTokenRows = computed(() => {
    const rows = REFERENCE_PATTERN_TOKENS.map(token => ({
        token: `{${token}}`,
        label: t(`admin.forms.referencePattern.tokens.${token}`)
    }));
    rows.splice(3, 0, {
        token: '{SEQ:N}',
        label: t('admin.forms.referencePattern.tokens.SEQ_PADDED')
    });
    return rows;
});

const referencePatternPreview = computed(() =>
    renderReferencePatternPreview(referencePattern.value, { sequence: 1 })
);

// The rendered reference is written to a 64-char field; warn before it would
// truncate at citizen submit time. Measured against a worst-case sequence +
// full-width uuid so a pattern that fits at seq 1 but overflows as the counter
// grows is still caught (the visible preview keeps sequence 1 for readability).
const referencePatternTooLong = computed(() =>
    renderReferencePatternPreview(referencePattern.value, { sequence: 9999999, uuidShort: '12345678' })
        .length > REFERENCE_NUMBER_MAX_LENGTH
);

// {TYPO} tokens render literally into every reference number — surface them.
const referencePatternUnknownTokens = computed(() =>
    findUnknownReferenceTokens(referencePattern.value)
);

const selectedFieldDetails = computed(() => {
    if (!editableSchema.value || !selectedField.value) return null;

    for (const section of editableSchema.value.sections) {
        if (section.id !== selectedField.value.sectionId) continue;

        const field = section.fields.find(item => item.id === selectedField.value?.fieldId);
        if (!field) return null;

        return {
            section,
            field,
            sectionId: section.id,
            fieldId: field.id
        };
    }

    return null;
});

const sourceTypeLabel = computed(() => {
    const type = editableSchema.value?.source?.type || 'unknown';
    const labels: Record<string, string> = {
        'fim-json-schema': t('admin.forms.sourceFim'),
        'pdf': t('admin.forms.sourcePdf'),
        'image': t('admin.forms.sourceImage'),
        'text': t('admin.forms.sourceText'),
        'manual': t('admin.forms.sourceManual'),
        'unknown': t('admin.forms.sourceUnknown')
    };

    return labels[type] || labels.unknown;
});

/*
 * One notion of saving. The autosave and its request are
 * unchanged; the head says the truth about the last change where "Speichern" stood:
 * - a change is "saved" only when the version of the last successful save is the current one;
 * - a failed request says why: network (a retry can work), conflict (only a reload helps),
 *   refusal (the reason), or a setting that blocks every save (the retention value).
 */
/** `fieldId` when the refusal names a field (a condition with a blank value). */
type SaveProblem = { kind: 'failed' | 'conflict' | 'forbidden' | 'invalid', reason?: string, fieldId?: string, missingLabel?: boolean };
const saveProblem = ref<SaveProblem | null>(null);
/** `editorMutationVersion` at the last successful save (the loaded form counts as saved). */
const savedMutationVersion = ref(0);
const retryingSave = ref(false);
const lastSavedTime = computed(() => lastSavedAt.value
    ? new Intl.DateTimeFormat(locale.value === 'en' ? 'en-GB' : 'de-DE', { hour: '2-digit', minute: '2-digit' }).format(lastSavedAt.value)
    : '');
const saveState = computed<'saved' | 'saving' | 'pending' | SaveProblem['kind']>(() => {
    // The retry keeps its button (with its spinner) while it runs.
    if (retryingSave.value) return 'failed';
    if (isSaving.value || autosaveTimer.value !== null) return 'saving';
    if (saveProblem.value) return saveProblem.value.kind;
    return editorMutationVersion.value === savedMutationVersion.value ? 'saved' : 'pending';
});

/*
 * An autosave rendered the editor page and the whole form, because the page's template
 * read the save state ("Speichert …", "Gespeichert"), "+ Feld" and "+ Abschnitt" read `isSaving`, and
 * the chat tool's disabled state came with a new list of tools. The save state is read by its own
 * component (`saveStateSource`), the chat tool carries the flag itself (`busy`). Failures still render
 * the page where it shows their action.
 *
 * "+ Feld" and "+ Abschnitt" were `aria-disabled` while a save was in
 * flight (0.1 to 0.4 s, 2.3 s on a slow line), and a click then did nothing and said nothing. They act at
 * once, as a move, a delete or typing in the inspector already do during a save. That is safe with
 * the save as it is: the save remembers `editorMutationVersion` when it starts; when the person changed
 * anything meanwhile, its answer is not applied (`applyPersistedSchema` would put back the schema without
 * the new field), and the autosave the change schedules waits for the running save (`hasPendingAutosave`)
 * and then sends the whole schema with `expectedChanged` from that save's answer, so our own two saves
 * never meet as a conflict (409). A queued click would act later, at a moment the person did not choose,
 * and take the focus into a new field's label; nothing is queued.
 */
const saveStateSource = { state: saveState, savedAt: lastSavedTime };

/** A save state that shows an action of its own (row 1 gives way to it below sm). */

/*
 * An empty label is a save problem bound to a field, and every such
 * problem used to be taken for a refused condition: the head's button said "Zur Bedingung", the
 * inspector got the reason as `conditionRefusal`, whose watcher opens the group "Anzeige" to show it
 * beside the condition, and the card got the condition's mark. A missing label is said once at the
 * label (its input's error) and in the head; only a refused condition goes to "Anzeige".
 */
const refusedCondition = computed(() => saveProblem.value?.fieldId && !saveProblem.value.missingLabel ? saveProblem.value : null);

/** Opens the refused field's condition (group "Anzeige"), the field in view. */
function revealRefusedCondition(fieldId: string) {
    const sectionId = editableSchema.value?.sections.find(section => section.fields.some(field => field.id === fieldId))?.id;
    if (sectionId) jumpToAuthoringIssue({ fieldId, sectionId }, 'display');
}

/** The one action of an "invalid" save state: the refused field, else the form settings. */
function onSaveProblemAction() {
    const problem = saveProblem.value;
    const fieldId = problem?.fieldId;
    if (fieldId && problem?.missingLabel) revealFieldLabel(fieldId);
    else if (fieldId) revealRefusedCondition(fieldId);
    else isSettingsOpen.value = true;
}

/** The field whose label is missing, with the cursor in its label. */
function revealFieldLabel(fieldId: string) {
    const sectionId = editableSchema.value?.sections.find(section => section.fields.some(field => field.id === fieldId))?.id;
    if (!sectionId) return;
    applyFieldSelection(sectionId, fieldId);
    isInspectorOpen.value = true;
    focusInspectorLabel();
}

/*
 * An emptied label was saved after 0.8 s, the server refused it (422, "Field …
 * label" must not be empty, `FormSchema.php`, since 4 June), and the head offered a retry that could
 * not work while nothing at the field said why. An empty label is not sent: the save state names it
 * with the way to the field (no retry), and the field says at its input what is missing.
 */
function firstFieldWithoutLabel(schema: FormSchema): string | null {
    for (const section of schema.sections) {
        const field = section.fields.find(candidate => !candidate.label?.trim());
        if (field) return field.id;
    }
    return null;
}

function responseStatusCode(error: unknown): number | null {
    if (!error || typeof error !== 'object') return null;
    const candidate = error as {
        statusCode?: unknown
        status?: unknown
        response?: { status?: unknown }
    };
    if (typeof candidate.statusCode === 'number') return candidate.statusCode;
    if (typeof candidate.status === 'number') return candidate.status;
    return typeof candidate.response?.status === 'number' ? candidate.response.status : null;
}

function replaceRejectedSources(schema: FormSchema) {
    applyingPersistedEditorState = true;
    try {
        editableSchema.value = schema;
        reconcileSelectedField(schema);
    } finally {
        applyingPersistedEditorState = false;
    }
    authoritativeEditorStateVersion.value += 1;
}

async function reloadPersistedSchemaAfterDeleteConflict() {
    await refresh();
    const refreshedSchema = parseResponseSchema();
    if (!refreshedSchema) {
        throw new Error('errors.admin.schemaLoadFailed');
    }
    applyPersistedSchema(refreshedSchema, {
        publicationScope: parseResponsePublicationScope(),
        referencePattern: parseResponseReferencePattern()
    });
    lastKnownSchemaChanged.value = schemaResponse.value?.data?.attributes?.changed ?? lastKnownSchemaChanged.value;
}

function contextSourceKey(source: Pick<FormContextSource, 'type' | 'id'>): string {
    return `${source.type}:${source.id}`;
}

function saveProblemFor(error: unknown): SaveProblem {
    const status = responseStatusCode(error);
    if (status === 409) return { kind: 'conflict' };
    if (status === 403) return { kind: 'forbidden', reason: resolveApiErrorMessage(error) };
    return { kind: 'failed' };
}

const selectedFieldChatTitle = computed(() =>
    selectedFieldDetails.value?.field.label || schemaLabel.value
);

/*
 * The chat window's place was a style the page's template read, so every pointer move
 * while dragging it rendered the whole editor page (and the form with it), without a frame limit. The
 * template reads it no more; a watcher writes it to the window itself, and a drag decides the place
 * at most once per animation frame.
 */
function applyFloatingChatPosition() {
    const element = floatingChat.value;
    if (!element) return;
    element.style.top = `${floatingChatPosition.value.top}px`;
    element.style.left = `${floatingChatPosition.value.left}px`;
    element.style.width = `${getFloatingChatWidth()}px`;
}
watch([floatingChat, floatingChatPosition], applyFloatingChatPosition, { flush: 'post' });

/*
 * With the template no longer reading the window's place,
 * a resized browser left the open chat's width (and a place outside the window) as they were
 * until the next move. A resize keeps the place inside the window and writes place and width, at
 * most once per animation frame.
 */
let chatResizeFrame: number | null = null;
function onWindowResizeForChat() {
    if (chatResizeFrame !== null) return;
    chatResizeFrame = requestAnimationFrame(() => {
        chatResizeFrame = null;
        if (!floatingChat.value) return;
        clampFloatingChatPosition(floatingChatPosition.value.top, floatingChatPosition.value.left);
        applyFloatingChatPosition();
    });
}
onMounted(() => window.addEventListener('resize', onWindowResizeForChat));
onUnmounted(() => {
    window.removeEventListener('resize', onWindowResizeForChat);
    if (chatResizeFrame !== null) cancelAnimationFrame(chatResizeFrame);
    chatResizeFrame = null;
});

const lastChangeSummaryText = computed(() =>
    lastSchemaChange.value ? formatSchemaChangeSummary(lastSchemaChange.value.summary) : ''
);

const schemaAuthoringIssues = computed(() =>
    editableSchema.value ? collectSchemaAuthoringIssues(editableSchema.value) : []
);
const blockingSchemaAuthoringIssues = computed(() =>
    schemaAuthoringIssues.value.filter(issue => issue.severity === 'blocking')
);

/** One entry per affected field, in the form's order, with its section's title. */
function authoringIssueLinks<T extends { fieldId: string, sectionId?: string, fieldLabel?: string, code?: string }>(issues: T[]): IssueEntry[] {
    const sections = editableSchema.value?.sections ?? [];
    const byField = new Map<string, IssueEntry>();
    for (const issue of issues) {
        if (byField.has(issue.fieldId)) continue;
        const section = sections.find(candidate => candidate.id === issue.sectionId)
          ?? sections.find(candidate => candidate.fields.some(field => field.id === issue.fieldId));
        byField.set(issue.fieldId, {
            fieldId: issue.fieldId,
            sectionId: section?.id,
            fieldLabel: issue.fieldLabel || issue.fieldId,
            sectionTitle: section ? (section.title || section.id) : '',
            code: issue.code,
            description: issue.code && NAMED_ISSUE_CODES.has(issue.code as SchemaAuthoringIssue['code'])
                ? t(`admin.fieldInspector.authoringIssues.${issue.code}`)
                : undefined
        });
    }
    const order = new Map(sections.flatMap(section => section.fields.map(field => field.id)).map((id, index) => [id, index]));
    return [...byField.values()].sort((a, b) => (order.get(a.fieldId) ?? 0) - (order.get(b.fieldId) ?? 0));
}

/**
 * One group per kind of finding in the overview, each with the
 * complete list. The kinds follow the inspector group that answers them; a jump opens it.
 * The ids stay the targets of `aria-describedby` on "Veröffentlichen".
 */
const ISSUE_KINDS: Array<{ key: string, id: string, codes: SchemaAuthoringIssue['code'][] | 'rest', icon: string, inspectorGroup: string }> = [
    { key: 'privacy', id: 'schema-authoring-risk-alert', codes: ['high_risk_unmarked', 'personal_data_classification_missing'], icon: 'i-lucide-shield-alert', inspectorGroup: 'privacy' },
    { key: 'reuse', id: 'schema-authoring-warning-alert', codes: ['risky_crm_key'], icon: 'i-lucide-shield-question', inspectorGroup: 'profile' },
    { key: 'duplicate', id: 'schema-duplicate-key-alert', codes: ['duplicate_crm_key'], icon: 'i-lucide-copy', inspectorGroup: 'profile' },
    { key: 'inactive', id: 'schema-inactive-check-alert', codes: ['staff_prompt_inactive'], icon: 'i-lucide-file-search', inspectorGroup: 'attachments' },
    { key: 'attachments', id: 'schema-attachment-check-alert', codes: ['purpose_bound_needs_sovereign', 'purpose_bound_compare_invalid'], icon: 'i-lucide-file-search', inspectorGroup: 'attachments' },
    // A finding no kind names still gets a badge: "Veröffentlichen" is never locked without one.
    { key: 'other', id: 'schema-authoring-other-alert', codes: 'rest', icon: 'i-lucide-circle-alert', inspectorGroup: '' }
];
const NAMED_ISSUE_CODES = new Set(ISSUE_KINDS.flatMap(kind => kind.codes === 'rest' ? [] : kind.codes));
// Conditions citizens' forms do not honour, with a jump to the field.
/*
 * Conditions whose source changed its kind in this editing session (a choice that became free
 * text, a number that became text). A stored schema keeps no earlier type, so these notes live only
 * here; they end when the condition is edited or the source gets its old kind back (undo).
 */
const conditionTypeChanges = ref<ConditionTypeChange[]>([]);
const brokenFormConditions = computed(() => editableSchema.value ? brokenConditions(editableSchema.value, conditionTypeChanges.value, t('admin.fieldInspector.untitledField')) : []);

function noteConditionTypeChanges(after: FormSchema, effects: ConditionTypeChangeEffect[]) {
    const notes = conditionTypeChangeNotes(after, effects);
    if (notes.length === 0) return;
    conditionTypeChanges.value = [
        ...conditionTypeChanges.value.filter(note => !notes.some(next => next.fieldId === note.fieldId)),
        ...notes
    ];
}
const authoringIssueGroups = computed<EditorIssueGroup[]>(() => {
    const groups: EditorIssueGroup[] = [];
    for (const kind of ISSUE_KINDS) {
        const codes = kind.codes;
        const issues = schemaAuthoringIssues.value.filter(issue => codes === 'rest' ? !NAMED_ISSUE_CODES.has(issue.code) : codes.includes(issue.code));
        const links = authoringIssueLinks(issues);
        if (kind.key === 'inactive') {
            // A stored upload or legacy instruction can also be switched off without a staff finding.
            for (const section of editableSchema.value?.sections ?? []) {
                for (const field of section.fields) {
                    if (field.type !== 'file' || !field.analysis) continue;
                    if (!formFeatures?.attachmentCheckConfiguration(field.analysis).inactive) continue;
                    const description = t('admin.forms.overview.inactiveDescription');
                    const existing = links.find(link => link.fieldId === field.id);
                    if (existing) existing.description = description;
                    else links.push({ fieldId: field.id, sectionId: section.id, fieldLabel: field.label || field.id, sectionTitle: section.title || section.id, description });
                }
            }
        }
        if (!links.length) continue;
        groups.push({
            id: kind.id,
            tone: kind.key === 'duplicate' || issues.some(issue => issue.severity === 'blocking') ? 'error' : 'warning',
            icon: kind.icon,
            label: t(`admin.forms.issueBadge.${kind.key}`, { count: links.length }, links.length),
            markText: t(`admin.forms.issueMark.${kind.key}`),
            note: kind.key === 'privacy' ? t('admin.forms.issueNote.privacy') : undefined,
            inspectorGroup: kind.inspectorGroup,
            issues: links
        });
    }
    const missingEntries: IssueEntry[] = [];
    for (const section of editableSchema.value?.sections ?? []) {
        for (const field of section.fields) {
            if (field.type !== 'file' || !field.analysis) continue;
            const missing = formFeatures?.attachmentCheckConfiguration(field.analysis).missingEntries;
            if (missing?.length) missingEntries.push({
                fieldId: field.id, sectionId: section.id, fieldLabel: field.label || field.id,
                sectionTitle: section.title || section.id,
                description: missing.map(key => t('admin.fieldInspector.attachmentAnalysis.' + key)).join(' ')
            });
        }
    }
    if (missingEntries.length) groups.push({
        id: 'schema-missing-result-entries', tone: 'warning', icon: 'i-lucide-list-checks',
        label: t('admin.forms.issueBadge.missingEntries', { count: missingEntries.length }, missingEntries.length),
        markText: t('admin.forms.issueMark.missingEntries'), inspectorGroup: 'resultList', issues: missingEntries
    });
    const conditions = authoringIssueLinks(brokenFormConditions.value);
    if (conditions.length > 0) {
        groups.push({
            id: 'schema-condition-alert',
            tone: 'warning',
            icon: 'i-lucide-git-branch',
            label: t('admin.forms.issueBadge.condition', { count: conditions.length }, conditions.length),
            markText: t('admin.forms.issueMark.condition'),
            inspectorGroup: 'display',
            issues: conditions
        });
    }
    return groups;
});
// Retain the review status when the inspector closes or switches between sheet and column.
provide('attachment-instruction-baselines', new Map<string, string>());
provide('attachment-review-scope', computed(() => user.value?.uid
    ? JSON.stringify([user.value.uid, selectedWorkspaceKey.value, schemaId])
    : undefined));
const overview = useTemplateRef('overview');
let overviewFieldId: string | undefined;

const formBlockers = computed<FormBlocker[]>(() => {
    if (!canInspectDraftFields.value) return [];
    const reasons: FormBlocker[] = [];
    if (publishForbidden.value) reasons.push({ id: 'permission', text: t('errors.schema.publishForbidden') });
    if (publishOrganisationMissing.value) reasons.push({
        id: 'office', text: t('admin.forms.publishOrganisationMissingInEditor'),
        action: { label: t('admin.forms.formSettings'), run: () => {
            isSettingsOpen.value = true;
        } }
    });
    if (saveState.value !== 'saved') {
        const problem = saveProblem.value;
        const action = problem?.kind === 'invalid'
            ? { label: t(problem.fieldId ? (problem.missingLabel ? 'admin.forms.saveState.toLabel' : 'admin.forms.saveState.toCondition') : 'admin.forms.formSettings'), run: onSaveProblemAction }
            : undefined;
        reasons.push({ id: 'save', text: problem?.reason || t('admin.forms.overview.saveBeforePublish'), action });
    }
    return reasons;
});
const publishBlockerCount = computed(() => formBlockers.value.length + authoringIssueGroups.value
    .filter(group => group.tone === 'error').reduce((count, group) => count + group.issues.length, 0));
const hintCount = computed(() => authoringIssueGroups.value
    .filter(group => group.tone === 'warning').reduce((count, group) => count + group.issues.length, 0));
const openPointCount = computed(() => publishBlockerCount.value + hintCount.value);

async function openOverviewIssues() {
    overviewFieldId = undefined;
    selectedField.value = null;
    isInspectorOpen.value = false;
    await nextTick();
    overview.value?.showIssues();
}

function jumpFromOverview(issue: Pick<IssueEntry, 'fieldId' | 'sectionId' | 'code'>, group?: string) {
    if (!isDraftInspectActive.value || isProcessing.value) return;
    overviewFieldId = issue.fieldId;
    jumpToAuthoringIssue(issue, group);
}

/** "Veröffentlichen" is described by every badge that blocks it. */
const publishBlockingIssueIds = computed(() => authoringIssueGroups.value
    .filter(group => group.tone === 'error')
    .map(group => group.id)
    .concat(publishOrganisationMissing.value ? ['editor-publish-organisation'] : [])
    .join(' '));

/** The small mark at every field with a finding (renderer slot `draft-field-mark`). */
const fieldIssueMarks = computed(() => {
    const marks = new Map<string, { tone: 'error' | 'warning', icon: string, text: string }>();
    // The field whose condition the last save was refused for.
    const refusedFieldId = refusedCondition.value?.fieldId;
    if (refusedFieldId) marks.set(refusedFieldId, { tone: 'error', icon: 'i-lucide-git-branch', text: t('admin.forms.conditionValueEmptyMark') });
    // The field without a label carries a mark in its own words, not the condition's.
    const unlabelledFieldId = saveProblem.value?.missingLabel ? saveProblem.value.fieldId : undefined;
    if (unlabelledFieldId) marks.set(unlabelledFieldId, { tone: 'error', icon: 'i-lucide-circle-alert', text: t('admin.forms.labelMissingMark') });
    for (const group of authoringIssueGroups.value) {
        for (const issue of group.issues) {
            const current = marks.get(issue.fieldId);
            if (!current) {
                marks.set(issue.fieldId, { tone: group.tone, icon: group.icon, text: group.markText });
            } else {
                current.text = `${current.text}; ${group.markText}`;
                if (group.tone === 'error' && current.tone !== 'error') {
                    current.tone = 'error';
                    current.icon = group.icon;
                }
            }
        }
    }
    /*
     * A field of type "Auswahl" or "Einzelauswahl" without any
     * answer option was saved and its card showed no sign; only the inspector, at the options, said
     * "Eine Auswahl braucht mindestens eine Antwortmöglichkeit." Its card carries a mark, worded like
     * the findings' marks ("Ohne Datenschutz-Einstufung": "Ohne Antwortmöglichkeit"). Saving and publishing
     * are unchanged.
     */
    for (const section of editableSchema.value?.sections ?? []) {
        for (const field of section.fields) {
            if ((field.type !== 'select' && field.type !== 'radio') || field.options?.length) continue;
            const text = t('admin.forms.issueMark.options');
            const current = marks.get(field.id);
            if (current) current.text = `${current.text}; ${text}`;
            else marks.set(field.id, { tone: 'warning', icon: 'i-lucide-circle-alert', text });
        }
    }
    return marks;
});

useHead({
    title: computed(() => `${editorPageName.value} - ${schemaLabel.value} - beantragt.ai`)
});

function createMessageId(): string {
    return `msg-${Date.now()}-${++messageCounter}`;
}

function normalizeEditorIdToken(value: string): string {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/ß/g, 'ss')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .replace(/_+/g, '_');
}

function collectSchemaIds(schema: FormSchema): Set<string> {
    const ids = new Set<string>();

    for (const section of schema.sections) {
        ids.add(section.id);
        for (const field of section.fields) {
            ids.add(field.id);
        }
    }

    return ids;
}

function createUniqueSchemaId(base: string, usedIds: Set<string>): string {
    const normalizedBase = normalizeEditorIdToken(base) || 'item';
    let candidate = normalizedBase;
    let suffix = 2;

    while (usedIds.has(candidate)) {
        candidate = `${normalizedBase}_${suffix}`;
        suffix += 1;
    }

    usedIds.add(candidate);
    return candidate;
}

function addMessage(
    role: 'user' | 'assistant',
    content: string,
    options: { sendToAi?: boolean, scopeKey?: string, aiContent?: string } = {}
) {
    chatMessageStore.value.push({
        id: createMessageId(),
        role,
        content,
        sendToAi: options.sendToAi ?? role === 'user',
        scopeKey: options.scopeKey ?? activeChatScopeKey.value,
        aiContent: options.aiContent
    });
}

function chatHistoryForScope(scopeKey: string): Array<Pick<EditorChatMessage, 'role' | 'content'>> {
    return chatMessageStore.value
        .filter(message => message.scopeKey === scopeKey && message.sendToAi !== false)
        .map(message => ({ role: message.role, content: message.aiContent ?? message.content }));
}

function findFieldLabel(fieldId: string): string | undefined {
    for (const section of editableSchema.value?.sections ?? []) {
        const field = section.fields.find(item => item.id === fieldId);
        if (field) return field.label;
    }
    return undefined;
}

function editorActionAiContent(kind: EditorActionKind, status: EditorActionStatus = 'applied'): string {
    return JSON.stringify({ editorAction: kind, status });
}

function retireFieldChatScope(fieldId: string) {
    fieldChatGenerations.value = {
        ...fieldChatGenerations.value,
        [fieldId]: (fieldChatGenerations.value[fieldId] ?? 0) + 1
    };
}

function retireDeletedFieldChatScopes(previousSchema: FormSchema, nextSchema: FormSchema) {
    const nextFieldIds = new Set(nextSchema.sections.flatMap(section =>
        section.fields.map(field => field.id)
    ));
    for (const section of previousSchema.sections) {
        for (const field of section.fields) {
            if (!nextFieldIds.has(field.id)) {
                retireFieldChatScope(field.id);
            }
        }
    }
}

function copySelectedFieldLocation(): FieldLocation | null {
    return selectedField.value
        ? { ...selectedField.value }
        : null;
}

function formatFieldChangeLabel(key: FieldChangeKey): string {
    return t(`admin.forms.changeFields.${key}`);
}

function formatSchemaChangeSummary(summary: SchemaChangeSummary): string {
    switch (summary.kind) {
        case 'field_updated':
            return t('admin.forms.changeFieldUpdated', {
                label: summary.fieldLabel,
                changes: summary.changes.map(formatFieldChangeLabel).join(', ')
            });

        case 'field_deleted':
            return t('admin.forms.changeFieldDeleted', {
                label: summary.fieldLabel
            });

        case 'field_added':
            return t('admin.forms.changeFieldAdded', {
                label: summary.fieldLabel
            });

        case 'schema_updated':
            return t('admin.forms.changeSchemaUpdated', {
                sections: summary.sections,
                fields: summary.fields
            }, summary.sections);

        case 'field_moved':
            return summary.toSectionTitle !== undefined && summary.toPosition !== undefined
                ? t('admin.forms.structure.changeFieldMovedTo', { label: summary.fieldLabel, section: summary.toSectionTitle, position: summary.toPosition })
                : t('admin.forms.structure.changeFieldMoved', { label: summary.fieldLabel });

        case 'section_moved':
            return summary.toPosition !== undefined
                ? t('admin.forms.structure.changeSectionMovedTo', { title: summary.sectionTitle, position: summary.toPosition })
                : t('admin.forms.structure.changeSectionMoved', { title: summary.sectionTitle });

        case 'section_deleted':
            return t('admin.forms.structure.changeSectionDeleted', { title: summary.sectionTitle });

        case 'section_updated':
            return t('admin.forms.structure.changeSectionUpdated', { title: summary.sectionTitle });

        case 'group_moved':
            return summary.toSectionTitle !== undefined
                ? t('admin.forms.structure.changeGroupMovedTo', { label: summary.groupLabel, section: summary.toSectionTitle })
                : t('admin.forms.structure.changeGroupMoved', { label: summary.groupLabel });

        case 'group_deleted':
            return t('admin.forms.structure.changeGroupDeleted', { label: summary.groupLabel });

        case 'no_change':
            return t('admin.forms.editNoChange');
    }
}

/**
 * The visible answer beside "Rückgängig" says what changed FIRST, without the
 * constant "Letzte Änderung: " (the place beside the button says that), so the informative part
 * stands where the room is. The long names come last, where a cut costs least. The full sentence
 * (`formatSchemaChangeSummary` in "Letzte Änderung: …") stays for the live region and the popover.
 */
function formatSchemaChangeAnswer(summary: SchemaChangeSummary): string {
    switch (summary.kind) {
        case 'field_updated':
            return t('admin.forms.answer.fieldUpdated', { label: summary.fieldLabel, changes: summary.changes.map(formatFieldChangeLabel).join(', ') });
        case 'field_deleted':
            return t('admin.forms.answer.fieldDeleted', { label: summary.fieldLabel });
        case 'field_added':
            return t('admin.forms.answer.fieldAdded', { label: summary.fieldLabel });
        case 'field_moved':
            return summary.toSectionTitle !== undefined && summary.toPosition !== undefined
                ? t('admin.forms.answer.fieldMovedTo', { label: summary.fieldLabel, section: summary.toSectionTitle, position: summary.toPosition })
                : t('admin.forms.answer.fieldMoved', { label: summary.fieldLabel });
        case 'section_moved':
            return summary.toPosition !== undefined
                ? t('admin.forms.answer.sectionMovedTo', { title: summary.sectionTitle, position: summary.toPosition })
                : t('admin.forms.answer.sectionMoved', { title: summary.sectionTitle });
        case 'section_deleted':
            return t('admin.forms.answer.sectionDeleted', { title: summary.sectionTitle });
        case 'section_updated':
            return t('admin.forms.answer.sectionUpdated', { title: summary.sectionTitle });
        case 'group_moved':
            return summary.toSectionTitle !== undefined
                ? t('admin.forms.answer.groupMovedTo', { label: summary.groupLabel, section: summary.toSectionTitle })
                : t('admin.forms.answer.groupMoved', { label: summary.groupLabel });
        case 'group_deleted':
            return t('admin.forms.answer.groupDeleted', { label: summary.groupLabel });
        default:
            return formatSchemaChangeSummary(summary);
    }
}

/**
 * Undo answers visibly. After every change and every undo a short text
 * stands beside "Rückgängig" for a few seconds; after deleting a field, a section or an
 * address group the same place offers "Wiederherstellen" (the same single undo step).
 * Screen readers hear the full sentence once from the live region; the short visible text is
 * a button whose popover holds that sentence.
 */
const UNDO_FEEDBACK_MS = 4000;
const RESTORE_OFFER_MS = 10000;
const RESTORABLE_KINDS = new Set<SchemaChangeSummary['kind']>(['field_deleted', 'section_deleted', 'group_deleted']);
const undoFeedback = ref<{ text: string, full: string, restore: boolean, key: number } | null>(null);
/** The popover with the full sentence, and the answer's element (see `answerHeld`). */
const answerDetailsOpen = ref(false);
const undoAnswer = ref<HTMLElement | null>(null);

/** The answer stays while its popover is open or the focus is in it, so the focus never vanishes with it. */
function answerHeld(): boolean {
    if (answerDetailsOpen.value || (!!undoAnswer.value && undoAnswer.value.contains(document.activeElement))) return true;
    // While the keyboard focus is anywhere in row 2 ("Rückgängig", the answer,
    // "Wiederherstellen", the badges, the tools) the answer stays: nobody races a timer to it.
    return !!document.querySelector('[data-test="editor-head-row"][data-row="2"]')?.contains(document.activeElement);
}

/*
 * The one named way from the form to the answer. Alt+Z on the form (the field cards)
 * puts the focus on the answer's button, where Enter opens the full sentence and "Wiederherstellen"
 * is one Tab further; where the answer is the toast, on the toasts (which then pause, the framework's
 * behaviour); without an answer, on "Rückgängig". The keyboard help names it.
 */
function onCanvasKeydown(event: KeyboardEvent) {
    if (!event.altKey || event.ctrlKey || event.metaKey || event.code !== 'KeyZ') return;
    event.preventDefault();
    let target: HTMLElement | null = null;
    if (undoFeedback.value) {
        target = answerInRow.value
            ? document.querySelector<HTMLElement>('[data-test="editor-undo-feedback-text"]')
            : document.querySelector<HTMLElement>('[data-slot="viewport"]');
    }
    if (target) {
        target.focus();
        return;
    }
    // With no answer and nothing to undo (right after "Wiederherstellen") Alt+Z did
    // nothing. "Rückgängig" stays focusable then (aria-disabled), and the live region says where the
    // focus is and why nothing else happens.
    document.querySelector<HTMLElement>('[data-test="editor-undo"]')?.focus();
    if (!lastSchemaChange.value && !pendingInspectorUndo.value) announceStructure(t('admin.forms.altZNothingToUndo'));
}

/** The answer goes at once, in row 2 and as the phone's toast. */
function endUndoFeedback() {
    if (undoFeedbackTimer) clearTimeout(undoFeedbackTimer);
    undoFeedbackTimer = null;
    undoFeedback.value = null;
    toast.remove(UNDO_ANSWER_TOAST_ID);
}

function scheduleUndoFeedbackEnd(duration: number) {
    if (undoFeedbackTimer) clearTimeout(undoFeedbackTimer);
    undoFeedbackTimer = setTimeout(() => {
        if (answerHeld()) {
            scheduleUndoFeedbackEnd(UNDO_FEEDBACK_MS);
            return;
        }
        undoFeedback.value = null;
        undoFeedbackTimer = null;
    }, duration);
}
let undoFeedbackTimer: ReturnType<typeof setTimeout> | null = null;
let undoFeedbackKey = 0;

/**
 * Below `sm` row 2 has no room for the answer (its place pushed the badges and
 * "Mehr" out of the 390 px screen). There the answer is the framework's toast: it takes no room
 * in the row, nothing in the head moves, the whole sentence is readable, and "Wiederherstellen"
 * is its action. One toast (one id) carries each new answer.
 */
const UNDO_ANSWER_TOAST_ID = 'editor-undo-answer';

/*
 * The answer stands in the row only where its place has room for "Wiederherstellen"
 * whole (129 px measured) and the start of the text; else it is the toast, at any width. The place's
 * width comes from the head (0 below sm, where the place is not shown).
 */
const ANSWER_MIN_ROOM = 176;
const answerRoom = ref(Number.POSITIVE_INFINITY);
const answerInRow = computed(() => hasRowRoom.value && answerRoom.value >= ANSWER_MIN_ROOM);

function showUndoFeedback(text: string, full = text, restore = false) {
    undoFeedbackKey += 1;
    undoFeedback.value = { text, full, restore, key: undoFeedbackKey };
    answerDetailsOpen.value = false;
    const duration = restore ? RESTORE_OFFER_MS : UNDO_FEEDBACK_MS;
    scheduleUndoFeedbackEnd(duration);
    if (!answerInRow.value) {
        // The toast has room for the whole sentence; it wraps.
        toast.add({
            id: UNDO_ANSWER_TOAST_ID,
            title: full,
            duration,
            actions: restore
                ? [{ label: t('admin.forms.restoreDeleted'), onClick: () => void undoLastSchemaChange() }]
                : undefined
        });
    }
}

onUnmounted(() => {
    if (undoFeedbackTimer) clearTimeout(undoFeedbackTimer);
});

function registerSchemaChange(
    previousSchema: FormSchema,
    nextSchema: FormSchema,
    previousSelectedField: FieldLocation | null,
    /** Structure edits name their change; the diff cannot tell a reorder apart. */
    summaryOverride?: SchemaChangeSummary
): SchemaChangeSummary | null {
    const summary = summaryOverride ?? summarizeSchemaChange(previousSchema, nextSchema, previousSelectedField);
    if (summary.kind === 'no_change') return null;
    // A chat edit can change a type too; its broken conditions are noted like the inspector's.
    noteConditionTypeChanges(nextSchema, conditionTypeChangeEffects(previousSchema, nextSchema, t('admin.fieldInspector.untitledField')));

    lastSchemaChange.value = {
        previousSchema,
        previousSelectedField,
        previousFieldChatGenerations: { ...fieldChatGenerations.value },
        summary
    };
    /*
     * With an emptied label row 2 said "Beschriftung geändert: …" (on the
     * phone a toast) while row 1 said "Nicht gespeichert". A form with a field without a label is not
     * saved (`saveCurrentSchema`), so no change is answered as done while one is missing: the answer that
     * may still stand goes, and only the save state speaks (its own live region names the reason). The
     * change is kept for "Rückgängig".
     */
    if (firstFieldWithoutLabel(nextSchema)) {
        endUndoFeedback();
        return summary;
    }
    // The visible "Letzte Änderung" line is gone; the summary is announced
    // here, and moves and deletes announce their own sentence after it.
    const changeText = t('admin.forms.lastChange', { summary: formatSchemaChangeSummary(summary) });
    announceStructure(changeText);
    showUndoFeedback(formatSchemaChangeAnswer(summary), changeText, RESTORABLE_KINDS.has(summary.kind));

    return summary;
}

function focusChangedField(summary: SchemaChangeSummary) {
    if (summary.kind !== 'field_added' && summary.kind !== 'field_updated') return;

    selectedField.value = {
        sectionId: summary.sectionId,
        fieldId: summary.fieldId
    };
    isInspectorOpen.value = true;
    nextTick(() => {
        focusSelectedField();
    });
}

/** Selects the field behind an authoring issue, scrolls to it and opens the inspector. */
/** The open inspector, so a jump can open the group that answers the finding. */
const fieldInspector = ref<{ revealGroup?: (group: string) => Promise<void>, focusType?: () => Promise<void> } | null>(null);

/*
 * Below 1280 px the inspector lives in the sheet, which mounts its content a moment
 * after it opens. The jump waited one tick, found no inspector, focused the field in the form,
 * outside the non-modal sheet, and the sheet closed again. It waits for the inspector (at most
 * a second), then opens the group of the finding as from 1280 px.
 */
function mountedInspector(): Promise<typeof fieldInspector.value> {
    if (fieldInspector.value?.revealGroup) return Promise.resolve(fieldInspector.value);
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            stop();
            resolve(fieldInspector.value);
        }, 1000);
        const stop = watch(fieldInspector, (inspector) => {
            if (!inspector?.revealGroup) return;
            clearTimeout(timer);
            stop();
            resolve(inspector);
        });
    });
}

function jumpToAuthoringIssue(issue: Pick<SchemaAuthoringIssue, 'fieldId' | 'sectionId'> & { code?: string }, inspectorGroup?: string) {
    if (isEditorMutationLocked.value || isProcessing.value) return;
    const sections = editableSchema.value?.sections ?? [];
    const sectionId = sections.some(section => section.id === issue.sectionId && section.fields.some(field => field.id === issue.fieldId))
        ? issue.sectionId
        : sections.find(section => section.fields.some(field => field.id === issue.fieldId))?.id;
    if (!sectionId) return;

    draftInspectEnabled.value = true;
    selectedField.value = { sectionId, fieldId: issue.fieldId };
    isInspectorOpen.value = true;
    nextTick(async () => {
        // A jump from a badge of the head opens the inspector's group that
        // answers the finding and puts the focus on its setting; the field comes into view.
        const inspector = inspectorGroup || overviewFieldId === issue.fieldId ? await mountedInspector() : null;
        if (inspectorGroup && inspector?.revealGroup) {
            const element = getSelectedFieldElement();
            // Instant, so the field and the setting are both in view when the group scrolls.
            if (element && element.offsetParent !== null) element.scrollIntoView?.({ behavior: 'auto', block: 'center' });
            await inspector.revealGroup(inspectorGroup);
            return;
        }
        // P3: a CRM key refusal opens the field's key control.
        if (overviewFieldId === issue.fieldId) {
            getSelectedFieldElement()?.scrollIntoView?.({ behavior: 'auto', block: 'center' });
            document.querySelector<HTMLElement>('#field-inspector [data-testid="field-inspector-title-button"], #field-inspector button')?.focus({ preventScroll: true });
            return;
        }
        if (issue.code === 'duplicate_crm_key') {
            const control = document.getElementById(`field-crm-key-${issue.fieldId}`);
            if (control) {
                control.scrollIntoView?.({ block: 'center' });
                control.focus();
                return;
            }
        }
        const element = getSelectedFieldElement();
        // A field hidden by a condition cannot be shown in the preview, so
        // move focus to the inspector instead of leaving it on the notice.
        if (!element || element.offsetParent === null) {
            document.querySelector<HTMLElement>('#field-inspector')
                ?.querySelector<HTMLElement>('input, select, textarea, button, [tabindex]:not([tabindex="-1"])')
                ?.focus();
            return;
        }
        const behavior = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
        element.scrollIntoView?.({ behavior, block: 'center' });
        element.focus({ preventScroll: true });
    });
}

function getSelectedFieldElement(): HTMLElement | null {
    const fieldId = selectedField.value?.fieldId;
    if (!fieldId) return null;

    return document.querySelector<HTMLElement>(`[data-field-id="${CSS.escape(fieldId)}"]`);
}

/**
 * Below 1280 px the inspector lies over the form as a sheet; the selected
 * field is brought into view beside it. From 1280 px nothing scrolls: nothing moved.
 */
function bringSelectedFieldIntoViewBelowXl() {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    if (window.matchMedia('(min-width: 1280px)').matches) return;
    nextTick(() => {
        getSelectedFieldElement()?.scrollIntoView?.({ block: 'nearest' });
    });
}

function focusSelectedField() {
    nextTick(() => {
        getSelectedFieldElement()?.focus();
    });
}

function blurActiveEditorField() {
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && activeElement.closest('.form-field-wrapper')) {
        activeElement.blur();
    }
}

/**
 * The chat toggle is a tool of the head: in the row from xl, in the
 * "Mehr" menu below it. Focus goes to the one that is shown.
 */
function focusChatToggle() {
    const toggle = document.querySelector<HTMLElement>('[data-test="editor-head"] [data-test="chat-toggle"]');
    const shown = toggle && toggle.offsetParent !== null ? toggle : null;
    (shown ?? document.querySelector<HTMLElement>('[data-test="editor-head-more"]') ?? toggle)?.focus();
}

function focusFloatingChat() {
    blurActiveEditorField();
    nextTick(() => {
        window.setTimeout(() => {
            const textArea = floatingChat.value?.querySelector<HTMLElement>('textarea');
            const target = textArea || floatingChat.value?.querySelector<HTMLElement>('input, [contenteditable="true"], button, [tabindex]:not([tabindex="-1"])');
            target?.focus();
        }, 0);
    });
}

function selectField(payload: {
    sectionId: string
    fieldId: string
    field: FormField
    editLabel?: boolean
}) {
    applyFieldSelection(payload.sectionId, payload.fieldId, payload.editLabel);
}

/**
 * Selection from the canvas (click, keyboard move, drop): opens the
 * inspector and lets an open chat follow, never opens the chat itself.
 */
function applyFieldSelection(sectionId: string, fieldId: string, editLabel = false) {
    overviewFieldId = undefined;
    if (!isDraftInspectActive.value || isProcessing.value) return;

    if (selectedField.value?.sectionId !== sectionId || selectedField.value?.fieldId !== fieldId) {
        flushTextCommit(true);
    }
    sheetLabelRequest = null;
    selectedField.value = { sectionId, fieldId };
    isInspectorOpen.value = true;
    bringSelectedFieldIntoViewBelowXl();
    if (editLabel && !isWideLayout.value) focusInspectorLabel();
    // Selecting is a canvas action: focus stays on the field, so Alt+Arrow and
    // Delete work right away, and the chat opens only on request (toolbar
    // button, inspector). An open chat follows the selection to the new field.
    if (isChatOpen.value) {
        nextTick(() => {
            dockFloatingChatToSelectedField();
        });
    }
}

function reconcileSelectedField(schema: FormSchema | null) {
    if (!schema || !selectedField.value) return;

    for (const section of schema.sections) {
        if (!section.fields.some(field => field.id === selectedField.value?.fieldId)) continue;
        if (section.id !== selectedField.value.sectionId) {
            selectedField.value = {
                sectionId: section.id,
                fieldId: selectedField.value.fieldId
            };
        }
        return;
    }

    selectedField.value = null;
    isInspectorOpen.value = false;
}

function buildSelectedFieldChatContext() {
    const details = selectedFieldDetails.value;
    if (!details) return undefined;

    return {
        sectionId: details.sectionId,
        fieldId: details.fieldId,
        label: details.field.label,
        type: details.field.type,
        required: details.field.required === true,
        options: details.field.options,
        format: details.field.format,
        validation: details.field.validation,
        sensitive: details.field.sensitive,
        privacy: details.field.privacy,
        widget: details.field.widget,
        analysis: details.field.analysis
    };
}

function updateSelectedField(fieldPatch: FormField): boolean {
    const details = selectedFieldDetails.value;
    if (!editableSchema.value || !details || isEditorMutationLocked.value) return false;
    const { sectionId: _sectionId, fieldId: _fieldId, ...safeFieldPatch } = fieldPatch as FormField & {
        sectionId?: string
        fieldId?: string
    };

    editableSchema.value = {
        ...editableSchema.value,
        sections: editableSchema.value.sections.map((section) => {
            if (section.id !== details.sectionId) return section;

            return {
                ...section,
                fields: section.fields.map(field =>
                    field.id === details.fieldId
                        ? {
                            ...field,
                            ...safeFieldPatch,
                            id: details.fieldId
                        }
                        : field
                )
            };
        })
    };

    return true;
}

const titleInput = useEditorTextDraft(() => editableSchema.value?.title ?? '', (text) => {
    const title = text.trim() || t('admin.forms.manualDefaultTitle');
    updateSchemaMetadata({ title });
    return title;
}, queueTextCommit);

function updateSchemaMetadata(patch: Partial<Pick<FormSchema, 'title' | 'description'>>) {
    if (!editableSchema.value || isEditorMutationLocked.value) return;

    editableSchema.value = { ...editableSchema.value, ...patch };
    lastSchemaChange.value = null;
    scheduleAutosave();
}

function schemaRetentionDaysInput(schema: FormSchema | null): string {
    const days = schema?.retention?.dataRetentionDays;
    return typeof days === 'number' ? String(days) : '';
}

function syncRetentionDaysInput(schema: FormSchema | null) {
    retentionDaysInput.value = schemaRetentionDaysInput(schema);
    retentionDaysError.value = undefined;
}

function validateRetentionDaysInput(value: string): string | undefined {
    const trimmedValue = value.trim();
    if (!trimmedValue) return undefined;

    if (!/^\d+$/.test(trimmedValue)) {
        return t('admin.forms.retention.validationError');
    }

    const days = Number(trimmedValue);
    if (!Number.isSafeInteger(days)) {
        return t('admin.forms.retention.validationError');
    }

    return undefined;
}

function applyRetentionDaysInput(rawValue: string | number) {
    if (!editableSchema.value || isEditorMutationLocked.value) return;

    retentionDaysInput.value = String(rawValue ?? '');
    const error = validateRetentionDaysInput(retentionDaysInput.value);
    retentionDaysError.value = error;
    if (error) return;

    const trimmedValue = retentionDaysInput.value.trim();
    if (!trimmedValue) {
        const { retention: _retention, ...schemaWithoutRetention } = editableSchema.value;
        editableSchema.value = schemaWithoutRetention;
    } else {
        editableSchema.value = {
            ...editableSchema.value,
            retention: {
                dataRetentionDays: Number(trimmedValue)
            }
        };
    }

    lastSchemaChange.value = null;
    scheduleAutosave();
}

function schemaWithNormalizedRetention(schema: FormSchema): FormSchema {
    const trimmedValue = retentionDaysInput.value.trim();
    if (!trimmedValue) {
        // A schema that needs no change stays the same object (no render for a save).
        if (!('retention' in schema)) return schema;
        const { retention: _retention, ...schemaWithoutRetention } = schema;
        return schemaWithoutRetention;
    }
    const days = Number(trimmedValue);
    const current = schema.retention as { dataRetentionDays?: number } | undefined;
    if (current && Object.keys(current).length === 1 && current.dataRetentionDays === days) return schema;

    return {
        ...schema,
        retention: {
            dataRetentionDays: Number(trimmedValue)
        }
    };
}

/**
 * "+ Feld" at the end of every section, and "Feld darunter einfügen" in the
 * selected field's bar: the new field lands at the end of that section,
 * or directly below the given field (after the whole address group when the field belongs to
 * one, so a group never gets split). The new field is selected and the cursor goes into the
 * inspector's label with the preset name selected, so typing replaces it.
 */
function addManualField(sectionId: string, afterFieldId?: string) {
    if (!editableSchema.value || !isDraftInspectActive.value) return;
    const target = editableSchema.value.sections.find(section => section.id === sectionId);
    if (!target) return;

    const previousSchema = cloneFormSchema(editableSchema.value);
    const previousSelectedField = copySelectedFieldLocation();
    const usedIds = collectSchemaIds(editableSchema.value);
    const fieldNumber = fieldCount.value + 1;
    const field: FormField = {
        id: createUniqueSchemaId(`feld_${fieldNumber}`, usedIds),
        type: 'text',
        label: t('admin.forms.newFieldLabel', { number: fieldNumber })
    };

    let insertAt = target.fields.length;
    if (afterFieldId) {
        const membership = findAddressGroupOfField(editableSchema.value, afterFieldId);
        const groupIds = membership ? new Set(Object.values(membership.group.fields)) : new Set([afterFieldId]);
        const lastIndex = target.fields.reduce((last, candidate, index) => groupIds.has(candidate.id) ? index : last, -1);
        if (lastIndex >= 0) insertAt = lastIndex + 1;
    }

    editableSchema.value = {
        ...editableSchema.value,
        sections: editableSchema.value.sections.map(section =>
            section.id === sectionId
                ? { ...section, fields: [...section.fields.slice(0, insertAt), field, ...section.fields.slice(insertAt)] }
                : section
        )
    };

    selectedField.value = { sectionId, fieldId: field.id };
    isInspectorOpen.value = true;
    registerSchemaChange(previousSchema, editableSchema.value, previousSelectedField);
    scheduleAutosave();
    // At every width the new field comes into view, with the smallest scroll
    // (`block: 'nearest'`), none when it is already in view. It stood below the window edge.
    scrollFieldIntoView(field.id);
    focusInspectorLabel();
}

/** "Feld darunter einfügen" from the selected field's bar. */
function insertFieldBelowSelected() {
    const location = selectedField.value;
    if (location) addManualField(location.sectionId, location.fieldId);
}

let sheetLabelRequest: string | null = null;

function focusLabelInput() {
    const host = document.getElementById('field-inspector-label');
    const input = host instanceof HTMLInputElement ? host : host?.querySelector('input');
    if (!input) {
        if (isWideLayout.value) focusSelectedField();
        return;
    }
    input.focus();
    input.select();
}

function focusInspectorLabel() {
    flushInspectorSelection();
    sheetLabelRequest = isWideLayout.value ? null : selectedField.value?.fieldId ?? null;
    void nextTick(focusLabelInput);
}

function onInspectorSheetAutoFocus(event: Event) {
    if (!sheetLabelRequest || sheetLabelRequest !== selectedField.value?.fieldId) return;
    // Reka opens its portal after the selection tick. Only explicit editing asks for the keyboard.
    event.preventDefault();
    focusLabelInput();
    sheetLabelRequest = null;
}

/** Title editors of the sections, so a new section can take the cursor into its title. */
const sectionTitleEditors = new Map<string, { startEditing: (options?: { select?: boolean }) => Promise<void> }>();
function registerSectionTitleEditor(sectionId: string, editor: unknown) {
    if (editor && typeof (editor as { startEditing?: unknown }).startEditing === 'function') {
        sectionTitleEditors.set(sectionId, editor as { startEditing: (options?: { select?: boolean }) => Promise<void> });
    } else {
        sectionTitleEditors.delete(sectionId);
    }
}

/**
 * "+ Abschnitt": adds an EMPTY section under the last one (the backend
 * keeps a draft section without fields; a published form needs one field somewhere) and
 * puts the cursor into its title. It adds no field.
 */
function addManualSection(afterSectionId?: string) {
    if (!editableSchema.value || !isDraftInspectActive.value) return;

    const previousSchema = cloneFormSchema(editableSchema.value);
    const previousSelectedField = copySelectedFieldLocation();
    const usedIds = collectSchemaIds(editableSchema.value);
    const sectionNumber = editableSchema.value.sections.length + 1;
    const sectionId = createUniqueSchemaId(`abschnitt_${sectionNumber}`, usedIds);
    const title = t('admin.forms.newSectionLabel', { number: sectionNumber });

    // "Abschnitt darunter einfügen" puts it directly below that section; "+ Abschnitt" last.
    const sections = editableSchema.value.sections;
    const afterIndex = afterSectionId ? sections.findIndex(section => section.id === afterSectionId) : -1;
    const insertAt = afterIndex >= 0 ? afterIndex + 1 : sections.length;
    editableSchema.value = {
        ...editableSchema.value,
        sections: [
            ...sections.slice(0, insertAt),
            { id: sectionId, title, fields: [] },
            ...sections.slice(insertAt)
        ]
    };

    selectedField.value = null;
    isInspectorOpen.value = false;
    registerSchemaChange(previousSchema, editableSchema.value, previousSelectedField);
    scheduleAutosave();
    announceStructure(t('admin.forms.sectionAddedAnnouncement', { title }));
    nextTick(() => {
        void sectionTitleEditors.get(sectionId)?.startEditing();
    });
}

/**
 * The title the editor shows is the one of the interface language when the section
 * carries a translation for it; the edit drafts from and writes to that same title, so a
 * translation is never written into the base title.
 */
function sectionTitleLocale(section: FormSchema['sections'][number]): string | null {
    const language = String(locale.value || 'de');
    return section.i18n?.[language]?.title ? language : null;
}

function editableSectionTitle(section: FormSchema['sections'][number]): string {
    const language = sectionTitleLocale(section);
    return (language ? section.i18n?.[language]?.title : section.title) ?? '';
}

/** The section's title, changed in place; its description stays as it is. */
function updateSectionTitle(section: FormSchema['sections'][number], title: string) {
    const language = sectionTitleLocale(section);
    if (!language) {
        updateSectionSettings(section.id, { title, ...(section.description ? { description: section.description } : {}) });
        return;
    }
    if (!editableSchema.value || !canEditStructure.value) return;
    const previousSchema = cloneFormSchema(editableSchema.value);
    const previousSelectedField = copySelectedFieldLocation();
    editableSchema.value = {
        ...editableSchema.value,
        sections: editableSchema.value.sections.map(candidate => candidate.id !== section.id
            ? candidate
            : { ...candidate, i18n: { ...candidate.i18n, [language]: { ...candidate.i18n?.[language], title } } })
    };
    registerSchemaChange(previousSchema, editableSchema.value, previousSelectedField, {
        kind: 'section_updated',
        sectionTitle: title,
        sectionId: section.id
    });
    scheduleAutosave();
    announceStructure(t('admin.forms.structure.announceSectionUpdated', { title }));
}

/** Enter on the selected field: the cursor goes into its label. */
function onCanvasActivateField(payload: { sectionId: string, fieldId: string }) {
    if (selectedField.value?.fieldId !== payload.fieldId) return;
    flushInspectorSelection();
    isInspectorOpen.value = true;
    focusInspectorLabel();
}

/** Escape in the label: back to the field on the canvas. */
function returnToSelectedField() {
    overviewFieldId = undefined;
    if (!isWideLayout.value) isInspectorOpen.value = false;
    focusSelectedField();
}

/*
 * Below 1280 px a click on "früher" in the bar at the field closed
 * the sheet (a pointer down and then the focus outside the non-modal sheet), while the same button
 * in the sheet left it open. A step with the bar leaves the sheet as it is.
 */
function keepSheetForFieldBar(event: Event) {
    const target = (event as CustomEvent<{ originalEvent?: Event }>).detail?.originalEvent?.target ?? event.target;
    if (target instanceof Element && target.closest('[data-field-bar]')) event.preventDefault();
}

/** From 1280 px the inspector is a column; below it a sheet (`USlideover`). */
const isWideLayout = useEditorWideLayout();

/**
 * Below 1280 px: the sheet is open while a field is selected and the inspector is wanted.
 * Closing it (its "x", Escape) keeps the selection, so the bar at the field stays the way to
 * move and delete; a click on the field opens it again.
 */
const inspectorSheetOpen = computed({
    get: () => !isWideLayout.value && isInspectorOpen.value && !!selectedFieldDetails.value,
    set: (open: boolean) => {
        if (open) {
            isInspectorOpen.value = true;
            return;
        }
        sheetLabelRequest = null;
        isInspectorOpen.value = false;
        if (overviewFieldId && overviewFieldId === selectedField.value?.fieldId) restoreOverviewFocus();
        else focusSelectedField();
    }
});

/** The sheet starts under the editor's head: its lower edge, kept as a CSS variable. */
function updateEditorSheetTop() {
    if (typeof document === 'undefined') return;
    const head = document.querySelector<HTMLElement>('[data-test="editor-head"]');
    const bottom = head ? Math.round(head.getBoundingClientRect().bottom) : 0;
    document.documentElement.style.setProperty('--editor-sheet-top', `${bottom}px`);
}
watch(inspectorSheetOpen, (open) => {
    if (open) updateEditorSheetTop();
});
if (typeof window !== 'undefined') {
    window.addEventListener('resize', updateEditorSheetTop);
    onUnmounted(() => {
        window.removeEventListener('resize', updateEditorSheetTop);
        document.documentElement.style.removeProperty('--editor-sheet-top');
    });
}

function restoreOverviewFocus() {
    overviewFieldId = undefined;
    void nextTick(() => overview.value?.restoreFocus());
}

/** The inspector's one close control: the selection ends, the focus goes back to the field. */
function closeInspector() {
    const fieldId = selectedField.value?.fieldId;
    selectedField.value = null;
    isInspectorOpen.value = false;
    if (overviewFieldId && overviewFieldId === fieldId) return restoreOverviewFocus();
    if (!fieldId) return;
    nextTick(() => {
        document.querySelector<HTMLElement>(`[data-field-id="${CSS.escape(fieldId)}"]`)?.focus();
    });
}

/*
 * Structure editing. The pure operations live in
 * utils/schema-structure.ts; this layer keeps the single-slot undo, the
 * autosave, the live announcement and keyboard focus in step with them.
 */
const canEditStructure = computed(() => isDraftInspectActive.value && !isProcessing.value);
const selectedAddressGroup = computed(() =>
    editableSchema.value && selectedField.value
        ? findAddressGroupOfField(editableSchema.value, selectedField.value.fieldId)
        : null
);

function announceStructure(message: string) {
    // Clear first so the same text is announced again on a repeated move.
    structureAnnouncement.value = '';
    void nextTick(() => {
        structureAnnouncement.value = message;
    });
}

function structureFieldLabel(fieldId: string): string {
    return findFieldLabel(fieldId) || fieldId;
}

function structureSectionTitle(sectionId: string): string {
    return editableSchema.value?.sections.find(section => section.id === sectionId)?.title || sectionId;
}

function prefersReducedMotion(): boolean {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function fieldElement(fieldId: string): HTMLElement | null {
    return document.querySelector<HTMLElement>(`[data-field-id="${CSS.escape(fieldId)}"]`);
}

/*
 * `scrollIntoView` in the drop's own frame cost 11 to 12 ms of
 * forced layout. After a drop the card takes the focus at once (the next key goes to it), and
 * the scroll waits until after the first paint, and only when the card is not fully in view. Inserts
 * keep their own rule.
 */
let dropRevealFrames: number[] = [];
function cancelDropReveal() {
    dropRevealFrames.forEach(frame => cancelAnimationFrame(frame));
    dropRevealFrames = [];
}
onUnmounted(cancelDropReveal);

function revealDroppedField(fieldId: string) {
    cancelDropReveal();
    void nextTick(() => {
        fieldElement(fieldId)?.focus({ preventScroll: true });
        dropRevealFrames.push(requestAnimationFrame(() => {
            dropRevealFrames.push(requestAnimationFrame(() => {
                dropRevealFrames = [];
                const element = fieldElement(fieldId);
                if (!element || fullyInView(element)) return;
                element.scrollIntoView?.({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
            }));
        }));
    });
}

/** The element lies wholly inside its scrolling area and the window. */
function fullyInView(element: HTMLElement): boolean {
    const box = element.getBoundingClientRect();
    const area = verticalScrollContainer(element)?.getBoundingClientRect();
    const top = Math.max(area?.top ?? 0, 0);
    const bottom = Math.min(area?.bottom ?? window.innerHeight, window.innerHeight);
    return box.top >= top && box.bottom <= bottom;
}

function scrollFieldIntoView(fieldId: string, focus = false) {
    void nextTick(() => {
        const element = fieldElement(fieldId);
        if (!element) return;
        if (focus) element.focus({ preventScroll: true });
        element.scrollIntoView?.({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    });
}

function blockedMoveMessage(reason: MoveBlockedReason | undefined, label: string, fieldId?: string, blockedGroupId?: string): string {
    switch (reason) {
        case 'at_start':
            return t('admin.forms.structure.announceAtStart', { label });
        case 'at_end':
            return t('admin.forms.structure.announceAtEnd', { label });
        case 'address_group_component': {
            const membership = fieldId && editableSchema.value ? findAddressGroupOfField(editableSchema.value, fieldId) : null;
            return t('admin.forms.structure.blockedAddressGroup', {
                label,
                group: membership ? addressGroupLabel(membership.group) : ''
            });
        }
        case 'address_group_block': {
            const membership = fieldId && editableSchema.value ? findAddressGroupOfField(editableSchema.value, fieldId) : null;
            if (membership && (!blockedGroupId || membership.group.id === blockedGroupId)) {
                return t('admin.forms.structure.blockedAddressGroupBlock', {
                    label,
                    group: addressGroupLabel(membership.group)
                });
            }
            // Another field would land between the components of a group.
            const blockingGroup = editableSchema.value?.sections
                .flatMap(section => section.addressGroups ?? [])
                .find(group => group.id === blockedGroupId);
            return t('admin.forms.structure.blockedIntoAddressGroupBlock', {
                label,
                group: blockingGroup ? addressGroupLabel(blockingGroup) : ''
            });
        }
        case 'compare_target_repeatable':
            return t('admin.forms.structure.blockedCompareTarget', { label });
        default:
            return '';
    }
}

interface StructureMoveContext {
    label: string
    fieldId?: string
    movedFieldIds: string[]
    summary: SchemaChangeSummary
    announcement: (schema: FormSchema) => string
}

interface StructureMoveOutcome {
    applied: boolean
    message: string
}

/**
 * A move, a changed answer list or a changed type can break a
 * condition for citizens without a word. Say so at once, with a way to the
 * field; the warning strip keeps listing it. Returns the sentence for the
 * live announcement, or '' when nothing broke.
 */
function warnNewlyBrokenConditions(before: FormSchema, after: FormSchema): string {
    const broken = newlyBrokenConditions(before, after, conditionTypeChanges.value, t('admin.fieldInspector.untitledField'));
    const first = broken[0];
    if (!first) return '';
    const description = [
        brokenConditionText(first),
        broken.length > 1 ? t('admin.forms.conditionBroken.more', { count: broken.length - 1 }, broken.length - 1) : ''
    ].filter(Boolean).join(' ');
    toast.add({
        title: t('admin.forms.conditionBroken.title'),
        description,
        color: 'warning',
        actions: [{
            label: t('admin.forms.conditionBroken.open'),
            color: 'neutral' as const,
            variant: 'outline' as const,
            onClick: () => jumpToAuthoringIssue(first)
        }]
    });
    return description;
}

function brokenConditionText(item: BrokenCondition): string {
    const key = item.reason === 'missing' && item.value === false ? 'missingKept' : item.reason;
    return t(`admin.forms.conditionBroken.${key}`, { field: item.fieldLabel, source: item.sourceLabel, value: String(item.value ?? '') });
}

/**
 * Applies a move result: undo slot, autosave, order hints and the
 * announcement. A refused move only explains why.
 */
function commitStructureMove(previousSchema: FormSchema, result: MoveResult, context: StructureMoveContext): StructureMoveOutcome {
    if (!result.applied) {
        const message = blockedMoveMessage(result.blockedReason, context.label, context.fieldId, result.blockedGroupId);
        if (message) {
            announceStructure(message);
            if (result.blockedReason === 'address_group_component' || result.blockedReason === 'address_group_block' || result.blockedReason === 'compare_target_repeatable') {
                toast.add({ title: t('admin.forms.structure.blockedTitle'), description: message, color: 'warning' });
            }
        }
        return { applied: false, message };
    }

    const previousSelectedField = copySelectedFieldLocation();
    editableSchema.value = { ...result.schema, id: schemaId };
    reconcileSelectedField(editableSchema.value);
    registerSchemaChange(previousSchema, editableSchema.value, previousSelectedField, context.summary);
    scheduleAutosave();

    const parts = [context.announcement(editableSchema.value)];
    const brokenText = warnNewlyBrokenConditions(previousSchema, editableSchema.value);
    if (brokenText) parts.push(brokenText);
    const orderHints = conditionOrderHints(previousSchema, editableSchema.value, context.movedFieldIds, t('admin.fieldInspector.untitledField'));
    const firstHint = orderHints[0];
    if (firstHint) {
        const hintText = [
            t('admin.forms.structure.conditionOrderHint', { dependent: firstHint.dependentLabel, source: firstHint.sourceLabel }),
            orderHints.length > 1 ? t('admin.forms.structure.conditionOrderMore', { count: orderHints.length - 1 }) : ''
        ].filter(Boolean).join(' ');
        parts.push(hintText);
        toast.add({ title: t('admin.forms.structure.conditionOrderTitle'), description: hintText, color: 'warning' });
    }
    if (crossedRepeatableBoundary(previousSchema, editableSchema.value, context.movedFieldIds)) {
        const boundaryText = t('admin.forms.structure.repeatableBoundaryHint');
        parts.push(boundaryText);
        toast.add({ title: t('admin.forms.structure.repeatableBoundaryTitle'), description: boundaryText, color: 'info' });
    }

    const message = parts.filter(Boolean).join(' ');
    announceStructure(message);
    return { applied: true, message };
}

function moveFieldWith(fieldId: string, apply: (schema: FormSchema) => MoveResult): StructureMoveOutcome {
    if (!editableSchema.value || !canEditStructure.value) return { applied: false, message: '' };
    const previousSchema = cloneFormSchema(editableSchema.value);
    const result = apply(editableSchema.value);
    const label = structureFieldLabel(fieldId);
    const to = fieldPosition(result.schema, fieldId);

    return commitStructureMove(previousSchema, result, {
        label,
        fieldId,
        movedFieldIds: [fieldId],
        summary: { kind: 'field_moved', fieldLabel: label, sectionId: to?.sectionId ?? '', fieldId, toSectionTitle: to?.sectionTitle, toPosition: to ? to.index + 1 : undefined },
        announcement: (schema) => {
            const position = fieldPosition(schema, fieldId);
            return position
                ? t('admin.forms.structure.announceFieldMoved', {
                    label,
                    position: position.index + 1,
                    count: position.count,
                    section: position.sectionTitle
                })
                : '';
        }
    });
}

function moveSectionWith(sectionId: string, apply: (schema: FormSchema) => MoveResult): StructureMoveOutcome {
    if (!editableSchema.value || !canEditStructure.value) return { applied: false, message: '' };
    const previousSchema = cloneFormSchema(editableSchema.value);
    const title = structureSectionTitle(sectionId);
    const movedFieldIds = editableSchema.value.sections.find(section => section.id === sectionId)?.fields.map(field => field.id) ?? [];
    const result = apply(editableSchema.value);
    const toIndex = result.schema.sections.findIndex(section => section.id === sectionId);

    return commitStructureMove(previousSchema, result, {
        label: title,
        movedFieldIds,
        summary: { kind: 'section_moved', sectionTitle: title, sectionId, toPosition: toIndex === -1 ? undefined : toIndex + 1 },
        announcement: schema => t('admin.forms.structure.announceSectionMoved', {
            title,
            position: schema.sections.findIndex(section => section.id === sectionId) + 1,
            count: schema.sections.length
        })
    });
}

function moveGroupWith(sectionId: string, groupId: string, apply: (schema: FormSchema) => MoveResult): StructureMoveOutcome {
    const schema = editableSchema.value;
    const section = schema?.sections.find(candidate => candidate.id === sectionId);
    const group = section?.addressGroups?.find(candidate => candidate.id === groupId);
    if (!schema || !section || !group || !canEditStructure.value) return { applied: false, message: '' };
    const previousSchema = cloneFormSchema(schema);
    const label = addressGroupLabel(group);
    const movedFieldIds = addressGroupFieldIds(section, group);
    const result = apply(schema);
    const firstMoved = movedFieldIds[0] ? fieldPosition(result.schema, movedFieldIds[0]) : null;

    return commitStructureMove(previousSchema, result, {
        label,
        movedFieldIds,
        summary: { kind: 'group_moved', groupLabel: label, sectionId, groupId, toSectionTitle: firstMoved?.sectionTitle },
        announcement: (next) => {
            const firstFieldId = movedFieldIds[0];
            const position = firstFieldId ? fieldPosition(next, firstFieldId) : null;
            return position
                ? t('admin.forms.structure.announceGroupMoved', { label, section: position.sectionTitle, position: position.index + 1 })
                : '';
        }
    });
}

function moveSelectedFieldStep(direction: MoveDirection): StructureMoveOutcome {
    const fieldId = selectedField.value?.fieldId;
    if (!fieldId) return { applied: false, message: '' };
    const outcome = moveFieldWith(fieldId, schema => moveFieldByStep(schema, fieldId, direction));
    if (outcome.applied) scrollFieldIntoView(fieldId);
    return outcome;
}

function moveSelectedFieldToSection(sectionId: string) {
    const fieldId = selectedField.value?.fieldId;
    if (!fieldId) return;
    if (moveFieldWith(fieldId, schema => moveFieldToSection(schema, fieldId, sectionId)).applied) {
        scrollFieldIntoView(fieldId);
    }
}

/**
 * Rule 5: after a move started in the field's bar, the focus stays on the
 * bar, also when the field went into another section and the bar was drawn anew there.
 */
function refocusFieldBar(action: 'field-up' | 'field-down' | 'field-section') {
    nextTick(() => {
        const bar = document.querySelector<HTMLElement>('[data-test="field-action-bar"][data-placement="sheet"]')
          ?? document.querySelector<HTMLElement>('[data-test="field-action-bar"]');
        if (!bar || bar.contains(document.activeElement)) return;
        const target = bar.querySelector<HTMLElement>(`[data-structure-action="${action}"]:not([disabled])`)
          ?? bar.querySelector<HTMLElement>('[data-structure-action="field-section"]');
        target?.focus();
    });
}

function onBarMoveStep(direction: MoveDirection) {
    if (moveSelectedFieldStep(direction).applied) refocusFieldBar(direction === 'up' ? 'field-up' : 'field-down');
}

function onBarMoveToSection(sectionId: string) {
    moveSelectedFieldToSection(sectionId);
    refocusFieldBar('field-section');
}

/** The address group's moves from the bar's menu keep the focus on the bar too. */
function onBarGroupMoveStep(direction: MoveDirection) {
    moveSelectedGroupStep(direction);
    refocusFieldBar('field-section');
}

function onBarGroupMoveToSection(sectionId: string) {
    moveSelectedGroupToSection(sectionId);
    refocusFieldBar('field-section');
}

function moveSelectedGroupStep(direction: MoveDirection) {
    const membership = selectedAddressGroup.value;
    if (!membership) return;
    const { section, group } = membership;
    moveGroupWith(section.id, group.id, schema => moveAddressGroupByStep(schema, section.id, group.id, direction));
    if (selectedField.value) scrollFieldIntoView(selectedField.value.fieldId);
}

function moveSelectedGroupToSection(targetSectionId: string) {
    const membership = selectedAddressGroup.value;
    if (!membership) return;
    const { section, group } = membership;
    moveGroupWith(section.id, group.id, schema => moveAddressGroupToSection(schema, section.id, group.id, targetSectionId));
    if (selectedField.value) scrollFieldIntoView(selectedField.value.fieldId);
}

/**
 * Title and description of a section from its header. Each accepted
 * change is one undo step and is saved by the autosave like any other edit.
 */
function updateSectionSettings(sectionId: string, patch: { title: string, description?: string }) {
    if (!editableSchema.value || !canEditStructure.value) return;
    if (!editableSchema.value.sections.some(section => section.id === sectionId)) return;

    const previousSchema = cloneFormSchema(editableSchema.value);
    const previousSelectedField = copySelectedFieldLocation();
    editableSchema.value = {
        ...editableSchema.value,
        sections: editableSchema.value.sections.map((section) => {
            if (section.id !== sectionId) return section;
            const { description: _description, ...rest } = section;
            return { ...rest, title: patch.title, ...(patch.description ? { description: patch.description } : {}) };
        })
    };
    registerSchemaChange(previousSchema, editableSchema.value, previousSelectedField, {
        kind: 'section_updated',
        sectionTitle: patch.title,
        sectionId
    });
    scheduleAutosave();
    announceStructure(t('admin.forms.structure.announceSectionUpdated', { title: patch.title }));
}

function moveSectionStep(sectionId: string, direction: MoveDirection) {
    moveSectionWith(sectionId, schema => moveSectionByStep(schema, sectionId, direction));
    // The section header moved in the DOM; keep focus on its buttons.
    void nextTick(() => {
        const selector = (action: string) => `[data-structure-action="${action}"][data-section-id="${CSS.escape(sectionId)}"]`;
        const preferred = document.querySelector<HTMLButtonElement>(selector(direction === 'up' ? 'section-up' : 'section-down'));
        const fallback = document.querySelector<HTMLButtonElement>(selector(direction === 'up' ? 'section-down' : 'section-up'));
        const target = preferred && !preferred.disabled ? preferred : fallback;
        target?.focus({ preventScroll: true });
        target?.closest('fieldset')?.scrollIntoView?.({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    });
}

/** Alt+Arrow on a focused canvas field: selects it, moves it, keeps focus on it. */
function onCanvasMoveFieldStep(payload: { sectionId: string, fieldId: string, direction: MoveDirection }) {
    if (!canEditStructure.value) return;
    if (selectedField.value?.fieldId !== payload.fieldId) {
        applyFieldSelection(payload.sectionId, payload.fieldId);
    }
    moveFieldWith(payload.fieldId, schema => moveFieldByStep(schema, payload.fieldId, payload.direction));
    scrollFieldIntoView(payload.fieldId, true);
}

/*
 * A drop moves the field and leaves the selection as it was. Dragging a field that is
 * not selected does not select it (below 1280 px that would open the sheet over the form);
 * a selected field keeps its selection and its bar, `reconcileSelectedField` follows it into
 * another section.
 */
function onCanvasMoveField(payload: { fieldId: string, sectionId: string, beforeFieldId: string | null }) {
    const outcome = moveFieldWith(payload.fieldId, schema => moveField(schema, payload.fieldId, {
        sectionId: payload.sectionId,
        beforeFieldId: payload.beforeFieldId
    }));
    // The next key goes to the moved field, and the form shows where it landed.
    if (outcome.applied) {
        selectDroppedField(payload.sectionId, payload.fieldId);
        revealDroppedField(payload.fieldId);
    }
}

/**
 * After a drop the dropped field is the selected one, so the inspector, the bar
 * and the focus ring stand at one field. Below 1280 px the sheet stays closed (it would
 * cover the form); the bar at the field is the way on, a click opens the sheet.
 */
function selectDroppedField(sectionId: string, fieldId: string) {
    if (!isDraftInspectActive.value) return;
    // The card and its bar first; the column's content for another field a frame later.
    deferInspectorSelection = inspectorSelection.value?.fieldId !== fieldId;
    selectedField.value = { sectionId, fieldId };
    deferInspectorSelection = false;
    if (isWideLayout.value) isInspectorOpen.value = true;
}

/*
 * Half of the first frame after a drop was
 * the inspector's column mounting its content for the dropped field. The canvas shows the field at its
 * place, selected and with its bar, in that frame; the column follows the selection one frame later
 * (after the first paint). Every other change of the selection reaches the column at once, and
 * anything that needs the column (Enter to the label) takes the pending selection along first.
 */
const inspectorSelection = ref<{ sectionId: string, fieldId: string } | null>(null);
let deferInspectorSelection = false;
let inspectorSelectionFrames: number[] = [];

function cancelInspectorSelectionFrames() {
    inspectorSelectionFrames.forEach(frame => cancelAnimationFrame(frame));
    inspectorSelectionFrames = [];
}

function flushInspectorSelection() {
    cancelInspectorSelectionFrames();
    if (inspectorSelection.value !== selectedField.value) inspectorSelection.value = selectedField.value;
}

watch(selectedField, () => {
    if (!deferInspectorSelection) {
        flushInspectorSelection();
        return;
    }
    cancelInspectorSelectionFrames();
    // Two frames: the first paints the card at its place, the second brings the column's content.
    inspectorSelectionFrames.push(requestAnimationFrame(() => {
        inspectorSelectionFrames.push(requestAnimationFrame(flushInspectorSelection));
    }));
}, { flush: 'sync', immediate: true });
onUnmounted(cancelInspectorSelectionFrames);

const inspectorFieldShown = computed(() => {
    const location = inspectorSelection.value;
    return Boolean(location && editableSchema.value?.sections.some(section => section.id === location.sectionId && section.fields.some(field => field.id === location.fieldId)));
});

type CanvasFieldDrop
    = | { kind: 'field', fieldId: string, sectionId: string, beforeFieldId: string | null }
      | { kind: 'addressGroup', groupId: string, fromSectionId: string, sectionId: string, beforeFieldId: string | null };

/**
 * Drop targets while dragging: the same schema operations as the drop
 * itself, so the canvas draws no marker where the move would be refused
 * (address group rules, a compare target into a repeatable section).
 */
function canDropOnCanvas(drop: CanvasFieldDrop): boolean {
    const schema = editableSchema.value;
    if (!schema || !canEditStructure.value) return false;
    const destination = { sectionId: drop.sectionId, beforeFieldId: drop.beforeFieldId };
    const result = drop.kind === 'field'
        ? moveField(schema, drop.fieldId, destination)
        : moveAddressGroup(schema, drop.fromSectionId, drop.groupId, destination);
    // A refused move and a move to the same place are both no target (no line, no drop).
    return result.applied;
}

/**
 * A drag ended over a target that was refused. The same explanation as the keyboard
 * gives (address group, compare target), without moving anything; the field's own place
 * is silent.
 */
function onCanvasDropRefused(drop: CanvasFieldDrop) {
    const schema = editableSchema.value;
    if (!schema || !canEditStructure.value) return;
    const destination = { sectionId: drop.sectionId, beforeFieldId: drop.beforeFieldId };
    const result = drop.kind === 'field'
        ? moveField(schema, drop.fieldId, destination)
        : moveAddressGroup(schema, drop.fromSectionId, drop.groupId, destination);
    if (result.applied || !result.blockedReason) return;
    let label = '';
    if (drop.kind === 'field') {
        label = structureFieldLabel(drop.fieldId);
    } else {
        const group = schema.sections.find(section => section.id === drop.fromSectionId)?.addressGroups?.find(candidate => candidate.id === drop.groupId);
        label = group ? addressGroupLabel(group) : drop.groupId;
    }
    commitStructureMove(schema, result, { label, fieldId: drop.kind === 'field' ? drop.fieldId : undefined, movedFieldIds: [], summary: { kind: 'no_change' }, announcement: () => '' });
}

function onCanvasMoveAddressGroup(payload: { groupId: string, fromSectionId: string, sectionId: string, beforeFieldId: string | null }) {
    const firstFieldId = editableSchema.value?.sections.find(section => section.id === payload.fromSectionId)
        ?.addressGroups?.find(group => group.id === payload.groupId)?.fields.street;
    const outcome = moveGroupWith(payload.fromSectionId, payload.groupId, schema => moveAddressGroup(schema, payload.fromSectionId, payload.groupId, {
        sectionId: payload.sectionId,
        beforeFieldId: payload.beforeFieldId
    }));
    if (outcome.applied && firstFieldId) {
        selectDroppedField(payload.sectionId, firstFieldId);
        revealDroppedField(firstFieldId);
    }
}

function onCanvasMoveSection(payload: { sectionId: string, beforeSectionId: string | null }) {
    const outcome = moveSectionWith(payload.sectionId, schema => moveSection(schema, payload.sectionId, payload.beforeSectionId));
    if (!outcome.applied) return;
    // The moved section's head comes into view.
    // the focus went to its grip, which is hidden from assistive tools (`aria-hidden`, `tabindex -1`); it
    // goes to the section's title button, the head's first named control, as after "Rückgängig".
    void nextTick(() => {
        const grip = document.querySelector<HTMLElement>(`[data-draft-section-handle="${CSS.escape(payload.sectionId)}"]`);
        const title = document.querySelector<HTMLElement>(`[data-section-title-button="${CSS.escape(payload.sectionId)}"]`);
        (title ?? grip)?.focus({ preventScroll: true });
        (grip?.closest('fieldset') ?? title?.closest('fieldset') ?? grip)?.scrollIntoView?.({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    });
}

/** Opens the confirmation dialog. Returns false when nothing can be deleted. */
function requestStructureDelete(
    target: StructureTarget,
    origin: 'editor' | 'chat' = 'editor',
    chat?: { message: string, scopeKey: string }
): boolean {
    const schema = editableSchema.value;
    if (!schema || !isDraftInspectActive.value || isProcessing.value || isStructureDeleteOpen.value) return false;
    const section = schema.sections.find(candidate => candidate.id === target.sectionId);
    if (!section) return false;

    let label: string;
    if (target.kind === 'field') {
        const field = section.fields.find(candidate => candidate.id === target.fieldId);
        if (!field) return false;
        // The dialog of the bar's delete names a field without a label as the card does.
        label = field.label?.trim() || t('admin.fieldInspector.untitledField');
    } else if (target.kind === 'section') {
        label = section.title || section.id;
    } else {
        const group = section.addressGroups?.find(candidate => candidate.id === target.groupId);
        if (!group) return false;
        label = addressGroupLabel(group);
    }

    // The previous dialog may still be in its leave transition: this request
    // takes over, and the late `closed` of the old dialog is ignored. The
    // dialog then stays mounted, so its focus scope still points at the
    // trigger of the first delete, which may be gone (see cancel).
    structureDeleteTookOver = false;
    if (structureDeleteCloseFallback) {
        clearTimeout(structureDeleteCloseFallback);
        structureDeleteCloseFallback = null;
        structureDeleteTookOver = pendingStructureDelete.value !== null;
    }

    const fieldIds = structureTargetFieldIds(schema, target);
    const totalFieldCount = schema.sections.reduce((count, candidate) => count + candidate.fields.length, 0);
    let emptyAfter: PendingStructureDelete['emptyAfter'] = null;
    if (target.kind === 'section' && schema.sections.length === 1) {
        emptyAfter = 'sections';
    } else if (fieldIds.length > 0 && totalFieldCount === fieldIds.length) {
        emptyAfter = 'fields';
    }

    structureDeleteRemoveConditions.value = true;
    structureFocusAfterClose = null;
    const references = findSchemaReferences(schema, target, String(locale.value), t('admin.fieldInspector.untitledField'));
    pendingStructureDelete.value = {
        target,
        label,
        origin,
        chat,
        fieldCount: fieldIds.length,
        fieldLabels: fieldIds.map(structureFieldLabel),
        references,
        emptyAfter
    };

    /*
     * Nothing hangs on the target, so the bin deletes at once; the answer
     * beside "Rückgängig" offers "Wiederherstellen". The dialog stays when conditions or other
     * fields refer to it, for an address group or one of its fields, for a section with fields,
     * and when the form would be left without fields or sections.
     */
    const inAddressGroup = target.kind === 'field' && !!findAddressGroupOfField(schema, target.fieldId);
    const nothingDepends = origin === 'editor'
      && !structureDeleteTookOver
      && references.length === 0
      && emptyAfter === null
      && ((target.kind === 'field' && !inAddressGroup) || (target.kind === 'section' && fieldIds.length === 0));
    if (nothingDepends) {
        confirmStructureDelete();
        onStructureDeleteClosed();
        return true;
    }

    isStructureDeleteOpen.value = true;
    return true;
}

function requestSelectedFieldDelete() {
    if (selectedField.value) requestStructureDelete({ kind: 'field', ...selectedField.value });
}

function requestSelectedGroupDelete() {
    const membership = selectedAddressGroup.value;
    if (membership) requestStructureDelete({ kind: 'addressGroup', sectionId: membership.section.id, groupId: membership.group.id });
}

function onCanvasDeleteField(payload: { sectionId: string, fieldId: string }) {
    requestStructureDelete({ kind: 'field', ...payload });
}

/*
 * The dialog closes with its leave transition first; it is unmounted and
 * focus is placed only afterwards, so the dialog's focus scope teardown
 * cannot send focus to the page body. A cancel lets the dialog return focus
 * to its trigger as usual.
 */
type StructureFocusTarget
    = | { kind: 'chat' }
      | { kind: 'field', fieldId: string | null, sectionId: string | null, fieldDeleted?: boolean }
      | { kind: 'selection' };
let structureFocusAfterClose: StructureFocusTarget | null = null;
let structureDeleteCloseFallback: ReturnType<typeof setTimeout> | null = null;
/** The open dialog took over from one that was still closing. */
let structureDeleteTookOver = false;
const structureCanvas = ref<HTMLElement | null>(null);

/*
 * The safety net outlived the page. Leaving the editor within a second of a delete
 * whose leave transition had not reported back let the timer run on the unmounted page; it then
 * focused "Feld hinzufügen" (a global query) on whatever page was shown next. In the unit suite that
 * was the next test's page, which made "moves from the selected field to its label with Enter" red
 * under load. The timer ends with the page.
 */
onUnmounted(() => {
    if (structureDeleteCloseFallback) clearTimeout(structureDeleteCloseFallback);
    structureDeleteCloseFallback = null;
});

function closeStructureDelete() {
    isStructureDeleteOpen.value = false;
    if (structureDeleteCloseFallback) clearTimeout(structureDeleteCloseFallback);
    // Safety net if the leave transition never reports back.
    structureDeleteCloseFallback = setTimeout(onStructureDeleteClosed, 1000);
}

function cancelStructureDelete() {
    // After a takeover the dialog's own return target may be a removed card;
    // place focus on the selection instead of letting it fall to the body.
    structureFocusAfterClose = structureDeleteTookOver ? { kind: 'selection' } : null;
    closeStructureDelete();
}

function onStructureDeleteClosed() {
    if (structureDeleteCloseFallback) {
        clearTimeout(structureDeleteCloseFallback);
        structureDeleteCloseFallback = null;
    }
    if (isStructureDeleteOpen.value) return;
    pendingStructureDelete.value = null;
    structureDeleteTookOver = false;
    const target = structureFocusAfterClose;
    structureFocusAfterClose = null;
    if (target) void nextTick(() => focusAfterStructureDelete(target));
}

/** Next field, else the section header, else the add-field control. */
function focusAfterStructureDelete(target: StructureFocusTarget) {
    if (target.kind === 'chat') {
        focusFloatingChat();
        return;
    }
    if (target.kind === 'selection') {
        // The selected field card, else the canvas.
        const card = selectedField.value ? fieldElement(selectedField.value.fieldId) : null;
        (card ?? structureCanvas.value)?.focus({ preventScroll: true });
        return;
    }
    const element = target.fieldId ? fieldElement(target.fieldId) : null;
    if (element) {
        element.focus({ preventScroll: true });
        element.scrollIntoView?.({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
        return;
    }
    // After a field (or address group) was deleted and its section has no field left,
    // the focus goes to that section's "+ Feld", not to "Bearbeiten: Abschnitt".
    const sectionAddField = target.fieldDeleted && target.sectionId
        ? document.querySelector<HTMLButtonElement>(`[data-structure-action="add-field"][data-section-id="${CSS.escape(target.sectionId)}"]`)
        : null;
    if (sectionAddField && !sectionAddField.disabled) {
        sectionAddField.focus();
        return;
    }
    const sectionButton = target.sectionId
        ? [...document.querySelectorAll<HTMLButtonElement>(`[data-section-id="${CSS.escape(target.sectionId)}"][data-structure-action^="section-"]`)]
            .find(button => !button.disabled)
        : undefined;
    if (sectionButton) {
        sectionButton.focus();
        return;
    }
    const addField = (target.sectionId
        ? document.querySelector<HTMLButtonElement>(`[data-structure-action="add-field"][data-section-id="${CSS.escape(target.sectionId)}"]`)
        : null) ?? document.querySelector<HTMLButtonElement>('[data-structure-action="add-field"]');
    if (addField && !addField.disabled) {
        addField.focus();
        return;
    }
    focusChatToggle();
}

function structureDeleteSummary(pending: PendingStructureDelete): SchemaChangeSummary {
    switch (pending.target.kind) {
        case 'field':
            return { kind: 'field_deleted', fieldLabel: pending.label, sectionId: pending.target.sectionId, fieldId: pending.target.fieldId };
        case 'section':
            return { kind: 'section_deleted', sectionTitle: pending.label, sectionId: pending.target.sectionId };
        case 'addressGroup':
            return { kind: 'group_deleted', groupLabel: pending.label, sectionId: pending.target.sectionId, groupId: pending.target.groupId };
    }
}

/** Where focus goes after a delete: the field in its place, else its neighbour, else that section. */
function focusTargetAfterDelete(previous: FormSchema, target: StructureTarget, next: FormSchema): StructureFocusTarget {
    if (target.kind === 'section') {
        const index = previous.sections.findIndex(section => section.id === target.sectionId);
        const section = next.sections[index] ?? next.sections[index - 1];
        return { kind: 'field', fieldId: section?.fields[0]?.id ?? null, sectionId: section?.id ?? null };
    }
    const section = previous.sections.find(candidate => candidate.id === target.sectionId);
    if (!section) return { kind: 'field', fieldId: null, sectionId: null };
    const removed = new Set(structureTargetFieldIds(previous, target));
    const firstIndex = section.fields.findIndex(field => removed.has(field.id));
    const after = section.fields.slice(firstIndex).find(field => !removed.has(field.id));
    const before = section.fields.slice(0, firstIndex).reverse().find(field => !removed.has(field.id));
    // The next card, else the previous one, else the section's "+ Feld".
    return { kind: 'field', fieldId: after?.id ?? before?.id ?? null, sectionId: section.id, fieldDeleted: true };
}

function confirmStructureDelete() {
    const pending = pendingStructureDelete.value;
    if (!pending || !editableSchema.value || isEditorMutationLocked.value) {
        cancelStructureDelete();
        return;
    }

    const previousSchema = cloneFormSchema(editableSchema.value);
    const previousSelectedField = copySelectedFieldLocation();
    const result = deleteSchemaElement(editableSchema.value, pending.target, {
        removeConditions: structureDeleteRemoveConditions.value
    });
    if (!result.applied) {
        cancelStructureDelete();
        return;
    }

    structureFocusAfterClose = pending.origin === 'chat' && isChatOpen.value
        ? { kind: 'chat' }
        : focusTargetAfterDelete(previousSchema, pending.target, result.schema);
    closeStructureDelete();

    editableSchema.value = { ...result.schema, id: schemaId };
    if (previousSelectedField && result.removedFieldIds.includes(previousSelectedField.fieldId)) {
        selectedField.value = null;
        isInspectorOpen.value = false;
    } else {
        reconcileSelectedField(editableSchema.value);
    }
    // The undo slot keeps the chat generations from before the retirement.
    const summary = registerSchemaChange(previousSchema, editableSchema.value, previousSelectedField, structureDeleteSummary(pending));
    for (const fieldId of result.removedFieldIds) {
        retireFieldChatScope(fieldId);
    }
    scheduleAutosave();

    if (pending.origin === 'chat' && pending.chat && summary) {
        if (pending.chat.scopeKey !== schemaChatScopeKey) {
            addMessage('user', pending.chat.message, { scopeKey: schemaChatScopeKey });
        }
        const deletedKey = pending.target.kind === 'field' ? 'admin.forms.fieldDeletedLocally' : 'admin.forms.structure.deletedLocally';
        addMessage('assistant', t(deletedKey, { summary: formatSchemaChangeSummary(summary) }), {
            scopeKey: schemaChatScopeKey,
            sendToAi: true,
            aiContent: editorActionAiContent(pending.target.kind === 'field' ? 'field_deleted' : 'schema_updated')
        });
    }

    announceStructure(t('admin.forms.structure.announceDeleted', { label: pending.label }));
}

function parseResponseSchema(): FormSchema | null {
    const attrs = schemaResponse.value?.data?.attributes;
    if (!attrs) return null;

    const fieldValue = typeof attrs.field_schema === 'string'
        ? attrs.field_schema
        : attrs.field_schema?.value;

    if (!fieldValue) return null;

    return parseStoredFormSchema(fieldValue, schemaResponse.value!.data.id);
}

function parseResponsePublicationScope(): 'internet' | 'intranet' {
    const scope = schemaResponse.value?.data?.attributes?.field_publication_scope;
    return scope === 'internet' ? 'internet' : 'intranet';
}

function parseResponseReferencePattern(): string {
    return normalizeReferencePattern(schemaResponse.value?.data?.attributes?.field_reference_pattern);
}

/** Deep equality of two JSON values, key order ignored. */
function sameJsonValue(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) {
        const other = b as unknown[];
        return a.length === other.length && a.every((item, index) => sameJsonValue(item, other[index]));
    }
    const left = Object.entries(a as Record<string, unknown>).filter(([, value]) => value !== undefined);
    const right = b as Record<string, unknown>;
    const rightKeys = Object.keys(right).filter(key => right[key] !== undefined);
    return left.length === rightKeys.length && left.every(([key, value]) => sameJsonValue(value, right[key]));
}

function applyPersistedSchema(
    schema: FormSchema,
    settings?: { publicationScope?: 'internet' | 'intranet', referencePattern?: string }
) {
    applyingPersistedEditorState = true;
    try {
        const persisted = { ...schema, id: schemaId };
        // The saved schema the server sends back is usually the one just sent; then the
        // editor keeps its object, and a save renders neither the page nor the form.
        if (!sameJsonValue(persisted, editableSchema.value)) editableSchema.value = persisted;
        syncRetentionDaysInput(editableSchema.value);
        reconcileSelectedField(editableSchema.value);
        if (settings?.publicationScope) {
            publicationScope.value = settings.publicationScope;
        }
        if (settings?.referencePattern !== undefined) {
            referencePattern.value = settings.referencePattern;
        }
    } finally {
        applyingPersistedEditorState = false;
    }
    authoritativeEditorStateVersion.value += 1;
}

watch(schemaResponse, () => {
    if (initialized) return;

    try {
        const parsed = parseResponseSchema();
        if (!parsed) {
            parseError.value = true;
            return;
        }

        applyPersistedSchema(parsed, {
            publicationScope: parseResponsePublicationScope(),
            referencePattern: parseResponseReferencePattern()
        });
        lastKnownSchemaChanged.value = schemaResponse.value?.data?.attributes?.changed ?? null;
        parseError.value = false;
        initialized = true;
        if (formFeatures) addMessage('assistant', formFeatures.chatIntro(t, {
            title: parsed.title,
            sections: parsed.sections.length,
            fields: parsed.sections.reduce((total, section) => total + section.fields.length, 0)
        }, parsed.sections.length));
    } catch (e) {
        parseError.value = true;
        console.error('[admin] Failed to parse editable schema:', e);
    }
}, { immediate: true });

// After a refused publish the form page links here; open the first
// field that keeps the form from being published (privacy first, then a
// CRM key on several fields, in the order of the publish check).
if (route.query.focus === 'privacy') {
    onMounted(() => {
        const first = publishBlockers(editableSchema.value)?.issues[0];
        if (first) jumpToAuthoringIssue(first);
    });
}

async function saveCurrentSchema(options: { showToast?: boolean, refreshSchema?: boolean, throwOnError?: boolean, showErrorToast?: boolean, allowDuringStatusUpdate?: boolean } = {}): Promise<boolean> {
    if (!editableSchema.value || isDeletingDraft.value) return false;

    const { showToast = true, refreshSchema = showToast, throwOnError = false, showErrorToast = true, allowDuringStatusUpdate = false } = options;
    if (!canInspectDraftFields.value) {
        if (showToast || showErrorToast) {
            toast.add({
                title: t('admin.forms.publishedReadOnlyTitle'),
                description: t('admin.forms.publishedReadOnlyDescription'),
                color: 'warning'
            });
        }
        if (throwOnError) {
            throw new Error(t('admin.forms.publishedReadOnlyDescription'));
        }
        return false;
    }
    if (schemaStatusUpdating.value && !allowDuringStatusUpdate) {
        return false;
    }

    committingTextForSave = true;
    try {
        flushTextCommit();
    } finally {
        committingTextForSave = false;
    }

    const retentionError = validateRetentionDaysInput(retentionDaysInput.value);
    retentionDaysError.value = retentionError;
    if (retentionError) {
        // Nothing is sent, so nothing is "Gespeichert"; the state names the setting.
        saveProblem.value = { kind: 'invalid', reason: retentionError };
        if (showErrorToast) {
            toast.add({
                title: t('admin.forms.retention.validationTitle'),
                description: retentionError,
                color: 'error'
            });
        }
        if (throwOnError) {
            throw new Error(retentionError);
        }
        return false;
    }

    const withoutLabel = firstFieldWithoutLabel(editableSchema.value);
    if (withoutLabel) {
        saveProblem.value = { kind: 'invalid', reason: t('admin.forms.labelMissing'), fieldId: withoutLabel, missingLabel: true };
        if (throwOnError) throw new Error(t('admin.forms.labelMissing'));
        return false;
    }

    if (isSaving.value) {
        hasPendingAutosave.value = true;
        return false;
    }
    isSaving.value = true;

    try {
        const schemaForSave = schemaWithNormalizedRetention(editableSchema.value);
        const unavailableSourceKeys = contextSettings?.unavailableKeys() ?? new Set<string>();
        const submittedUnavailableSources = (schemaForSave.contextSources || [])
            .filter(source => unavailableSourceKeys.has(contextSourceKey(source)));
        editableSchema.value = schemaForSave;
        const mutationVersionAtSave = editorMutationVersion.value;
        const result = await $fetch<{ success: boolean, changed?: string | null, schema?: FormSchema }>(`/api/admin/schemas/${schemaId}`, {
            method: 'PATCH',
            body: {
                schema: schemaForSave,
                publicationScope: publicationScope.value,
                referencePattern: normalizeReferencePattern(referencePattern.value),
                expectedChanged: lastKnownSchemaChanged.value
            }
        });

        lastKnownSchemaChanged.value = result.changed ?? lastKnownSchemaChanged.value;
        lastSavedAt.value = Date.now();
        saveProblem.value = null;
        savedMutationVersion.value = mutationVersionAtSave;
        const hasNewerLocalMutation = editorMutationVersion.value !== mutationVersionAtSave;
        const canonicalRemovedSourceKeys = result.schema
            ? contextSettings?.removedKeys(schemaForSave, result.schema) ?? new Set<string>()
            : new Set<string>();
        if (result.schema && !hasNewerLocalMutation) {
            applyPersistedSchema(result.schema);
            if (canonicalRemovedSourceKeys.size > 0) {
                contextSettings?.setRemoved(true);
            }
        } else if (result.schema && hasNewerLocalMutation) {
            if (contextSettings?.removeRejected(canonicalRemovedSourceKeys)) {
                contextSettings?.setRemoved(true);
            }
        } else if (submittedUnavailableSources.length > 0 && !hasNewerLocalMutation) {
            if (contextSettings?.removeRejected(unavailableSourceKeys)) {
                contextSettings?.setRemoved(true);
            }
        }
        const shouldRefreshSchema = !hasNewerLocalMutation
          && (refreshSchema || (submittedUnavailableSources.length > 0 && !result.schema));
        if (shouldRefreshSchema) {
            const mutationVersionBeforeRefresh = editorMutationVersion.value;
            await refresh();
            lastKnownSchemaChanged.value = schemaResponse.value?.data?.attributes?.changed ?? lastKnownSchemaChanged.value;
            const refreshedSchema = parseResponseSchema();
            if (editorMutationVersion.value === mutationVersionBeforeRefresh) {
                if (refreshedSchema) {
                    applyPersistedSchema(refreshedSchema, {
                        publicationScope: parseResponsePublicationScope(),
                        referencePattern: parseResponseReferencePattern()
                    });
                }
                if (submittedUnavailableSources.length > 0) {
                    const persistedSourceKeys = new Set(
                        (refreshedSchema?.contextSources || []).map(contextSourceKey)
                    );
                    contextSettings?.setRemoved(submittedUnavailableSources
                        .some(source => !persistedSourceKeys.has(contextSourceKey(source))));
                }
            }
        }
        await refreshNuxtData('admin-schemas');
        if (showToast) {
            toast.add({
                title: t('admin.forms.editorSaved'),
                color: 'success'
            });
        }
        return true;
    } catch (e) {
        // A refusal that names a field (a condition with a blank value) says so in the
        // person's words, marks the field and opens its condition; no retry, it cannot work.
        const refusal = schemaRefusalOf(e);
        saveProblem.value = refusal
            ? { kind: 'invalid', reason: t('admin.forms.conditionValueEmpty'), fieldId: refusal.fieldId }
            : saveProblemFor(e);
        if (refusal) revealRefusedCondition(refusal.fieldId);
        if (showErrorToast) {
            toast.add({
                title: t('admin.forms.editorSaveError'),
                description: refusal ? t('admin.forms.conditionValueEmpty') : resolveApiErrorMessage(e),
                color: 'error'
            });
        }
        if (throwOnError) {
            throw e;
        }
        return false;
    } finally {
        isSaving.value = false;
        if (hasPendingAutosave.value) {
            hasPendingAutosave.value = false;
            void saveCurrentSchema({ showToast: false, refreshSchema: false, showErrorToast: false });
        }
    }
}

async function undoLastSchemaChange() {
    if (isSaving.value || isEditorMutationLocked.value) return;
    flushTextCommit(true);
    const change = lastSchemaChange.value;
    if (!change || !editableSchema.value) return;

    if (autosaveTimer.value) {
        clearTimeout(autosaveTimer.value);
        autosaveTimer.value = null;
    }

    const schemaBeforeUndo = cloneFormSchema(editableSchema.value);
    const selectedFieldBeforeUndo = copySelectedFieldLocation();
    const fieldChatGenerationsBeforeUndo = { ...fieldChatGenerations.value };

    editableSchema.value = {
        ...cloneFormSchema(change.previousSchema),
        id: schemaId
    };
    fieldChatGenerations.value = { ...change.previousFieldChatGenerations };
    selectedField.value = change.previousSelectedField
        ? { ...change.previousSelectedField }
        : null;
    // Below 1280 px the sheet keeps its state. Opened here, it shut again 0.3 s later
    // when the focus went back to the field in the form (outside the non-modal sheet).
    const sheetWasOpen = isInspectorOpen.value;
    isInspectorOpen.value = !!selectedField.value && (isWideLayout.value || sheetWasOpen);

    try {
        await saveCurrentSchema({ showToast: false, refreshSchema: false, throwOnError: true });
        lastSchemaChange.value = null;
        const undoMessage = t('admin.forms.undoApplied');
        const undoActionKind: EditorActionKind = change.summary.kind === 'field_deleted'
            ? 'field_deleted'
            : change.summary.kind === 'field_updated'
                ? 'field_updated'
                : 'schema_updated';
        const undoScopeKey = activeChatScopeKey.value;
        addMessage('assistant', undoMessage, {
            scopeKey: undoScopeKey,
            sendToAi: true,
            aiContent: editorActionAiContent(undoActionKind, 'undone')
        });
        if (undoScopeKey !== schemaChatScopeKey) {
            addMessage('assistant', undoMessage, {
                scopeKey: schemaChatScopeKey,
                sendToAi: true,
                aiContent: editorActionAiContent(undoActionKind, 'undone')
            });
        }
        // Undo answers once, beside its button (and in the live region); no toast.
        announceStructure(t('admin.forms.undoApplied'));
        showUndoFeedback(t('admin.forms.undoApplied'));

        nextTick(() => {
            // After undoing a section move the focus is on that section's head (its
            // title, the named control there), and the form shows it; it went to "Chat öffnen".
            if (change.summary.kind === 'section_moved') {
                const title = document.querySelector<HTMLElement>(`[data-section-title-button="${CSS.escape(change.summary.sectionId)}"]`);
                if (title) {
                    title.focus({ preventScroll: true });
                    title.scrollIntoView?.({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
                    return;
                }
            }
            if (selectedField.value) {
                focusSelectedField();
                return;
            }

            focusChatToggle();
        });
    } catch {
        editableSchema.value = schemaBeforeUndo;
        fieldChatGenerations.value = fieldChatGenerationsBeforeUndo;
        selectedField.value = selectedFieldBeforeUndo;
        isInspectorOpen.value = !!selectedField.value && (isWideLayout.value || sheetWasOpen);
        lastSchemaChange.value = change;
    }
}

// "Zurück zur Einrichtung" (UX review 10.11.2026): the round trip is
// "fix one label, click back", often within the 800 ms autosave debounce.
// A waiting change is saved at once and a running save is awaited, so the
// setup screen loads the stored draft; if saving fails, the editor stays.
const leavingToSetup = ref(false);

async function untilSaveSettled() {
    while (isSaving.value) {
        await new Promise<void>((resolve) => {
            const stop = watch(isSaving, (saving) => {
                if (saving) return;
                stop();
                resolve();
            });
        });
    }
}

async function returnToSetup() {
    if (leavingToSetup.value) return;
    leavingToSetup.value = true;
    try {
        const waiting = autosaveTimer.value !== null;
        if (autosaveTimer.value) {
            clearTimeout(autosaveTimer.value);
            autosaveTimer.value = null;
        }
        await untilSaveSettled();
        if (waiting && !(await saveCurrentSchema({ showToast: false, refreshSchema: false }))) return;
        await untilSaveSettled();
        await router.push(setupRoute.value);
    } finally {
        leavingToSetup.value = false;
    }
}

// A focused text control keeps its raw draft until blur, even if autosave takes a snapshot.
let pendingTextCommit: CommitEditorText | undefined;
const pendingInspectorUndo = ref(false);
let committingTextForSave = false;

function queueInspectorText(commit: CommitEditorText) {
    queueTextCommit(commit);
    pendingInspectorUndo.value = true;
}

function queueTextCommit(commit: CommitEditorText) {
    if (pendingTextCommit && pendingTextCommit !== commit) flushTextCommit(true);
    pendingTextCommit = commit;
    recordEditorMutation();
    scheduleAutosave();
}

// Commit from the old inspector before Vue retargets it or swaps the sheet and column.
watch([() => selectedField.value?.sectionId, () => selectedField.value?.fieldId, isInspectorOpen, isWideLayout], () => {
    if (pendingInspectorUndo.value) flushTextCommit(true);
}, { flush: 'sync' });

function flushTextCommit(finishEditing = false) {
    const commit = pendingTextCommit;
    pendingTextCommit = undefined;
    pendingInspectorUndo.value = false;
    commit?.(editableSchema.value ?? undefined, finishEditing);
}

function scheduleAutosave() {
    if (isEditorMutationLocked.value || committingTextForSave) return;

    if (autosaveTimer.value) {
        clearTimeout(autosaveTimer.value);
    }

    autosaveTimer.value = setTimeout(() => {
        autosaveTimer.value = null;
        if (isAssigningOrganisation.value) {
            scheduleAutosave();
            return;
        }
        void saveCurrentSchema({ showToast: false, refreshSchema: false, showErrorToast: false });
    }, 800);
}

/**
 * "Nicht gespeichert, erneut versuchen": the same request as the
 * autosave, without reloading the form, so scroll position, selection and focus stay.
 */
async function retrySave() {
    if (retryingSave.value) return;
    if (autosaveTimer.value) {
        clearTimeout(autosaveTimer.value);
        autosaveTimer.value = null;
    }
    retryingSave.value = true;
    try {
        await untilSaveSettled();
        await saveCurrentSchema({ showToast: false, refreshSchema: false, showErrorToast: false });
    } finally {
        retryingSave.value = false;
    }
}

/** When the network comes back after a failed save, the editor tries once by itself. */
function onBrowserOnline() {
    if (saveProblem.value?.kind === 'failed' && !isSaving.value) void retrySave();
}
if (typeof window !== 'undefined') {
    window.addEventListener('online', onBrowserOnline);
    onUnmounted(() => window.removeEventListener('online', onBrowserOnline));
}

/**
 * After a conflict the stored form differs from this one; only loading it again helps, and the
 * change that could not be saved is lost (the button says so). The same load the editor
 * already does after a save with refresh.
 */
async function reloadAfterConflict() {
    if (autosaveTimer.value) {
        clearTimeout(autosaveTimer.value);
        autosaveTimer.value = null;
    }
    await refresh();
    const reloaded = parseResponseSchema();
    if (!reloaded) return;
    lastKnownSchemaChanged.value = schemaResponse.value?.data?.attributes?.changed ?? lastKnownSchemaChanged.value;
    applyPersistedSchema(reloaded, {
        publicationScope: parseResponsePublicationScope(),
        referencePattern: parseResponseReferencePattern()
    });
    lastSchemaChange.value = null;
    saveProblem.value = null;
    savedMutationVersion.value = editorMutationVersion.value;
    reconcileSelectedField(editableSchema.value);
}

/*
 * Leaving the editor with a change that is not saved. A waiting change is
 * saved at once (as "Zurück zur Einrichtung" does); if it still is not saved, the framework's
 * dialog asks before anything is dropped.
 */
const pendingLeave = ref<string | null>(null);
let leaveConfirmed = false;

onBeforeRouteLeave(async (to) => {
    if (leaveConfirmed || !canInspectDraftFields.value) return true;
    const waiting = autosaveTimer.value !== null;
    if (waiting) {
        clearTimeout(autosaveTimer.value!);
        autosaveTimer.value = null;
    }
    await untilSaveSettled();
    if (waiting && !saveProblem.value) {
        await saveCurrentSchema({ showToast: false, refreshSchema: false, showErrorToast: false });
    }
    if (editorMutationVersion.value === savedMutationVersion.value) return true;
    pendingLeave.value = to.fullPath;
    return false;
});

/*
 * A reload or closing the tab dropped a change that was not saved (a save
 * that failed or was refused, or one still waiting or running) without the browser's question; only
 * leaving inside the app asked (above). The shared guard registers the browser's question for exactly
 * this condition; in-app leaving stays with the guard above (`routes: false`).
 */
useUnsavedChangesGuard(computed(() => canInspectDraftFields.value && editorMutationVersion.value !== savedMutationVersion.value), { routes: false });

async function confirmLeave() {
    const target = pendingLeave.value;
    pendingLeave.value = null;
    if (!target) return;
    leaveConfirmed = true;
    await router.push(target);
}

function cancelLeave() {
    pendingLeave.value = null;
}

async function confirmPublish() {
    if (!confirmingPublish.value || schemaStatusUpdating.value) return;
    await updateSchemaStatus('published', { confirmed: true });
    confirmingPublish.value = false;
    await nextTick();
    // A published form has no "Veröffentlichen" any more; after a refusal the
    // focus goes back to it.
    document.getElementById('editor-publish')?.focus();
}

async function confirmDraft() {
    if (!confirmingDraft.value || schemaStatusUpdating.value) return;
    await updateSchemaStatus('draft', { confirmed: true });
    confirmingDraft.value = false;
    await nextTick();
    // Back on the draft the filled button is "Veröffentlichen"; after a failure "Als Entwurf setzen" stays.
    (document.getElementById('editor-move-to-draft') ?? document.getElementById('editor-publish'))?.focus();
}

/** "Abbrechen" takes the focus when the question opens (pattern "Questions before a change of state"). */
function focusDraftCancel(event: Event) {
    event.preventDefault();
    void nextTick(() => document.querySelector<HTMLElement>('[data-test="move-to-draft-cancel"]')?.focus());
}

async function cancelDraft() {
    if (schemaStatusUpdating.value) return;
    confirmingDraft.value = false;
    await nextTick();
    document.getElementById('editor-move-to-draft')?.focus();
}

async function cancelPublish() {
    if (schemaStatusUpdating.value) return;
    confirmingPublish.value = false;
    await nextTick();
    document.getElementById('editor-publish')?.focus();
}

async function updateSchemaStatus(newStatus: 'draft' | 'published', options: { confirmed?: boolean } = {}) {
    if (isDeletingDraft.value) return;
    if (newStatus === 'published' && publishForbidden.value) {
        toast.add({ title: t('errors.schema.publishForbidden'), color: 'error' });
        return;
    }

    if (newStatus === 'published') {
        flushTextCommit(true);
        const blockers = publishBlockers(editableSchema.value, 'privacy');
        if (blockers) {
            showPublishRefusal(blockers);
            return;
        }
        if (publishOrganisationMissing.value) return;
        if (!options.confirmed) {
            // Ask first; nothing is saved or changed until "Jetzt veröffentlichen".
            confirmingPublish.value = true;
            return;
        }
    }

    if (newStatus === 'draft' && !options.confirmed) {
        // Ask first, in the dialog of the form page; nothing changes until confirmed.
        confirmingDraft.value = true;
        return;
    }

    if (autosaveTimer.value) {
        clearTimeout(autosaveTimer.value);
        autosaveTimer.value = null;
    }

    schemaStatusUpdating.value = true;
    try {
        if (newStatus === 'published') {
            try {
                const saved = await saveCurrentSchema({
                    showToast: false,
                    refreshSchema: true,
                    throwOnError: true,
                    showErrorToast: false,
                    allowDuringStatusUpdate: true
                });
                if (!saved) return;
            } catch (e) {
                toast.add({
                    title: t('admin.forms.editorSaveError'),
                    description: resolveApiErrorMessage(e),
                    color: 'error'
                });
                return;
            }
        }

        await $fetch(`/api/admin/schemas/${schemaId}/status`, {
            method: 'PATCH',
            body: { status: newStatus }
        });
        const mutationVersionBeforeRefresh = editorMutationVersion.value;
        await refresh();
        lastKnownSchemaChanged.value = schemaResponse.value?.data?.attributes?.changed ?? lastKnownSchemaChanged.value;
        if (editorMutationVersion.value === mutationVersionBeforeRefresh) {
            const refreshedSchema = parseResponseSchema();
            if (refreshedSchema) {
                applyPersistedSchema(refreshedSchema, {
                    publicationScope: parseResponsePublicationScope(),
                    referencePattern: parseResponseReferencePattern()
                });
            }
        }
        await refreshNuxtData('admin-schemas');
        void setup?.refresh();
        if (newStatus === 'published') {
            // The second line fits the form; the workflow sentence
            // only with applications. The count does not hold up the editor.
            const scope = publicationScope.value;
            void loadFormApplicationCount([...new Set([schemaResourceId.value, schemaId])], withWorkspaceQuery()).then((applicationCount) => {
                const description = publishSuccessDescription(t, { scope, applicationCount });
                toast.add({
                    title: t('admin.forms.publishSuccess'),
                    ...(description ? { description } : {}),
                    color: 'success'
                });
            });
        } else {
            toast.add({ title: t('admin.forms.draftSuccess'), color: 'success' });
        }
    } catch (e) {
        console.error('[admin] Failed to update schema status:', e);
        // A refusal names the fields readably and leads to the first one.
        const refusalKind = publishRefusalKind(e);
        const blockers = refusalKind ? publishBlockers(editableSchema.value, refusalKind) : null;
        if (newStatus === 'published' && blockers) {
            showPublishRefusal(blockers);
        } else {
            toast.add({
                title: t('admin.forms.statusUpdateError'),
                description: resolveApiErrorMessage(e),
                color: 'error'
            });
        }
    } finally {
        schemaStatusUpdating.value = false;
    }
}

/**
 * A refused publish: how many fields are open, the first few by the
 * name the canvas shows, and a way to the first one. Derived from the form in
 * the editor, which the publish route checks the same way.
 */
function showPublishRefusal(blockers: PublishBlockers) {
    const { names } = namedBlockerFields(blockers);
    const first = blockers.issues[0];
    const count = blockers.issues.length;
    toast.add({
        title: t('admin.forms.publishRefused.title'),
        description: blockers.kind === 'privacy'
            ? t('admin.forms.publishRefused.privacy', { count, fields: names }, count)
            : t('admin.forms.publishRefused.duplicateCrmKey', { count, fields: names }),
        color: 'error',
        ...(first
            ? {
                actions: [{
                    label: t('admin.forms.publishRefused.openFirst'),
                    color: 'neutral' as const,
                    variant: 'outline' as const,
                    onClick: () => jumpToAuthoringIssue(first)
                }]
            }
            : {})
    });
}

function onPublicationScopeChange(value: string) {
    if (isEditorMutationLocked.value) return;

    publicationScope.value = value === 'intranet' ? 'intranet' : 'internet';
    scheduleAutosave();
}

function onReferencePatternInput(value: string) {
    if (isEditorMutationLocked.value) return;

    referencePattern.value = value;
    scheduleAutosave();
}

/*
 * Inspector edits are undo steps as well. The inspector reports every
 * keystroke, so a typing burst collapses into one step that goes back to the
 * state before its first edit: consecutive edits of the same field while it
 * stays selected, each at most INSPECTOR_UNDO_BURST_MS after the previous one.
 */
const INSPECTOR_UNDO_BURST_MS = 2000;

// Selecting another field ends the burst, even if the same field comes back.
watch(() => selectedField.value?.fieldId, () => {
    if (lastSchemaChange.value?.inspectorFieldId) lastSchemaChange.value.inspectorFieldId = undefined;
});

/*
 * A type chosen in the inspector that would break conditions is asked first, with the fields
 * named; nothing changes until it is confirmed. A type that follows from the label (the inference)
 * is not asked while the person types: it applies and the editor warns, as for every other change.
 */
const pendingTypeChange = ref<{ schema: FormSchema, dependents: Array<{ fieldLabel: string, sourceLabel: string }>, losses: string[] } | null>(null);

/** What a type change drops, in the person's words, before it happens. */
function typeChangeLossTexts(before: FormSchema, after: FormSchema): string[] {
    const fieldId = selectedField.value?.fieldId;
    const find = (schema: FormSchema) => schema.sections.flatMap(section => section.fields).find(field => field.id === fieldId);
    const previous = find(before);
    const next = find(after);
    if (!previous || !next) return [];
    return typeChangeLosses(previous, next).map((loss) => {
        // The setting by the label of its own input field.
        const name = SETTING_LABEL_KEYS[loss.setting].map(key => t(key)).join(', ');
        if (loss.setting === 'uploadLimits') {
            return typeof loss.value === 'number'
                ? t('admin.forms.typeChangeDialog.lossFiles', { count: loss.value }, loss.value)
                : t('admin.forms.typeChangeDialog.lossSize', { size: String(loss.value ?? '') });
        }
        if (loss.setting === 'options') return t('admin.forms.typeChangeDialog.lossOptions', { count: Number(loss.value) }, Number(loss.value));
        // "Format: currency" named the stored value; a value is named by its
        // option label, from the same keys as the format's select ("Betrag").
        // Numbers in the person's notation ("0,01", not "0.01").
        const value = loss.setting === 'format'
            ? t(`admin.fieldInspector.fieldFormats.${String(loss.value)}`)
            : typeof loss.value === 'number' ? new Intl.NumberFormat(locale.value === 'en' ? 'en-GB' : 'de-DE').format(loss.value) : String(loss.value);
        return loss.value === undefined ? name : t('admin.forms.typeChangeDialog.lossValue', { name, value });
    });
}

function isExplicitTypeChange(before: FormSchema, after: FormSchema): boolean {
    const fieldId = selectedField.value?.fieldId;
    const find = (schema: FormSchema) => schema.sections.flatMap(section => section.fields).find(field => field.id === fieldId);
    const previous = find(before);
    const next = find(after);
    return !!previous && !!next && previous.type !== next.type && previous.label === next.label;
}

function onInspectorSchemaUpdate(schema: FormSchema) {
    if (!isDraftInspectActive.value || !editableSchema.value) return;
    pendingInspectorUndo.value = false;
    const effects = conditionTypeChangeEffects(editableSchema.value, schema, t('admin.fieldInspector.untitledField'));
    if (isExplicitTypeChange(editableSchema.value, schema)) {
        const breaking = effects.flatMap(effect => effect.dependents
            .filter(dependent => dependent.breaks)
            .map(dependent => ({ fieldLabel: dependent.fieldLabel, sourceLabel: effect.sourceLabel })));
        const losses = typeChangeLossTexts(editableSchema.value, schema);
        // Nothing is asked when nothing would be lost.
        if (breaking.length > 0 || losses.length > 0) {
            pendingTypeChange.value = { schema, dependents: breaking, losses };
            return;
        }
    }
    applyInspectorSchemaUpdate(schema, effects);
}

function confirmTypeChange() {
    const pending = pendingTypeChange.value;
    pendingTypeChange.value = null;
    if (!pending || !editableSchema.value) return;
    applyInspectorSchemaUpdate(pending.schema, conditionTypeChangeEffects(editableSchema.value, pending.schema, t('admin.fieldInspector.untitledField')));
}

function cancelTypeChange() {
    pendingTypeChange.value = null;
}

/*
 * Chosen with the keyboard, the type list sets its value on the Enter key's
 * `keydown`; the dialog opens and the framework focuses its first button (the close "x")
 * before the browser sends the `keypress` of the same Enter, which then activates that
 * button: the question was gone 236 ms later. The focus therefore lands on the dialog's
 * text (what the change drops), where a key press activates nothing; Tab reaches the buttons,
 * Escape cancels. Point 55: after either answer the focus goes back to "Typ".
 */
const typeChangeDialogBody = ref<HTMLElement | null>(null);
const typeChangeDialogContent = {
    onOpenAutoFocus: (event: Event) => {
        event.preventDefault();
        typeChangeDialogBody.value?.focus();
    },
    onCloseAutoFocus: (event: Event) => {
        event.preventDefault();
        void fieldInspector.value?.focusType?.();
    }
};

function applyInspectorSchemaUpdate(schema: FormSchema, effects: ConditionTypeChangeEffect[]) {
    if (!isDraftInspectActive.value || !editableSchema.value) return;

    const location = copySelectedFieldLocation();
    const current = lastSchemaChange.value;
    const now = Date.now();
    const continues = !!location
      && current?.inspectorFieldId === location.fieldId
      && current.inspectorEditAt !== undefined
      && now - current.inspectorEditAt <= INSPECTOR_UNDO_BURST_MS;
    const previousSchema = continues ? current.previousSchema : cloneFormSchema(editableSchema.value);
    const previousSelectedField = continues ? current.previousSelectedField : location;
    const previousFieldChatGenerations = continues ? current.previousFieldChatGenerations : { ...fieldChatGenerations.value };

    const schemaBeforeEdit = editableSchema.value;
    editableSchema.value = schema;
    noteConditionTypeChanges(schema, effects);
    const summary = summarizeSchemaChange(previousSchema, schema, previousSelectedField);
    lastSchemaChange.value = summary.kind === 'no_change' || !location
        ? null
        : { previousSchema, previousSelectedField, previousFieldChatGenerations, summary, inspectorFieldId: location.fieldId, inspectorEditAt: now };
    scheduleAutosave();
    // While a label is missing nothing is saved, so no change is answered as done.
    if (lastSchemaChange.value && firstFieldWithoutLabel(schema)) endUndoFeedback();
    // The last change is announced, no longer shown as a line in the head.
    else if (lastSchemaChange.value) {
        // A type change says how many fields depend on this answer.
        const dependents = effects.reduce((count, effect) => count + effect.dependents.length, 0);
        const dependentsText = dependents > 0 ? t('admin.forms.typeChangeDependents', { count: dependents }, dependents) : '';
        const changeText = [
            t('admin.forms.lastChange', { summary: formatSchemaChangeSummary(lastSchemaChange.value.summary) }),
            dependentsText
        ].filter(Boolean).join(' ');
        announceStructure(changeText);
        showUndoFeedback([formatSchemaChangeAnswer(lastSchemaChange.value.summary), dependentsText].filter(Boolean).join(' '), changeText);
    }
    // A renamed or removed answer, or a changed type, can break a condition.
    const brokenText = warnNewlyBrokenConditions(schemaBeforeEdit, schema);
    if (brokenText) announceStructure(brokenText);
}

function goBack() {
    router.push(workspaceRoute(`/admin/forms/${schemaId}`));
}

function openDeleteDraftDialog() {
    if (!canDeleteDraft.value || isSaving.value || isProcessing.value || schemaStatusUpdating.value || isDeletingDraft.value) {
        return;
    }

    isDeleteDraftDialogOpen.value = true;
}

function closeDeleteDraftDialog() {
    if (isDeletingDraft.value) return;

    isDeleteDraftDialogOpen.value = false;
}

async function deleteDraft() {
    const expectedChanged = lastKnownSchemaChanged.value;
    if (
        !isDeleteDraftDialogOpen.value
        || !canDeleteDraft.value
        || !expectedChanged
        || isSaving.value
        || isProcessing.value
        || schemaStatusUpdating.value
        || isDeletingDraft.value
    ) {
        return;
    }

    if (autosaveTimer.value) {
        clearTimeout(autosaveTimer.value);
        autosaveTimer.value = null;
    }
    hasPendingAutosave.value = false;

    isDeletingDraft.value = true;
    try {
        await $fetch(`/api/admin/schemas/${schemaId}`, {
            method: 'DELETE',
            query: withWorkspaceQuery({ expectedChanged })
        });
        isDeleteDraftDialogOpen.value = false;
        toast.add({
            title: t('admin.forms.deleteSuccess'),
            color: 'success'
        });
        await refreshNuxtData('admin-schemas');
        await router.push(workspaceRoute('/admin/forms'));
    } catch (e) {
        toast.add({
            title: t('admin.forms.deleteError'),
            description: resolveApiErrorMessage(e),
            color: 'error'
        });
    } finally {
        isDeletingDraft.value = false;
    }
}

function clampFloatingChatPosition(top: number, left: number) {
    const margin = 16;
    const chatWidth = getFloatingChatWidth();
    const maxTop = Math.max(margin, window.innerHeight - floatingChatSize.height - margin);
    const maxLeft = Math.max(margin, window.innerWidth - chatWidth - margin);

    const next = {
        top: Math.round(Math.min(Math.max(top, margin), maxTop)),
        left: Math.round(Math.min(Math.max(left, margin), maxLeft))
    };
    // A place that does not change changes no state.
    if (next.top === floatingChatPosition.value.top && next.left === floatingChatPosition.value.left) return;
    floatingChatPosition.value = next;
}

function getFloatingChatWidth() {
    if (typeof window === 'undefined') {
        return floatingChatSize.width;
    }

    return Math.max(280, Math.min(floatingChatSize.width, window.innerWidth - 32));
}

function dockFloatingChatToSelectedField() {
    const fieldElement = getSelectedFieldElement();
    if (!fieldElement) return;

    const fieldRect = fieldElement.getBoundingClientRect();
    const sidebarOffset = window.innerWidth >= 768 ? 288 : 16;
    const desiredLeft = Math.min(fieldRect.left - getFloatingChatWidth() - 20, sidebarOffset);
    const desiredTop = fieldRect.top + Math.min(0, fieldRect.height / 2 - 72);
    clampFloatingChatPosition(desiredTop, desiredLeft);
}

function dockFloatingChatDefault() {
    const desiredLeft = window.innerWidth >= 768
        ? Math.max(304, window.innerWidth - getFloatingChatWidth() - 32)
        : 16;
    clampFloatingChatPosition(96, desiredLeft);
}

/** The latest pointer of a chat drag, placed with the next animation frame. */
let chatDragPointer: { x: number, y: number } | null = null;
let chatDragFrame: number | null = null;

function placeDraggedChat() {
    chatDragFrame = null;
    const pointer = chatDragPointer;
    chatDragPointer = null;
    if (!pointer) return;
    clampFloatingChatPosition(pointer.y - dragOffset.value.y, pointer.x - dragOffset.value.x);
}

function onChatDragMove(event: PointerEvent) {
    if (!isDraggingChat.value) return;
    chatDragPointer = { x: event.clientX, y: event.clientY };
    if (chatDragFrame === null) chatDragFrame = requestAnimationFrame(placeDraggedChat);
}

function stopChatDrag() {
    isDraggingChat.value = false;
    window.removeEventListener('pointermove', onChatDragMove);
    window.removeEventListener('pointerup', stopChatDrag);
    // The window ends where the pointer let go.
    if (chatDragFrame !== null) cancelAnimationFrame(chatDragFrame);
    placeDraggedChat();
}

function startChatDrag(event: PointerEvent) {
    if (window.innerWidth < 768) return;

    const target = event.target as HTMLElement;
    if (target.closest('button, input, textarea, select, a')) return;

    event.preventDefault();
    isDraggingChat.value = true;
    dragOffset.value = {
        x: event.clientX - floatingChatPosition.value.left,
        y: event.clientY - floatingChatPosition.value.top
    };
    window.addEventListener('pointermove', onChatDragMove);
    window.addEventListener('pointerup', stopChatDrag);
}

function openFloatingChat() {
    if (!isDraftInspectActive.value) return;

    isChatOpen.value = true;
    nextTick(() => {
        if (selectedFieldDetails.value) {
            dockFloatingChatToSelectedField();
        } else {
            dockFloatingChatDefault();
        }
        focusFloatingChat();
    });
}

/** The inspector asks for a chat request; the person reviews and sends it. */
function prefillFloatingChat(message: string) {
    if (!formFeatures) return;
    if (!isDraftInspectActive.value) return;

    openFloatingChat();
    nextTick(() => {
        chatPanel.value?.prefillInput(message);
    });
}

function closeFloatingChat() {
    isChatOpen.value = false;
    if (selectedFieldDetails.value) {
        focusSelectedField();
    } else {
        nextTick(() => {
            focusChatToggle();
        });
    }
}

function onFloatingChatKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;

    event.preventDefault();
    closeFloatingChat();
}

const onChatSend = formFeatures?.useEditorChat({
    editableSchema,
    isProcessing,
    isSaving,
    flushTextCommit,
    selectedField,
    isInspectorOpen,
    activeChatScopeKey,
    addMessage,
    isDraftInspectActive,
    copySelectedFieldLocation,
    requestStructureDelete,
    moveSelectedFieldStep,
    editorActionAiContent,
    schemaId,
    registerSchemaChange,
    formatSchemaChangeSummary,
    focusChangedField,
    scheduleAutosave,
    editorMutationVersion,
    authoritativeEditorStateVersion,
    buildSelectedFieldChatContext,
    chatHistoryForScope,
    draftInspectEnabled,
    isEditorMutationLocked,
    updateSelectedField,
    reconcileSelectedField,
    retireDeletedFieldChatScopes,
    schemaChatScopeKey,
    focusFloatingChat,
    findFieldLabel
});

const chatContext = {
    isChatOpen,
    editableSchema,
    floatingChat,
    onFloatingChatKeydown,
    startChatDrag,
    selectedFieldChatTitle,
    closeFloatingChat,
    chatPanel,
    activeChatScopeKey,
    schemaLabel,
    chatMessages,
    isProcessing,
    onChatSend,
    goBack
};

watch(editableSchema, (schema) => {
    reconcileSelectedField(schema);
});

watch(selectedFieldDetails, (details) => {
    if (!details) {
        isInspectorOpen.value = false;
    }
});

watch(isEditorMutationLocked, (locked) => {
    if (!locked) return;

    selectedField.value = null;
    isInspectorOpen.value = false;
    isChatOpen.value = false;
    lastSchemaChange.value = null;
});

watch(draftInspectEnabled, (enabled) => {
    overviewFieldId = undefined;
    if (enabled) return;

    selectedField.value = null;
    isInspectorOpen.value = false;
    isChatOpen.value = false;
});

onUnmounted(() => {
    if (autosaveTimer.value) {
        clearTimeout(autosaveTimer.value);
        autosaveTimer.value = null;
    }
    hasPendingAutosave.value = false;
    stopChatDrag();
});
</script>

<template>
  <!-- The frame renders the page's one h1 (hidden in full bleed); the work frame below is the head. -->
  <AppPageLayout
    full-bleed
    :title="`${editorPageName}: ${schemaLabel}`"
  >
    <div class="flex min-h-0 flex-1 flex-col bg-default">
      <p
        class="sr-only"
        aria-live="polite"
        aria-atomic="true"
        data-test="structure-announcement"
      >
        {{ structureAnnouncement }}
      </p>

      <UAlert
        v-if="schemaError"
        color="error"
        icon="i-lucide-circle-x"
        :title="t('admin.forms.formNotFound')"
        :description="t('admin.forms.formNotFoundDescription')"
        class="m-6 flex-1"
      />

      <div
        v-else-if="schemaStatus === 'pending'"
        class="p-6 space-y-4"
      >
        <USkeleton class="h-10 w-1/3" />
        <USkeleton class="h-96 w-full" />
      </div>

      <UAlert
        v-else-if="parseError"
        color="error"
        icon="i-lucide-circle-x"
        :title="t('admin.forms.schemaParseError')"
        :description="t('admin.forms.schemaParseErrorDescription')"
        class="m-6 flex-1"
      />

      <template v-else-if="editableSchema">
        <!-- Desktop has two toolbar rows. On phones the two mode labels have their own row. -->
        <section
          class="flex min-h-0 flex-1 flex-col"
          aria-labelledby="schema-editor-preview-title"
        >
          <AdminEditorHead
            :tools="editorHeadTools"
            :back="{ to: workspaceRoute(`/admin/forms/${schemaId}`), label: t('admin.forms.backToFormPage'), attrs: { 'data-test': 'editor-back' } }"
            @answer-room="(width: number) => answerRoom = width"
          >
            <template #signals>
              <AdminEditorIssueBadge
                v-if="openPointCount"
                :groups="authoringIssueGroups"
                :count="openPointCount"
                @open="openOverviewIssues"
              />
            </template>
            <template #title>
              <h2
                id="schema-editor-preview-title"
                class="flex min-w-0"
              >
                <UPopover
                  :content="{ align: 'start' }"
                  :ui="VIEWPORT_BOUND_UI"
                >
                  <UButton
                    color="neutral"
                    variant="link"
                    :aria-label="schemaLabel"
                    data-test="editor-title-button"
                  >
                    <span
                      class="truncate"
                      data-test="editor-title-text"
                    >{{ schemaLabel }}</span>
                  </UButton>
                  <template #content>
                    <p
                      class="max-w-xs break-words p-3 text-sm"
                      data-test="editor-title-full"
                    >
                      {{ schemaLabel }}
                    </p>
                  </template>
                </UPopover>
              </h2>
            </template>
            <template #status>
              <StatusBadge
                :status="schemaWorkflowStatus"
                type="schema"
                data-test="editor-status-badge"
              />
            </template>
            <template #reason>
              <UPopover
                v-if="headReason"
                :content="{ align: 'start' }"
                :ui="VIEWPORT_BOUND_UI"
              >
                <UButton
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  icon="i-lucide-lock"
                  :aria-label="headReason.text"
                  :data-test="headReason.test ?? 'editor-head-reason'"
                >
                  <span
                    :id="headReason.id"
                    class="sr-only"
                  >{{ headReason.text }}</span>
                </UButton>
                <template #content>
                  <div
                    class="max-w-sm space-y-3 p-4 text-sm"
                    data-test="editor-head-reason-text"
                  >
                    <p>{{ headReason.text }}</p>
                    <UButton
                      v-if="headReason.settingsLink"
                      color="neutral"
                      variant="outline"
                      @click="isSettingsOpen = true"
                    >
                      {{ t('admin.forms.formSettings') }}
                    </UButton>
                  </div>
                </template>
              </UPopover>
            </template>

            <template #save>
              <AdminEditorSaveState
                v-if="canInspectDraftFields"
                :source="saveStateSource"
                :retrying="retryingSave"
                :reason="saveProblem?.reason"
                :invalid-target="saveProblem?.missingLabel ? 'label' : saveProblem?.fieldId ? 'condition' : 'settings'"
                @retry="retrySave"
                @reload="reloadAfterConflict"
                @open-settings="onSaveProblemAction"
              />
            </template>
            <template #actions>
              <UButton
                v-if="setupEligible && isWideLayout"
                icon="i-lucide-list-checks"
                size="sm"
                color="neutral"
                variant="outline"
                :loading="leavingToSetup"
                @click="returnToSetup"
              >
                {{ formFeatures?.setupResumeLabel(t, openedFromSetup) }}
              </UButton>
              <UButton
                v-if="canInspectDraftFields && !publishForbidden"
                id="editor-publish"
                :loading="schemaStatusUpdating && confirmingPublish"
                :disabled="!editableSchema || isSaving || isProcessing || schemaStatusUpdating || isDeletingDraft || blockingSchemaAuthoringIssues.length > 0 || publishOrganisationMissing"
                :aria-describedby="publishBlockingIssueIds || undefined"
                size="sm"
                data-test="editor-publish"
                @click="updateSchemaStatus('published')"
              >
                <UIcon
                  name="i-lucide-send"
                  aria-hidden="true"
                  data-test="editor-publish-icon"
                />
                {{ t('admin.forms.publish') }}
              </UButton>
              <UButton
                v-if="isPublishedSchema"
                id="editor-move-to-draft"
                size="sm"
                icon="i-lucide-undo-2"
                color="neutral"
                variant="outline"
                :loading="schemaStatusUpdating"
                :disabled="!editableSchema || isSaving || schemaStatusUpdating || isDeletingDraft"
                @click="updateSchemaStatus('draft')"
              >
                {{ t('admin.forms.moveToDraft') }}
              </UButton>
              <UTooltip
                v-if="isWideLayout && canOpenPublicFormPreview"
                :text="t('admin.forms.openPublicForm')"
              >
                <UButton
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-external-link"
                  :to="publicFormPreviewPath"
                  target="_blank"
                  rel="noopener"
                  :aria-label="t('admin.forms.openPublicFormNewTab')"
                />
              </UTooltip>
            </template>

            <template
              v-if="canInspectDraftFields"
              #undo
            >
              <!-- "Rückgängig" keeps its place in "Nur ansehen" (disabled). -->
              <UTooltip
                :text="pendingInspectorUndo ? t('admin.forms.undoLastChange') : lastChangeSummaryText ? t('admin.forms.lastChange', { summary: lastChangeSummaryText }) : t('admin.forms.undoNothing')"
              >
                <!-- A save in flight makes it unavailable only for a moment; it is
                       aria-disabled then (undoLastSchemaChange refuses during a save), so a focus
                       on it is never dropped by the browser. -->
                <UButton
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  icon="i-lucide-undo-2"
                  :disabled="!draftInspectEnabled"
                  :aria-disabled="isSaving || (!lastSchemaChange && !pendingInspectorUndo) ? 'true' : undefined"
                  :aria-label="t('admin.forms.undoLastChange')"
                  data-test="editor-undo"
                  @click="undoLastSchemaChange"
                >
                  {{ t('admin.forms.undo') }}
                </UButton>
              </UTooltip>
            </template>
            <template
              v-if="canInspectDraftFields"
              #mode
            >
              <UTabs
                v-mode-tabs="t('admin.forms.editorMode.label')"
                :model-value="draftInspectEnabled ? 'edit' : 'view'"
                :items="editorModeItems"
                :content="false"
                color="neutral"
                size="sm"
                variant="link"
                data-test="editor-mode"
                @update:model-value="onEditorModeChange"
              />
            </template>

            <!-- What the last change or undo did, beside the button, for a few seconds.
                 in the head's fixed place, one line, cut when long. what
                 changed comes first; the text is a button whose popover holds the full sentence
                 (mouse, keyboard, touch), and the live region says the full sentence once. -->
            <template #answer>
              <p
                v-if="canInspectDraftFields && draftInspectEnabled && undoFeedback && answerInRow"
                :key="undoFeedback.key"
                ref="undoAnswer"
                class="flex min-w-0 items-center gap-2 text-sm text-muted"
                data-test="editor-undo-feedback"
              >
                <UPopover
                  v-model:open="answerDetailsOpen"
                  :content="{ align: 'start' }"
                >
                  <UButton
                    color="neutral"
                    variant="link"
                    class="min-w-0"
                    data-test="editor-undo-feedback-text"
                  >
                    <span class="truncate">{{ undoFeedback.text }}</span>
                  </UButton>
                  <template #content>
                    <p
                      class="max-w-sm p-3 text-sm"
                      data-test="editor-undo-feedback-full"
                    >
                      {{ undoFeedback.full }}
                    </p>
                  </template>
                </UPopover>
                <UButton
                  v-if="undoFeedback.restore && lastSchemaChange"
                  color="neutral"
                  variant="link"
                  class="shrink-0"
                  :aria-disabled="isSaving ? 'true' : undefined"
                  data-test="editor-restore"
                  @click="undoLastSchemaChange"
                >
                  {{ t('admin.forms.restoreDeleted') }}
                </UButton>
              </p>
            </template>
          </AdminEditorHead>

          <div
            v-if="setupWorkspaceMismatch || setupIneligibleReason"
            class="shrink-0 px-4 py-2"
          >
            <AdminOfficeWorkspaceNotice
              v-if="setupWorkspaceMismatch"
              :title="t('admin.setup.officeWorkspaceTitle')"
              :office-path="setupWorkspaceMismatch.path"
              data-test="setup-office-workspace"
            />
            <UAlert
              v-else-if="setupIneligibleReason"
              icon="i-lucide-info"
              :title="formFeatures?.setupIneligibleText(t, setupIneligibleReason)"
              data-test="setup-ineligible-reason"
            />
          </div>

          <AdminEditorSplitLayout
            ref="editorSplit"
            :wide="isWideLayout"
            :account="user?.uid"
            :workspace="selectedWorkspaceKey"
            data-test="editor-body"
          >
            <!-- Positioned, so the hidden texts of the form (`sr-only`, the sections'
                 places, the announcements) stay inside this scroll area, as in the inspector. -->
            <div
              class="relative min-h-0 min-w-0 flex-1 overflow-y-auto"
              data-test="editor-canvas-scroll"
            >
              <div
                ref="structureCanvas"
                class="relative outline-none"
                tabindex="-1"
                data-test="structure-canvas"
                @keydown="onCanvasKeydown"
              >
                <UAlert
                  v-if="formFeatures && showAiReviewNotice"
                  icon="i-lucide-info"
                  class="mb-2"
                  :title="t('admin.forms.aiReviewMarker')"
                  :description="t('admin.forms.aiReviewNotice')"
                  data-test="ai-review-notice"
                />
                <StaffExtensionOutlet
                  name="form-editor-source"
                  :context="{ schema: editableSchema }"
                />
                <FormRenderer
                  v-model="formData"
                  :schema="editableSchema"
                  hide-submit
                  read-only
                  :draft-mode="isDraftInspectActive"
                  :structure-editable="isDraftInspectActive"
                  :draft-single-column="isDraftInspectActive && EDIT_MODE_ONE_FIELD_PER_ROW"
                  :field-selection-disabled="isProcessing"
                  :selected-field-id="selectedField?.fieldId"
                  :can-drop="canDropOnCanvas"
                  @select-field="selectField"
                  @move-field="onCanvasMoveField"
                  @move-address-group="onCanvasMoveAddressGroup"
                  @move-section="onCanvasMoveSection"
                  @drop-refused="onCanvasDropRefused"
                  @move-field-step="onCanvasMoveFieldStep"
                  @delete-field="onCanvasDeleteField"
                  @activate-field="onCanvasActivateField"
                >
                  <template #draft-section-actions="{ section, index, count, disabled, dragHandle }">
                    <!-- The section's head: grip, the title (changed in place), the controls.
                         Its place among the sections is said to screen readers only. The grip is
                         for the pointer; the keyboard path is "nach oben" and "nach unten". -->
                    <UButton
                      v-bind="dragHandle"
                      color="neutral"
                      variant="ghost"
                      icon="i-lucide-grip-vertical"
                      class="shrink-0 cursor-grab"
                      tabindex="-1"
                      aria-hidden="true"
                      data-structure-action="section-drag"
                    />
                    <!-- Below sm the title comes first and takes the card's width (it broke
                         letter by letter in 54 px); grip, badge and controls form the row below it.
                         From sm the head is one row as before. -->
                    <AdminEditorSectionTitle
                      :ref="(editor: unknown) => registerSectionTitleEditor(section.id, editor)"
                      class="max-sm:order-first max-sm:basis-full"
                      :title="editableSectionTitle(section)"
                      :section-id="section.id"
                      :disabled="disabled || !canEditStructure"
                      @update="(value: string) => updateSectionTitle(section, value)"
                    />
                    <span class="sr-only">{{ t('admin.forms.structure.sectionPosition', { position: index + 1, count }) }}</span>
                    <UBadge
                      v-if="section.repeatable"
                      color="neutral"
                      class="shrink-0"
                    >
                      {{ t('admin.forms.structure.repeatable') }}
                    </UBadge>
                    <!-- After the .: the four controls are one group that stays
                       together at the right, however long the title is. -->
                    <div class="ms-auto flex shrink-0 items-center gap-1">
                      <AdminSectionSettingsPopover
                        :section="section"
                        :disabled="disabled || !canEditStructure"
                        @update="(patch: { title: string, description?: string }) => updateSectionSettings(section.id, patch)"
                      />
                      <UTooltip :text="t('admin.forms.structure.moveSectionUp')">
                        <UButton
                          color="neutral"
                          variant="ghost"
                          icon="i-lucide-arrow-up"
                          :disabled="disabled || index === 0"
                          :aria-label="t('admin.forms.structure.moveSectionUpNamed', { title: section.title })"
                          data-structure-action="section-up"
                          :data-section-id="section.id"
                          @click="moveSectionStep(section.id, 'up')"
                        />
                      </UTooltip>
                      <UTooltip :text="t('admin.forms.structure.moveSectionDown')">
                        <UButton
                          color="neutral"
                          variant="ghost"
                          icon="i-lucide-arrow-down"
                          :disabled="disabled || index === count - 1"
                          :aria-label="t('admin.forms.structure.moveSectionDownNamed', { title: section.title })"
                          data-structure-action="section-down"
                          :data-section-id="section.id"
                          @click="moveSectionStep(section.id, 'down')"
                        />
                      </UTooltip>
                      <UTooltip :text="t('admin.forms.structure.insertSectionBelow')">
                        <UButton
                          color="neutral"
                          variant="ghost"
                          icon="i-lucide-plus"
                          :disabled="disabled || !isDraftInspectActive || schemaStatusUpdating"
                          :aria-label="t('admin.forms.structure.insertSectionBelowNamed', { title: section.title })"
                          data-structure-action="section-insert-below"
                          :data-section-id="section.id"
                          @click="addManualSection(section.id)"
                        />
                      </UTooltip>
                      <UTooltip :text="t('admin.forms.structure.deleteSection')">
                        <UButton
                          color="neutral"
                          variant="ghost"
                          icon="i-lucide-trash-2"
                          class="hover:text-error focus-visible:text-error"
                          :disabled="disabled"
                          :aria-label="t('admin.forms.structure.deleteSectionNamed', { title: section.title })"
                          data-structure-action="section-delete"
                          :data-section-id="section.id"
                          @click="requestStructureDelete({ kind: 'section', sectionId: section.id })"
                        />
                      </UTooltip>
                    </div>
                  </template>

                  <!-- A small mark at every field with a finding; its text for screen readers. -->
                  <template #draft-field-mark="{ field }">
                    <span
                      v-if="fieldIssueMarks.get(field.id)"
                      class="pointer-events-none inline-flex"
                      :class="fieldIssueMarks.get(field.id)!.tone === 'error' ? 'text-error' : 'text-warning'"
                      :data-test="`field-issue-mark-${field.id}`"
                    >
                      <UIcon
                        :name="fieldIssueMarks.get(field.id)!.icon"
                        class="size-4"
                        aria-hidden="true"
                      />
                      <span class="sr-only">{{ fieldIssueMarks.get(field.id)!.text }}</span>
                    </span>
                  </template>

                  <!-- The actions of the selected field, at the field. -->
                  <template #draft-field-actions="{ section, field, disabled, dragHandle }">
                    <!-- On narrow screens the open sheet owns the actions of its selected field. -->
                    <AdminEditorFieldActionBar
                      v-if="isWideLayout || !inspectorSheetOpen"
                      data-field-bar
                      :schema="editableSchema"
                      :section-id="section.id"
                      :field-id="field.id"
                      :disabled="disabled || !canEditStructure"
                      :drag-handle="dragHandle"
                      @move-step="onBarMoveStep"
                      @move-to-section="onBarMoveToSection"
                      @insert-below="insertFieldBelowSelected"
                      @delete="requestSelectedFieldDelete"
                      @group-move-step="onBarGroupMoveStep"
                      @group-move-to-section="onBarGroupMoveToSection"
                      @group-delete="requestSelectedGroupDelete"
                    />
                  </template>

                  <!-- "+ Feld" at the end of every section, where the field appears. -->
                  <template #draft-section-end="{ section }">
                    <div class="mt-4">
                      <UButton
                        color="neutral"
                        variant="ghost"
                        icon="i-lucide-plus"
                        :disabled="!isDraftInspectActive || schemaStatusUpdating"
                        :aria-label="t('admin.forms.addFieldToSection', { section: section.title || section.id })"
                        data-structure-action="add-field"
                        :data-section-id="section.id"
                        @click="addManualField(section.id)"
                      >
                        {{ t('admin.forms.addFieldShort') }}
                      </UButton>
                    </div>
                  </template>

                  <!-- "+ Abschnitt" under the last section. -->
                  <template #draft-form-end>
                    <div class="mt-6">
                      <UButton
                        color="neutral"
                        variant="outline"
                        icon="i-lucide-plus"
                        :disabled="!isDraftInspectActive || schemaStatusUpdating"
                        :aria-label="t('admin.forms.addSection')"
                        data-structure-action="add-section"
                        @click="addManualSection()"
                      >
                        {{ t('admin.forms.addSectionShort') }}
                      </UButton>
                    </div>
                  </template>
                </FormRenderer>
              </div>
            </div>

            <template #inspector>
              <AdminEditorInspectorFrame
                :open="!!(isWideLayout && isInspectorOpen && inspectorFieldShown)"
              >
                <!-- After a drop the column shows the dropped field one frame later. -->
                <AdminFieldInspector
                  id="field-inspector"
                  ref="fieldInspector"
                  class="min-h-0 flex-1"
                  :schema="editableSchema"
                  :section-id="inspectorSelection?.sectionId"
                  :field-id="inspectorSelection?.fieldId"
                  :form-id="schemaId"
                  :uploads-settings-to="formFeatures ? workspaceRoute('/admin/settings/uploads') : null"
                  :condition-findings="brokenFormConditions"
                  :condition-refusal="refusedCondition?.fieldId === inspectorSelection?.fieldId ? refusedCondition?.reason : undefined"
                  @text-input="queueInspectorText"
                  @update:schema="onInspectorSchemaUpdate"
                  @prefill-chat="prefillFloatingChat"
                  @close="closeInspector"
                  @return-to-field="returnToSelectedField"
                />
                <template #empty>
                  <EditorOverview
                    ref="overview"
                    :sections="editableSchema.sections"
                    :office="publishOrganisationMissing ? t('admin.forms.overview.missingOffice') : publishReceiverText"
                    :groups="authoringIssueGroups"
                    :reasons="formBlockers"
                    :blockers="publishBlockerCount"
                    :hints="hintCount"
                    :locked="isEditorMutationLocked"
                    :busy="isProcessing"
                    :view-only="!draftInspectEnabled"
                    @jump="jumpFromOverview"
                  >
                    <p
                      v-if="canInspectDraftFields && !draftInspectEnabled"
                      :id="EDITOR_VIEW_REASON_ID"
                      class="text-sm text-muted"
                      data-test="editor-view-reason"
                    >
                      {{ t('admin.forms.editorMode.viewReason') }}
                    </p>
                    <p
                      v-else-if="canInspectDraftFields"
                      class="sr-only"
                      data-test="editor-inspector-hint"
                    >
                      {{ t('admin.forms.structure.noSelection') }}
                    </p>
                  </EditorOverview>
                </template>
              </AdminEditorInspectorFrame>
            </template>
          </AdminEditorSplitLayout>

          <!-- Below 1280 px the inspector is the framework's sheet. It
               starts under the editor's head, so the save state and "Veröffentlichen" stay in
               view. The sheet carries the field's actions after the common inputs. Closing it keeps the
               selection, so the bar at the field stays the way to move and delete. -->
          <template v-if="canInspectDraftFields && !isWideLayout">
            <USlideover
              v-model:open="inspectorSheetOpen"
              :overlay="false"
              :modal="false"
              :title="selectedFieldDetails?.field.label || t('admin.fieldInspector.title')"
              :ui="{ content: 'inset-y-auto top-(--editor-sheet-top) bottom-0' }"
              :content="{ onInteractOutside: keepSheetForFieldBar, onOpenAutoFocus: onInspectorSheetAutoFocus }"
              data-test="editor-inspector-sheet"
            >
              <template #content>
                <AdminFieldInspector
                  v-if="selectedFieldDetails"
                  id="field-inspector"
                  ref="fieldInspector"
                  class="min-h-0 flex-1"
                  :schema="editableSchema"
                  :section-id="selectedField?.sectionId"
                  :field-id="selectedField?.fieldId"
                  :form-id="schemaId"
                  :uploads-settings-to="formFeatures ? workspaceRoute('/admin/settings/uploads') : null"
                  :condition-findings="brokenFormConditions"
                  :condition-refusal="refusedCondition?.fieldId === selectedField?.fieldId ? refusedCondition?.reason : undefined"
                  @text-input="queueInspectorText"
                  @update:schema="onInspectorSchemaUpdate"
                  @prefill-chat="prefillFloatingChat"
                  @close="inspectorSheetOpen = false"
                  @return-to-field="returnToSelectedField"
                >
                  <template #structure-actions>
                    <AdminEditorFieldActionBar
                      :schema="editableSchema"
                      :section-id="selectedFieldDetails.sectionId"
                      :field-id="selectedFieldDetails.fieldId"
                      :disabled="!canEditStructure"
                      placement="sheet"
                      @move-step="onBarMoveStep"
                      @move-to-section="onBarMoveToSection"
                      @insert-below="insertFieldBelowSelected"
                      @delete="requestSelectedFieldDelete"
                      @group-move-step="onBarGroupMoveStep"
                      @group-move-to-section="onBarGroupMoveToSection"
                      @group-delete="requestSelectedGroupDelete"
                    />
                  </template>
                </AdminFieldInspector>
              </template>
            </USlideover>
          </template>
        </section>

        <StaffExtensionOutlet
          v-if="formFeatures"
          name="form-editor-chat"
          :context="chatContext"
        />

        <AdminStructureDeleteModal
          v-if="pendingStructureDelete"
          v-model:remove-conditions="structureDeleteRemoveConditions"
          :open="isStructureDeleteOpen"
          :target-kind="pendingStructureDelete.target.kind"
          :label="pendingStructureDelete.label"
          :field-count="pendingStructureDelete.fieldCount"
          :field-labels="pendingStructureDelete.fieldLabels"
          :references="pendingStructureDelete.references"
          :empty-after="pendingStructureDelete.emptyAfter"
          @confirm="confirmStructureDelete"
          @cancel="cancelStructureDelete"
          @closed="onStructureDeleteClosed"
        />

        <!-- Leaving with a change that could not be saved asks first. -->
        <!-- A type change that breaks conditions is asked first, the fields named. -->
        <UModal
          :open="pendingTypeChange !== null"
          :title="t('admin.forms.typeChangeDialog.title')"
          :description="t('admin.forms.typeChangeDialog.description')"
          :content="typeChangeDialogContent"
          data-test="type-change-dialog"
          @update:open="(value: boolean) => !value && cancelTypeChange()"
        >
          <template #body>
            <div
              ref="typeChangeDialogBody"
              class="space-y-4 text-sm outline-none"
              tabindex="-1"
              data-test="type-change-body"
            >
              <div v-if="pendingTypeChange?.losses.length">
                <p class="font-medium text-highlighted">
                  {{ t('admin.forms.typeChangeDialog.lossesTitle') }}
                </p>
                <ul class="mt-1 list-disc space-y-1 ps-5">
                  <li
                    v-for="loss in pendingTypeChange.losses"
                    :key="loss"
                    data-test="type-change-loss"
                  >
                    {{ loss }}
                  </li>
                </ul>
              </div>
              <div v-if="pendingTypeChange?.dependents.length">
                <p class="font-medium text-highlighted">
                  {{ t('admin.forms.typeChangeDialog.conditionsTitle') }}
                </p>
                <ul class="mt-1 list-disc space-y-1 ps-5">
                  <li
                    v-for="dependent in pendingTypeChange.dependents"
                    :key="dependent.fieldLabel"
                    data-test="type-change-dependent"
                  >
                    {{ t('admin.forms.typeChangeDialog.item', { field: dependent.fieldLabel, source: dependent.sourceLabel }) }}
                  </li>
                </ul>
              </div>
            </div>
          </template>
          <template #footer>
            <div class="flex w-full justify-end gap-2">
              <UButton
                color="neutral"
                variant="ghost"
                data-test="type-change-cancel"
                @click="cancelTypeChange"
              >
                {{ t('admin.forms.typeChangeDialog.cancel') }}
              </UButton>
              <UButton
                data-test="type-change-confirm"
                @click="confirmTypeChange"
              >
                {{ t('admin.forms.typeChangeDialog.confirm') }}
              </UButton>
            </div>
          </template>
        </UModal>

        <UModal
          :open="pendingLeave !== null"
          :title="t('admin.forms.leaveDialog.title')"
          :description="t('admin.forms.leaveDialog.description')"
          data-test="leave-dialog"
          @update:open="(value: boolean) => !value && cancelLeave()"
        >
          <template #footer>
            <div class="flex w-full justify-end gap-2">
              <UButton
                color="neutral"
                variant="ghost"
                data-test="leave-stay"
                @click="cancelLeave"
              >
                {{ t('admin.forms.leaveDialog.stay') }}
              </UButton>
              <UButton
                color="error"
                data-test="leave-confirm"
                @click="confirmLeave"
              >
                {{ t('admin.forms.leaveDialog.leave') }}
              </UButton>
            </div>
          </template>
        </UModal>

        <!-- Reuse PublishConfirm from the form page and guided setup. Its own heading names the question;
           the dialog's title names the form for screen readers. -->
        <UModal
          :open="confirmingPublish && canInspectDraftFields"
          :title="t('admin.forms.publishDialogTitle', { title: schemaLabel })"
          :ui="{ header: 'sr-only' }"
          :content="{ onOpenAutoFocus: (event: Event) => event.preventDefault() }"
          data-test="publish-dialog"
          @update:open="(value: boolean) => !value && cancelPublish()"
        >
          <template #body>
            <AdminPublishConfirm
              :form-title="schemaLabel"
              :scope="publicationScope"
              :receiver-text="publishReceiverText"
              :publishing="schemaStatusUpdating"
              @confirm="confirmPublish"
              @cancel="cancelPublish"
            />
          </template>
        </UModal>

        <UModal
          :open="confirmingDraft"
          :title="t('admin.forms.moveToDraftDialog.title', { title: schemaLabel })"
          :description="t('admin.forms.moveToDraftDialog.description')"
          :content="{ onOpenAutoFocus: focusDraftCancel }"
          data-test="move-to-draft-dialog"
          @update:open="(value: boolean) => !value && cancelDraft()"
        >
          <template #footer>
            <div class="flex w-full justify-end gap-2">
              <UButton
                color="neutral"
                variant="ghost"
                :disabled="schemaStatusUpdating"
                data-test="move-to-draft-cancel"
                @click="cancelDraft"
              >
                {{ t('common.cancel') }}
              </UButton>
              <UButton
                :loading="schemaStatusUpdating"
                data-test="move-to-draft-confirm"
                @click="confirmDraft"
              >
                {{ t('admin.forms.moveToDraftDialog.submit') }}
              </UButton>
            </div>
          </template>
        </UModal>

        <UModal
          :open="isDeleteDraftDialogOpen"
          :title="t('admin.forms.deleteSchemaTitle')"
          :description="t('admin.forms.deleteDraftDescription')"
          @update:open="(value: boolean) => !value && closeDeleteDraftDialog()"
        >
          <template #body>
            <p class="text-sm text-(--ui-text-muted)">
              {{ schemaLabel }}
            </p>
          </template>

          <template #footer>
            <div class="flex w-full justify-end gap-3">
              <UButton
                color="neutral"
                variant="ghost"
                :disabled="isDeletingDraft"
                @click="closeDeleteDraftDialog"
              >
                {{ t('common.cancel') }}
              </UButton>
              <UButton
                color="error"
                icon="i-lucide-trash-2"
                :loading="isDeletingDraft"
                :disabled="isSaving || isProcessing || schemaStatusUpdating || isDeletingDraft"
                data-test="delete-draft-confirm"
                @click="deleteDraft"
              >
                {{ t('admin.forms.deleteSchemaConfirm') }}
              </UButton>
            </div>
          </template>
        </UModal>

        <USlideover
          v-model:open="isDecisionsOpen"
          :title="t('docgenUi.form.title')"
          :description="t('docgenUi.form.description')"
          side="right"
          :close="!isDecisionsBusy"
          :dismissible="!isDecisionsBusy"
          :ui="{ content: 'max-w-3xl' }"
          data-test="docgen-form-slideover"
        >
          <template #body>
            <AdminFormDecisionsPanel
              :form-id="schemaId"
              @busy="isDecisionsBusy = $event"
            />
          </template>
        </USlideover>

        <USlideover
          v-model:open="isSettingsOpen"
          :title="t('admin.forms.formSettings')"
          :description="canInspectDraftFields ? t('admin.forms.formSettingsDescription') : (formFeatures?.readOnlySettingsDescription(t) ?? t('admin.forms.manualSettingsReadOnlyDescription'))"
          side="right"
          :close="!isSettingsAsyncBusy"
          :dismissible="!isSettingsAsyncBusy"
          :ui="{ content: 'max-w-2xl' }"
          data-test="form-settings-slideover"
        >
          <template #body>
            <!-- Use the same heading level for each group and avoid nesting cards. -->
            <div class="space-y-8">
              <AccessReason
                v-if="!canInspectDraftFields"
                id="form-settings-read-only"
                :text="t('admin.forms.publishedReadOnlyDescription')"
              />

              <section
                class="space-y-4"
                aria-labelledby="form-settings-group-details"
              >
                <h3
                  id="form-settings-group-details"
                  class="text-sm font-semibold text-highlighted"
                >
                  {{ t('admin.forms.settingsGroups.details') }}
                </h3>
                <p
                  class="text-sm text-muted"
                  data-test="form-settings-facts"
                >
                  {{ settingsFactsText }}
                </p>
                <UFormField
                  :label="t('admin.forms.schemaTitleLabel')"
                  name="schemaTitle"
                >
                  <UInput
                    v-model="titleInput.model.value"
                    :placeholder="t('admin.forms.manualDefaultTitle')"
                    :maxlength="120"
                    class="w-full"
                    icon="i-lucide-file-text"
                    :disabled="isSettingsMutationLocked"
                    @change="titleInput.commit()"
                    @blur="titleInput.finish"
                  />
                </UFormField>

                <UFormField
                  :label="t('admin.forms.schemaDescriptionLabel')"
                  name="schemaDescription"
                >
                  <UTextarea
                    :model-value="editableSchema?.description ?? ''"
                    :placeholder="t('admin.forms.manualDescriptionPlaceholder')"
                    :rows="3"
                    :maxlength="1000"
                    class="w-full"
                    :disabled="isSettingsMutationLocked"
                    @update:model-value="updateSchemaMetadata({ description: String($event) || undefined })"
                  />
                </UFormField>
              </section>

              <section
                class="space-y-4"
                aria-labelledby="form-settings-group-publication"
              >
                <h3
                  id="form-settings-group-publication"
                  class="text-sm font-semibold text-highlighted"
                >
                  {{ t('admin.forms.settingsGroups.publication') }}
                </h3>
                <div class="space-y-1.5">
                  <UFormField
                    :label="t('admin.forms.publicationScope')"
                    name="schemaPublicationScope"
                  >
                    <USelect
                      :model-value="publicationScope"
                      :items="publicationScopeOptions"
                      value-key="value"
                      class="w-full sm:w-72"
                      :disabled="isEditorMutationLocked || isSaving"
                      data-test="schema-publication-scope"
                      @update:model-value="onPublicationScopeChange"
                    />
                  </UFormField>
                  <!-- Where no public view exists (draft, intranet), its reason stands here. -->
                  <UTooltip
                    v-if="!canOpenPublicFormPreview"
                    :text="publicFormPreviewUnavailableReason"
                  >
                    <span
                      class="inline-flex min-h-10 items-center gap-1.5 text-sm text-(--ui-text-muted)"
                      tabindex="0"
                      role="status"
                      aria-disabled="true"
                      data-test="public-preview-unavailable"
                      :aria-label="publicFormPreviewUnavailableReason"
                    >
                      <UIcon
                        name="i-lucide-globe-lock"
                        class="size-4 shrink-0"
                        aria-hidden="true"
                      />
                      <span>{{ t(publicationScope === 'internet' ? 'admin.forms.publicPreviewAfterPublish' : 'admin.forms.publicPreviewUnavailable') }}</span>
                    </span>
                  </UTooltip>
                </div>

                <AdminFormOrganisationSetting
                  :form-id="schemaId"
                  :organisation-id="schemaOrganisationId"
                  :expected-changed="lastKnownSchemaChanged"
                  :disabled="isSaving || hasPendingAutosave || autosaveTimer !== null || isSettingsAsyncBusy"
                  @assigned="onOrganisationAssigned"
                  @busy="onOrganisationAssignBusy"
                />
              </section>

              <section
                class="space-y-4"
                aria-labelledby="form-settings-group-retention"
              >
                <h3
                  id="form-settings-group-retention"
                  class="text-sm font-semibold text-highlighted"
                >
                  {{ t('admin.forms.settingsGroups.retention') }}
                </h3>
                <UFormField
                  :label="t('admin.forms.retention.label')"
                  name="schemaRetentionDays"
                  :description="t('admin.forms.retention.help')"
                  :error="retentionDaysError || undefined"
                >
                  <UInput
                    :model-value="retentionDaysInput"
                    :placeholder="t('admin.forms.retention.placeholder')"
                    type="number"
                    min="0"
                    step="1"
                    inputmode="numeric"
                    class="w-full"
                    icon="i-lucide-calendar-clock"
                    :disabled="isSettingsMutationLocked"
                    data-test="schema-retention-days"
                    @update:model-value="applyRetentionDaysInput"
                  />
                </UFormField>

                <UFormField
                  :label="t('admin.forms.referencePattern.label')"
                  name="referencePattern"
                  :description="t('admin.forms.referencePattern.help')"
                >
                  <UInput
                    :model-value="referencePattern"
                    :placeholder="t('admin.forms.referencePattern.placeholder')"
                    size="lg"
                    :maxlength="128"
                    class="w-full font-mono"
                    icon="i-lucide-hash"
                    :disabled="isSettingsMutationLocked"
                    @update:model-value="onReferencePatternInput"
                  />
                  <template #hint>
                    <span
                      class="text-sm text-(--ui-text-muted)"
                      aria-live="polite"
                    >
                      {{
                        referencePatternPreview
                          ? t('admin.forms.referencePattern.preview', { preview: referencePatternPreview })
                          : t('admin.forms.referencePattern.emptyFallback')
                      }}
                    </span>
                  </template>
                </UFormField>

                <!-- Published forms: the pattern is only editable in draft mode -->
                <UAlert
                  v-if="!canInspectDraftFields"
                  icon="i-lucide-lock"
                  :title="t('admin.forms.referencePattern.draftRequired')"
                />

                <!-- Announce the length warning while the reference pattern is being edited. -->
                <UAlert
                  v-if="referencePatternTooLong"
                  role="status"
                  icon="i-lucide-triangle-alert"
                  color="warning"
                  :title="t('admin.forms.referencePattern.tooLong', { max: REFERENCE_NUMBER_MAX_LENGTH })"
                />

                <!-- Unrecognised {TOKEN}s would appear literally in every Aktenzeichen -->
                <UAlert
                  v-if="referencePatternUnknownTokens.length"
                  role="status"
                  icon="i-lucide-triangle-alert"
                  color="warning"
                  :title="t('admin.forms.referencePattern.unknownTokens', { tokens: referencePatternUnknownTokens.join(', ') })"
                />

                <div class="rounded-md border border-(--ui-border) bg-(--ui-bg-muted) p-4">
                  <p class="text-sm font-semibold text-(--ui-text-highlighted) flex items-center gap-1.5">
                    <UIcon
                      name="i-lucide-braces"
                      class="size-3.5"
                    />
                    {{ t('admin.forms.referencePattern.tokensTitle') }}
                  </p>
                  <dl class="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                    <div
                      v-for="row in referencePatternTokenRows"
                      :key="row.token"
                      class="flex items-baseline gap-2 text-sm"
                    >
                      <dt>
                        <code class="rounded bg-(--ui-bg-elevated) px-1.5 py-0.5 font-mono text-(--ui-text-highlighted)">{{ row.token }}</code>
                      </dt>
                      <dd class="text-(--ui-text-muted)">
                        {{ row.label }}
                      </dd>
                    </div>
                  </dl>
                </div>

                <!-- Standing information is one muted sentence, not an info alert. -->
                <p class="max-w-prose text-sm text-muted">
                  {{ t('admin.forms.referencePattern.fallbackHint') }}
                </p>
              </section>

              <StaffExtensionOutlet
                v-if="contextSettings"
                name="form-editor-settings"
                :context="contextSettings.context"
              />

              <!-- Facts of the form, not of the editing; they left the head. -->
              <section
                v-if="formFeatures"
                class="space-y-4"
                aria-labelledby="form-settings-group-batch"
              >
                <h3
                  id="form-settings-group-batch"
                  class="text-sm font-semibold text-highlighted"
                >
                  {{ t('admin.forms.settingsGroups.batchAndSetup') }}
                </h3>
                <StaffExtensionOutlet
                  name="form-editor-bulk-status"
                  :context="{ formId: schemaId, revision: lastKnownSchemaChanged }"
                />
              </section>
            </div>
          </template>

          <template #footer>
            <div class="flex w-full flex-wrap items-center justify-between gap-2">
              <UButton
                v-if="canDeleteDraft"
                color="error"
                variant="ghost"
                icon="i-lucide-trash-2"
                :disabled="deleteDraftDisabled"
                data-test="delete-draft"
                @click="openDeleteDraftDialog"
              >
                {{ t('admin.forms.deleteSchema') }}
              </UButton>
              <!-- The panel changes a draft that saves itself: "Fertig" is quiet (side panel pattern). -->
              <UButton
                color="neutral"
                variant="outline"
                class="ms-auto"
                :disabled="isSettingsAsyncBusy"
                @click="isSettingsOpen = false"
              >
                {{ t('common.done') }}
              </UButton>
            </div>
          </template>
        </USlideover>
      </template>
    </div>
  </AppPageLayout>
</template>
