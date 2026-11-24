import { computed, onMounted, ref, watch } from 'vue';
import { CONTENT_REFUSAL_CODES, useSettingsLoadState } from '~~/casework-layer/app/composables/useSettingsLoadState';

export interface AdminContentBody {
    value?: string
    processed?: string
    format?: string | null
}

export interface AdminContentItem {
    id: string
    internalId: number
    kind: 'page' | 'boilerplate' | 'content_section'
    title: string
    status: boolean
    langcode?: string
    changed?: number
    scope?: {
        jurisdictionInternalId?: number | null
        organisationInternalId?: number | null
    }
    body?: AdminContentBody
    page?: {
        key?: string
        slug?: string | null
        path?: string | null
        footerVisible?: boolean
        order?: number
    }
    boilerplate?: {
        type?: string
        text?: string
    }
    section?: {
        placement?: string
        order?: number
        form?: {
            id: string
            title: string
        } | null
    }
}

export interface AdminPublicDocumentItem {
    id: string
    internalId: number
    kind: 'public_document'
    title: string
    status: boolean
    langcode?: string
    changed?: number
    scope?: {
        jurisdictionInternalId?: number | null
        organisationInternalId?: number | null
    }
    body?: AdminContentBody
    document: {
        placement: string
        order: number
        form?: {
            id: string
            title: string
        } | null
        file?: {
            filename: string
            mimeType: string
            size: number
            url?: string | null
        } | null
    }
}

export interface AdminContentResponse {
    data: AdminContentItem[]
}

export interface AdminPublicDocumentsResponse {
    data: AdminPublicDocumentItem[]
}

export interface FormSchemaOptionResponse {
    data?: Array<{
        id: string
        attributes?: {
            label?: string
            field_workflow_status?: string
            field_publication_scope?: string
        }
    }>
}

export type EditorItem = AdminContentItem | AdminPublicDocumentItem;
export type ContentKind = 'page' | 'boilerplate' | 'section' | 'document';
export type ScopeMode = 'jurisdiction' | 'organisation';

