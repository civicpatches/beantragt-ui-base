import type { ComputedRef, Ref } from 'vue';
import type {
    AdminApplicationAssignee,
    AdminApplicationAssigneesResponse
} from '~/types';
import { resolveAdminNotificationReceipt } from '~~/casework-layer/app/utils/admin-notification-receipt';

export const UNASSIGNED_ASSIGNEE_VALUE = '__unassigned__';

interface AssignmentApplicationState {
    changed: string
    revisionId: number | null
}

interface AssignmentResponse {
    notifications?: unknown
}

export interface AdminAssignmentSelection {
    assignmentType: 'user' | 'team' | 'none'
    assigneeId: string | null
    teamId: string | null
    note?: string
}

export interface AdminAssignmentInlineError {
    kind: 'conflict' | 'error'
    message: string
    detail?: string
    statusCode: number | null
}

type AssignmentQuery = Record<string, unknown>;
type MaybeComputedRef<T> = Ref<T> | ComputedRef<T>;

export function assignmentSelectionValue(target: { type?: 'user' | 'team', id: string } | null): string {
    if (!target) return UNASSIGNED_ASSIGNEE_VALUE;
    return `${target.type ?? 'user'}:${target.id}`;
}

export function parseAssignmentSelection(value: string): AdminAssignmentSelection {
    if (value === UNASSIGNED_ASSIGNEE_VALUE) {
        return { assignmentType: 'none', assigneeId: null, teamId: null };
    }
    const [type, ...idParts] = value.split(':');
    const id = idParts.join(':');
    if (type === 'team' && id) return { assignmentType: 'team', assigneeId: null, teamId: id };
    if (type === 'user' && id) return { assignmentType: 'user', assigneeId: id, teamId: null };
    return { assignmentType: 'none', assigneeId: null, teamId: null };
}

function responseStatusCode(error: unknown): number | null {
    const statusCode = (error as { statusCode?: unknown })?.statusCode;
    if (typeof statusCode === 'number') return statusCode;
    const status = (error as { status?: unknown })?.status;
    if (typeof status === 'number') return status;
    const responseStatus = (error as { response?: { status?: unknown } })?.response?.status;
    return typeof responseStatus === 'number' ? responseStatus : null;
}

