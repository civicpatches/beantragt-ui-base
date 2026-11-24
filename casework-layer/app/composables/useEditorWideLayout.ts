import { onScopeDispose, readonly, ref, type Ref } from 'vue';

/**
 * The one media query of the form editor (Tailwind `xl`, in rem like Tailwind itself): from
 * this width the field inspector has its fixed column at the right; below it the inspector
 * opens as a sheet (`USlideover`) under the editor's head.
 */
export const EDITOR_WIDE_QUERY = '(min-width: 80rem)';

/**
 * Tailwind `sm`: from this width row 2 of the head has room for the mode and the answer beside
 * "Rückgängig". Below it the answer is a toast and the mode is an entry of "Mehr".
 */
export const EDITOR_ROW_ROOM_QUERY = '(min-width: 40rem)';

/** Whether a media query matches; follows window resizes. Without matchMedia it is assumed. */
function useEditorMediaQuery(query: string): Readonly<Ref<boolean>> {
    const media = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query) : undefined;
    // Without matchMedia (server, tests without a viewport) the wider layout is assumed.
    const matches = ref(media ? media.matches : true);
    const update = (event: MediaQueryListEvent) => {
        matches.value = event.matches;
    };
    media?.addEventListener?.('change', update);
    onScopeDispose(() => media?.removeEventListener?.('change', update));
    return readonly(matches);
}

/** Whether the viewport is wide enough for the inspector column; follows window resizes. */
export function useEditorWideLayout(): Readonly<Ref<boolean>> {
    return useEditorMediaQuery(EDITOR_WIDE_QUERY);
}

/** Whether row 2 of the head has room for the mode and the answer beside "Rückgängig" (from `sm`). */
export function useEditorRowRoom(): Readonly<Ref<boolean>> {
    return useEditorMediaQuery(EDITOR_ROW_ROOM_QUERY);
}
