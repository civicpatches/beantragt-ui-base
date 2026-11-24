<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui';
import { onBeforeUnmount, onMounted } from 'vue';
import type { FormSchema } from '~/types/form';
import type { MoveDirection, MoveResult } from '../../../utils/schema-structure';
import {
    addressGroupLabel,
    compareTargetFieldIds,
    fieldPosition,
    findAddressGroupOfField,
    moveAddressGroupByStep,
    moveFieldByStep
} from '../../../utils/schema-structure';
import { useEditorRowRoom } from '../../../composables/useEditorWideLayout';
import { decideBarForms, MENU_SHORT_WIDTH, rememberDeleteText, rememberedDeleteText, SECTION_BIN_CLEARANCE } from '../../../utils/field-bar-room';
import { VIEWPORT_BOUND_CONTENT } from '../../../utils/viewport-bound-content';

/**
 * The actions of the selected field, at the field. Always the
 * same controls in the same order: the drag handle (only at the field), "früher", "später",
 * "Feld darunter einfügen", the section control, the keyboard help, "Feld löschen" (three
 * groups set apart by spacing). Where a step cannot be taken, "früher" or "später" stays in place, says
 * why and does nothing; the section control:
 * - one other section: a button that names it ("Nach „Nachweise“"), one click, at its natural width
 *   (the name in full while the bar fits its card; its text changes after the move);
 * - several: a menu "In Abschnitt verschieben"; a field of an address group: the menu "Adressgruppe";
 * - none: the same button, disabled.
 *
 * `placement="field"`: above the field's upper edge, in the gap between two fields, so it covers
 * nothing of the field (at the right from 1280 px, at the left below, where the inspector's
 * sheet lies over the right part). `placement="sheet"`: in the head of the inspector's sheet
 * below 1280 px, where the bar at the field is under the sheet.
 *
 * Position and section are said to screen readers through the bar's description; the editor
 * announces moves itself. The editor applies every action, saves and announces it.
 */
const props = withDefaults(defineProps<{
    schema: FormSchema
    sectionId: string
    fieldId: string
    disabled?: boolean
    /** Drag attributes for the field from the renderer (`fieldDragHandle`). */
    dragHandle?: Record<string, unknown>
    placement?: 'field' | 'sheet'
}>(), {
    disabled: false,
    dragHandle: () => ({}),
    placement: 'field'
});

const emit = defineEmits<{
    'move-step': [direction: MoveDirection]
    'move-to-section': [sectionId: string]
    'insert-below': []
    'delete': []
    'group-move-step': [direction: MoveDirection]
    'group-move-to-section': [sectionId: string]
    'group-delete': []
}>();

const { t } = useI18n();
const root = ref<HTMLElement | null>(null);

const field = computed(() => props.schema.sections
    .find(section => section.id === props.sectionId)
    ?.fields.find(candidate => candidate.id === props.fieldId) ?? null);
/*
 * With an emptied label the bar's buttons were named after the field's
 * key ("Feld löschen: „city“"), a word the person never gave, while the card and the inspector's title say
 * "Feld ohne Beschriftung". The bar uses the same words.
 */
const fieldLabel = computed(() => field.value?.label?.trim() || t('admin.fieldInspector.untitledField'));
const position = computed(() => fieldPosition(props.schema, props.fieldId));
const membership = computed(() => findAddressGroupOfField(props.schema, props.fieldId));

const earlierMove = computed(() => moveFieldByStep(props.schema, props.fieldId, 'up'));
const laterMove = computed(() => moveFieldByStep(props.schema, props.fieldId, 'down'));
const canMoveEarlier = computed(() => earlierMove.value.applied);
const canMoveLater = computed(() => laterMove.value.applied);

/*
 * "früher" was disabled at position 14, because an address group
 * stands before the field, without a word, and the focus jumped to "später". A step that cannot
 * be taken says why (the same sentence the keyboard says), in its tooltip and as the button's
 * description; the button stays focusable (`aria-disabled`, styled by the theme) and does nothing.
 */
