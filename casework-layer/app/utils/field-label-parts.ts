/**
 * Splits a field label into the field's own short name and the context before it.
 *
 * Imported catalogue forms write a field's label as a path: groups joined by " / ",
 * with the field's name last, sometimes "Gruppe: Name" at the end. Lists that show many
 * fields at once (the editor's warning strip) show the short name first and the context
 * as one muted line, so rows that share a long common prefix stay distinguishable.
 *
 * Generic on purpose: only the label's structure decides, never a form or field name.
 */
export interface FieldLabelParts {
    /** The field's own name: the last " / " segment, or else the part after the last ": ". */
    name: string
    /** Everything before the name, without the separator; empty when the label is flat. */
    context: string
}

const PATH_SEPARATOR = ' / ';
const NAME_SEPARATOR = ': ';

export function splitFieldLabel(label: string): FieldLabelParts {
    const text = label.trim();
    const pathIndex = text.lastIndexOf(PATH_SEPARATOR);
    if (pathIndex > 0 && pathIndex + PATH_SEPARATOR.length < text.length) {
        return {
            name: text.slice(pathIndex + PATH_SEPARATOR.length).trim(),
            context: text.slice(0, pathIndex).trim()
        };
    }
    const nameIndex = text.lastIndexOf(NAME_SEPARATOR);
    if (nameIndex > 0 && nameIndex + NAME_SEPARATOR.length < text.length) {
        return {
            name: text.slice(nameIndex + NAME_SEPARATOR.length).trim(),
            context: text.slice(0, nameIndex).trim()
        };
    }
    return { name: text, context: '' };
}

/**
 * What tells a field apart from others with the same short name
 * ("Postfach" twice). The nearest part of its own label path that no twin shares at the same
 * depth from the name; else the title of its section when the twins stand elsewhere; '' when
 * there is no twin or nothing tells them apart.
 */
export function twinDistinction(
    field: { id: string, label: string },
    sectionTitle: string,
    others: Array<{ id: string, label: string, sectionTitle: string }>
): string {
    const own = splitFieldLabel(field.label);
    const key = (name: string) => name.trim().toLocaleLowerCase();
    const twins = others.filter(other => other.id !== field.id && key(splitFieldLabel(other.label).name) === key(own.name));
    if (twins.length === 0) return '';
    const path = (context: string) => (context ? context.split(PATH_SEPARATOR).map(part => part.trim()) : []);
    const ownPath = path(own.context);
    const twinPaths = twins.map(twin => path(splitFieldLabel(twin.label).context));
    for (let depth = 1; depth <= ownPath.length; depth++) {
        const part = ownPath[ownPath.length - depth]!;
        if (twinPaths.every(twinPath => twinPath[twinPath.length - depth] !== part)) return part;
    }
    return twins.every(twin => twin.sectionTitle !== sectionTitle) ? sectionTitle : '';
}