export function useAdminContentSettings() {
    const { t } = useI18n();
    const toast = useToast();
    const { resolveApiErrorMessage } = useApiErrorMessage();
    const {
        currentWorkspace,
        selectedWorkspaceKey,
        workspaceRoute
    } = useWorkspaceContext();

    const contentItems = ref<AdminContentItem[]>([]);
    const documentItems = ref<AdminPublicDocumentItem[]>([]);
    const formOptions = ref<Array<{ label: string, value: string }>>([]);
    const formsLoading = ref(false);
    const sections = {
        content: { state: useSettingsLoadState({ refusalCodes: CONTENT_REFUSAL_CODES }), error: ref<string | null>(null) },
        documents: { state: useSettingsLoadState({ refusalCodes: CONTENT_REFUSAL_CODES }), error: ref<string | null>(null) }
    };
    type LoadSection = keyof typeof sections;
    const loadRequestIds = { content: 0, documents: 0 };
    let formsRequestId = 0;

    const selectedKind = ref<ContentKind>('page');
    const activeSection = computed<LoadSection>(() => selectedKind.value === 'document' ? 'documents' : 'content');
    const activeLoad = computed(() => sections[activeSection.value]);
    const loading = computed(() => activeLoad.value.state.phase.value === 'loading');
    const error = computed(() => activeLoad.value.error.value);
    const loadRefusal = computed(() => activeLoad.value.state.refusal.value);
    const loadRetryable = computed(() => activeLoad.value.state.retryable.value);
    const allSectionsRefused = computed(() => Object.values(sections).every(section => section.state.refused.value));
    const isModalOpen = ref(false);
    const editingItem = ref<EditorItem | null>(null);
    const saving = ref(false);

    const formKind = ref<ContentKind>('page');
    const formTitle = ref('');
    const formStatus = ref(true);
    const formScope = ref<ScopeMode>('jurisdiction');
    const formBody = ref('');
    const formPageKey = ref('content');
    const formPublicSlug = ref('');
    const formFooterVisible = ref(true);
    const formOrder = ref(0);
    const formBoilerplateType = ref('status_notes');
    const formDocumentPlacement = ref('form_downloads');
    const formDocumentFormId = ref('');
    const selectedDocumentFile = ref<File | null>(null);
    const documentFileInputKey = ref(0);
    const documentFileInputId = computed(() => `public-document-file-${editingItem.value?.id || 'new'}-${documentFileInputKey.value}`);
    const documentFileHelpId = computed(() => `${documentFileInputId.value}-help`);

    const tabs = computed(() => [
        { label: t('admin.settings.content.pagesTab'), value: 'page', icon: 'i-lucide-file-text' },
        { label: t('admin.settings.content.sectionsTab'), value: 'section', icon: 'i-lucide-info' },
        { label: t('admin.settings.content.boilerplatesTab'), value: 'boilerplate', icon: 'i-lucide-message-square-text' },
        { label: t('admin.settings.content.documentsTab'), value: 'document', icon: 'i-lucide-paperclip' }
    ]);

    const pageKeyOptions = computed(() => [
        { label: t('admin.settings.content.pageKeys.content'), value: 'content' },
        { label: t('admin.settings.content.pageKeys.privacy'), value: 'privacy' },
        { label: t('admin.settings.content.pageKeys.legalNotice'), value: 'legal_notice' },
        { label: t('admin.settings.content.pageKeys.accessibility'), value: 'accessibility' },
        { label: t('admin.settings.content.pageKeys.easyLanguage'), value: 'easy_language' },
        { label: t('admin.settings.content.pageKeys.signLanguage'), value: 'sign_language' }
    ]);

    const boilerplateTypeOptions = computed(() => [
        { label: t('admin.settings.content.boilerplateTypes.statusNotes'), value: 'status_notes' },
        { label: t('admin.settings.content.boilerplateTypes.serviceProvider'), value: 'service_provider' },
        { label: t('admin.settings.content.boilerplateTypes.remarks'), value: 'remarks' }
    ]);

    const documentPlacementOptions = computed(() => [
        { label: t('admin.settings.content.documentPlacements.formDownloads'), value: 'form_downloads' },
        { label: t('admin.settings.content.documentPlacements.formIntro'), value: 'form_intro' },
        { label: t('admin.settings.content.documentPlacements.formSidebar'), value: 'form_sidebar' },
        { label: t('admin.settings.content.documentPlacements.submissionSuccess'), value: 'submission_success' },
        { label: t('admin.settings.content.documentPlacements.orgStart'), value: 'org_start' }
    ]);

    const sectionPlacementOptions = computed(() => [
        { label: t('admin.settings.content.documentPlacements.orgStart'), value: 'org_start' },
        { label: t('admin.settings.content.documentPlacements.formIntro'), value: 'form_intro' },
        { label: t('admin.settings.content.documentPlacements.formSidebar'), value: 'form_sidebar' },
        { label: t('admin.settings.content.documentPlacements.submissionSuccess'), value: 'submission_success' }
    ]);

    const documentFormOptions = computed(() => [
        { label: t('admin.settings.content.noFormRestriction'), value: '' },
        ...formOptions.value
    ]);

    const scopeOptions = computed(() => {
        const options = [
            { label: t('admin.settings.content.scopeJurisdiction'), value: 'jurisdiction' }
        ];
        if (currentWorkspace.value?.organisationSlug) {
            options.push({
                label: t('admin.settings.content.scopeOrganisation', {
                    organisation: currentWorkspace.value.organisationLabel || currentWorkspace.value.organisationSlug
                }),
                value: 'organisation'
            });
        }
        return options;
    });

    const filteredItems = computed(() =>
        selectedKind.value === 'document'
            ? documentItems.value
            : contentItems.value.filter(item => item.kind === contentKindBundle(selectedKind.value))
    );

    // Create and edit only once the server answered and did not refuse.
    const canEdit = computed(() => Boolean(currentWorkspace.value?.jurisdictionSlug)
      && (activeLoad.value.state.loaded.value || activeLoad.value.state.failed.value));
    const isNewItem = computed(() => !editingItem.value);
    const currentSavedPreview = computed(() =>
        editingItem.value?.body?.processed || ''
    );

    function queryForWorkspace() {
        const workspace = currentWorkspace.value;
        if (!workspace?.jurisdictionSlug) return {};
        return {
            jurisdiction: workspace.jurisdictionSlug,
            ...(workspace.organisationSlug ? { organisation: workspace.organisationSlug } : {})
        };
    }

    async function loadContent(only?: LoadSection) {
        const workspace = currentWorkspace.value;
        const query = queryForWorkspace();
        async function loadSection<T>(key: LoadSection, request: () => Promise<T>, setItems: (response?: T) => void) {
            const requestId = ++loadRequestIds[key];
            const { state, error } = sections[key];
            state.begin();
            error.value = null;
            if (!workspace?.jurisdictionSlug) {
                setItems();
                error.value = t('admin.settings.selectWorkspace');
                state.failLocally();
                return;
            }
            try {
                const response = await request();
                if (requestId !== loadRequestIds[key]) return;
                setItems(response);
                state.succeed();
            } catch (failure) {
                if (requestId !== loadRequestIds[key]) return;
                setItems();
                if (state.fail(failure) !== 'refused') {
                    const fallback = key === 'documents' ? 'admin.settings.content.documentsLoadError' : 'admin.settings.content.loadError';
                    error.value = resolveApiErrorMessage(failure, fallback);
                }
            }
        }

        const base = `/api/admin/jurisdictions/${workspace?.jurisdictionSlug}`;
        await Promise.allSettled([
            only !== 'documents' && loadSection('content', () => $fetch<AdminContentResponse>(`${base}/content`, { query }), (response) => {
                contentItems.value = response?.data ?? [];
            }),
            only !== 'content' && loadSection('documents', () => $fetch<AdminPublicDocumentsResponse>(`${base}/documents`, { query }), (response) => {
                documentItems.value = response?.data ?? [];
            })
        ]);
    }

    function retryActiveSection() {
        return loadContent(activeSection.value);
    }

    async function loadForms() {
        const workspace = currentWorkspace.value;
        const requestId = ++formsRequestId;
        formOptions.value = [];
        if (!workspace?.jurisdictionSlug) {
            formsLoading.value = false;
            return;
        }

        formsLoading.value = true;
        try {
            const response = await $fetch<FormSchemaOptionResponse>('/api/admin/schemas', {
                query: {
                    ...queryForWorkspace(),
                    all: 'true',
                    fields: 'label,field_workflow_status,field_publication_scope'
                }
            });
            if (requestId !== formsRequestId) return;
            formOptions.value = (response.data || []).map(item => ({
                label: item.attributes?.label || item.id,
                value: item.id
            }));
        } catch {
            if (requestId === formsRequestId) formOptions.value = [];
        } finally {
            if (requestId === formsRequestId) formsLoading.value = false;
        }
    }

    async function refreshWorkspaceContent() {
        await Promise.all([
            loadContent(),
            loadForms()
        ]);
    }

    onMounted(refreshWorkspaceContent);
    watch(selectedWorkspaceKey, refreshWorkspaceContent);

    function openCreateModal(kind: ContentKind) {
        editingItem.value = null;
        formKind.value = kind;
        formTitle.value = '';
        formStatus.value = true;
        formScope.value = currentWorkspace.value?.organisationSlug ? 'organisation' : 'jurisdiction';
        formBody.value = '';
        formPageKey.value = 'content';
        formPublicSlug.value = '';
        formFooterVisible.value = true;
        formOrder.value = nextOrder(kind);
        formBoilerplateType.value = 'status_notes';
        formDocumentPlacement.value = kind === 'document' ? 'form_downloads' : 'form_intro';
        formDocumentFormId.value = '';
        selectedDocumentFile.value = null;
        documentFileInputKey.value += 1;
        isModalOpen.value = true;
    }

    function openEditModal(item: EditorItem) {
        editingItem.value = item;
        formKind.value = item.kind === 'public_document'
            ? 'document'
            : item.kind === 'content_section'
                ? 'section'
                : item.kind;
        formTitle.value = item.title;
        formStatus.value = Boolean(item.status);
        formScope.value = item.scope?.organisationInternalId ? 'organisation' : 'jurisdiction';
        formBody.value = item.body?.value || '';
        formPageKey.value = item.kind === 'page' ? item.page?.key || 'content' : 'content';
        formPublicSlug.value = item.kind === 'page' ? item.page?.slug || '' : '';
        formFooterVisible.value = item.kind === 'page' ? item.page?.footerVisible !== false : true;
        formOrder.value = item.kind === 'page'
            ? item.page?.order || 0
            : item.kind === 'public_document'
                ? item.document.order || 0
                : item.kind === 'content_section'
                    ? item.section?.order || 0
                    : 0;
        formBoilerplateType.value = item.kind === 'boilerplate' ? item.boilerplate?.type || 'status_notes' : 'status_notes';
        formDocumentPlacement.value = item.kind === 'public_document'
            ? item.document.placement || 'form_downloads'
            : item.kind === 'content_section'
                ? item.section?.placement || 'form_intro'
                : 'form_intro';
        formDocumentFormId.value = item.kind === 'public_document'
            ? item.document.form?.id || ''
            : item.kind === 'content_section'
                ? item.section?.form?.id || ''
                : '';
        selectedDocumentFile.value = null;
        documentFileInputKey.value += 1;
        isModalOpen.value = true;
    }

    function closeModal() {
        if (saving.value) return;
        isModalOpen.value = false;
        editingItem.value = null;
    }

    function nextOrder(kind: ContentKind): number {
        const orders = kind === 'document'
            ? documentItems.value.map(item => Number(item.document.order || 0))
            : contentItems.value
                .filter(item => item.kind === contentKindBundle(kind))
                .map(item => Number(item.kind === 'content_section' ? item.section?.order || 0 : item.page?.order || 0));
        return orders.length ? Math.max(...orders) + 10 : 10;
    }

    function contentKindBundle(kind: ContentKind): AdminContentItem['kind'] | null {
        if (kind === 'document') return null;
        if (kind === 'section') return 'content_section';
        return kind;
    }

    function contentBundleKind(bundle: AdminContentItem['kind']): ContentKind {
        return bundle === 'content_section' ? 'section' : bundle;
    }

    function itemScopeLabel(item: EditorItem): string {
        if (item.scope?.organisationInternalId) {
            return currentWorkspace.value?.organisationLabel || t('admin.settings.content.scopeOrganisationShort');
        }
        return t('admin.settings.content.scopeJurisdictionShort');
    }

    function itemKindLabel(item: EditorItem): string {
        if (item.kind === 'page') return t('admin.settings.content.kindPage');
        if (item.kind === 'content_section') return t('admin.settings.content.kindSection');
        if (item.kind === 'boilerplate') return t('admin.settings.content.kindBoilerplate');
        return t('admin.settings.content.kindDocument');
    }

    function placementLabel(placement: string | undefined): string {
        const option = [
            ...documentPlacementOptions.value,
            ...sectionPlacementOptions.value
        ].find(row => row.value === placement);
        return option?.label || placement || '';
    }

    function itemSubtitle(item: EditorItem): string {
        if (item.kind === 'page') {
            return item.page?.path || t('admin.settings.content.noPublicPath');
        }
        if (item.kind === 'content_section') {
            const formLabel = item.section?.form?.title || t('admin.settings.content.noFormRestriction');
            return `${placementLabel(item.section?.placement)} · ${formLabel}`;
        }
        if (item.kind === 'public_document') {
            const formLabel = item.document.form?.title || t('admin.settings.content.noFormRestriction');
            return `${formLabel} · ${item.document.file?.filename || t('admin.settings.content.noFile')}`;
        }
        const option = boilerplateTypeOptions.value.find(row => row.value === item.boilerplate?.type);
        return option?.label || item.boilerplate?.type || '';
    }

    function publicPagePath(item: AdminContentItem): string {
        const workspace = currentWorkspace.value;
        const path = item.page?.path;
        if (!workspace || !path) return '/';
        return `${workspace.path}${path}`;
    }

    function changedLabel(item: EditorItem): string {
        if (!item.changed) return '';
        return new Intl.DateTimeFormat(undefined, {
            dateStyle: 'medium',
            timeStyle: 'short'
        }).format(new Date(item.changed * 1000));
    }

    function insertSnippet(snippet: string) {
        formBody.value = formBody.value
            ? `${formBody.value}\n${snippet}`
            : snippet;
    }

    function contentPayload() {
        const workspace = currentWorkspace.value;
        const base = {
            kind: formKind.value,
            title: formTitle.value.trim(),
            status: formStatus.value,
            organisation: formScope.value === 'organisation' ? workspace?.organisationSlug || null : null,
            body: { value: formBody.value }
        };
        if (formKind.value === 'page') {
            return {
                ...base,
                pageKey: formPageKey.value,
                publicSlug: formPublicSlug.value.trim(),
                footerVisible: formFooterVisible.value,
                order: Number(formOrder.value) || 0
            };
        }
        if (formKind.value === 'section') {
            return {
                ...base,
                placement: formDocumentPlacement.value,
                order: Number(formOrder.value) || 0,
                formId: formDocumentFormId.value || null
            };
        }
        return {
            ...base,
            boilerplateType: formBoilerplateType.value
        };
    }

    function documentFormData(): FormData {
        const workspace = currentWorkspace.value;
        const body = new FormData();
        body.append('title', formTitle.value.trim());
        body.append('status', formStatus.value ? 'true' : 'false');
        body.append('organisation', formScope.value === 'organisation' ? workspace?.organisationSlug || '' : '');
        body.append('body', formBody.value);
        body.append('placement', formDocumentPlacement.value);
        body.append('order', String(Number(formOrder.value) || 0));
        body.append('formId', formDocumentFormId.value || '');
        if (selectedDocumentFile.value) {
            body.append('file', selectedDocumentFile.value);
        }
        return body;
    }

    function onDocumentFileSelected(event: Event) {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0] || null;
        selectedDocumentFile.value = file;
    }

    function formatDocumentFileSize(size: number | undefined): string {
        if (!Number.isFinite(size) || !size || size <= 0) return '';
        if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
        return `${Math.ceil(size / 1024)} KB`;
    }

    function adminDocumentFileUrl(item: AdminPublicDocumentItem): string {
        const url = item.document.file?.url || '';
        return /^\/api\/v1\/jurisdictions\/[a-z0-9-]+\/documents\/[0-9a-f-]{36}\/file(?:\?|$)/u.test(url) ? url : '';
    }

    async function saveContent() {
        const workspace = currentWorkspace.value;
        if (!workspace?.jurisdictionSlug || !formTitle.value.trim()) {
            toast.add({ title: t('admin.settings.content.titleRequired'), color: 'error' });
            return;
        }
        if (formKind.value === 'document' && !editingItem.value && !selectedDocumentFile.value) {
            toast.add({ title: t('admin.settings.content.documentFileRequired'), color: 'error' });
            return;
        }

        saving.value = true;
        try {
            const current = editingItem.value;
            if (formKind.value === 'document') {
                const url = current
                    ? `/api/admin/jurisdictions/${workspace.jurisdictionSlug}/documents/${current.id}`
                    : `/api/admin/jurisdictions/${workspace.jurisdictionSlug}/documents`;
                const response = await $fetch<{ data: AdminPublicDocumentItem }>(url, {
                    method: current ? 'PATCH' : 'POST',
                    query: queryForWorkspace(),
                    body: documentFormData()
                });
                const saved = response.data;
                const index = documentItems.value.findIndex(item => item.id === saved.id);
                if (index >= 0) {
                    documentItems.value.splice(index, 1, saved);
                } else {
                    documentItems.value.push(saved);
                }
                selectedKind.value = 'document';
            } else {
                const url = current
                    ? `/api/admin/jurisdictions/${workspace.jurisdictionSlug}/content/${current.id}`
                    : `/api/admin/jurisdictions/${workspace.jurisdictionSlug}/content`;
                const response = await $fetch<{ data: AdminContentItem }>(url, {
                    method: current ? 'PATCH' : 'POST',
                    query: queryForWorkspace(),
                    body: contentPayload()
                });

                const saved = response.data;
                const index = contentItems.value.findIndex(item => item.id === saved.id);
                if (index >= 0) {
                    contentItems.value.splice(index, 1, saved);
                } else {
                    contentItems.value.push(saved);
                }
                selectedKind.value = contentBundleKind(saved.kind);
            }
            toast.add({
                title: current ? t('admin.settings.content.updated') : t('admin.settings.content.created'),
                color: 'success'
            });
            isModalOpen.value = false;
            editingItem.value = null;
        } catch (e) {
            toast.add({
                title: t('admin.settings.content.saveError'),
                description: resolveApiErrorMessage(e),
                color: 'error'
            });
        } finally {
            saving.value = false;
        }
    }

    return {
        contentItems,
        documentItems,
        formOptions,
        loading,
        formsLoading,
        error,
        selectedKind,
        isModalOpen,
        editingItem,
        saving,
        formKind,
        formTitle,
        formStatus,
        formScope,
        formBody,
        formPageKey,
        formPublicSlug,
        formFooterVisible,
        formOrder,
        formBoilerplateType,
        formDocumentPlacement,
        formDocumentFormId,
        selectedDocumentFile,
        documentFileInputKey,
        documentFileInputId,
        documentFileHelpId,
        tabs,
        pageKeyOptions,
        boilerplateTypeOptions,
        documentPlacementOptions,
        sectionPlacementOptions,
        documentFormOptions,
        scopeOptions,
        filteredItems,
        canEdit,
        loadRefusal,
        allSectionsRefused,
        loadRetryable,
        isNewItem,
        currentSavedPreview,
        workspaceRoute,
        queryForWorkspace,
        loadContent,
        retryActiveSection,
        loadForms,
        refreshWorkspaceContent,
        openCreateModal,
        openEditModal,
        closeModal,
        nextOrder,
        contentKindBundle,
        contentBundleKind,
        itemScopeLabel,
        itemKindLabel,
        placementLabel,
        itemSubtitle,
        publicPagePath,
        changedLabel,
        insertSnippet,
        contentPayload,
        documentFormData,
        onDocumentFileSelected,
        formatDocumentFileSize,
        adminDocumentFileUrl,
        saveContent
    };
}
