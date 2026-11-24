/**
 * One-shot notice after the admin middleware moved a person away from the page
 * they asked for.
 *
 * The middleware keeps every redirect as it was and only records here where it
 * sent the person and why. The target page shows the sentence once and clears
 * it. App state, not a query flag: a link cannot fake the notice, a reload does
 * not repeat it, and the redirect target stays the same address (the app runs
 * without SSR, so the state survives the client-side redirect).
 *
 * Only the role branch of the middleware sets the `role` reason. The workspace
 * fallback (a person opens a page of a workspace they do not belong to and
 * lands in their own) is not a missing right and gets no notice; the demo
 * tour's case worker passes through that branch.
 * The line: no notice when the requested workspace is an ancestor of the
 * one the person lands in; any other foreign or unknown workspace records the
 * `workspace` reason, word for word the same, without the requested key.
 * In the running app a workspace that does not exist never gets here: the
 * public route answers 404 first.
 *
 * Bound to the account: the notice carries the key of the
 * signed-in account, and a notice of another account is dropped instead of
 * shown. The admin layout also clears it on logout and on a demo persona switch.
 */
import { computed } from 'vue';

export type AdminAccessNoticeReason = 'role' | 'workspace';

interface AdminAccessNotice {
    /** Path the middleware redirected to, without query. */
    targetPath: string
    /** Stable key of the account the redirect happened for. */
    userKey: string
    /** Why the person was redirected. Nothing about the requested address. */
    reason: AdminAccessNoticeReason
}

interface NoticeUser {
    uuid?: string | null
    uid?: number | string | null
}

/** Same account key as the workspace list uses (useWorkspaceContext). Empty when unknown. */
export function adminNoticeUserKey(user: NoticeUser | null | undefined): string {
    return String(user?.uuid || user?.uid || '');
}

function normalizedPath(path: string): string {
    return (path.split('?')[0] || '').replace(/\/+$/u, '');
}

export function useAdminAccessNotice() {
    const notice = useState<AdminAccessNotice | null>('admin-access-notice', () => null);

    function record(reason: AdminAccessNoticeReason, targetPath: string, userKey: string): void {
        notice.value = userKey ? { targetPath: normalizedPath(targetPath), userKey, reason } : null;
    }

    /** Records a role redirect. Without a known account nothing is recorded. */
    function recordRoleRedirect(targetPath: string, userKey: string): void {
        record('role', targetPath, userKey);
    }

    /**
     * Records a redirect away from a workspace that is not the person's own.
     * Takes only the target: the requested workspace is never passed or kept.
     */
    function recordWorkspaceRedirect(targetPath: string, userKey: string): void {
        record('workspace', targetPath, userKey);
    }

    /** Target of a redirect that no page has shown yet. */
    const pendingTarget = computed(() => notice.value?.targetPath ?? null);

    /**
     * The reason, once, if a redirect of this account went to `currentPath`;
     * then the notice is cleared. A notice of another account is dropped. A
     * notice for another path stays: the redirect may still be on its way there
     * while the old page is shown.
     */
    function consumeRedirect(currentPath: string, userKey: string): AdminAccessNoticeReason | null {
        if (notice.value === null) return null;
        if (!userKey || notice.value.userKey !== userKey) {
            notice.value = null;
            return null;
        }
        if (notice.value.targetPath !== normalizedPath(currentPath)) return null;
        const reason = notice.value.reason;
        notice.value = null;
        return reason;
    }

    /** Drops a pending notice of either reason (logout, account switch). */
    function clearRedirect(): void {
        notice.value = null;
    }

    return { pendingTarget, recordRoleRedirect, recordWorkspaceRedirect, consumeRedirect, clearRedirect };
}
