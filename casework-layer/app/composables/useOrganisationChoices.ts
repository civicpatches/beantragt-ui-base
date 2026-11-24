/**
 * Organisations of the current municipality that a form can be assigned to.
 *
 * Only an admin inside the municipality workspace may assign: inside an
 * organisation the form of the municipality is not visible, and the
 * integrations stay with the municipality either way.
 */
export function useOrganisationChoices() {
    const { isAdmin } = useAuth();
    const { workspaces, currentWorkspace } = useWorkspaceContext();

    const organisations = computed(() => workspaces.value
        .filter(workspace => workspace.type === 'organisation' && workspace.key !== currentWorkspace.value?.key
          && workspace.jurisdictionId === currentWorkspace.value?.jurisdictionId)
        .sort((a, b) => a.label.localeCompare(b.label)));

    const canAssign = computed(() => isAdmin.value && currentWorkspace.value?.type === 'jurisdiction' && organisations.value.length > 0);

    return { organisations, canAssign };
}
