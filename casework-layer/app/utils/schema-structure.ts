import { fieldName } from './field-name';
import type { FormAddressGroup, FormField, FormPrecheckCriterion, FormSchema, FormSection } from '~/types/form';

/**
 * Pure structure operations of the form editor ( delete move).
 *
 * Every function returns a new schema and never mutates its input, so the
 * editor's single-slot undo can restore the snapshot it took before the
 * operation. Field ids never change: a moved field keeps its condition,
 * computed spec, attachment profile and every mapping that names its id.
 */

export type StructureTarget
    = | { kind: 'field', sectionId: string, fieldId: string }
      | { kind: 'section', sectionId: string }
      | { kind: 'addressGroup', sectionId: string, groupId: string };

export type SchemaReferenceKind = 'condition' | 'computed' | 'compareWith' | 'precheck' | 'addressGroup';

/**
 * Reference kinds Drupal refuses to save while they point to a missing field
 * (FormSchema::validateFormSchemaDefinitionDetails): computed args, address
 * group components, compareWith targets and approved precheck bindings. The
 * editor always cleans these up; only conditions are left to the author.
 */
export const REQUIRED_CLEANUP_REFERENCE_KINDS: ReadonlySet<SchemaReferenceKind> = new Set([
    'computed',
    'compareWith',
    'precheck',
    'addressGroup'
]);

export interface SchemaReference {
    kind: SchemaReferenceKind
    /** Field, precheck criterion or address group that holds the reference. */
    ownerId: string
    ownerLabel: string
    /** Field that is deleted and that the owner points to. */
    targetFieldId: string
    targetLabel: string
    /** Result value title or key, for compareWith. */
    detail?: string
    /** computed: the field loses every input and is no longer calculated. */
    stopsComputing?: boolean
}

export interface DeleteOptions {
    /** Remove conditions of other fields that depend on a deleted field. */
    removeConditions: boolean
}

export interface DeleteResult {
    schema: FormSchema
    applied: boolean
    removedFieldIds: string[]
    references: SchemaReference[]
}

export type MoveDirection = 'up' | 'down';

/**
 * Why a move did not happen:
 * - at_start / at_end: nothing above or below.
 * - address_group_component: a component of an address group must stay in
 *   its section (Drupal: "must reference a field in the same section").
 * - address_group_block: a component may change places only inside its
 *   group's block of fields, and no other field may enter that block; the
 *   address search stands before it. The whole group moves through the
 *   group actions.
 * - compare_target_repeatable: a number field an attachment check compares
 *   with cannot enter a repeatable section (Drupal rejects the draft).
 */
export type MoveBlockedReason = 'at_start' | 'at_end' | 'address_group_component' | 'address_group_block' | 'compare_target_repeatable';

export interface MoveResult {
    schema: FormSchema
    applied: boolean
    blockedReason?: MoveBlockedReason
    /** For address_group_block: the group whose block the move would split. */
    blockedGroupId?: string
}

export interface FieldDestination {
    sectionId: string
    /** Insert before this field; null appends at the end of the section. */
    beforeFieldId: string | null
}

export interface FieldPosition {
    sectionId: string
    sectionTitle: string
    sectionIndex: number
    sectionCount: number
    /** Zero-based index inside the section. */
    index: number
    count: number
}