function blockedText(result: MoveResult): string {
    const label = fieldLabel.value;
    switch (result.blockedReason) {
        case 'at_start': return t('admin.forms.structure.announceAtStart', { label });
        case 'at_end': return t('admin.forms.structure.announceAtEnd', { label });
        case 'address_group_component':
            return t('admin.forms.structure.blockedAddressGroup', { label, group: membership.value ? addressGroupLabel(membership.value.group) : '' });
        case 'address_group_block': {
            if (membership.value && (!result.blockedGroupId || membership.value.group.id === result.blockedGroupId)) {
                return t('admin.forms.structure.blockedAddressGroupBlock', { label, group: addressGroupLabel(membership.value.group) });
            }
            const group = props.schema.sections.flatMap(section => section.addressGroups ?? []).find(candidate => candidate.id === result.blockedGroupId);
            return t('admin.forms.structure.blockedIntoAddressGroupBlock', { label, group: group ? addressGroupLabel(group) : '' });
        }
        case 'compare_target_repeatable': return t('admin.forms.structure.blockedCompareTarget', { label });
        default: return '';
    }
}
const earlierReason = computed(() => canMoveEarlier.value ? '' : blockedText(earlierMove.value));
const laterReason = computed(() => canMoveLater.value ? '' : blockedText(laterMove.value));

/*
 * "später" on the last field of a section ("Position 44 von 44") was
 * free and said only "Später": it moves the field to the start of the next section (and "früher" on a
 * section's first field to the end of the one before). Where a step leaves the section, its tooltip and
 * name say where it goes. The keys stay Alt+↑ and Alt+↓.
 */
function crossedSection(result: MoveResult): string {
    if (!result.applied) return '';
    const after = fieldPosition(result.schema, props.fieldId);
    if (!after || after.sectionId === props.sectionId) return '';
    return after.sectionTitle || after.sectionId;
}
const earlierSection = computed(() => crossedSection(earlierMove.value));
const laterSection = computed(() => crossedSection(laterMove.value));
const earlierText = computed(() => earlierSection.value ? t('admin.forms.fieldBar.earlierToSection', { section: earlierSection.value }) : t('admin.forms.fieldBar.earlier'));
const laterText = computed(() => laterSection.value ? t('admin.forms.fieldBar.laterToSection', { section: laterSection.value }) : t('admin.forms.fieldBar.later'));
const earlierName = computed(() => earlierSection.value
    ? t('admin.forms.fieldBar.earlierToSectionNamed', { label: fieldLabel.value, section: earlierSection.value })
    : t('admin.forms.fieldBar.earlierNamed', { label: fieldLabel.value }));
const laterName = computed(() => laterSection.value
    ? t('admin.forms.fieldBar.laterToSectionNamed', { label: fieldLabel.value, section: laterSection.value })
    : t('admin.forms.fieldBar.laterNamed', { label: fieldLabel.value }));

const descriptionId = computed(() => `field-action-bar-position-${props.placement}`);

/*
 * At 390 px the bar was 362 px wide from x 32, its bin cut by 4 px at
 * the screen's edge. Below sm the section control is its icon (the label stays for screen readers,
 * the tooltip and the button's name keep the full text) and the grip, which only a mouse can use,
 * is not shown: about 200 px. From sm both are as before (the icon is hidden there).
 */
const SECTION_CONTROL_UI = { label: 'max-sm:sr-only', leadingIcon: 'sm:hidden' };
/*
 * In the inspector's sheet (below 1280 px, 416 px inside at
 * 1100) the section control is ALWAYS its icon, with the text in its tooltip and its name; with text at
 * both the section control and "Feld löschen" the head is too narrow.
 */
/*
 * In the sheet the section control has NO label (its name and tooltip carry the text):
 * a label hidden with `sr-only` keeps the framework's text padding (px-2.5), a button without one is
 * square (p-1.5, 32 px). That and gap-x-2 below 640 px keep the sheet's bar in one row down to 320 px.
 */
/*
 * At the field from 640 px the section control shows its text, also at 1280 px, where the review
 * computed the bar at about 538 of 552 px (to be measured; if it does not fit, the short form of the
 * sheet would apply at the field below 1536 px). It never gets cut: the bar wraps.
 */
