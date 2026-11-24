import { onBeforeUnmount, onMounted, type Ref } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate, type RouteLocationNormalized } from 'vue-router';

/**
 * Warn before discarding unsaved edits.
 *
 * Registers two guards keyed on a reactive dirty flag:
 *  - `onBeforeRouteLeave` / `onBeforeRouteUpdate`: in-app SPA navigation
 *    shows a localized confirm().
 *  - `beforeunload`: browser tab close, reload, or external navigation triggers
 *    the native "leave site?" prompt (message text is browser-controlled).
 *
 * The `beforeunload` listener is removed on unmount. Pass a `messageKey` so the
 * SPA confirm() prose stays localized per page; a getter picks the key at the
 * moment of leaving, for pages whose risk changes while they run. `allow`
 * lets a page pass moves that lose nothing, for example between its own
 * child routes. `routes: false` registers only the browser's question, for a
 * page that guards in-app navigation itself (the form editor saves first and
 * asks in its own dialog).
 */
export function useUnsavedChangesGuard(
    isDirty: Ref<boolean>,
    options: {
        messageKey?: string | (() => string)
        allow?: (to: RouteLocationNormalized, from: RouteLocationNormalized) => boolean
        routes?: boolean
    } = {}
) {
    const { t } = useI18n();
    const messageKey = (): string => {
        const key = typeof options.messageKey === 'function' ? options.messageKey() : options.messageKey;
        return key || 'admin.settings.unsavedChanges';
    };

    if (options.routes !== false) {
        onBeforeRouteLeave((to, from) => {
            if (!isDirty.value || options.allow?.(to, from)) return true;
            return window.confirm(t(messageKey()));
        });

        onBeforeRouteUpdate((to, from) => {
            if (!isDirty.value || options.allow?.(to, from)) return true;
            return window.confirm(t(messageKey()));
        });
    }

    function handleBeforeUnload(event: BeforeUnloadEvent) {
        if (!isDirty.value) return;
        event.preventDefault();
        // Legacy browsers require returnValue to be set; the string is ignored.
        event.returnValue = '';
    }

    onMounted(() => {
        window.addEventListener('beforeunload', handleBeforeUnload);
    });

    onBeforeUnmount(() => {
        window.removeEventListener('beforeunload', handleBeforeUnload);
    });
}