export function useAdminApplicationAssignment(options: {
    applicationId: string
    application: MaybeComputedRef<AssignmentApplicationState | null>
    assigneeResponse: MaybeComputedRef<AdminApplicationAssigneesResponse | null | undefined>
    applicationQuery: MaybeComputedRef<AssignmentQuery>
    refreshApplication: () => Promise<unknown>
    refreshAssignees: () => Promise<unknown>
    /** UUID of the signed-in account (`useAuth().user.uuid`), for "Mir zuweisen". */
    currentUserUuid?: MaybeComputedRef<string | null | undefined>
}) {
    const { t } = useI18n();
    const toast = useToast();
    const { resolveApiErrorMessage } = useApiErrorMessage();
    const { workspaceRoute } = useWorkspaceContext();

    const isSavingAssignee = ref(false);
    const assigneeSaveError = ref<AdminAssignmentInlineError | null>(null);
    /** Where the failed save started: the card shows errors of "Mir zuweisen", the dialog its own. */
    const assigneeSaveErrorSource = ref<'self' | 'picker' | null>(null);
    const assignmentSaveAnnouncement = ref('');

    const currentAssignee = computed(() => options.assigneeResponse.value?.current ?? null);
    const personalAssignmentEnabled = computed(() => options.assigneeResponse.value?.personal_assignment_enabled !== false);

    function assignmentLabel(target: { type?: 'user' | 'team', label: string }): string {
        return target.type === 'team'
            ? t('admin.detail.assignmentTeamLabel', { name: target.label })
            : t('admin.detail.assignmentUserLabel', { name: target.label });
    }

    const assigneeCandidates = computed<AdminApplicationAssignee[]>(() => personalAssignmentEnabled.value
        ? options.assigneeResponse.value?.candidates ?? []
        : []);

    const assigneeTeamCandidates = computed<AdminApplicationAssignee[]>(() => options.assigneeResponse.value?.teams ?? []);

    const assigneeCandidateIds = computed(() => new Set([
        ...assigneeCandidates.value.map(candidate => assignmentSelectionValue({ ...candidate, type: 'user' })),
        ...assigneeTeamCandidates.value.map(candidate => assignmentSelectionValue({ ...candidate, type: 'team' }))
    ]));

    const hasAssigneeCandidates = computed(() => assigneeCandidates.value.length + assigneeTeamCandidates.value.length > 0);
    const canChangeAssignment = computed(() => options.assigneeResponse.value?.can_assign === true
      && (Boolean(currentAssignee.value) || hasAssigneeCandidates.value));

    const currentAssigneeOutOfScope = computed(() => {
        const current = currentAssignee.value;
        // An opt-out suppresses the people list without changing the current person's scope.
        if (!personalAssignmentEnabled.value && current && current.type !== 'team') return current.outOfScope === true;
        return Boolean(current?.outOfScope) || Boolean(current && !assigneeCandidateIds.value.has(assignmentSelectionValue(current)));
    });

    const assigneeDisplayLabel = computed(() => {
        const current = currentAssignee.value;
        if (!current) return t('admin.detail.unassigned');
        if (current.outOfScope === true) return t('admin.detail.assigneeOutsideWorkspace');
        if (currentAssigneeOutOfScope.value) {
            return t('admin.detail.currentAssigneeOutsideCandidates', { name: assignmentLabel(current) });
        }
        return assignmentLabel(current);
    });

    const ownUuid = computed(() => options.currentUserUuid?.value || null);

    /**
     * "Mir zuweisen": offered only when the own account is one of the
     * people the backend lists for this case, so the existing assignment path
     * accepts it, and only when the case is not already the own one.
     */
    const canAssignSelf = computed(() => {
        const uuid = ownUuid.value;
        if (!uuid || !canChangeAssignment.value || !personalAssignmentEnabled.value) return false;
        if (!assigneeCandidates.value.some(candidate => candidate.id === uuid)) return false;
        const current = currentAssignee.value;
        return !(current && current.type !== 'team' && current.id === uuid);
    });

    /**
     * "Mir zuweisen" on a case someone else holds asks first: `null` when the
     * case is unassigned (one click), otherwise who holds it; `name` is empty when it is not available.
     */
    const selfAssignTakesOverFrom = computed<{ name: string, team: boolean } | null>(() => {
        const current = currentAssignee.value;
        if (!current || !canAssignSelf.value) return null;
        const name = current.outOfScope === true ? '' : current.label?.trim() ?? '';
        return { name, team: current.type === 'team' };
    });

    function isOwnCandidate(candidate: { id: string }): boolean {
        return Boolean(ownUuid.value) && candidate.id === ownUuid.value;
    }

    function clearAssigneeSaveError() {
        assigneeSaveError.value = null;
        assigneeSaveErrorSource.value = null;
    }

    function assignSelf(): Promise<boolean> {
        const uuid = ownUuid.value;
        if (!uuid || !canAssignSelf.value) return Promise.resolve(false);
        return assignTo({ assignmentType: 'user', assigneeId: uuid, teamId: null }, 'self');
    }

    async function assignTo(selection: AdminAssignmentSelection, source: 'self' | 'picker' = 'picker'): Promise<boolean> {
        if (!options.application.value || !canChangeAssignment.value || isSavingAssignee.value) return false;
        if (selection.assignmentType === 'user' && !personalAssignmentEnabled.value) return false;

        clearAssigneeSaveError();
        assigneeSaveErrorSource.value = source;
        assignmentSaveAnnouncement.value = '';
        if (options.application.value.revisionId === null) {
            assigneeSaveError.value = {
                kind: 'error',
                message: t('admin.applications.loadError'),
                statusCode: null
            };
            return false;
        }

        isSavingAssignee.value = true;
        try {
            const response = await $fetch<AssignmentResponse>(`/api/admin/applications/${options.applicationId}/assignee`, {
                method: 'PATCH',
                query: options.applicationQuery.value,
                body: {
                    assignmentType: selection.assignmentType,
                    assigneeId: selection.assigneeId,
                    teamId: selection.teamId,
                    ...(selection.note?.trim() ? { note: selection.note.trim() } : {}),
                    expectedChanged: options.application.value.changed,
                    expectedRevisionId: options.application.value.revisionId
                }
            });
            await options.refreshApplication();
            await options.refreshAssignees();
            const title = t('admin.detail.assigneeSaved');
            const receipt = resolveAdminNotificationReceipt(response?.notifications);
            const description = receipt ? t(receipt.messageKey) : undefined;
            assignmentSaveAnnouncement.value = [title, description].filter(Boolean).join(' ');
            toast.add({
                title,
                ...(description ? { description } : {}),
                color: receipt?.color ?? 'success'
            });
            return true;
        } catch (error: unknown) {
            const statusCode = responseStatusCode(error);
            if (statusCode === 409 || statusCode === 428) {
                assigneeSaveError.value = {
                    kind: 'conflict',
                    message: t('admin.detail.assignment.conflictError'),
                    statusCode
                };
                return false;
            }

            if (statusCode === 404) {
                toast.add({
                    title: t('admin.detail.delegation.movedOutOfScope'),
                    color: 'info'
                });
                await navigateTo(workspaceRoute('/admin/applications'));
                return true;
            }

            const resolved = resolveApiErrorMessage(error, 'admin.detail.assigneeSaveError');
            assigneeSaveError.value = statusCode === 403
                ? {
                    kind: 'error',
                    message: resolved,
                    statusCode
                }
                : {
                    kind: 'error',
                    message: t('admin.detail.assigneeSaveError'),
                    detail: resolved,
                    statusCode
                };
            return false;
        } finally {
            isSavingAssignee.value = false;
        }
    }

    return {
        currentAssignee,
        personalAssignmentEnabled,
        assigneeCandidates,
        assigneeTeamCandidates,
        isSavingAssignee,
        assigneeSaveError,
        assigneeSaveErrorSource,
        assignmentSaveAnnouncement,
        assigneeDisplayLabel,
        hasAssigneeCandidates,
        canChangeAssignment,
        currentAssigneeOutOfScope,
        assignmentLabel,
        parseAssignmentSelection,
        clearAssigneeSaveError,
        canAssignSelf,
        selfAssignTakesOverFrom,
        isOwnCandidate,
        assignSelf,
        assignTo
    };
}
