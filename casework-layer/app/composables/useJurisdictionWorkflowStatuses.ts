import { staffFetch } from '~~/casework-layer/app/composables/api/useStaffSessionFetch';

export interface FlaggedWorkflowStatus {
    id: string
    label: string
    semanticFlags: string[]
}

/**
 * Workflow statuses of the municipality and all its organisations, for the
 * coupling settings of connections and transfer rules. Connections belong to
 * the municipality, catalogues to organisations: only semantic flags couple
 * them, so the settings show which statuses carry a chosen flag.
 *
 * A failed load leaves `loaded` FALSE; the settings then show no warning
 * instead of a false "no matching status".
 */
export function useJurisdictionWorkflowStatuses() {
    const { currentWorkspace } = useWorkspaceContext();
    const statuses = ref<FlaggedWorkflowStatus[]>([]);
    const loaded = ref(false);
    let sequence = 0;

    async function load() {
        const current = ++sequence;
        const jurisdiction = currentWorkspace.value?.jurisdictionSlug;
        loaded.value = false;
        if (!jurisdiction) return;
        try {
            const response = await staffFetch<{ statuses: FlaggedWorkflowStatus[] }>('/api/admin/workflow-statuses', {
                query: { jurisdiction }
            });
            if (current !== sequence) return;
            statuses.value = response.statuses.map(status => ({ id: status.id, label: status.label, semanticFlags: [...status.semanticFlags] }));
            loaded.value = true;
        } catch {
            if (current === sequence) statuses.value = [];
        }
    }

    /** Distinct labels of statuses carrying the flag (organisations share names). */
    function labelsWithFlag(flag: string): string[] {
        return [...new Set(statuses.value.filter(status => status.semanticFlags.includes(flag)).map(status => status.label))];
    }

    onMounted(load);
    watch(() => currentWorkspace.value?.jurisdictionSlug, load);

    return { statuses, loaded, load, labelsWithFlag };
}