/*
 * "Feld löschen" shows its label when the row has room (`deleteTextFits`, measured from the bar's own
 * groups and its card or the sheet's head); else the text goes to its tooltip and name. The bar never
 * gets cut (`flex-wrap` stays as the last resort).
 */
/*
 * The room is read from the sizes the browser
 * hands over after layout, the `ResizeObserver` entries of the bar's groups, its delete button and its
 * container (the first callback after `observe` brings the initial sizes). Reading `offsetWidth`,
 * `scrollWidth` or `getComputedStyle` when the bar mounted (in the drop's frame) forced the layout of the
 * changed page: 11.5 ms at 1x, 53 ms throttled. Until the first entries the last decision of this
 * placement stands (at first: the text at the field and in a wide sheet, the icon in the phone's sheet),
 * so nothing flickers.
 */
const hasRowRoom = useEditorRowRoom();
/*
 * Below 640 px the bar at the field could not end 48 px before the
 * section's bin column. Its card is the viewport minus 64 px (the canvas's and the section's padding),
 * the bar at least 246 px (the move group 104, the menu's short form 58, the keyboard help 32, the delete
 * 32, the spacing 4 + 8 + 8); 7 x 32 px of controls do not fit 176 px (320 minus 64 minus 80). At 320 the
 * two bins stood in one column 8 px apart, at 360 18 px apart, at 375 33. Wrapping is no way out: a
 * second row grows upwards over the section's controls. So the bar's order gives way: at the field below
 * 640 px "Feld löschen" is its FIRST control (in the DOM too, so the focus order is the visual one). The
 * field's bin then stands at the card's left edge, the section's at its right: at 320 the field's bin
 * spans 0 to 32 and the section's 224 to 256 (192 px between them), at 360 0 to 32 and 264 to 296 (232).
 * From 640 px the order stays as it was. below 640 px the bar in the
 * inspector's sheet has the delete first as well, so the same person on the same phone finds it in the
 * same place in both bars.
 */
const deleteFirst = computed(() => !hasRowRoom.value);
const groupOrder = computed(() => deleteFirst.value
    ? (['delete', 'move', 'place'] as const)
    : (['move', 'place', 'delete'] as const));
const deleteTextShown = ref(rememberedDeleteText(props.placement, hasRowRoom.value));
/** The section control in its short form, and the bar wrapping (the last resort). */
const sectionShortShown = ref(false);
const wrapShown = ref(false);
/** What the text adds to the icon, from the entries while it is shown (the review's 121 px minus 32). */
let deleteTextWidth = 89;
/** The menu trigger's full width, from the entries while it is shown ("In Abschnitt verschieben ▾"). */
let sectionFullWidth = 196;
const observed = { container: 0, move: 0, section: 0, keyboard: 0, delete: 0, deleteHeight: 0 };
let barObserver: ResizeObserver | null = null;
let observedControls: Element[] = [];

function boxWidth(entry: ResizeObserverEntry): number {
    return entry.borderBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
}

/** The section control has a menu (several sections, or the address group): it does not shrink. */
const sectionIsMenu = computed(() => sectionControl.value === 'menu' || sectionControl.value === 'group');

function decideForms() {
    if (!observed.container || !observed.deleteHeight || !observed.keyboard) return;
    if (deleteTextShown.value) deleteTextWidth = Math.max(0, observed.delete - observed.deleteHeight);
    const icon = observed.deleteHeight;
    const atField = props.placement === 'field';
    if (atField && sectionIsMenu.value && !sectionShortShown.value) sectionFullWidth = observed.section;
    // The one-target button may be cut down to about its icon's width; a menu trigger never shrinks.
    // In the sheet the section control is always its short form.
    const sectionFull = !atField ? observed.section : sectionIsMenu.value ? sectionFullWidth : icon;
    const sectionShort = !atField ? observed.section : sectionIsMenu.value ? MENU_SHORT_WIDTH : icon;
    const forms = decideBarForms({
        // At the field the bar ends at least 48 px left of the section's bin column,
        // where its delete is its last control (from 640 px); below, the delete comes first.
        available: observed.container - (atField && !deleteFirst.value ? SECTION_BIN_CLEARANCE : 0),
        gap: hasRowRoom.value ? 24 : 8,
        inner: 4,
        move: observed.move,
        sectionFull,
        sectionShort,
        keyboard: observed.keyboard,
        deleteIcon: icon,
        deleteText: deleteTextWidth
    });
    rememberDeleteText(props.placement, hasRowRoom.value, forms.deleteText);
    if (forms.deleteText !== deleteTextShown.value) deleteTextShown.value = forms.deleteText;
    const short = atField && forms.sectionShort;
    if (short !== sectionShortShown.value) sectionShortShown.value = short;
    if (forms.wrap !== wrapShown.value) wrapShown.value = forms.wrap;
}

