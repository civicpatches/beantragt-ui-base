/**
 * Registries of the staff area: sidebar entries, function-search destinations, path rules of the route gate and
 * outlets that hand a context to the component a layer registered.
 *
 * Same mechanics as `app/utils/app-extensions.ts`: a layer registers at plugin time, every register function returns
 * the function that removes what it added, and an empty registry means nothing is shown. Plugins run before the
 * first route middleware, so the path gate is complete when `middleware/admin.ts` asks. Registration order does not
 * matter: entries and destination sections are read sorted by `order`, path rules have no order.
 *
 * Part of the open case-work shell; the open part and Pro both fill it (`plugins/casework-extensions.ts`,
 * `plugins/staff-extensions.ts`).
 */
import { markRaw, shallowReactive, type Component, type ComputedRef } from 'vue';
import type { RouteLocationRaw } from 'vue-router';
import type { DropdownMenuItem, NavigationMenuItem } from '@nuxt/ui';
import type { DocumentReviewCopy } from './document-review';
import type { StaffFormFeatures } from './staff-form-features';
import type { FunctionDestination } from './function-search';
import type { ApplicationRow } from '~/types';
import type { FormSchema } from '~/types/form';
import type { ResolvedStatus } from '~/utils/workflow-status';

export interface StaffNavContext {
    t: (key: string) => string
    routePath: string
    workspaceRoute: (path: string) => RouteLocationRaw
    isAdmin: boolean
    workspaceType: 'jurisdiction' | 'organisation' | null
}

export interface StaffNavEntry {
    id: string
    /** One order for both audiences: forms 10, formGroups 20, fim 30, assistant 40, applications 50, bulk 60, applicants 70, reports 80, settings 100. */
    order: number
    /** `staff`: every staff role; `admin`: admins only. */
    audience: 'staff' | 'admin'
    when?: (context: StaffNavContext) => boolean
    item: (context: StaffNavContext) => NavigationMenuItem
}

/**
 * A run of destinations at one place of the index. The index order is the palette's tie-breaker and open and Pro
 * destinations alternate in it, so each run carries the order of its place.
 */
export interface FunctionDestinationSection {
    order: number
    destinations: readonly FunctionDestination[]
}

export interface StaffSettingsRow {
    key: string
    path?: string
    group: 'processing' | 'citizen' | 'operations'
    order: number
    municipalityOnly?: boolean
}

export interface StaffPathRule {
    /** Matches an admin path without workspace prefix; case-insensitive like the router, without the `g` flag. */
    pattern: RegExp
    /** Inside the paths other rules open, this one stays with the admins. */
    adminOnly?: boolean
}

export type StaffOutletName
    = | 'case-detail-panels' | 'case-document-review' | 'case-docgen' | 'case-delivery' | 'case-transfers' | 'case-supplements' | 'case-attachment-insight' | 'case-list-actions' | 'general-applicant-profile'
      | 'form-integration-hint' | 'form-editor-source' | 'form-editor-settings' | 'form-editor-bulk-status' | 'form-editor-chat' | 'form-field-analysis'
      | 'form-list-toolbar' | 'form-list-empty-actions' | 'form-list-row-actions' | 'fim-imported-actions';

export interface FormListRowContext {
    id: string
    label: string
    status: string
}

type FormListDetailPath = (formId: string) => string;

export interface StaffAccountMenuContext {
    /** Shows the layout's sentence that the server kept the session (the logout before a switch failed). */
    announceLogoutFailed: () => void
}

/** Initialized during layout setup so the extension can use composables. */
type StaffAccountMenuExtension = (context: StaffAccountMenuContext) => ComputedRef<DropdownMenuItem[]>;

/** Context of the outlet `case-list-actions` (first toolbar line of the application list). */
export interface CaseListActionsContext {
    /** The rows the list's filters leave, in the list's order: all of them, not only the page or the selection. */
    rows: readonly ApplicationRow[]
    /** The form of the form page; null on the global list. */
    schema: FormSchema | null
    /** The global list shows the "Formular" column. */
    showFormColumn: boolean
    /** Schema id -> form name, for the "Formular" column. */
    schemaLabels: Readonly<Record<string, string>>
    /** The list's resolved status of a row. */
    statusOf: (row: ApplicationRow) => ResolvedStatus | null
}

const registry = shallowReactive<{
    nav: readonly StaffNavEntry[]
    destinations: readonly FunctionDestinationSection[]
    settingsRows: readonly StaffSettingsRow[]
    pathRules: readonly StaffPathRule[]
    outlets: Partial<Record<StaffOutletName, readonly Component[]>>
    accountMenu: readonly StaffAccountMenuExtension[]
    formListDetailPath?: FormListDetailPath
    formFeatures?: StaffFormFeatures
    useDocumentReviewCopy?: () => DocumentReviewCopy
}>({ nav: [], destinations: [], settingsRows: [], pathRules: [], outlets: {}, accountMenu: [] });