export interface ConditionOrderHint {
    dependentId: string
    dependentLabel: string
    sourceId: string
    sourceLabel: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function allFields(schema: FormSchema): Array<{ section: FormSection, field: FormField }> {
    return schema.sections.flatMap(section => section.fields.map(field => ({ section, field })));
}

function fieldLabel(schema: FormSchema, fieldId: string, untitled?: string): string {
    const field = allFields(schema).find(item => item.field.id === fieldId)?.field;
    // A field that does not exist has only its key; one without a label gets the caller's name.
    return field ? fieldName(field, untitled) : fieldId;
}

export function addressGroupLabel(group: Pick<FormAddressGroup, 'id' | 'label'>): string {
    return group.label?.trim() || group.id;
}

/** Ids of the four component fields of an address group, in section order. */
export function addressGroupFieldIds(section: FormSection, group: FormAddressGroup): string[] {
    const ids = new Set(Object.values(group.fields));
    return section.fields.filter(field => ids.has(field.id)).map(field => field.id);
}

/** The address group a field belongs to, if any. */
export function findAddressGroupOfField(
    schema: FormSchema,
    fieldId: string
): { section: FormSection, group: FormAddressGroup } | null {
    for (const section of schema.sections) {
        const group = section.addressGroups?.find(candidate => Object.values(candidate.fields).includes(fieldId));
        if (group) return { section, group };
    }
    return null;
}

/** Field ids that disappear with the target. */
export function structureTargetFieldIds(schema: FormSchema, target: StructureTarget): string[] {
    const section = schema.sections.find(candidate => candidate.id === target.sectionId);
    if (!section) return [];

    switch (target.kind) {
        case 'field':
            return section.fields.some(field => field.id === target.fieldId) ? [target.fieldId] : [];
        case 'section':
            return section.fields.map(field => field.id);
        case 'addressGroup': {
            const group = section.addressGroups?.find(candidate => candidate.id === target.groupId);
            return group ? addressGroupFieldIds(section, group) : [];
        }
    }
}

/** Result value definitions of an attachment profile, in both stored formats. */
function resultDefinitions(resultSchema: unknown): Array<{ key: string, definition: Record<string, unknown> }> {
    if (!isRecord(resultSchema)) return [];
    const definitions: Array<{ key: string, definition: Record<string, unknown> }> = [];
    if (isRecord(resultSchema.properties)) {
        for (const [key, definition] of Object.entries(resultSchema.properties)) {
            if (isRecord(definition)) definitions.push({ key, definition });
        }
    }
    if (Array.isArray(resultSchema.fields)) {
        for (const definition of resultSchema.fields) {
            if (!isRecord(definition)) continue;
            const key = [definition.key, definition.id, definition.name]
                .find((value): value is string => typeof value === 'string' && value !== '');
            if (key) definitions.push({ key, definition });
        }
    }
    return definitions;
}

/** Ids of the fields some attachment check compares a value with. */
export function compareTargetFieldIds(schema: FormSchema): Set<string> {
    const ids = new Set<string>();
    for (const { field } of allFields(schema)) {
        for (const { definition } of resultDefinitions(field.analysis?.resultSchema)) {
            if (typeof definition.compareWith === 'string' && definition.compareWith !== '') {
                ids.add(definition.compareWith);
            }
        }
    }
    return ids;
}

function precheckLabel(criterion: FormPrecheckCriterion, locale: string): string {
    const label = locale === 'en'
        ? criterion.label.en || criterion.label.de
        : criterion.label.de || criterion.label.en;
    return label || criterion.factKey || criterion.id;
}

/**
 * Everything inside the schema that points to a field the target removes.
 * References held by fields that are removed as well are not listed.
 * Integration mappings and document template placeholders live in Drupal
 * and are not part of the schema, so they are not covered here.
 */
/** `untitled`: the name of a field without a label; without it the key, as before. */
export function findSchemaReferences(schema: FormSchema, target: StructureTarget, locale = 'de', untitled?: string): SchemaReference[] {
    const removed = new Set(structureTargetFieldIds(schema, target));
    if (removed.size === 0) return [];

    const references: SchemaReference[] = [];

    for (const { field } of allFields(schema)) {
        if (removed.has(field.id)) continue;

        const conditionSource = field.conditionalOn?.fieldId;
        if (conditionSource && removed.has(conditionSource)) {
            references.push({
                kind: 'condition',
                ownerId: field.id,
                ownerLabel: fieldName(field, untitled),
                targetFieldId: conditionSource,
                targetLabel: fieldLabel(schema, conditionSource, untitled)
            });
        }

        const args = field.computed?.args ?? [];
        const stopsComputing = args.length > 0 && args.every(arg => removed.has(arg));
        for (const arg of args) {
            if (!removed.has(arg)) continue;
            references.push({
                kind: 'computed',
                ownerId: field.id,
                ownerLabel: fieldName(field, untitled),
                targetFieldId: arg,
                targetLabel: fieldLabel(schema, arg, untitled),
                ...(stopsComputing ? { stopsComputing: true } : {})
            });
        }

        for (const { key, definition } of resultDefinitions(field.analysis?.resultSchema)) {
            const compareWith = definition.compareWith;
            if (typeof compareWith !== 'string' || !removed.has(compareWith)) continue;
            references.push({
                kind: 'compareWith',
                ownerId: field.id,
                ownerLabel: fieldName(field, untitled),
                targetFieldId: compareWith,
                targetLabel: fieldLabel(schema, compareWith, untitled),
                detail: typeof definition.title === 'string' && definition.title.trim() ? definition.title.trim() : key
            });
        }
    }

    for (const criterion of schema.precheckSchema?.criteria ?? []) {
        if (!criterion.fieldId || !removed.has(criterion.fieldId)) continue;
        references.push({
            kind: 'precheck',
            ownerId: criterion.id,
            ownerLabel: precheckLabel(criterion, locale),
            targetFieldId: criterion.fieldId,
            targetLabel: fieldLabel(schema, criterion.fieldId, untitled)
        });
    }

    // Deleting one component dissolves its address group. A deleted group or
    // section takes its own groups with it, so those are not references.
    if (target.kind === 'field') {
        const membership = findAddressGroupOfField(schema, target.fieldId);
        if (membership) {
            references.push({
                kind: 'addressGroup',
                ownerId: membership.group.id,
                ownerLabel: addressGroupLabel(membership.group),
                targetFieldId: target.fieldId,
                targetLabel: fieldLabel(schema, target.fieldId, untitled)
            });
        }
    }

    return references;
}

/** Result schema without compareWith entries that point to a removed field. */
export function stripCompareWith(resultSchema: Record<string, unknown>, removed: ReadonlySet<string>): Record<string, unknown> {
    let changed = false;
    const next: Record<string, unknown> = { ...resultSchema };

    if (isRecord(resultSchema.properties)) {
        const properties: Record<string, unknown> = {};
        for (const [key, definition] of Object.entries(resultSchema.properties)) {
            if (isRecord(definition) && typeof definition.compareWith === 'string' && removed.has(definition.compareWith)) {
                const { compareWith: _compareWith, ...rest } = definition;
                properties[key] = rest;
                changed = true;
            } else {
                properties[key] = definition;
            }
        }
        next.properties = properties;
    }

    if (Array.isArray(resultSchema.fields)) {
        next.fields = resultSchema.fields.map((definition) => {
            if (isRecord(definition) && typeof definition.compareWith === 'string' && removed.has(definition.compareWith)) {
                const { compareWith: _compareWith, ...rest } = definition;
                changed = true;
                return rest;
            }
            return definition;
        });
    }

    return changed ? next : resultSchema;
}

function cleanField(field: FormField, removed: ReadonlySet<string>, options: DeleteOptions): FormField {
    let next = field;

    if (field.computed?.args.some(arg => removed.has(arg))) {
        const args = field.computed.args.filter(arg => !removed.has(arg));
        if (args.length > 0) {
            next = { ...next, computed: { ...field.computed, args } };
        } else {
            // Without any input the calculation cannot run: the field stops
            // being calculated instead of being saved as a broken spec.
            const { computed: _computed, ...rest } = next;
            next = rest;
        }
    }

    if (options.removeConditions && field.conditionalOn && removed.has(field.conditionalOn.fieldId)) {
        const { conditionalOn: _conditionalOn, ...rest } = next;
        next = rest;
    }

    const resultSchema = field.analysis?.resultSchema;
    if (field.analysis && isRecord(resultSchema)) {
        const stripped = stripCompareWith(resultSchema, removed);
        if (stripped !== resultSchema) {
            next = { ...next, analysis: { ...field.analysis, resultSchema: stripped } };
        }
    }

    return next;
}

function withAddressGroups(section: FormSection, groups: FormAddressGroup[] | undefined): FormSection {
    if (groups && groups.length > 0) return { ...section, addressGroups: groups };
    const { addressGroups: _addressGroups, ...rest } = section;
    return rest;
}

/**
 * Deletes a field, an address group with its four fields, or a section with
 * all its fields. References Drupal would reject are always cleaned up:
 * computed args lose the deleted ids (a field left without any input is no
 * longer calculated), an address group that loses a
 * component is dissolved (its other fields stay), compareWith entries are
 * removed, and a precheck criterion bound to a deleted field is unbound and
 * returns to "suggested" for a new review, as the precheck editor does.
 * Conditions of other fields are removed only when asked; otherwise the
 * author can point them to another field.
 */
export function deleteSchemaElement(schema: FormSchema, target: StructureTarget, options: DeleteOptions): DeleteResult {
    const removedFieldIds = structureTargetFieldIds(schema, target);
    const sectionExists = schema.sections.some(section => section.id === target.sectionId);
    const groupExists = target.kind !== 'addressGroup' || schema.sections
        .find(section => section.id === target.sectionId)
        ?.addressGroups?.some(group => group.id === target.groupId) === true;
    if (!sectionExists || !groupExists || (target.kind === 'field' && removedFieldIds.length === 0)) {
        return { schema, applied: false, removedFieldIds: [], references: [] };
    }

    const references = findSchemaReferences(schema, target);
    const removed = new Set(removedFieldIds);

    const sections = schema.sections
        .filter(section => !(target.kind === 'section' && section.id === target.sectionId))
        .map((section) => {
            const fields = section.fields
                .filter(field => !removed.has(field.id))
                .map(field => cleanField(field, removed, options));
            const groups = section.addressGroups?.filter(group =>
                !(target.kind === 'addressGroup' && section.id === target.sectionId && group.id === target.groupId)
                && !Object.values(group.fields).some(fieldId => removed.has(fieldId))
            );
            const groupsChanged = (groups?.length ?? 0) !== (section.addressGroups?.length ?? 0);
            const next: FormSection = { ...section, fields };
            return groupsChanged ? withAddressGroups(next, groups) : next;
        });

    let precheckSchema = schema.precheckSchema;
    if (precheckSchema?.criteria.some(criterion => criterion.fieldId && removed.has(criterion.fieldId))) {
        precheckSchema = {
            ...precheckSchema,
            criteria: precheckSchema.criteria.map((criterion) => {
                if (!criterion.fieldId || !removed.has(criterion.fieldId)) return criterion;
                const { fieldId: _fieldId, privacy: _privacy, ...unbound } = criterion;
                return {
                    ...unbound,
                    reviewStatus: criterion.reviewStatus === 'approved' ? 'suggested' : criterion.reviewStatus
                };
            })
        };
    }

    return {
        schema: {
            ...schema,
            sections,
            ...(precheckSchema ? { precheckSchema } : {})
        },
        applied: true,
        removedFieldIds,
        references
    };
}

function sameOrder(left: string[], right: string[]): boolean {
    return left.length === right.length && left.every((id, index) => id === right[index]);
}

function schemaFieldOrder(schema: FormSchema): string[] {
    return schema.sections.flatMap(section => [`#${section.id}`, ...section.fields.map(field => field.id)]);
}

/**
 * Moves a block of fields (one field or the components of an address group)
 * from its section to a position in a target section. `insertIndex` counts in
 * the target section's field list without the moved fields.
 */
function placeFieldBlock(
    schema: FormSchema,
    sourceSectionId: string,
    blockIds: string[],
    targetSectionId: string,
    insertIndex: number,
    groupId?: string
): FormSchema {
    const block = new Set(blockIds);
    const source = schema.sections.find(section => section.id === sourceSectionId);
    if (!source) return schema;
    const blockFields = source.fields.filter(field => block.has(field.id));
    const group = groupId ? source.addressGroups?.find(candidate => candidate.id === groupId) : undefined;
    const movesGroup = Boolean(group) && sourceSectionId !== targetSectionId;

    return {
        ...schema,
        sections: schema.sections.map((section) => {
            const isSource = section.id === sourceSectionId;
            const isTarget = section.id === targetSectionId;
            if (!isSource && !isTarget) return section;

            let fields = isSource ? section.fields.filter(field => !block.has(field.id)) : section.fields;
            if (isTarget) {
                const index = Math.max(0, Math.min(insertIndex, fields.length));
                fields = [...fields.slice(0, index), ...blockFields, ...fields.slice(index)];
            }

            let next: FormSection = { ...section, fields };
            if (movesGroup && group) {
                if (isSource) {
                    next = withAddressGroups(next, section.addressGroups?.filter(candidate => candidate.id !== group.id));
                } else {
                    next = withAddressGroups(next, [...(section.addressGroups ?? []), group]);
                }
            }
            return next;
        })
    };
}

function crossingBlockedReason(
    schema: FormSchema,
    blockIds: string[],
    sourceSection: FormSection,
    targetSection: FormSection,
    isAddressGroupMove: boolean
): MoveBlockedReason | undefined {
    if (sourceSection.id === targetSection.id) return undefined;
    if (!isAddressGroupMove && blockIds.some(fieldId => findAddressGroupOfField(schema, fieldId))) {
        return 'address_group_component';
    }
    if (targetSection.repeatable === true && !sourceSection.repeatable) {
        const compareTargets = compareTargetFieldIds(schema);
        if (blockIds.some(fieldId => compareTargets.has(fieldId))) return 'compare_target_repeatable';
    }
    return undefined;
}

/** Rows from the first to the last component of a group in a section. */
function addressGroupSpan(section: FormSection | undefined, group: FormAddressGroup): number {
    if (!section) return 0;
    const ids = new Set(Object.values(group.fields));
    const indexes = section.fields.flatMap((field, index) => ids.has(field.id) ? [index] : []);
    const first = indexes[0];
    const last = indexes.at(-1);
    return first === undefined || last === undefined ? 0 : last - first + 1;
}

/**
 * The address group whose block a move splits, if any: the rows from a
 * group's first to its last component grew, in the source or the target
 * section. That covers a component leaving its block and any other field,
 * or a whole other group, entering one. Comparing the span instead of
 * demanding a contiguous block keeps an older, already scattered group
 * movable inside its own rows. A moved group carries its own block and is
 * skipped; the other groups of both sections are still checked.
 */
function splitAddressGroup(
    schema: FormSchema,
    next: FormSchema,
    sectionIds: string[],
    groupId?: string
): FormAddressGroup | undefined {
    for (const sectionId of new Set(sectionIds)) {
        const before = schema.sections.find(section => section.id === sectionId);
        const after = next.sections.find(section => section.id === sectionId);
        const split = before?.addressGroups
            ?.filter(group => group.id !== groupId)
            .find(group => addressGroupSpan(after, group) > addressGroupSpan(before, group));
        if (split) return split;
    }
    return undefined;
}

function blockedBySplit(schema: FormSchema, group: FormAddressGroup): MoveResult {
    return { schema, applied: false, blockedReason: 'address_group_block', blockedGroupId: group.id };
}

function finishMove(schema: FormSchema, next: FormSchema): MoveResult {
    return sameOrder(schemaFieldOrder(schema), schemaFieldOrder(next))
        ? { schema, applied: false }
        : { schema: next, applied: true };
}

function moveBlockTo(
    schema: FormSchema,
    sourceSection: FormSection,
    blockIds: string[],
    destination: FieldDestination,
    groupId?: string
): MoveResult {
    const targetSection = schema.sections.find(section => section.id === destination.sectionId);
    if (!targetSection || blockIds.length === 0) return { schema, applied: false };
    if (destination.beforeFieldId && blockIds.includes(destination.beforeFieldId)) return { schema, applied: false };

    const blockedReason = crossingBlockedReason(schema, blockIds, sourceSection, targetSection, Boolean(groupId));
    if (blockedReason) return { schema, applied: false, blockedReason };

    const reduced = targetSection.fields.filter(field => !blockIds.includes(field.id));
    const beforeIndex = destination.beforeFieldId
        ? reduced.findIndex(field => field.id === destination.beforeFieldId)
        : -1;
    const insertIndex = beforeIndex === -1 ? reduced.length : beforeIndex;

    const next = placeFieldBlock(schema, sourceSection.id, blockIds, targetSection.id, insertIndex, groupId);
    const split = splitAddressGroup(schema, next, [sourceSection.id, targetSection.id], groupId);
    if (split) return blockedBySplit(schema, split);
    return finishMove(schema, next);
}

/**
 * One step up or down for a block of fields. Inside a section the block
 * swaps with its neighbour; at the edge of a section it continues at the end
 * of the previous or the start of the next section.
 */
function moveBlockByStep(
    schema: FormSchema,
    sourceSection: FormSection,
    blockIds: string[],
    direction: MoveDirection,
    groupId?: string
): MoveResult {
    const sectionIndex = schema.sections.findIndex(section => section.id === sourceSection.id);
    const block = new Set(blockIds);
    const reduced = sourceSection.fields.filter(field => !block.has(field.id));
    const firstBlockIndex = sourceSection.fields.findIndex(field => block.has(field.id));
    if (sectionIndex === -1 || firstBlockIndex === -1) return { schema, applied: false };
    // Position of the block among the other fields of its section.
    const anchor = sourceSection.fields.slice(0, firstBlockIndex).filter(field => !block.has(field.id)).length;

    let targetSection: FormSection | undefined;
    let insertIndex: number;
    if (direction === 'up') {
        if (anchor > 0) {
            targetSection = sourceSection;
            insertIndex = anchor - 1;
        } else {
            targetSection = schema.sections[sectionIndex - 1];
            insertIndex = targetSection?.fields.length ?? 0;
        }
    } else if (anchor < reduced.length) {
        targetSection = sourceSection;
        insertIndex = anchor + 1;
    } else {
        targetSection = schema.sections[sectionIndex + 1];
        insertIndex = 0;
    }

    if (!targetSection) {
        return { schema, applied: false, blockedReason: direction === 'up' ? 'at_start' : 'at_end' };
    }

    const blockedReason = crossingBlockedReason(schema, blockIds, sourceSection, targetSection, Boolean(groupId));
    if (blockedReason) return { schema, applied: false, blockedReason };

    const next = placeFieldBlock(schema, sourceSection.id, blockIds, targetSection.id, insertIndex, groupId);
    const split = splitAddressGroup(schema, next, [sourceSection.id, targetSection.id], groupId);
    if (split) return blockedBySplit(schema, split);
    return finishMove(schema, next);
}

function findFieldSection(schema: FormSchema, fieldId: string): FormSection | undefined {
    return schema.sections.find(section => section.fields.some(field => field.id === fieldId));
}

/** Moves one field before another field or to the end of a section. */
export function moveField(schema: FormSchema, fieldId: string, destination: FieldDestination): MoveResult {
    const sourceSection = findFieldSection(schema, fieldId);
    if (!sourceSection) return { schema, applied: false };
    return moveBlockTo(schema, sourceSection, [fieldId], destination);
}

export function moveFieldByStep(schema: FormSchema, fieldId: string, direction: MoveDirection): MoveResult {
    const sourceSection = findFieldSection(schema, fieldId);
    if (!sourceSection) return { schema, applied: false };
    return moveBlockByStep(schema, sourceSection, [fieldId], direction);
}

/** Moves a field to the end of another section. */
export function moveFieldToSection(schema: FormSchema, fieldId: string, sectionId: string): MoveResult {
    return moveField(schema, fieldId, { sectionId, beforeFieldId: null });
}

function findGroup(schema: FormSchema, sectionId: string, groupId: string): { section: FormSection, group: FormAddressGroup } | null {
    const section = schema.sections.find(candidate => candidate.id === sectionId);
    const group = section?.addressGroups?.find(candidate => candidate.id === groupId);
    return section && group ? { section, group } : null;
}

/** Moves an address group with its four fields as one block. */
export function moveAddressGroup(schema: FormSchema, sectionId: string, groupId: string, destination: FieldDestination): MoveResult {
    const found = findGroup(schema, sectionId, groupId);
    if (!found) return { schema, applied: false };
    return moveBlockTo(schema, found.section, addressGroupFieldIds(found.section, found.group), destination, groupId);
}

export function moveAddressGroupByStep(schema: FormSchema, sectionId: string, groupId: string, direction: MoveDirection): MoveResult {
    const found = findGroup(schema, sectionId, groupId);
    if (!found) return { schema, applied: false };
    return moveBlockByStep(schema, found.section, addressGroupFieldIds(found.section, found.group), direction, groupId);
}

export function moveAddressGroupToSection(schema: FormSchema, sectionId: string, groupId: string, targetSectionId: string): MoveResult {
    return moveAddressGroup(schema, sectionId, groupId, { sectionId: targetSectionId, beforeFieldId: null });
}

/**
 * Moves a whole section, a repeatable one included, before another section
 * or to the end. Its fields travel with it.
 */
export function moveSection(schema: FormSchema, sectionId: string, beforeSectionId: string | null): MoveResult {
    const section = schema.sections.find(candidate => candidate.id === sectionId);
    if (!section || beforeSectionId === sectionId) return { schema, applied: false };
    const reduced = schema.sections.filter(candidate => candidate.id !== sectionId);
    const beforeIndex = beforeSectionId ? reduced.findIndex(candidate => candidate.id === beforeSectionId) : -1;
    const index = beforeIndex === -1 ? reduced.length : beforeIndex;
    const sections = [...reduced.slice(0, index), section, ...reduced.slice(index)];
    // Compared by section order, not field order, so an empty section (the editor supports
    // them) moves too, and so does a section moved past an empty one.
    const unchanged = sections.every((candidate, position) => candidate.id === schema.sections[position]?.id);
    return unchanged ? { schema, applied: false } : { schema: { ...schema, sections }, applied: true };
}

export function moveSectionByStep(schema: FormSchema, sectionId: string, direction: MoveDirection): MoveResult {
    const index = schema.sections.findIndex(section => section.id === sectionId);
    if (index === -1) return { schema, applied: false };
    if (direction === 'up' && index === 0) return { schema, applied: false, blockedReason: 'at_start' };
    if (direction === 'down' && index === schema.sections.length - 1) return { schema, applied: false, blockedReason: 'at_end' };

    const sections = [...schema.sections];
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    [sections[index], sections[swapIndex]] = [sections[swapIndex]!, sections[index]!];
    return { schema: { ...schema, sections }, applied: true };
}

export function fieldPosition(schema: FormSchema, fieldId: string): FieldPosition | null {
    for (const [sectionIndex, section] of schema.sections.entries()) {
        const index = section.fields.findIndex(field => field.id === fieldId);
        if (index === -1) continue;
        return {
            sectionId: section.id,
            sectionTitle: section.title,
            sectionIndex,
            sectionCount: schema.sections.length,
            index,
            count: section.fields.length
        };
    }
    return null;
}

/** Whether a field can still move one step in that direction. */
export function canMoveFieldByStep(schema: FormSchema, fieldId: string, direction: MoveDirection): boolean {
    const result = moveFieldByStep(schema, fieldId, direction);
    return result.applied;
}

/**
 * Conditions that read oddly after a move: a field stands before the
 * field its visibility depends on. The form still works; the order only
 * reads backwards for citizens. Only pairs that were in order before and
 * involve one of the moved fields are reported.
 */
export function conditionOrderHints(before: FormSchema, after: FormSchema, movedFieldIds: Iterable<string>, untitled?: string): ConditionOrderHint[] {
    const moved = new Set(movedFieldIds);
    const orderOf = (schema: FormSchema) => new Map(allFields(schema).map(({ field }, index) => [field.id, index]));
    const beforeOrder = orderOf(before);
    const afterOrder = orderOf(after);
    const hints: ConditionOrderHint[] = [];

    for (const { field } of allFields(after)) {
        const sourceId = field.conditionalOn?.fieldId;
        if (!sourceId || !afterOrder.has(sourceId)) continue;
        if (!moved.has(field.id) && !moved.has(sourceId)) continue;

        const inverted = (afterOrder.get(field.id) ?? 0) < (afterOrder.get(sourceId) ?? 0);
        const wasInverted = beforeOrder.has(field.id) && beforeOrder.has(sourceId)
          && (beforeOrder.get(field.id) ?? 0) < (beforeOrder.get(sourceId) ?? 0);
        if (!inverted || wasInverted) continue;

        hints.push({
            dependentId: field.id,
            dependentLabel: fieldName(field, untitled),
            sourceId,
            sourceLabel: fieldLabel(after, sourceId, untitled)
        });
    }

    return hints;
}

/**
 * True when one of the moved fields sits on the other side of a
 * repeatable section boundary. Its document template placeholder changes
 * (inside a loop or not), which the editor cannot check.
 */
export function crossedRepeatableBoundary(before: FormSchema, after: FormSchema, movedFieldIds: Iterable<string>): boolean {
    const repeatableOf = (schema: FormSchema) => new Map(allFields(schema).map(({ section, field }) => [field.id, section.repeatable === true]));
    const beforeMap = repeatableOf(before);
    const afterMap = repeatableOf(after);
    for (const fieldId of movedFieldIds) {
        if (beforeMap.has(fieldId) && afterMap.has(fieldId) && beforeMap.get(fieldId) !== afterMap.get(fieldId)) return true;
    }
    return false;
}
