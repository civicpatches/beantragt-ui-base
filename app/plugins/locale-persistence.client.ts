import {
    normalizeSupportedLocale,
    readChosenLocale,
    resolveRouteLocale,
    shouldPersistLocaleOnPath,
    storeChosenLocale,
    type SupportedLocale
} from '~/utils/locale-routing';
import type { Ref } from 'vue';

type I18nRuntime = {
    locale?: Ref<string> | string
    setLocale?: (locale: SupportedLocale) => Promise<void> | void
};

/**
 * Language of the public pages.
 *
 * Every page shows the language its URL asks for (`?lang=`, or the language
 * of a legal page path such as `/privacy`), else the language the person
 * chose in a language switcher, else German. Only a switcher choice is
 * stored: opening one English page no longer turns every later page
 * English. The switchers (citizen header, maintenance page, staff
 * dashboard) change the i18n locale; the watcher at the end stores that.
 */
export default defineNuxtPlugin(() => {
    const i18n = useNuxtApp().$i18n as I18nRuntime;
    const route = useRoute();
    const router = useRouter();

    // The locale this plugin is applying from the route. Its change of the
    // i18n locale is no choice of the person and must not be stored.
    let routeAppliedLocale: string | null = null;

    function currentLocale(): string | null {
        if (typeof i18n.locale === 'string') return i18n.locale;
        return i18n.locale?.value ?? null;
    }

    function setRuntimeLocale(locale: SupportedLocale) {
        if (currentLocale() === locale) return;
        routeAppliedLocale = locale;
        if (typeof i18n.setLocale === 'function') {
            void i18n.setLocale(locale);
        } else if (i18n.locale && typeof i18n.locale !== 'string') {
            i18n.locale.value = locale;
        }
    }

    // Whether the app has applied a locale since it was loaded.
    let started = false;

    function reconcileRouteLocale() {
        const atStart = !started;
        started = true;
        if (!shouldPersistLocaleOnPath(route.path)) {
            // Admin and other non-persisted paths keep the in-memory locale,
            // but an explicit ?lang= override is still honored (applied only,
            // no storage write and no redirect) so admin views can be deep
            // linked or captured in a specific language.
            const routeLocale = normalizeSupportedLocale(route.query.lang);
            if (routeLocale) {
                setRuntimeLocale(routeLocale);
                return;
            }
            // The dashboard's switcher stores
            // the choice (the watcher below), but after a reload on an admin
            // path the in-memory locale is the default again and nothing read
            // the stored choice back: the editor was German, storage said "en".
            // When the app starts on such a path, the stored choice is applied
            // (no write, no redirect); later moves keep the in-memory locale.
            if (atStart) {
                const chosen = readChosenLocale();
                if (chosen) setRuntimeLocale(chosen);
            }
            return;
        }

        const decision = resolveRouteLocale({
            path: route.path,
            queryLang: route.query.lang,
            chosenLocale: readChosenLocale()
        });
        setRuntimeLocale(decision.locale);

        if (!decision.redirectPath) return;
        void router.replace({
            path: decision.redirectPath,
            query: route.query,
            hash: route.hash
        });
    }

    void router.isReady().then(reconcileRouteLocale);
    watch(() => route.fullPath, reconcileRouteLocale, { immediate: true });

    if (i18n.locale && typeof i18n.locale !== 'string') {
        watch(i18n.locale, (value) => {
            const appliedByRoute = value === routeAppliedLocale;
            routeAppliedLocale = null;
            if (appliedByRoute) return;
            const chosen = normalizeSupportedLocale(value);
            if (chosen) storeChosenLocale(chosen);
        });
    }
});
