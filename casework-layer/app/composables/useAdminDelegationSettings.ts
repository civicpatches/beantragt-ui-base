import { computed, onMounted, ref, watch } from 'vue';
import { staffFetch } from '~~/casework-layer/app/composables/api/useStaffSessionFetch';
import { parseSettingsError } from '~/composables/useSettingsError';

export interface DelegationSettingsData {
    noteRequired?: boolean
    personalAssignment?: boolean
    personalAssignmentEditable?: boolean
}

export interface DelegationSettingsResponse {
    section: string
    data: DelegationSettingsData
}

export function useAdminDelegationSettings() {
    const { t } = useI18n();
    const toast = useToast();
    const {
        currentWorkspace,
        selectedWorkspaceSlug,
        selectedWorkspaceKey,
        loadWorkspaces
    } = useWorkspaceContext();

    const noteRequired = ref(false);
    const personalAssignment = ref(true);
    const personalAssignmentEditable = ref(true);
    const isLoading = ref(true);
    const loadError = ref<string | null>(null);
    const permissionError = ref(false);
    const isSaving = ref(false);
    const saveError = ref<string | null>(null);

    const jurisdictionIdentifier = computed(() => {
        const workspace = currentWorkspace.value;
        if (workspace?.jurisdictionSlug) return workspace.jurisdictionSlug;
        if (workspace?.jurisdictionInternalId !== null && workspace?.jurisdictionInternalId !== undefined) {
            return String(workspace.jurisdictionInternalId);
        }
        return selectedWorkspaceSlug.value || null;
    });

    async function ensureJurisdictionIdentifier(): Promise<string | null> {
        if (!jurisdictionIdentifier.value) {
            await loadWorkspaces();
        }
        return jurisdictionIdentifier.value;
    }

    function applySection(data: DelegationSettingsData) {
        noteRequired.value = data.noteRequired === true;
        personalAssignment.value = data.personalAssignment !== false;
        personalAssignmentEditable.value = data.personalAssignmentEditable !== false;
    }

    async function loadSettings() {
        const requestJurisdiction = await ensureJurisdictionIdentifier();
        isLoading.value = true;
        loadError.value = null;
        permissionError.value = false;
        saveError.value = null;

        if (!requestJurisdiction) {
            noteRequired.value = false;
            loadError.value = t('admin.settings.selectWorkspace');
            isLoading.value = false;
            return;
        }

        try {
            const response = await staffFetch<DelegationSettingsResponse>(
                `/api/admin/jurisdictions/${encodeURIComponent(requestJurisdiction)}/settings/delegation`
            );
            applySection(response.data);
        } catch (e: unknown) {
            const { status, detail } = parseSettingsError(e);
            noteRequired.value = false;
            if (status === 403) {
                permissionError.value = true;
                loadError.value = null;
                return;
            }
            if (status === 401) return;
            loadError.value = detail || t('admin.settings.workflow.delegationSettingsLoadError');
        } finally {
            isLoading.value = false;
        }
    }

    async function updateAssignmentSetting(key: 'noteRequired' | 'personalAssignment', value: boolean) {
        const state = key === 'noteRequired' ? noteRequired : personalAssignment;
        if (isSaving.value || state.value === value) return;

        const requestJurisdiction = await ensureJurisdictionIdentifier();
        if (!requestJurisdiction) {
            toast.add({
                title: t('admin.settings.selectWorkspace'),
                icon: 'i-lucide-circle-x',
                color: 'error'
            });
            return;
        }

        const previous = state.value;
        state.value = value;
        isSaving.value = true;
        saveError.value = null;

        try {
            const response = await staffFetch<DelegationSettingsResponse>(
                `/api/admin/jurisdictions/${encodeURIComponent(requestJurisdiction)}/settings/delegation`,
                {
                    method: 'PATCH',
                    body: {
                        data: {
                            [key]: value
                        }
                    }
                }
            );
            applySection(response.data);
            toast.add({
                title: t('admin.settings.workflow.delegationSettingsSaved'),
                color: 'success'
            });
        } catch (e: unknown) {
            const { status, detail } = parseSettingsError(e);
            state.value = previous;
            if (status === 401) return;
            saveError.value = detail || t('admin.settings.workflow.delegationSettingsSaveError');
            toast.add({
                title: t('admin.settings.workflow.delegationSettingsSaveError'),
                description: saveError.value,
                color: 'error'
            });
        } finally {
            isSaving.value = false;
        }
    }

    watch(selectedWorkspaceKey, (next, previous) => {
        if (!previous || next === previous) return;
        loadSettings();
    });

    onMounted(() => {
        loadSettings();
    });

    return {
        noteRequired,
        personalAssignment,
        personalAssignmentEditable,
        isLoading,
        loadError,
        permissionError,
        isSaving,
        saveError,
        jurisdictionIdentifier,
        loadSettings,
        setNoteRequired: (value: boolean) => updateAssignmentSetting('noteRequired', value),
        setPersonalAssignment: (value: boolean) => updateAssignmentSetting('personalAssignment', value)
    };
}
