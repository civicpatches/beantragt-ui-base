<script setup lang="ts">
import { publicAdministrationPath, publicWorkspaceFromRoute } from '~/utils/public-form-path';
import { ADMIN_ENTRY_PATH, roleMayOpenAdminPath } from '~~/casework-layer/app/utils/admin-access';

// Primary navigation entry into the administration, for every role the admin
// middleware lets into the application list (case workers included): the
// same check as the middleware, not a second one. The demo persona switch is a
// user switch, not navigation: it lives in the citizen account menu (AppHeader)
// and, for signed-out visitors, on the login page.
const { t } = useI18n();
const { isAdmin, isStaff, loading } = useAuth();
const visible = computed(() => roleMayOpenAdminPath(ADMIN_ENTRY_PATH, {
    isAdmin: isAdmin.value,
    isStaff: isStaff.value
}));
const route = useRoute();
const router = useRouter();
const { workspaceRoute } = useWorkspaceContext();
const publicWorkspace = computed(() => publicWorkspaceFromRoute(route));
const administrationPath = computed(() =>
    publicAdministrationPath(publicWorkspace.value) ?? workspaceRoute(ADMIN_ENTRY_PATH).path
);

async function handleAdministrationClick() {
    await router.push(administrationPath.value);
}
</script>

<template>
  <UButton
    v-if="visible"
    type="button"
    :variant="route.path.includes('/admin') ? 'soft' : 'ghost'"
    color="neutral"
    icon="i-lucide-building-2"
    :ui="{ base: 'px-1.5 sm:px-2.5' }"
    :disabled="loading"
    :aria-label="t('nav.administration')"
    data-testid="app-header-administration"
    @click="handleAdministrationClick"
  >
    <span class="hidden lg:inline">{{ t('nav.administration') }}</span>
  </UButton>
</template>