/** The section control and the keyboard help are observed one by one: their own widths, not the group's. */
function observeControls() {
    const bar = root.value;
    if (!bar || !barObserver) return;
    observedControls.forEach(element => barObserver?.unobserve(element));
    observedControls = ['field-section', 'field-keyboard']
        .map(name => bar.querySelector(`[data-structure-action="${name}"]`))
        .filter((element): element is Element => Boolean(element));
    observedControls.forEach(element => barObserver?.observe(element));
}

onMounted(() => {
    const bar = root.value;
    if (typeof ResizeObserver === 'undefined' || !bar) return;
    const container = bar.parentElement;
    const move = bar.querySelector('[data-test="field-action-bar-move"]');
    const remove = bar.querySelector('[data-test="field-action-bar-delete"]');
    barObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
            const action = (entry.target as HTMLElement).dataset?.structureAction;
            if (entry.target === container) observed.container = boxWidth(entry);
            else if (entry.target === move) observed.move = boxWidth(entry);
            else if (action === 'field-section') observed.section = boxWidth(entry);
            else if (action === 'field-keyboard') observed.keyboard = boxWidth(entry);
            else if (entry.target === remove) {
                observed.delete = boxWidth(entry);
                observed.deleteHeight = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
            }
        }
        decideForms();
    });
    for (const element of [container, move, remove]) {
        if (element) barObserver.observe(element);
    }
    observeControls();
});
onBeforeUnmount(() => barObserver?.disconnect());
/** The section control shows its text: at the field from sm, unless the room asks for its short form; never in the sheet. */
const sectionTextShown = computed(() => props.placement === 'field' && hasRowRoom.value && !sectionShortShown.value);
/** At the field: packed, capped, cut where the one-target name allows it; wrapping only as the last resort. */
const barClass = computed(() => props.placement === 'field'
    ? `absolute bottom-full start-0 z-10 mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 sm:max-w-[calc(100%-5rem)] sm:gap-x-6${wrapShown.value ? '' : ' sm:flex-nowrap'}`
    : 'flex flex-wrap items-center gap-x-2 gap-y-1 sm:gap-x-6');
const positionText = computed(() => position.value
    ? t('admin.forms.fieldBar.position', {
        position: position.value.index + 1,
        count: position.value.count,
        section: position.value.sectionTitle
    })
    : '');

function sectionTitle(section: FormSchema['sections'][number]) {
    return section.title || section.id;
}

const otherSections = computed(() => props.schema.sections.filter(section => section.id !== props.sectionId));
const currentSection = computed(() => props.schema.sections.find(section => section.id === props.sectionId));
const isCompareTarget = computed(() => compareTargetFieldIds(props.schema).has(props.fieldId));

function moveBlocked(section: FormSchema['sections'][number]) {
    return isCompareTarget.value && section.repeatable === true && currentSection.value?.repeatable !== true;
}

/** The section control's form: menu, one named button, or nothing to choose. */
const sectionControl = computed<'group' | 'menu' | 'one' | 'none'>(() => {
    if (membership.value) return 'group';
    if (otherSections.value.length > 1) return 'menu';
    return otherSections.value.length === 1 ? 'one' : 'none';
});
// Another number of sections changes the section control (menu or one target): observe the new one.
watch(sectionControl, () => observeControls(), { flush: 'post' });

