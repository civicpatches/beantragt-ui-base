import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
import { staffFetch } from '~~/casework-layer/app/composables/api/useStaffSessionFetch';
import type { AdminWorkspace } from '~~/casework-layer/app/composables/useWorkspaceContext';
import { parseSettingsError } from '~/composables/useSettingsError';

export interface WorkspaceSettingsData {
    label?: string
    slug?: string
    orgEmail?: string
    referencePrefix?: string
    referencePattern?: string
}

export interface WorkspaceSettingsResponse {
    workspace: AdminWorkspace & {
        settings?: WorkspaceSettingsData
        parentJurisdiction?: {
            label: string
            slug: string
        } | null
        parentOrganisation?: {
            label: string
            slug: string
        } | null
    }
}

export type WorkspaceOrganisation = AdminWorkspace & {
    settings?: WorkspaceSettingsData
    parentOrganisation?: {
        id: string
        internalId?: number | null
        label: string
        slug: string
    } | null
};

interface WorkspaceOrganisationsResponse {
    organisations: WorkspaceOrganisation[]
    count: number
}

interface WorkspaceOrganisationResponse {
    organisation: WorkspaceOrganisation
    archived?: boolean
}

export type TenantFieldKey = 'label' | 'slug' | 'orgEmail' | 'referencePrefix' | 'referencePattern';
export type TenantOrganisationFormKey = TenantFieldKey | 'parentOrganisationId';

const MAX_HIERARCHY_ORGANISATIONS = 8;

export const TENANT_FIELD_IDS: Record<TenantFieldKey, string> = {
    label: 'settings-tenant-label',
    slug: 'settings-tenant-slug',
    orgEmail: 'settings-tenant-orgEmail',
    referencePrefix: 'settings-tenant-referencePrefix',
    referencePattern: 'settings-tenant-referencePattern'
};

export const TENANT_ORGANISATION_FIELD_IDS: Record<TenantOrganisationFormKey, string> = {
    label: 'settings-tenant-organisation-label',
    slug: 'settings-tenant-organisation-slug',
    parentOrganisationId: 'settings-tenant-organisation-parent',
    orgEmail: 'settings-tenant-organisation-email',
    referencePrefix: 'settings-tenant-organisation-reference-prefix',
    referencePattern: 'settings-tenant-organisation-reference-pattern'
};

const slugPattern = /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/;
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const prefixPattern = /^[A-Za-z0-9_-]{0,32}$/;

