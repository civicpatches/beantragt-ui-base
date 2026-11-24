import type { RouteLocationRaw } from 'vue-router';
import type { SetupIneligibleReason, SetupReadView } from '~/types/schema-setup';
import type { Ref } from 'vue';
import type { FormAttachmentAnalysisProfile, FormField, FormSchema } from '~/types/form';
import type { MoveDirection, StructureTarget } from './schema-structure';
import type { FieldLocation, SchemaChangeSummary } from './schema-change-summary';
import type { CommitEditorText } from '../composables/useEditorTextDraft';

export interface FormBulkActions {
    label: string
    bulkUploadRoute: Ref<{ path: string, query: { form: string } } | null>
    bulkUploadAvailable: Ref<boolean>
    bulkUploadElsewhereReason: Ref<string | null>
    bulkIneligibleReason: Ref<string | null>
    bulkIneligibleHasReason: Ref<boolean>
}

type Translate = (key: string, params?: Record<string, string | number>, plural?: number) => string;

export interface StaffFormFeatures {
    useSetupView: (formId: string) => {
        data: Ref<SetupReadView | null | undefined>
        error: Ref<unknown>
        refresh: () => Promise<void>
    }
    useSetupOverlay: (formId: string) => {
        state: Ref<{ busy: boolean, changed: boolean, openerPosition?: number | null }>
        noteOpener: (path: string) => void
        close: (route: RouteLocationRaw) => Promise<boolean>
    }
    setupResumeLabel: (t: Translate, returning: boolean) => string
    setupIneligibleText: (t: Translate, reason: SetupIneligibleReason) => string
    setupDialog: (t: Translate, title: string) => { title: string, description: string, close: string }
    chatToggleLabel: (t: Translate, open: boolean) => string
    chatIntro: (t: Translate, params: { title: string, sections: number, fields: number }, count: number) => string
    readOnlySettingsDescription: (t: Translate) => string
    useContextSettings: (input: FormContextSettingsInput) => FormContextSettings
    useEditorChat: (input: EditorChatInput) => (message: string) => Promise<void>
    attachmentCheckConfiguration: (analysis?: FormAttachmentAnalysisProfile) => { inactive: boolean, missingEntries: readonly string[] }
    useBulkActions: (formId: string, organisationId: Ref<string | null>) => FormBulkActions
}

export interface FieldAnalysisContext {
    schema: Ref<FormSchema>
    formId: Ref<string | null | undefined>
    selectedField: Ref<FormField | null>
    updateField: (updater: (field: FormField) => FormField, schema?: FormSchema) => FormField | undefined
    queueTextCommit: (commit: CommitEditorText) => void
    prefillChat: (message: string) => void
    setResultListFocus: (focus: (() => void) | null) => void
}

interface SaveSchemaOptions {
    showToast?: boolean
    refreshSchema?: boolean
    throwOnError?: boolean
    showErrorToast?: boolean
    allowDuringStatusUpdate?: boolean
}

export interface FormContextSettingsInput {
    schemaId: string
    schemaResourceId: Ref<string>
    editableSchema: Ref<FormSchema | null>
    canInspectDraftFields: Ref<boolean>
    isEditorMutationLocked: Ref<boolean>
    isSaving: Ref<boolean>
    hasPendingAutosave: Ref<boolean>
    autosaveTimer: Ref<ReturnType<typeof setTimeout> | null>
    isSettingsOpen: Ref<boolean>
    openSettingsAtContext: boolean
    clearUndo: () => void
    replaceRejectedSources: (schema: FormSchema) => void
    scheduleAutosave: () => void
    saveCurrentSchema: (options?: SaveSchemaOptions) => Promise<boolean>
    reloadPersistedSchemaAfterDeleteConflict: () => Promise<void>
    responseStatusCode: (error: unknown) => number | null
}

interface FormContextSettings {
    ready: PromiseLike<unknown>
    isSettingsAsyncBusy: Ref<boolean>
    context: object
    unavailableKeys: () => Set<string>
    removedKeys: (submitted: FormSchema, persisted: FormSchema) => Set<string>
    removeRejected: (sourceKeys: Set<string>) => boolean
    setRemoved: (removed: boolean) => void
}

export interface EditorChatMessage {
    id: string
    role: 'user' | 'assistant'
    content: string
    sendToAi?: boolean
}

export interface EditorChatInput {
    editableSchema: Ref<FormSchema | null>
    isProcessing: Ref<boolean>
    isSaving: Ref<boolean>
    flushTextCommit: (finishEditing?: boolean) => void
    selectedField: Ref<{ sectionId: string, fieldId: string } | null>
    isInspectorOpen: Ref<boolean>
    activeChatScopeKey: Ref<string>
    addMessage: (role: EditorChatMessage['role'], content: string, options?: { sendToAi?: boolean, scopeKey?: string, aiContent?: string }) => void
    isDraftInspectActive: Ref<boolean>
    copySelectedFieldLocation: () => FieldLocation | null
    requestStructureDelete: (target: StructureTarget, origin: 'chat', chat: { message: string, scopeKey: string }) => boolean
    moveSelectedFieldStep: (direction: MoveDirection) => { applied: boolean, message: string }
    editorActionAiContent: (kind: 'field_updated' | 'field_deleted' | 'schema_updated') => string
    schemaId: string
    registerSchemaChange: (previous: FormSchema, next: FormSchema, selection: FieldLocation | null) => SchemaChangeSummary | null
    formatSchemaChangeSummary: (summary: SchemaChangeSummary) => string
    focusChangedField: (summary: SchemaChangeSummary) => void
    scheduleAutosave: () => void
    editorMutationVersion: Ref<number>
    authoritativeEditorStateVersion: Ref<number>
    buildSelectedFieldChatContext: () => unknown
    chatHistoryForScope: (scopeKey: string) => Array<Pick<EditorChatMessage, 'role' | 'content'>>
    draftInspectEnabled: Ref<boolean>
    isEditorMutationLocked: Ref<boolean>
    updateSelectedField: (field: FormField) => boolean
    reconcileSelectedField: (schema: FormSchema | null) => void
    retireDeletedFieldChatScopes: (previous: FormSchema, next: FormSchema) => void
    schemaChatScopeKey: string
    focusFloatingChat: () => void
    findFieldLabel: (id: string) => string | undefined
}

export interface EditorChatPanelContext {
    isChatOpen: Ref<boolean>
    editableSchema: Ref<FormSchema | null>
    floatingChat: Ref<HTMLElement | null>
    onFloatingChatKeydown: (event: KeyboardEvent) => void
    startChatDrag: (event: PointerEvent) => void
    selectedFieldChatTitle: Ref<string>
    closeFloatingChat: () => void
    chatPanel: Ref<{ prefillInput: (text: string) => void } | null>
    activeChatScopeKey: Ref<string>
    schemaLabel: Ref<string>
    chatMessages: Ref<EditorChatMessage[]>
    isProcessing: Ref<boolean>
    onChatSend?: (message: string) => Promise<void>
    goBack: () => void
}