/** Adds the entries that are not there yet (same object or same id); the remover takes back only those. */
function addOnce<T>(current: readonly T[], added: readonly T[], sameAs: (a: T, b: T) => boolean): { next: readonly T[], taken: readonly T[] } {
    const taken: T[] = [];
    for (const entry of added) {
        if (![...current, ...taken].some(existing => sameAs(existing, entry))) taken.push(entry);
    }
    return { next: [...current, ...taken], taken };
}

const byOrder = <T extends { order: number }>(list: readonly T[]) => [...list].sort((a, b) => a.order - b.order);

export function registerStaffNavEntries(entries: readonly StaffNavEntry[]): () => void {
    const { next, taken } = addOnce(registry.nav, entries, (a, b) => a === b || a.id === b.id);
    registry.nav = next;
    return () => {
        registry.nav = registry.nav.filter(entry => !taken.includes(entry));
    };
}

/** Every registered sidebar entry, sorted by `order`. */
export function staffNavEntries(): readonly StaffNavEntry[] {
    return byOrder(registry.nav);
}

export function registerFunctionDestinations(sections: readonly FunctionDestinationSection[]): () => void {
    const ids = (section: FunctionDestinationSection) => section.destinations.map(destination => destination.id);
    const { next, taken } = addOnce(registry.destinations, sections, (a, b) => a === b || ids(a).some(id => ids(b).includes(id)));
    registry.destinations = next;
    return () => {
        registry.destinations = registry.destinations.filter(section => !taken.includes(section));
    };
}

/** Every registered destination in index order. */
export function functionDestinations(): readonly FunctionDestination[] {
    return byOrder(registry.destinations).flatMap(section => section.destinations);
}

export function registerStaffSettingsRows(rows: readonly StaffSettingsRow[]): () => void {
    const { next, taken } = addOnce(registry.settingsRows, rows, (a, b) => a.key === b.key);
    registry.settingsRows = next;
    return () => {
        registry.settingsRows = registry.settingsRows.filter(row => !taken.includes(row));
    };
}

export function staffSettingsRows(): readonly StaffSettingsRow[] {
    return byOrder(registry.settingsRows);
}

export function registerStaffPathRules(rules: readonly StaffPathRule[]): () => void {
    const same = (a: StaffPathRule, b: StaffPathRule) => a === b
      || (a.pattern.source === b.pattern.source && a.pattern.flags === b.pattern.flags && Boolean(a.adminOnly) === Boolean(b.adminOnly));
    const { next, taken } = addOnce(registry.pathRules, rules, same);
    registry.pathRules = next;
    return () => {
        registry.pathRules = registry.pathRules.filter(rule => !taken.includes(rule));
    };
}

export function staffPathRules(): readonly StaffPathRule[] {
    return registry.pathRules;
}

/** Adds a component to an outlet once; returns a function that removes it. */
export function registerStaffOutlet(name: StaffOutletName, component: Component): () => void {
    const raw = markRaw(component);
    const current = registry.outlets[name] ?? [];
    const added = !current.includes(raw);
    if (added) registry.outlets = { ...registry.outlets, [name]: [...current, raw] };
    return () => {
        if (!added) return;
        registry.outlets = { ...registry.outlets, [name]: (registry.outlets[name] ?? []).filter(entry => entry !== raw) };
    };
}

/** The components registered for an outlet, in registration order. */
export function staffOutlet(name: StaffOutletName): readonly Component[] {
    return registry.outlets[name] ?? [];
}

export function registerStaffAccountMenuExtension(extension: StaffAccountMenuExtension): () => void {
    if (registry.accountMenu.includes(extension)) return () => {};
    registry.accountMenu = [...registry.accountMenu, extension];
    return () => {
        registry.accountMenu = registry.accountMenu.filter(item => item !== extension);
    };
}

export function staffAccountMenuExtensions(): readonly StaffAccountMenuExtension[] {
    return registry.accountMenu;
}

/** A layer with a form detail page can make the list rows link to it. */
export function registerFormListDetailPath(path: FormListDetailPath): () => void {
    const added = registry.formListDetailPath === undefined;
    if (added) registry.formListDetailPath = path;
    return () => {
        if (added) delete registry.formListDetailPath;
    };
}

export function formListDetailPath(formId: string): string | undefined {
    return registry.formListDetailPath?.(formId);
}

/** The additional tools available in the form work area. */
export function registerStaffFormFeatures(features: StaffFormFeatures): () => void {
    if (registry.formFeatures) return () => {};
    registry.formFeatures = features;
    return () => {
        delete registry.formFeatures;
    };
}

export function staffFormFeatures(): StaffFormFeatures | undefined {
    return registry.formFeatures;
}

export function registerStaffDocumentReviewCopy(useCopy: () => DocumentReviewCopy): () => void {
    if (registry.useDocumentReviewCopy) return () => {};
    registry.useDocumentReviewCopy = useCopy;
    return () => {
        delete registry.useDocumentReviewCopy;
    };
}

export function staffDocumentReviewCopy(): DocumentReviewCopy | undefined {
    return registry.useDocumentReviewCopy?.();
}
