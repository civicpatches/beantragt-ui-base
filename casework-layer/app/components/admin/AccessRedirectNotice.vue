<script setup lang="ts">
/**
 * The one notice after the admin middleware redirected a person.
 *
 * The dashboard layout hands this component to every `AppPageLayout`, which
 * renders it first in its content: on the application list that is the place
 * the role notice always had. The middleware records where it sent the person
 * and why (`useAdminAccessNotice`); the page the redirect went to shows the
 * sentence once, in a live region, and closing it keeps the focus in the page.
 *
 * Role: the page is not available for the role, the person is on the list.
 * Workspace: the address named a workspace that is not the person's own. The
 * sentence names only the workspace the person is in, never the requested
 * one (the record does not even hold it), so it reads the same whether that
 * workspace belongs to someone else or does not exist.
 *
 * A full-bleed work frame (form editor, batch review, batch case) gets no
 * notice: its fixed rows must not move. The frame clears a notice meant for it
 * and renders nothing, not even an empty live region, so a notice cannot turn
 * up later when the frame returns to its normal view on the same path.
 */
import {
    adminNoticeUserKey,
    type AdminAccessNoticeReason,
    useAdminAccessNotice
} from '~~/casework-layer/app/composables/useAdminAccessNotice';

const props = defineProps<{
    /** Set by `AppPageLayout`: the page is a full-bleed work frame. */
    fullBleed?: boolean
}>();

const { t } = useI18n();
const route = useRoute();
const { user } = useAuth();
const { currentWorkspace, workspaces } = useWorkspaceContext();
const { pendingTarget, consumeRedirect } = useAdminAccessNotice();

const reason = ref<AdminAccessNoticeReason | null>(null);

/** The workspace the person landed in; they may see it anyway. */
const currentWorkspaceName = computed(() => currentWorkspace.value?.label || '');
/** Switching is a way out only with more than one workspace. */
const canSwitchWorkspace = computed(() => (workspaces.value?.length ?? 0) > 1);

async function showNotice() {
    const next = consumeRedirect(route.path, adminNoticeUserKey(user.value));
    if (!next || props.fullBleed) return;
    // Empty the live region first, so a repeated notice is announced again.
    reason.value = null;
    await nextTick();
    reason.value = next;
}

function dismissNotice() {
    reason.value = null;
    // The close button disappears with the notice; keep the focus in the page.
    // Without scrolling: focusing `main` scrolled the panel by its padding, so
    // the page jumped on closing. Only the notice's own height leaves the flow.
    document.getElementById('admin-main')?.focus({ preventScroll: true });
}

// Filled after mount so the live region below announces it.
onMounted(showNotice);
// Already on the target: the redirect back to it is a duplicate navigation and
// does not remount the page, so the notice is picked up here.
watch([pendingTarget, () => route.path], showNotice);
// A page that turns into a work frame after loading (batch review) drops a
// shown notice, so it does not come back when the frame is left.
watch(() => props.fullBleed, (fullBleed) => {
    if (fullBleed) reason.value = null;
});
</script>

<template>
  <div
    v-if="!fullBleed"
    role="status"
    aria-live="polite"
  >
    <UAlert
      v-if="reason"
      icon="i-lucide-lock"
      :title="reason === 'role' ? t('admin.access.redirectTitle') : t('admin.access.workspaceRedirectTitle')"
      close
      class="mb-4"
      :data-testid="reason === 'role' ? 'admin-role-redirect-notice' : 'admin-workspace-redirect-notice'"
      @update:open="dismissNotice"
    >
      <template #description>
        <template v-if="reason === 'role'">
          <AccessReason
            id="admin-role-redirect-reason"
            reason="admin"
          />
          <p class="mt-1">
            {{ t('admin.access.redirectBody') }}
          </p>
        </template>
        <p v-else>
          <template v-if="currentWorkspaceName">
            {{ t('admin.access.workspaceRedirectCurrent', { workspace: currentWorkspaceName }) }}
          </template>
          <template v-if="canSwitchWorkspace">
            {{ t('admin.access.workspaceRedirectSwitch') }}
          </template>
          {{ t('admin.access.workspaceRedirectAccess') }}
        </p>
      </template>
    </UAlert>
  </div>
</template>
