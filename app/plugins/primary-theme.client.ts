import { publicWorkspaceFromRoute } from '~/utils/public-form-path';

export default defineNuxtPlugin({
    name: 'beantragt-primary-theme',
    enforce: 'post',
    setup() {
        const route = useRoute();
        const error = useError();
        // The error page resolves its own frame, including unknown paths below a known jurisdiction.
        usePublicPrimaryTheme(computed(() => error.value ? null : publicWorkspaceFromRoute(route).jurisdictionSlug));
    }
});
