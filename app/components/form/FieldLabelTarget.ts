import { defineComponent } from 'vue';
import { useFormField } from '@nuxt/ui/composables/useFormField';

/**
 * Points the label of the surrounding `UFormField` at a native control.
 *
 * A Nuxt UI control inside a `UFormField` hands its id to the field (`useFormField`), and the field's
 * `<label for>` follows it. A native `<input>` does not, so the label pointed at the field's own id,
 * which no control carried. This renders nothing; it only hands the field the native control's id.
 * It must stand in the field's own slot, not inside another `UFormField` (that one would get the id).
 *
 * Without `id` the field has no control to point at (a file field where no input is rendered: the editor,
 * a read-only view): the label loses its `for` (`useFormField(…, { bind: false })`) instead of naming an
 * id no element carries.
 */
export default defineComponent({
    name: 'FormFieldLabelTarget',
    props: {
        /** The native control's id; none when no control is rendered. */
        id: { type: String, default: undefined }
    },
    setup(props) {
        useFormField(props, props.id ? undefined : { bind: false });
        return () => null;
    }
});
