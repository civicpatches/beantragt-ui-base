import type { ComputedRef, Ref } from 'vue';

interface DeletableApplication {
    changed: string
}

interface AdminApplicationDeletionOptions {
    applicationId: string
    application: ComputedRef<DeletableApplication | null>
    applicationQuery: ComputedRef<Record<string, string>>
    canDelete: ComputedRef<boolean>
    mutationBusy: ComputedRef<boolean>
    listRoute: () => string | { path: string }
}

interface AdminApplicationDeletion {
    isDeleteDialogOpen: Ref<boolean>
    isDeletingApplication: Ref<boolean>
    deleteActionDisabled: ComputedRef<boolean>
    openDeleteDialog: () => void
    closeDeleteDialog: () => void
    deleteApplication: () => Promise<void>
}

/**
 * Coordinates the confirmed, tenant-scoped permanent application deletion.
 */
export function useAdminApplicationDeletion(
    options: AdminApplicationDeletionOptions
): AdminApplicationDeletion {
    const { t } = useI18n();
    const toast = useToast();
    const { resolveApiErrorMessage } = useApiErrorMessage();
    const isDeleteDialogOpen = ref(false);
    const isDeletingApplication = ref(false);
    const deleteActionDisabled = computed(() =>
        options.mutationBusy.value || isDeletingApplication.value
    );

    function openDeleteDialog() {
        if (!options.canDelete.value || deleteActionDisabled.value) return;
        isDeleteDialogOpen.value = true;
    }

    function closeDeleteDialog() {
        if (isDeletingApplication.value) return;
        isDeleteDialogOpen.value = false;
    }

    async function deleteApplication() {
        const application = options.application.value;
        if (!options.canDelete.value || !application?.changed || deleteActionDisabled.value) return;

        isDeletingApplication.value = true;
        try {
            const deleteUrl: string = `/api/admin/applications/${options.applicationId}`;
            await $fetch<{ success: boolean, id: string }>(deleteUrl, {
                method: 'DELETE',
                query: options.applicationQuery.value,
                body: { expectedChanged: application.changed }
            });
        } catch (deleteError: unknown) {
            toast.add({
                title: t('admin.detail.applicationDeleteError'),
                description: resolveApiErrorMessage(deleteError, 'errors.applications.deleteFailed'),
                color: 'error'
            });
            return;
        } finally {
            isDeletingApplication.value = false;
        }

        isDeleteDialogOpen.value = false;
        toast.add({
            title: t('admin.detail.applicationDeleted'),
            color: 'success'
        });
        try {
            const target = options.listRoute();
            await navigateTo(target);
        } catch (navigationError: unknown) {
            console.error('[admin] Application was deleted, but navigation to the list failed:', navigationError);
            toast.add({
                title: t('admin.detail.applicationDeleted'),
                description: t('admin.detail.applicationDeleteNavigationRecovery'),
                color: 'warning'
            });
            const fallbackPath = options.listRoute();
            await reloadNuxtApp({
                path: typeof fallbackPath === 'string' ? fallbackPath : fallbackPath.path,
                force: true
            });
        }
    }

    return {
        isDeleteDialogOpen,
        isDeletingApplication,
        deleteActionDisabled,
        openDeleteDialog,
        closeDeleteDialog,
        deleteApplication
    };
}