/*
 * At 390 px the menu was 449 px wide when a target section had a long
 * name and reached 67 px past the screen, the name cut at the edge without an ellipsis. The framework's
 * menu content limits only its height (`max-h-(--reka-dropdown-menu-content-available-height)`) and its
 * item labels are `truncate`. Here the content is at most the viewport minus the framework's collision
 * padding on both sides (8 + 8 px; `collisionPadding` of `UDropdownMenu`), so Reka's collision handling can
 * keep it inside, and a long name wraps instead of being cut (`whitespace-normal!` over the theme's
 * `truncate`, `break-words` for a long word): the whole name, its distinguishing end included, is read.
 */
const SECTION_MENU_UI = { content: VIEWPORT_BOUND_CONTENT, itemLabel: 'whitespace-normal! break-words' };

/* A heading "In Abschnitt", below it only the sections' names (no repeated "Nach"). */
const sectionMoveItems = computed<DropdownMenuItem[][]>(() => [[
    { type: 'label', label: t('admin.forms.fieldBar.menuHeading') },
    ...otherSections.value.map(section => ({
        label: sectionTitle(section),
        disabled: props.disabled || moveBlocked(section),
        onSelect: () => emit('move-to-section', section.id)
    }))
]]);

/* The trigger's accessible name starts with its visible text (WCAG 2.5.3). */
const sectionMenuText = computed(() => sectionControl.value === 'group' ? t('admin.forms.fieldBar.menuGroup') : t('admin.forms.fieldBar.menu'));
const sectionMenuName = computed(() => membership.value
    ? t('admin.forms.fieldBar.menuGroupNamed', { group: addressGroupLabel(membership.value.group) })
    : t('admin.forms.fieldBar.menuNamed', { label: fieldLabel.value }));

/** A field of an address group moves with its group (as the old group menu did). */
const groupItems = computed<DropdownMenuItem[][]>(() => {
    const found = membership.value;
    if (!found) return [];
    const up = moveAddressGroupByStep(props.schema, found.section.id, found.group.id, 'up').applied;
    const down = moveAddressGroupByStep(props.schema, found.section.id, found.group.id, 'down').applied;
    const targets = props.schema.sections.filter(section => section.id !== found.section.id);
    return [
        [{ type: 'label', label: t('admin.forms.structure.groupNamed', { label: addressGroupLabel(found.group) }) }],
        [
            { label: t('admin.forms.structure.groupMoveUp'), disabled: props.disabled || !up, onSelect: () => emit('group-move-step', 'up') },
            { label: t('admin.forms.structure.groupMoveDown'), disabled: props.disabled || !down, onSelect: () => emit('group-move-step', 'down') },
            ...targets.map(section => ({
                label: t('admin.forms.fieldBar.groupMoveTo', { section: sectionTitle(section) }),
                disabled: props.disabled,
                onSelect: () => emit('group-move-to-section', section.id)
            }))
        ],
        [{ label: t('admin.forms.structure.groupDelete'), color: 'error' as const, disabled: props.disabled, onSelect: () => emit('group-delete') }]
    ];
});

