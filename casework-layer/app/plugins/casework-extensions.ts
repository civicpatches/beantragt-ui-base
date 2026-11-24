import { registerCaseworkStaffExtensions } from '~~/casework-layer/app/utils/casework-extensions';

// The open case-work shell fills the staff registries before the first route middleware asks the path gate.
export default defineNuxtPlugin(() => {
    if (useRuntimeConfig().public.uiMode === 'citizen') return;
    registerCaseworkStaffExtensions();
});