export function useAdminTenantSettings() {
    const { t } = useI18n();
    const toast = useToast();
    const route = useRoute();
    const {
        currentWorkspace,
        selectedWorkspaceKey,
        workspaces,
        withWorkspaceQuery,
        workspaceRoute,
        loadWorkspaces
    } = useWorkspaceContext();

    const form = reactive<Record<TenantFieldKey, string>>({
        label: '',
        slug: '',
        orgEmail: '',
        referencePrefix: '',
        referencePattern: ''
    });

    const errors = reactive<Record<TenantFieldKey, string | undefined>>({
        label: undefined,
        slug: undefined,
        orgEmail: undefined,
        referencePrefix: undefined,
        referencePattern: undefined
    });

    const organisationForm = reactive<Record<TenantOrganisationFormKey, string>>({
        label: '',
        slug: '',
        parentOrganisationId: '',
        orgEmail: '',
        referencePrefix: '',
        referencePattern: ''
    });

    const organisationErrors = reactive<Record<TenantOrganisationFormKey, string | undefined>>({
        label: undefined,
        slug: undefined,
        parentOrganisationId: undefined,
        orgEmail: undefined,
        referencePrefix: undefined,
        referencePattern: undefined
    });

    const workspaceDetails = ref<WorkspaceSettingsResponse['workspace'] | null>(null);
    const isLoading = ref(true);
    const isSaving = ref(false);
    const loadError = ref<string | null>(null);
    const savedSnapshot = ref('');
    const organisations = ref<WorkspaceOrganisation[]>([]);
    const isOrganisationsLoading = ref(false);
    const isOrganisationSaving = ref(false);
    const organisationLoadError = ref<string | null>(null);
    const organisationStructureForbidden = ref(false);
    const isOrganisationModalOpen = ref(false);
    const organisationMode = ref<'create' | 'edit'>('create');
    const editingOrganisationId = ref<string | null>(null);
    const organisationSavedSnapshot = ref('');
    const archiveTarget = ref<WorkspaceOrganisation | null>(null);
    const isArchiveModalOpen = ref(false);
    let settingsLoadRequestId = 0;
    let organisationsLoadRequestId = 0;

    const isOrganisationWorkspace = computed(() => workspaceDetails.value?.type === 'organisation');

    function editableSnapshot() {
        const payload: Record<string, string> = {
            label: form.label,
            slug: form.slug
        };
        if (isOrganisationWorkspace.value) {
            payload.orgEmail = form.orgEmail;
            payload.referencePrefix = form.referencePrefix;
            payload.referencePattern = form.referencePattern;
        }
        return JSON.stringify(payload);
    }

    function takeSnapshot() {
        savedSnapshot.value = editableSnapshot();
    }

    const isDirty = computed(() => {
        if (!savedSnapshot.value) return false;
        return editableSnapshot() !== savedSnapshot.value;
    });

    function organisationEditableSnapshot() {
        return JSON.stringify({
            label: organisationForm.label,
            slug: organisationForm.slug,
            parentOrganisationId: organisationForm.parentOrganisationId,
            orgEmail: organisationForm.orgEmail,
            referencePrefix: organisationForm.referencePrefix,
            referencePattern: organisationForm.referencePattern
        });
    }

    function takeOrganisationSnapshot() {
        organisationSavedSnapshot.value = organisationEditableSnapshot();
    }

    const isOrganisationDirty = computed(() =>
        isOrganisationModalOpen.value
        && Boolean(organisationSavedSnapshot.value)
        && organisationEditableSnapshot() !== organisationSavedSnapshot.value
    );

    const hasUnsavedChanges = computed(() => isDirty.value || isOrganisationDirty.value);

    useUnsavedChangesGuard(hasUnsavedChanges);

    function applyWorkspace(workspace: WorkspaceSettingsResponse['workspace']) {
        workspaceDetails.value = workspace;
        form.label = workspace.settings?.label || workspace.label || '';
        form.slug = workspace.settings?.slug || workspace.slug || '';
        form.orgEmail = workspace.settings?.orgEmail || '';
        form.referencePrefix = workspace.settings?.referencePrefix || '';
        form.referencePattern = workspace.settings?.referencePattern || '';
        takeSnapshot();
    }

    function clearErrors() {
        errors.label = undefined;
        errors.slug = undefined;
        errors.orgEmail = undefined;
        errors.referencePrefix = undefined;
        errors.referencePattern = undefined;
    }

    function clearOrganisationErrors() {
        organisationErrors.label = undefined;
        organisationErrors.slug = undefined;
        organisationErrors.parentOrganisationId = undefined;
        organisationErrors.orgEmail = undefined;
        organisationErrors.referencePrefix = undefined;
        organisationErrors.referencePattern = undefined;
    }

    watch(() => form.label, () => {
        errors.label = undefined;
    });
    watch(() => form.slug, () => {
        errors.slug = undefined;
    });
    watch(() => form.orgEmail, () => {
        errors.orgEmail = undefined;
    });
    watch(() => form.referencePrefix, () => {
        errors.referencePrefix = undefined;
    });
    watch(() => form.referencePattern, () => {
        errors.referencePattern = undefined;
    });
    watch(() => organisationForm.label, () => {
        organisationErrors.label = undefined;
    });
    watch(() => organisationForm.slug, () => {
        organisationErrors.slug = undefined;
    });
    watch(() => organisationForm.parentOrganisationId, () => {
        organisationErrors.parentOrganisationId = undefined;
    });
    watch(() => organisationForm.orgEmail, () => {
        organisationErrors.orgEmail = undefined;
    });
    watch(() => organisationForm.referencePrefix, () => {
        organisationErrors.referencePrefix = undefined;
    });
    watch(() => organisationForm.referencePattern, () => {
        organisationErrors.referencePattern = undefined;
    });

    function focusField(field: TenantFieldKey) {
        nextTick(() => {
            if (!import.meta.client) return;
            document.getElementById(TENANT_FIELD_IDS[field])?.focus();
        });
    }

    function focusOrganisationField(field: TenantOrganisationFormKey) {
        nextTick(() => {
            if (!import.meta.client) return;
            document.getElementById(TENANT_ORGANISATION_FIELD_IDS[field])?.focus();
        });
    }

    function validateForm(): boolean {
        clearErrors();
        let valid = true;

        if (!form.label.trim()) {
            errors.label = t('admin.settings.tenant.validation.labelRequired');
            valid = false;
        }
        if (!slugPattern.test(form.slug.trim())) {
            errors.slug = t('admin.settings.tenant.validation.slugInvalid');
            valid = false;
        }
        if (isOrganisationWorkspace.value && form.orgEmail.trim() && !emailRegex.test(form.orgEmail.trim())) {
            errors.orgEmail = t('admin.settings.tenant.validation.emailInvalid');
            valid = false;
        }
        if (isOrganisationWorkspace.value && !prefixPattern.test(form.referencePrefix.trim())) {
            errors.referencePrefix = t('admin.settings.tenant.validation.prefixInvalid');
            valid = false;
        }
        if (isOrganisationWorkspace.value && form.referencePattern.trim().length > 128) {
            errors.referencePattern = t('admin.settings.tenant.validation.patternTooLong');
            valid = false;
        }

        const firstError = (Object.entries(errors).find(([, value]) => value) || [null])[0] as TenantFieldKey | null;
        if (firstError) {
            focusField(firstError);
        }
        return valid;
    }

    function workspaceQuery() {
        const query = withWorkspaceQuery();
        return {
            jurisdiction: query.jurisdiction,
            ...(query.organisation ? { organisation: query.organisation } : {})
        };
    }

    function jurisdictionQuery() {
        const query = withWorkspaceQuery();
        return {
            jurisdiction: query.jurisdiction
        };
    }

    async function loadOrganisationStructure() {
        const requestId = ++organisationsLoadRequestId;
        isOrganisationsLoading.value = true;
        organisationLoadError.value = null;
        organisationStructureForbidden.value = false;

        if (!currentWorkspace.value) {
            await loadWorkspaces();
        }
        if (requestId !== organisationsLoadRequestId) return;
        if (!currentWorkspace.value) {
            organisations.value = [];
            organisationLoadError.value = t('admin.settings.selectWorkspace');
            isOrganisationsLoading.value = false;
            return;
        }

        try {
            const response = await staffFetch<WorkspaceOrganisationsResponse>('/api/admin/workspace-organisations', {
                query: jurisdictionQuery()
            });
            if (requestId !== organisationsLoadRequestId) return;
            organisations.value = response.organisations;
        } catch (e: unknown) {
            if (requestId !== organisationsLoadRequestId) return;
            const { status, detail } = parseSettingsError(e);
            organisations.value = [];
            if (status === 403) {
                organisationStructureForbidden.value = true;
                return;
            }
            if (status === 401) return;
            organisationLoadError.value = detail || t('admin.settings.tenant.organisationsLoadError');
        } finally {
            if (requestId === organisationsLoadRequestId) {
                isOrganisationsLoading.value = false;
            }
        }
    }

    async function loadSettings() {
        const requestId = ++settingsLoadRequestId;
        isLoading.value = true;
        loadError.value = null;

        if (!currentWorkspace.value) {
            await loadWorkspaces();
        }
        if (requestId !== settingsLoadRequestId) return;
        if (!currentWorkspace.value) {
            loadError.value = t('admin.settings.selectWorkspace');
            isLoading.value = false;
            return;
        }

        try {
            const response = await staffFetch<WorkspaceSettingsResponse>('/api/admin/workspace-settings', {
                query: workspaceQuery()
            });
            if (requestId !== settingsLoadRequestId) return;
            applyWorkspace(response.workspace);
        } catch (e: unknown) {
            if (requestId !== settingsLoadRequestId) return;
            const { status, detail } = parseSettingsError(e);
            if (status === 401) return;
            loadError.value = detail || t('admin.settings.tenant.loadError');
        } finally {
            if (requestId === settingsLoadRequestId) {
                isLoading.value = false;
            }
        }
    }

    function parentOrganisationOptions() {
        return [
            {
                label: t('admin.settings.tenant.rootOrganisation'),
                value: ''
            },
            ...organisations.value
                .filter(organisation => organisation.id !== editingOrganisationId.value)
                .map(organisation => ({
                    label: organisation.label,
                    value: organisation.id
                }))
        ];
    }

    const organisationParentItems = computed(parentOrganisationOptions);

    function validateOrganisationForm(): boolean {
        clearOrganisationErrors();
        let valid = true;

        if (!organisationForm.label.trim()) {
            organisationErrors.label = t('admin.settings.tenant.validation.labelRequired');
            valid = false;
        }
        if (!slugPattern.test(organisationForm.slug.trim())) {
            organisationErrors.slug = t('admin.settings.tenant.validation.slugInvalid');
            valid = false;
        }
        if (organisationForm.orgEmail.trim() && !emailRegex.test(organisationForm.orgEmail.trim())) {
            organisationErrors.orgEmail = t('admin.settings.tenant.validation.emailInvalid');
            valid = false;
        }
        if (!prefixPattern.test(organisationForm.referencePrefix.trim())) {
            organisationErrors.referencePrefix = t('admin.settings.tenant.validation.prefixInvalid');
            valid = false;
        }
        if (organisationForm.referencePattern.trim().length > 128) {
            organisationErrors.referencePattern = t('admin.settings.tenant.validation.patternTooLong');
            valid = false;
        }

        const firstError = (Object.entries(organisationErrors).find(([, value]) => value) || [null])[0] as TenantOrganisationFormKey | null;
        if (firstError) {
            focusOrganisationField(firstError);
        }
        return valid;
    }

    function organisationData() {
        return {
            label: organisationForm.label.trim(),
            slug: organisationForm.slug.trim().toLowerCase(),
            parentOrganisationId: organisationForm.parentOrganisationId || null,
            orgEmail: organisationForm.orgEmail.trim(),
            referencePrefix: organisationForm.referencePrefix.trim(),
            referencePattern: organisationForm.referencePattern.trim()
        };
    }

    function openCreateOrganisation() {
        organisationMode.value = 'create';
        editingOrganisationId.value = null;
        organisationForm.label = '';
        organisationForm.slug = '';
        organisationForm.parentOrganisationId = '';
        organisationForm.orgEmail = '';
        organisationForm.referencePrefix = '';
        organisationForm.referencePattern = '';
        clearOrganisationErrors();
        takeOrganisationSnapshot();
        isOrganisationModalOpen.value = true;
    }

    function openEditOrganisation(organisation: WorkspaceOrganisation) {
        organisationMode.value = 'edit';
        editingOrganisationId.value = organisation.id;
        organisationForm.label = organisation.settings?.label || organisation.label;
        organisationForm.slug = organisation.settings?.slug || organisation.slug;
        organisationForm.parentOrganisationId = organisation.parentOrganisation?.id || '';
        organisationForm.orgEmail = organisation.settings?.orgEmail || '';
        organisationForm.referencePrefix = organisation.settings?.referencePrefix || '';
        organisationForm.referencePattern = organisation.settings?.referencePattern || '';
        clearOrganisationErrors();
        takeOrganisationSnapshot();
        isOrganisationModalOpen.value = true;
    }

    function closeOrganisationModal(force = false) {
        if (!force && isOrganisationSaving.value) return;
        if (!force && isOrganisationDirty.value && !window.confirm(t('admin.settings.tenant.unsavedOrganisationChanges'))) {
            return;
        }
        organisationSavedSnapshot.value = '';
        isOrganisationModalOpen.value = false;
        editingOrganisationId.value = null;
        clearOrganisationErrors();
    }

    function applyOrganisationToState(organisation: WorkspaceOrganisation) {
        const index = organisations.value.findIndex(item => item.id === organisation.id || item.internalId === organisation.internalId);
        if (index === -1) {
            organisations.value = [...organisations.value, organisation]
                .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
            return;
        }

        organisations.value[index] = {
            ...organisations.value[index]!,
            ...organisation
        };
    }

    function localizedOrganisationFieldError(field: TenantOrganisationFormKey, detail: string | null): string {
        if (field === 'parentOrganisationId') return t('admin.settings.tenant.validation.parentInvalid');
        return localizedFieldError(field, detail);
    }

    function applyOrganisationFieldError(field: string | null, detail: string | null): boolean {
        if (!field || !(field in organisationErrors)) return false;
        const target = field as TenantOrganisationFormKey;
        organisationErrors[target] = localizedOrganisationFieldError(target, detail);
        focusOrganisationField(target);
        return true;
    }

    async function saveOrganisation() {
        if (isOrganisationSaving.value || !validateOrganisationForm()) return;

        const editingCurrentWorkspace = organisationMode.value === 'edit'
          && Boolean(editingOrganisationId.value)
          && currentWorkspace.value?.id === editingOrganisationId.value;

        isOrganisationSaving.value = true;
        try {
            const response = await staffFetch<WorkspaceOrganisationResponse>(
                organisationMode.value === 'create'
                    ? '/api/admin/workspace-organisations'
                    : `/api/admin/workspace-organisations/${editingOrganisationId.value}`,
                {
                    method: organisationMode.value === 'create' ? 'POST' : 'PATCH',
                    query: jurisdictionQuery(),
                    body: { data: organisationData() }
                }
            );

            applyOrganisationToState(response.organisation);
            await loadWorkspaces({
                force: true,
                syncRoute: false,
                preferredWorkspaceKey: editingCurrentWorkspace
                    ? response.organisation.key
                    : selectedWorkspaceKey.value || undefined
            });
            await loadOrganisationStructure();
            if (editingCurrentWorkspace && response.organisation.path !== currentWorkspace.value?.path) {
                await navigateTo({ path: `${response.organisation.path}/admin/settings/tenant` });
            }
            closeOrganisationModal(true);

            toast.add({
                title: t('common.success'),
                description: organisationMode.value === 'create'
                    ? t('admin.settings.tenant.organisationCreated')
                    : t('admin.settings.tenant.organisationSaved'),
                color: 'success'
            });
        } catch (e: unknown) {
            const { status, field, detail } = parseSettingsError(e);
            if (status === 401) {
                return;
            }
            if (applyOrganisationFieldError(field, detail)) return;

            toast.add({
                title: t('admin.settings.tenant.organisationSaveError'),
                description: detail || undefined,
                icon: 'i-lucide-circle-x',
                color: 'error'
            });
        } finally {
            isOrganisationSaving.value = false;
        }
    }

    function openArchiveOrganisation(organisation: WorkspaceOrganisation) {
        archiveTarget.value = organisation;
        isArchiveModalOpen.value = true;
    }

    function closeArchiveModal(force = false) {
        if (!force && isOrganisationSaving.value) return;
        isArchiveModalOpen.value = false;
        archiveTarget.value = null;
    }

    async function archiveOrganisation() {
        const organisation = archiveTarget.value;
        if (!organisation || isOrganisationSaving.value) return;

        isOrganisationSaving.value = true;
        try {
            await staffFetch<WorkspaceOrganisationResponse>(`/api/admin/workspace-organisations/${organisation.id}`, {
                method: 'DELETE',
                query: jurisdictionQuery()
            });
            const archivedCurrentWorkspace = selectedWorkspaceKey.value === organisation.key;
            organisations.value = organisations.value.filter(item => item.id !== organisation.id);
            await loadWorkspaces({
                force: true,
                syncRoute: false,
                preferredWorkspaceKey: archivedCurrentWorkspace ? organisation.jurisdictionSlug : selectedWorkspaceKey.value || undefined
            });
            await loadOrganisationStructure();
            if (archivedCurrentWorkspace) {
                await navigateTo({ path: `/${organisation.jurisdictionSlug}/admin/settings/tenant` });
            }

            toast.add({
                title: t('common.success'),
                description: t('admin.settings.tenant.organisationArchived'),
                color: 'success'
            });
            closeArchiveModal(true);
        } catch (e: unknown) {
            const { status, detail } = parseSettingsError(e);
            if (status === 401) return;
            const description = status === 409
                ? t('admin.settings.tenant.archiveBlocked')
                : detail || t('admin.settings.tenant.organisationDeleteError');
            toast.add({
                title: t('admin.settings.tenant.organisationDeleteError'),
                description: description === t('admin.settings.tenant.organisationDeleteError') ? undefined : description,
                icon: 'i-lucide-circle-x',
                color: 'error'
            });
        } finally {
            isOrganisationSaving.value = false;
        }
    }

    function localizedFieldError(field: TenantFieldKey, detail: string | null): string {
        if (field === 'label') return t('admin.settings.tenant.validation.labelRequired');
        if (field === 'slug') return t('admin.settings.tenant.validation.slugInvalid');
        if (field === 'orgEmail') return t('admin.settings.tenant.validation.emailInvalid');
        if (field === 'referencePrefix') return t('admin.settings.tenant.validation.prefixInvalid');
        if (field === 'referencePattern') {
            return detail?.includes('between 3 and 64')
                ? t('admin.settings.tenant.validation.patternLength')
                : t('admin.settings.tenant.validation.patternInvalid');
        }
        return detail || t('admin.settings.tenant.saveError');
    }

    function applyFieldError(field: string | null, detail: string | null): boolean {
        if (!field || !(field in errors)) return false;
        const target = field as TenantFieldKey;
        errors[target] = localizedFieldError(target, detail);
        focusField(target);
        return true;
    }

    function replaceWorkspaceInState(next: WorkspaceSettingsResponse['workspace']) {
        const index = workspaces.value.findIndex(item => item.id === next.id || item.internalId === next.internalId);
        if (index === -1) return;

        workspaces.value[index] = {
            ...workspaces.value[index]!,
            ...next
        };
    }

    async function handleSave() {
        if (isSaving.value || !validateForm()) return;
        if (!currentWorkspace.value) {
            toast.add({
                title: t('admin.settings.selectWorkspace'),
                icon: 'i-lucide-circle-x',
                color: 'error'
            });
            return;
        }

        const data: Record<string, string> = {
            label: form.label.trim(),
            slug: form.slug.trim().toLowerCase()
        };
        if (isOrganisationWorkspace.value) {
            data.orgEmail = form.orgEmail.trim();
            data.referencePrefix = form.referencePrefix.trim();
            data.referencePattern = form.referencePattern.trim();
        }

        isSaving.value = true;
        try {
            const response = await staffFetch<WorkspaceSettingsResponse>('/api/admin/workspace-settings', {
                method: 'PATCH',
                query: workspaceQuery(),
                body: { data }
            });
            applyWorkspace(response.workspace);
            replaceWorkspaceInState(response.workspace);
            await loadWorkspaces({
                force: true,
                syncRoute: false,
                preferredWorkspaceKey: response.workspace.key
            });

            toast.add({
                title: t('common.success'),
                description: t('admin.settings.tenant.saved'),
                color: 'success'
            });

            const nextPath = `${response.workspace.path}/admin/settings/tenant`;
            if (nextPath !== route.path) {
                await navigateTo({ path: nextPath });
            }
        } catch (e: unknown) {
            const { status, field, detail } = parseSettingsError(e);
            if (status === 401) {
                return;
            }
            if (applyFieldError(field, detail)) return;

            toast.add({
                title: t('admin.settings.tenant.saveError'),
                description: detail || undefined,
                icon: 'i-lucide-circle-x',
                color: 'error'
            });
        } finally {
            isSaving.value = false;
        }
    }

    const workspaceTree = computed(() => {
        const current = workspaceDetails.value || currentWorkspace.value;
        if (!current) return [];

        const jurisdiction = workspaces.value.find(workspace =>
            workspace.type === 'jurisdiction'
            && workspace.jurisdictionSlug === current.jurisdictionSlug
        ) || (current.type === 'jurisdiction' ? current : null);

        if (!jurisdiction) return [];

        const organisations = workspaces.value.filter(workspace =>
            workspace.type === 'organisation'
            && workspace.jurisdictionSlug === jurisdiction.jurisdictionSlug
        );

        if (current.type === 'organisation') {
            const selectedOrganisation = organisations.find(workspace => workspace.key === current.key) || current;
            return [{
                jurisdiction,
                organisations: [selectedOrganisation],
                hiddenOrganisationCount: 0
            }];
        }

        const visibleOrganisations = organisations.slice(0, MAX_HIERARCHY_ORGANISATIONS);

        return [{
            jurisdiction,
            organisations: visibleOrganisations,
            hiddenOrganisationCount: Math.max(0, organisations.length - visibleOrganisations.length)
        }];
    });

    onMounted(() => {
        loadSettings();
        loadOrganisationStructure();
    });

    watch(selectedWorkspaceKey, () => {
        loadSettings();
        loadOrganisationStructure();
    });

    return {
        FIELD_IDS: TENANT_FIELD_IDS,
        ORGANISATION_FIELD_IDS: TENANT_ORGANISATION_FIELD_IDS,
        form,
        errors,
        organisationForm,
        organisationErrors,
        workspaceDetails,
        isLoading,
        isSaving,
        loadError,
        organisations,
        isOrganisationsLoading,
        isOrganisationSaving,
        organisationLoadError,
        organisationStructureForbidden,
        isOrganisationModalOpen,
        organisationMode,
        archiveTarget,
        isArchiveModalOpen,
        isOrganisationWorkspace,
        isDirty,
        isOrganisationDirty,
        hasUnsavedChanges,
        organisationParentItems,
        workspaceTree,
        workspaceRoute,
        loadSettings,
        loadOrganisationStructure,
        handleSave,
        openCreateOrganisation,
        openEditOrganisation,
        closeOrganisationModal,
        saveOrganisation,
        openArchiveOrganisation,
        closeArchiveModal,
        archiveOrganisation
    };
}
