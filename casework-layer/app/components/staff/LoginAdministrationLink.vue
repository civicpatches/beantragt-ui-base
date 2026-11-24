<script setup lang="ts">
import { ADMIN_ENTRY_PATH, publicAdministrationPath, publicWorkspaceFromRoute } from '~/utils/public-form-path';

// The way on for signed-in staff on the login page. `to` is the admin
// page the person asked for, when the login page was reached from one;
// otherwise the application list, which every staff role may open.
const props = defineProps<{
    to?: string
}>();

const { t } = useI18n();
const route = useRoute();
const { workspaceRoute } = useWorkspaceContext();
const target = computed(() => {
    if (props.to) return props.to;
    return publicAdministrationPath(publicWorkspaceFromRoute(route)) ?? workspaceRoute(ADMIN_ENTRY_PATH).path;
});
</script>

<template>
  <!-- The filled button of the signed-in row, text only, natural width from sm. -->
  <UButton
    :to="target"
    size="xl"
    class="w-full justify-center sm:w-auto"
    data-testid="login-signed-in-administration"
  >
    {{ t('auth.login.toAdministration') }}
  </UButton>
</template>
