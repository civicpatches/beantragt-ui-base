import type { FormSchema } from '~/types/form';
import { computed, shallowRef, watch } from 'vue';

export type CommitEditorText = (schema?: FormSchema, finishEditing?: boolean) => void;

/** Keep the native input intact through an autosave. Only blur or saving commits its text. */
export function useEditorTextDraft(
    read: () => string,
    write: (text: string, schema?: FormSchema) => string,
    queue: (commit: CommitEditorText) => void,
    maxLength?: number
) {
    const draft = shallowRef<string>();
    let stored = '';
    let dirty = false;

    function discard() {
        draft.value = undefined;
        dirty = false;
    }

    function commit(schema?: FormSchema, finishEditing = false) {
        if (draft.value !== undefined && dirty && read() === stored) {
            dirty = false;
            stored = write(draft.value, schema);
        }
        if (finishEditing) discard();
    }

    function finish() {
        commit(undefined, true);
    }

    const model = computed({
        get: () => draft.value ?? read(),
        set(text: string) {
            if (draft.value === undefined) stored = read();
            draft.value = text.slice(0, maxLength);
            dirty = true;
            queue(commit);
        }
    });

    // Prefer an external change (for example undo) over a draft based on the old value.
    watch(read, (value) => {
        if (draft.value !== undefined && value !== stored) discard();
    });
    return { model, commit, finish, discard };
}
