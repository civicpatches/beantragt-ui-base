import type { ComputedRef, Ref } from 'vue';
import type {
    AdminApplicationAssigneesResponse,
    AdminApplicationDelegationTarget
} from '~/types';
import { resolveAdminNotificationReceipt } from '~~/casework-layer/app/utils/admin-notification-receipt';

interface DelegationApplicationState {
    changed: string
    revisionId: number | null
    /** For the toast after a hand-over that takes the case out of this workspace. */
    referenceNumber?: string
}

type DelegationQuery = Record<string, unknown>;
type MaybeComputedRef<T> = Ref<T> | ComputedRef<T>;

interface DelegationResponse {
    success?: boolean
    revision_id?: number
    target_org?: {
        uuid?: string
        label?: string
    }
    notifications?: unknown
}

function responseStatusCode(error: unknown): number | null {
    const statusCode = (error as { statusCode?: unknown })?.statusCode;
    if (typeof statusCode === 'number') return statusCode;
    const status = (error as { status?: unknown })?.status;
    if (typeof status === 'number') return status;
    const responseStatus = (error as { response?: { status?: unknown } })?.response?.status;
    return typeof responseStatus === 'number' ? responseStatus : null;
}

function errorPayload(error: unknown): Record<string, unknown> | null {
    const data = (error as { data?: unknown })?.data
      ?? (error as { response?: { _data?: unknown } })?.response?._data;
    return data && typeof data === 'object' ? data as Record<string, unknown> : null;
}

function stringPayloadValue(payload: Record<string, unknown> | null, key: string): string | null {
    const value = payload?.[key];
    if (typeof value === 'string') return value;
    const nested = payload?.data;
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
        const nestedValue = (nested as Record<string, unknown>)[key];
        if (typeof nestedValue === 'string') return nestedValue;
    }
    return null;
}

function isMissingDelegationNoteError(error: unknown): boolean {
    if (responseStatusCode(error) !== 400) return false;
    const payload = errorPayload(error);
    if (stringPayloadValue(payload, 'code') === 'errors.admin.delegationNoteRequired') return true;
    if (stringPayloadValue(payload, 'code') === 'delegation_note_required') return true;

    const messages = [
        (error as { message?: unknown })?.message,
        (error as { statusMessage?: unknown })?.statusMessage,
        stringPayloadValue(payload, 'message'),
        stringPayloadValue(payload, 'detail')
    ];

    return messages.some(value =>
        typeof value === 'string' && value.toLowerCase().includes('delegation note is required')
    );
}

export function useAdminApplicationDelegation(options: {
    applicationId: string
    application: MaybeComputedRef<DelegationApplicationState | null>
    assigneeResponse: MaybeComputedRef<AdminApplicationAssigneesResponse | null | undefined>
    applicationQuery: MaybeComputedRef<DelegationQuery>
    refreshApplication: () => Promise<unknown>
    refreshAssignees: () => Promise<unknown>
}) {
    const { t } = useI18n();
    const toast = useToast();
    const { resolveApiErrorMessage } = useApiErrorMessage();
    const { workspaceRoute } = useWorkspaceContext();

    const isDelegating = ref(false);

    const delegationTargets = computed<AdminApplicationDelegationTarget[]>(() =>
        options.assigneeResponse.value?.delegation_targets ?? []
    );

    const hasDelegationTargets = computed(() => delegationTargets.value.length > 0);
    const canDelegate = computed(() => options.assigneeResponse.value?.can_delegate === true);
    const delegationNoteRequired = computed(() => options.assigneeResponse.value?.note_required === true);

    function targetLabel(targetOrgUuid: string): string {
        return delegationTargets.value.find(target => target.uuid === targetOrgUuid)?.label ?? targetOrgUuid;
    }

    /** `left`: the case is no longer in this workspace; the page goes to the list. */
    async function handleRefreshAfterDelegation(): Promise<'stayed' | 'left'> {
        try {
            await options.refreshApplication();
            await options.refreshAssignees();
            return 'stayed';
        } catch (error: unknown) {
            if (responseStatusCode(error) === 404) return 'left';
            throw error;
        }
    }

    async function delegateTo(targetOrgUuid: string, note: string) {
        if (!options.application.value || isDelegating.value || !canDelegate.value) return false;

        isDelegating.value = true;
        try {
            const response = await $fetch<DelegationResponse>(`/api/admin/applications/${options.applicationId}/delegate`, {
                method: 'POST',
                query: options.applicationQuery.value,
                body: {
                    targetOrgUuid,
                    note,
                    expectedChanged: options.application.value.changed,
                    expectedRevisionId: options.application.value.revisionId
                }
            });
            const name = response.target_org?.label || targetLabel(targetOrgUuid);
            const receipt = resolveAdminNotificationReceipt(response.notifications);
            const reference = options.application.value.referenceNumber;
            const outcome = await handleRefreshAfterDelegation();
            // The person chose the office, so naming it reveals nothing (02 state "not in this office").
            toast.add({
                title: outcome === 'left'
                    ? (reference ? t('admin.detail.handedOverToast', { ref: reference, office: name }) : t('admin.detail.handedOverToastNoRef', { office: name }))
                    : t('admin.detail.delegation.success', { name }),
                ...(receipt ? { description: t(receipt.messageKey) } : {}),
                color: receipt?.color ?? 'success'
            });
            if (outcome === 'left') await navigateTo(workspaceRoute('/admin/applications'));
            return true;
        } catch (error: unknown) {
            const statusCode = responseStatusCode(error);
            if (statusCode === 409 || statusCode === 428) {
                toast.add({
                    title: t('admin.detail.delegation.conflictError'),
                    color: 'error'
                });
                return false;
            }
            if (isMissingDelegationNoteError(error)) {
                toast.add({
                    title: t('admin.detail.delegation.genericError'),
                    description: t('admin.detail.delegation.noteRequiredHint'),
                    color: 'error'
                });
                return false;
            }
            toast.add({
                title: t('admin.detail.delegation.genericError'),
                description: resolveApiErrorMessage(error, 'admin.detail.delegation.genericError'),
                color: 'error'
            });
            return false;
        } finally {
            isDelegating.value = false;
        }
    }

    return {
        delegationTargets,
        hasDelegationTargets,
        canDelegate,
        delegationNoteRequired,
        isDelegating,
        delegateTo
    };
}