const onlyOtherSection = computed(() => otherSections.value[0]);
/** The one-target button's label is cut at this width (measured when the pointer or focus arrives). */
const oneTargetCut = ref(false);
function measureOneTarget(event: Event) {
    const label = (event.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>('[data-one-target-shown]');
    oneTargetCut.value = Boolean(label && label.scrollWidth > label.clientWidth);
}
const sectionMoveText = computed(() => onlyOtherSection.value
    ? t('admin.forms.fieldBar.moveTo', { section: sectionTitle(onlyOtherSection.value) })
    : t('admin.forms.fieldBar.menu'));
/*
 * The one-target button exists only with
 * exactly two sections, so it can show only two texts: "Nach „B“" here and "Nach „A“" after the move.
 * Both stand in one grid cell, the other one invisible and hidden from screen readers, so the button is
 * as wide as the longer one (capped by the bar's room): the name shows in full where it fits, and after
 * the move nothing to its right moves.
 */
const sectionMoveTextAfterMove = computed(() => currentSection.value && onlyOtherSection.value
    ? t('admin.forms.fieldBar.moveTo', { section: sectionTitle(currentSection.value) })
    : '');

/*
 * The reason at a blocked step stood as one line of 1180 px over the
 * label of the field that had just moved, and it opened by itself after the last possible step: the
 * pointer still rested on the button, and the bar puts the focus back on it. The reason wraps at
 * the tooltip's width (the framework's content slot, its height freed), and after a step the pressed
 * button's tooltip stays closed until the pointer leaves it or the focus goes elsewhere; hover and
 * keyboard focus open it as any tooltip. The screen-reader description is unchanged.
 */
const quietTooltip = ref<'field-up' | 'field-down' | null>(null);
const REASON_TOOLTIP_UI = { content: 'h-auto pointer-events-none' };
/*
 * The reason (340 x 72) opened below the button, so over the card
 * the bar belongs to, and once caught a click meant for the card. The step tooltips open above the
 * bar (which stands above its card), and their content takes no pointer events. Text and the
 * screen-reader description are unchanged.
 */
/*
 * Centred on "früher" (x about 339 at 1440 px) the 320 px reason reached left to x 179,
 * over the sidebar (which ends at 240). `align: 'start'` lines its left edge up with the button's, and
 * the bar stands at the card's left, so the tooltip starts inside the canvas column and
 * grows into it; at the viewport's edge the framework's default collision handling still shifts it.
 */
const STEP_TOOLTIP_CONTENT = { side: 'top' as const, align: 'start' as const };
const STEP_TOOLTIP_UI = { content: 'pointer-events-none' };

function releaseTooltip(event?: FocusEvent) {
    // A blur without a new target is the moved card taking the bar along, not the person leaving.
    if (event && !event.relatedTarget) return;
    quietTooltip.value = null;
}

/** "Verschieben" keeps the focus on the pressed button while the field moves (rule 5). */
let lastStepAction: 'field-up' | 'field-down' | null = null;

function step(direction: MoveDirection) {
    lastStepAction = direction === 'up' ? 'field-up' : 'field-down';
    quietTooltip.value = lastStepAction;
    emit('move-step', direction);
}

function focusAction(action: string) {
    root.value?.querySelector<HTMLElement>(`[data-structure-action="${action}"]`)?.focus();
}

watch(() => position.value?.index, async () => {
    if (!lastStepAction) return;
    const action = lastStepAction;
    lastStepAction = null;
    await nextTick();
    // The pressed button stays focusable when it cannot step further, so the focus stays on it.
    focusAction(action);
}, { flush: 'post' });
</script>

<template>
  <div
    ref="root"
    role="toolbar"
    :aria-label="t('admin.forms.fieldBar.label', { label: fieldLabel })"
    :aria-describedby="descriptionId"
    :class="barClass"
    data-test="field-action-bar"
    :data-placement="placement"
  >
    <!-- From 1280 px the bar stood at the card's right edge, so at a
         section's first field its bin stood 10 px under the section's bin (both x = 924). It stands at
         the card's left at every width; the section's controls stay at the right. -->
    <span
      :id="descriptionId"
      class="sr-only"
      data-test="field-action-bar-position"
    >{{ positionText }}</span>
    <span
      :id="`${descriptionId}-earlier`"
      class="sr-only"
      data-test="field-action-bar-earlier-reason"
    >{{ earlierReason }}</span>
    <span
      :id="`${descriptionId}-later`"
      class="sr-only"
      data-test="field-action-bar-later-reason"
    >{{ laterReason }}</span>

    <!-- The groups stand in `groupOrder` (below 640 px the delete first, at the field and in the sheet). -->
    <template
      v-for="group in groupOrder"
      :key="group"
    >
      <!-- Keep ghost buttons outside UFieldGroup so their hover areas retain rounded corners.
           Spacing separates the three groups: gap-1 inside, as in the section's row; gap-x-6 between,
           gap-x-2 below 640 px (gap-x-3 did not leave one row at 320 px in the sheet). -->
      <div
        v-if="group === 'move'"
        class="flex shrink-0 items-center gap-1"
        data-test="field-action-bar-move"
      >
        <!-- The keyboard path is "früher" and "später"; the handle is for the pointer only. -->
        <UTooltip
          v-if="placement === 'field'"
          :text="t('admin.forms.fieldBar.dragHandle')"
        >
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-grip-vertical"
            class="max-sm:hidden"
            tabindex="-1"
            aria-hidden="true"
            v-bind="dragHandle"
            data-structure-action="field-drag"
          />
        </UTooltip>

        <UTooltip
          :text="earlierText"
          :kbds="['alt', 'arrowup']"
          :disabled="quietTooltip === 'field-up'"
          :ui="earlierReason ? REASON_TOOLTIP_UI : STEP_TOOLTIP_UI"
          :content="STEP_TOOLTIP_CONTENT"
        >
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-arrow-up"
            :disabled="disabled"
            :aria-disabled="earlierReason ? 'true' : undefined"
            :aria-label="earlierName"
            :aria-describedby="earlierReason ? `${descriptionId}-earlier` : undefined"
            data-structure-action="field-up"
            @click="canMoveEarlier && step('up')"
            @pointerleave="releaseTooltip()"
            @blur="releaseTooltip"
          />
          <template
            v-if="earlierReason"
            #content
          >
            <span
              class="block max-w-xs whitespace-normal"
              data-test="field-action-bar-earlier-tooltip"
            >{{ earlierReason }}</span>
          </template>
        </UTooltip>

        <UTooltip
          :text="laterText"
          :kbds="['alt', 'arrowdown']"
          :disabled="quietTooltip === 'field-down'"
          :ui="laterReason ? REASON_TOOLTIP_UI : STEP_TOOLTIP_UI"
          :content="STEP_TOOLTIP_CONTENT"
        >
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-arrow-down"
            :disabled="disabled"
            :aria-disabled="laterReason ? 'true' : undefined"
            :aria-label="laterName"
            :aria-describedby="laterReason ? `${descriptionId}-later` : undefined"
            data-structure-action="field-down"
            @click="canMoveLater && step('down')"
            @pointerleave="releaseTooltip()"
            @blur="releaseTooltip"
          />
          <template
            v-if="laterReason"
            #content
          >
            <span
              class="block max-w-xs whitespace-normal"
              data-test="field-action-bar-later-tooltip"
            >{{ laterReason }}</span>
          </template>
        </UTooltip>

        <UTooltip :text="t('admin.forms.fieldBar.insertBelow')">
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-plus"
            :disabled="disabled"
            :aria-label="t('admin.forms.fieldBar.insertBelowNamed', { label: fieldLabel })"
            data-structure-action="field-insert-below"
            @click="emit('insert-below')"
          />
        </UTooltip>
      </div>

      <!-- The bar stays packed at the card's left, only as wide as its content and at
           the field from 640 px at most the card minus 5rem (the section's bin column and 48 px). This group
           is the one that gives way (`min-w-0`, no `grow`): the one-target button shows the longer of its
           two names in full where it fits and is cut only when the room ends. -->
      <div
        v-else-if="group === 'place'"
        class="flex min-w-0 items-center gap-1"
        data-test="field-action-bar-place"
      >
        <!-- The trigger keeps its natural width; the menu
             opens at the bar's side. -->
        <UDropdownMenu
          v-if="sectionControl === 'group' || sectionControl === 'menu'"
          :items="sectionControl === 'group' ? groupItems : sectionMoveItems"
          :content="{ align: 'start' }"
          :ui="SECTION_MENU_UI"
        >
          <UTooltip
            :text="sectionMenuText"
            :disabled="sectionTextShown"
          >
            <UButton
              color="neutral"
              variant="ghost"
              leading-icon="i-lucide-folder-input"
              trailing-icon="i-lucide-chevron-down"
              :ui="placement === 'field' && !sectionShortShown ? SECTION_CONTROL_UI : undefined"
              :label="placement === 'field' && !sectionShortShown ? sectionMenuText : undefined"
              :disabled="disabled"
              :aria-label="sectionMenuName"
              data-structure-action="field-section"
            />
          </UTooltip>
        </UDropdownMenu>
        <!-- "Nach „…“" keeps one line, 32 px; a long section name is cut
             by the framework's label and stays whole in the tooltip and the button's name.
             no fixed width (`w-44` cut "Nach „Nachweise (PAus…" with 244 px of the card free); the
             tooltip only where the name is not shown in full (cut, or the icon form). -->
        <UTooltip
          v-else
          :text="sectionMoveText"
          :disabled="!onlyOtherSection || (sectionTextShown && !oneTargetCut)"
        >
          <UButton
            color="neutral"
            variant="ghost"
            leading-icon="i-lucide-folder-input"
            :class="placement === 'field' ? 'min-w-0 max-w-full' : undefined"
            :ui="placement === 'field' && !sectionShortShown ? SECTION_CONTROL_UI : undefined"
            :aria-label="sectionMoveText"
            :disabled="disabled || !onlyOtherSection || moveBlocked(onlyOtherSection)"
            data-structure-action="field-section"
            @click="onlyOtherSection && emit('move-to-section', onlyOtherSection.id)"
            @pointerenter="measureOneTarget"
            @focus="measureOneTarget"
          >
            <template
              v-if="placement === 'field' && !sectionShortShown"
              #default
            >
              <span
                class="grid min-w-0 max-sm:sr-only"
                data-one-target-cell
              >
                <span
                  class="col-start-1 row-start-1 truncate"
                  data-one-target-shown
                >{{ sectionMoveText }}</span>
                <span
                  v-if="sectionMoveTextAfterMove"
                  class="invisible col-start-1 row-start-1 truncate"
                  aria-hidden="true"
                  data-one-target-other
                >{{ sectionMoveTextAfterMove }}</span>
              </span>
            </template>
          </UButton>
        </UTooltip>

        <!-- The keyboard shortcuts, in full and reachable: a popover from a named button. Its
             tooltip says what the icon is; it opens at the bar's side like the menu. -->
        <UPopover :content="{ align: 'start' }">
          <UTooltip :text="t('admin.forms.structure.keyboardHelp')">
            <UButton
              color="neutral"
              variant="ghost"
              icon="i-lucide-keyboard"
              :aria-label="t('admin.forms.structure.keyboardHelp')"
              data-structure-action="field-keyboard"
            />
          </UTooltip>
          <template #content>
            <dl
              class="max-w-xs space-y-2 p-3 text-sm"
              data-test="field-keyboard-help"
            >
              <div class="flex items-center justify-between gap-4">
                <dt class="flex gap-1">
                  <UKbd value="alt" /><UKbd value="arrowup" /><UKbd value="arrowdown" />
                </dt>
                <dd>{{ t('admin.forms.keyboard.move') }}</dd>
              </div>
              <div class="flex items-center justify-between gap-4">
                <dt class="flex gap-1">
                  <UKbd value="delete" /><UKbd value="backspace" />
                </dt>
                <dd>{{ t('admin.forms.keyboard.delete') }}</dd>
              </div>
              <div class="flex items-center justify-between gap-4">
                <dt><UKbd value="enter" /></dt>
                <dd>{{ t('admin.forms.keyboard.toLabel') }}</dd>
              </div>
              <div class="flex items-center justify-between gap-4">
                <dt><UKbd value="escape" /></dt>
                <dd>{{ t('admin.forms.keyboard.toField') }}</dd>
              </div>
              <!-- The way from the form to the answer beside "Rückgängig". -->
              <div class="flex items-center justify-between gap-4">
                <dt class="flex gap-1">
                  <UKbd value="alt" /><UKbd value="Z" />
                </dt>
                <dd>{{ t('admin.forms.keyboard.toAnswer') }}</dd>
              </div>
            </dl>
          </template>
        </UPopover>
      </div>

      <!-- The selected field's delete, once, with its text at the end of the row,
           as its own group (below 640 px at its start). -->
      <div
        v-else
        class="flex shrink-0 items-center gap-1"
        data-test="field-action-bar-delete"
      >
        <UTooltip
          :text="t('admin.forms.structure.deleteField')"
          :kbds="['delete']"
        >
          <UButton
            color="error"
            variant="ghost"
            icon="i-lucide-trash-2"
            :label="deleteTextShown ? t('admin.forms.structure.deleteField') : undefined"
            :disabled="disabled"
            :aria-label="t('admin.forms.structure.deleteFieldNamed', { label: fieldLabel })"
            data-structure-action="field-delete"
            @click="emit('delete')"
          />
        </UTooltip>
      </div>
    </template>
  </div>
</template>
