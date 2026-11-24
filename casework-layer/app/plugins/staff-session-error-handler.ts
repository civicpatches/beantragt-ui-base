import { installStaffSessionErrorHandler } from '~~/casework-layer/app/composables/api/useStaffSessionFetch';

export default defineNuxtPlugin(() => {
    if (useRuntimeConfig().public.uiMode === 'citizen') return;
    installStaffSessionErrorHandler();
});
