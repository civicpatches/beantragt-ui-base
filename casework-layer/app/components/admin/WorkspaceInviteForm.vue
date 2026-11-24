<script setup lang="ts">
import type { AdminWorkspace } from '~~/casework-layer/app/composables/useWorkspaceContext';
import { staffFetch } from '~~/casework-layer/app/composables/api/useStaffSessionFetch';
import AppCard from '~/components/app/Card.vue';

const props = defineProps<{ workspace: AdminWorkspace }>();
const { t } = useI18n();
const email = ref('');
const sending = ref(false);
const feedback = ref<'sent' | 'mailFailed' | 'forbidden' | 'alreadyPending' | 'failed' | null>(null);

const tone = computed(() => {
    if (feedback.value === 'sent') return { color: 'success', icon: 'i-lucide-circle-check', role: 'status' } as const;
    if (feedback.value === 'failed' || feedback.value === 'forbidden') {
        return { color: 'error', icon: 'i-lucide-circle-x', role: 'alert' } as const;
    }
    return { color: 'warning', icon: 'i-lucide-triangle-alert', role: 'status' } as const;
});

async function invite() {
    const target = props.workspace;
    const parentId = target.jurisdictionInternalId ?? (target.type === 'jurisdiction' ? target.internalId : null);
    const organisationId = target.type === 'organisation' ? target.organisationInternalId ?? target.internalId : null;
    if (sending.value || !parentId || (target.type === 'organisation' && !organisationId)) return;

    feedback.value = null;
    sending.value = true;
    try {
        const response = await staffFetch<{ mail_sent: boolean }>('/api/workspace-invites', {
            method: 'POST',
            body: {
                email: email.value.trim(),
                target_parent_id: parentId,
                ...(organisationId ? { group_id: organisationId } : {})
            }
        });
        feedback.value = response.mail_sent ? 'sent' : 'mailFailed';
        if (response.mail_sent) email.value = '';
    } catch (error: unknown) {
        const status = (error as { statusCode?: number })?.statusCode;
        feedback.value = status === 409 ? 'alreadyPending' : status === 403 ? 'forbidden' : 'failed';
    } finally {
        sending.value = false;
    }
}
</script>

<template>
  <AppCard :title="t('workspaceInvite.issue.title')">
    <form
      class="max-w-xl space-y-4"
      @submit.prevent="invite"
    >
      <UFormField
        :label="t('workspaceInvite.invitedEmail')"
        :description="t('workspaceInvite.issue.description', { workspace: workspace.label })"
        name="email"
        required
      >
        <UInput
          v-model="email"
          type="email"
          name="email"
          autocomplete="off"
          required
          :maxlength="254"
          :disabled="sending"
          class="w-full"
        />
      </UFormField>
      <UAlert
        v-if="feedback"
        v-bind="tone"
        :title="t(`workspaceInvite.issue.${feedback}`)"
      />
      <UButton
        type="submit"
        :loading="sending"
        :disabled="!email.trim()"
      >
        {{ t('workspaceInvite.issue.send') }}
      </UButton>
    </form>
  </AppCard>
</template>
