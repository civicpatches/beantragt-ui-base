import { onMounted, ref } from 'vue';
import { appBasePath } from '#shared/app-base-path';

export function useBundidAvailability() {
    const config = useRuntimeConfig();
    const enabled = config.public.ssoBundidEnabled;
    const available = ref<boolean | null>(enabled ? null : false);

    if (enabled) {
        onMounted(async () => {
            try {
                const result = await $fetch<{ available: boolean }>(appBasePath(config.app.baseURL, '/api/auth/sso-bundid-availability'), { retry: 0 });
                available.value = result.available === true;
            } catch {
                available.value = false;
            }
        });
    }

    return available;
}
