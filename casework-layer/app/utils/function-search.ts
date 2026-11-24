import { EDIT_ICON } from '~/utils/action-icons';
/**
 * Destination index of the admin area and the pure builder that turns it into
 * command-palette groups (function search in the Cmd+K palette).
 *
 * A destination is a place a person can be taken to: a page, a section of a
 * page, or a function that lives inside an open application, form or batch.
 * The index holds only public product vocabulary (i18n keys), never data.
 *
 * Visibility follows the rules the product already applies and nothing else:
 * - `staff`: `useAuth().isStaff` (every admin route needs it, see middleware/admin.ts),
 * - `admin`: `useAuth().isAdmin` (case workers are redirected away from every
 *   other admin path, middleware/admin.ts via utils/admin-access.ts),
 * - `platform-admin`: Drupal role `administrator` (settings/index.vue e-mail card,
 *   settings/integrations/outbox.vue),
 * - `municipality`: not in an organisation workspace (integrations, dashboard.vue),
 * - `organisation`: in an organisation workspace (batch upload, bulk/index.vue).
 * - `form-create`: the personal workspace catalogue allows form creation.
 *
 * Framework-agnostic on purpose: the caller passes translation and route
 * resolution, so this stays unit-testable like `workspace-palette.ts`.
 */

import { functionDestinations, type FunctionDestinationSection } from './staff-extensions';

export type FunctionRequirement = 'staff' | 'admin' | 'platform-admin' | 'municipality' | 'organisation' | 'form-create';

/** Functions that need an open object. Away from it, the entry opens the list page. */
export type FunctionContext = 'application' | 'form' | 'bulk';

export type FunctionTarget
    = | { kind: 'admin', path: string, query?: Record<string, string> }
      | { kind: 'citizen-view' }
      | { kind: 'profile' };

export interface FunctionWhere {
    /** i18n key of the sentence that says where the function is. */
    key: string
    /** Named parameters; every value is itself an i18n key (for example a card title). */
    params?: Record<string, string>
}

export interface FunctionDestination {
    id: string
    labelKey: string
    descriptionKey: string
    /** Comma-separated synonyms. Searchable, never displayed. */
    keywordsKey: string
    icon: string
    target: FunctionTarget
    requires: readonly FunctionRequirement[]
    context?: FunctionContext
    /**
     * Where the function is, with the names that stand on the screen. Context
     * functions show it instead of the description away from their object;
     * all other entries show it in front of the description.
     */
    where?: FunctionWhere
    /** DOM id of the section on the application detail page (context `application`). */
    sectionId?: string
    /** `data-function-search-target` of the control inside the section that the entry names. */
    focusTarget?: string
    /** Canonical destination of a sidebar entry (sidebar parity test). */
    sidebar?: boolean
}

export interface FunctionSearchAccess {
    isStaff: boolean
    isAdmin: boolean
    isPlatformAdmin: boolean
    inOrganisationWorkspace: boolean
    canCreateFormSchema?: boolean
}

export type FunctionDeniedReason = FunctionRequirement;

/** Section ids on `/admin/applications/[id]`. `docgen-panel` is owned by ApplicationDocgen. */
export const APPLICATION_SECTION_IDS = {
    header: 'application-header',
    attachments: 'application-attachments',
    data: 'application-data-card',
    delivery: 'application-delivery',
    transfers: 'application-transfers',
    decisions: 'docgen-panel',
    nachreichung: 'application-nachreichung',
    responses: 'application-responses',
    crm: 'application-crm',
    messages: 'application-messages',
    assignment: 'application-assignment',
    deadline: 'application-deadline',
    statusHistory: 'application-status-history'
} as const;

const D = 'functionSearch.destinations';
const STAFF: readonly FunctionRequirement[] = ['staff'];
const MUNICIPALITY_ADMIN: readonly FunctionRequirement[] = ['staff', 'admin', 'municipality'];
const ADMIN: readonly FunctionRequirement[] = ['staff', 'admin'];

function keys(name: string) {
    return {
        labelKey: `${D}.${name}.label`,
        descriptionKey: `${D}.${name}.description`,
        keywordsKey: `${D}.${name}.keywords`
    };
}

function admin(path: string, query?: Record<string, string>): FunctionTarget {
    return query ? { kind: 'admin', path, query } : { kind: 'admin', path };
}

function applicationCard(cardKey: string): FunctionWhere {
    return { key: 'functionSearch.where.applicationCard', params: { card: cardKey } };
}

function applicationHeader(controlKey: string): FunctionWhere {
    return { key: 'functionSearch.where.applicationHeader', params: { control: controlKey } };
}

/** Page, by the i18n key of its title. */
function page(pageKey: string): FunctionWhere {
    return { key: 'functionSearch.where.page', params: { page: pageKey } };
}

function applicationEntry(
    id: string,
    name: string,
    icon: string,
    sectionId: string,
    where: FunctionWhere,
    requires: readonly FunctionRequirement[] = STAFF,
    focusTarget?: string
): FunctionDestination {
    return {
        id,
        ...keys(name),
        icon,
        target: admin('/admin/applications'),
        requires,
        context: 'application',
        where,
        sectionId,
        ...(focusTarget ? { focusTarget } : {})
    };
}

/** Application list pages. */
const CASEWORK_LIST_PAGES: readonly FunctionDestination[] = [
    { id: 'applications', ...keys('applications'), labelKey: 'nav.applications', icon: 'i-lucide-inbox', target: admin('/admin/applications'), requires: STAFF, sidebar: true },
    { id: 'applications-overdue', ...keys('applicationsOverdue'), icon: 'i-lucide-alarm-clock', target: admin('/admin/applications', { deadline: 'overdue' }), requires: STAFF }
];

/** Account, citizen side and the sections of an open application that the case-work layer shows. */
const CASEWORK_ACCOUNT_AND_APPLICATION: readonly FunctionDestination[] = [
    // Account and citizen side
    { id: 'profile', ...keys('profile'), labelKey: 'common.profile', icon: 'i-lucide-user-round', target: { kind: 'profile' }, requires: STAFF },
    { id: 'citizen-view', ...keys('citizenView'), labelKey: 'nav.citizenView', icon: 'i-lucide-eye', target: { kind: 'citizen-view' }, requires: STAFF },

    // Inside an open application
    applicationEntry('application-status', 'applicationStatus', 'i-lucide-refresh-cw', APPLICATION_SECTION_IDS.header, applicationHeader('admin.detail.changeStatus'), STAFF, 'status'),
    applicationEntry('application-status-history', 'applicationStatusHistory', 'i-lucide-history', APPLICATION_SECTION_IDS.statusHistory, applicationCard('admin.detail.statusHistoryTitle')),
    applicationEntry('application-print', 'applicationPrint', 'i-lucide-printer', APPLICATION_SECTION_IDS.header, applicationHeader('admin.applications.printView'), STAFF, 'print'),
    applicationEntry('application-delete', 'applicationDelete', 'i-lucide-trash-2', APPLICATION_SECTION_IDS.header, applicationHeader('admin.detail.deleteApplication'), ADMIN, 'delete'),
    applicationEntry('application-attachments', 'applicationAttachments', 'i-lucide-paperclip', APPLICATION_SECTION_IDS.attachments, applicationCard('admin.detail.attachments')),
    applicationEntry('application-data', 'applicationData', 'i-lucide-file-pen', APPLICATION_SECTION_IDS.data, applicationCard('admin.detail.formData')),
    applicationEntry('application-applicant-data', 'applicationApplicantData', 'i-lucide-contact', APPLICATION_SECTION_IDS.crm, applicationCard('admin.detail.crmData')),
    applicationEntry('application-messages', 'applicationMessages', 'i-lucide-message-circle', APPLICATION_SECTION_IDS.messages, applicationCard('comments.title')),
    applicationEntry('application-assignment', 'applicationAssignment', 'i-lucide-user-plus', APPLICATION_SECTION_IDS.assignment, applicationCard('admin.detail.assignmentTitle')),
    applicationEntry('application-deadline', 'applicationDeadline', 'i-lucide-calendar', APPLICATION_SECTION_IDS.deadline, applicationCard('admin.detail.deadlineTitle'))
];

/** The response list of an open application and the actions of the application list. */
const CASEWORK_RESPONSES_AND_LIST_ACTIONS: readonly FunctionDestination[] = [
    applicationEntry('application-responses', 'applicationResponses', 'i-lucide-inbox', APPLICATION_SECTION_IDS.responses, applicationCard('externalResponses.staffTitle')),

    // On the application list, for the selected rows; the list shows the bar to every staff role.
    { id: 'applications-bulk-deadline', ...keys('applicationsBulkDeadline'), icon: 'i-lucide-calendar-clock', target: admin('/admin/applications'), requires: STAFF, where: page('admin.applications.title') }
];

/** Tab on the page behind a settings card. */
function settingsTab(cardKey: string, tabKey: string): FunctionWhere {
    return { key: 'functionSearch.where.settingsTab', params: { card: cardKey, tab: tabKey } };
}

export function formEntry(id: string, name: string, icon: string): FunctionDestination {
    return {
        id,
        ...keys(name),
        icon,
        target: admin('/admin/forms'),
        requires: ADMIN,
        context: 'form',
        where: { key: `${D}.${name}.where` }
    };
}

/** Form management, ahead of the application list in the index (the staff assistant left the interface on 16.11.2026). */
const FORM_GROUPS_BEFORE_THE_LIST: readonly FunctionDestination[] = [
    // Sidebar and top-level pages
    { id: 'form-groups', ...keys('formGroups'), labelKey: 'nav.formGroups', icon: 'i-lucide-folder-tree', target: admin('/admin/form-groups'), requires: ADMIN, sidebar: true }
];

/**
 * The open part of the index: the application list, the open sections of an application and the account entries.
 * Pro registers the rest (`function-destinations.ts`); `functionDestinations()` reads both. Order is the
 * tie-breaker of the ranking, so the broad pages come before their sections. Open and Pro entries alternate in the
 * index, so every run has its place: `order` = 10 x (position of its first entry + 1) in the index of 39caf7ae.
 */
export const CASEWORK_FUNCTION_DESTINATIONS: readonly FunctionDestinationSection[] = [
    { order: 10, destinations: [
        { id: 'forms', ...keys('forms'), labelKey: 'nav.forms', icon: 'i-lucide-file-text', target: admin('/admin/forms'), requires: ADMIN, sidebar: true }
    ] },
    { order: 30, destinations: [
        { id: 'forms-archived', ...keys('formsArchived'), icon: 'i-lucide-archive', target: admin('/admin/forms', { status: 'archived' }), requires: ADMIN }
    ] },
    { order: 40, destinations: FORM_GROUPS_BEFORE_THE_LIST },
    { order: 50, destinations: [
        { id: 'fim', ...keys('fim'), labelKey: 'nav.fimCatalog', icon: 'i-lucide-database', target: admin('/admin/fim'), requires: ADMIN, sidebar: true }
    ] },
    { order: 70, destinations: CASEWORK_LIST_PAGES },
    { order: 220, destinations: [
        { id: 'settings', ...keys('settings'), labelKey: 'nav.settings', icon: 'i-lucide-settings', target: admin('/admin/settings'), requires: ADMIN, sidebar: true }
    ] },
    { order: 240, destinations: [
        { id: 'settings-general', ...keys('settingsGeneral'), labelKey: 'admin.settings.general.label', icon: 'i-lucide-settings', target: admin('/admin/settings/general'), requires: ADMIN },
        { id: 'settings-legal', ...keys('settingsLegal'), icon: 'i-lucide-scale', target: admin('/admin/settings/general'), requires: ADMIN, where: settingsSection('admin.settings.general.label', 'admin.settings.general.legalSection') }
    ] },
    { order: 270, destinations: [
        { id: 'settings-tenant', ...keys('settingsTenant'), icon: 'i-lucide-building-2', target: admin('/admin/settings/tenant'), requires: ADMIN, where: settingsCard('admin.settings.tenant.label') },
        { id: 'settings-organisations', ...keys('settingsOrganisations'), icon: 'i-lucide-network', target: admin('/admin/settings/tenant'), requires: ADMIN, where: settingsSection('admin.settings.tenant.label', 'admin.settings.tenant.organisationsTitle') },
        { id: 'settings-branding', ...keys('settingsBranding'), icon: 'i-lucide-palette', target: admin('/admin/settings/branding'), requires: ADMIN, where: settingsCard('admin.settings.branding.label') }
    ] },
    { order: 300, destinations: [
        { id: 'settings-workflow', ...keys('settingsWorkflow'), icon: 'i-lucide-git-branch', target: admin('/admin/settings/workflow'), requires: ADMIN, where: settingsCard('admin.settings.workflow.label') },
        { id: 'settings-statuses', ...keys('settingsStatuses'), icon: 'i-lucide-circle-dot', target: admin('/admin/settings/workflow'), requires: ADMIN, where: settingsSection('admin.settings.workflow.label', 'admin.settings.workflow.statusDefinitions') },
        { id: 'settings-delegation', ...keys('settingsDelegation'), icon: 'i-lucide-user-cog', target: admin('/admin/settings/workflow'), requires: ADMIN, where: settingsSection('admin.settings.workflow.label', 'admin.settings.workflow.delegationSettingsTitle') },
        { id: 'settings-content', ...keys('settingsContent'), labelKey: 'admin.settings.content.label', icon: 'i-lucide-file-pen-line', target: admin('/admin/settings/content'), requires: ADMIN },
        { id: 'settings-pages', ...keys('settingsPages'), icon: 'i-lucide-file', target: admin('/admin/settings/content'), requires: ADMIN, where: settingsTab('admin.settings.content.label', 'admin.settings.content.pagesTab') },
        { id: 'settings-info-sections', ...keys('settingsInfoSections'), icon: 'i-lucide-info', target: admin('/admin/settings/content'), requires: ADMIN, where: settingsTab('admin.settings.content.label', 'admin.settings.content.sectionsTab') },
        { id: 'settings-boilerplates', ...keys('settingsBoilerplates'), icon: 'i-lucide-text-quote', target: admin('/admin/settings/content'), requires: ADMIN, where: settingsTab('admin.settings.content.label', 'admin.settings.content.boilerplatesTab') },
        { id: 'settings-documents', ...keys('settingsDocuments'), icon: 'i-lucide-file-down', target: admin('/admin/settings/content'), requires: ADMIN, where: settingsTab('admin.settings.content.label', 'admin.settings.content.documentsTab') },
    ] },
    { order: 410, destinations: [
        { id: 'settings-decisions', ...keys('settingsDecisions'), labelKey: 'admin.settings.decisions.label', icon: 'i-lucide-stamp', target: admin('/admin/settings/decisions'), requires: ADMIN },
        { id: 'settings-email', ...keys('settingsEmail'), labelKey: 'admin.settings.email.label', icon: 'i-lucide-mail', target: admin('/admin/settings/email'), requires: MUNICIPALITY_ADMIN }
    ] },
    { order: 580, destinations: [
        applicationEntry('application-decisions', 'applicationDecisions', 'i-lucide-stamp', APPLICATION_SECTION_IDS.decisions, applicationCard('docgenUi.case.title')),
        applicationEntry('application-nachreichung', 'applicationNachreichung', 'i-lucide-file-input', APPLICATION_SECTION_IDS.nachreichung, applicationCard('admin.detail.attachmentList.followUpGroup'))
    ] },
    { order: 620, destinations: [
        formEntry('form-edit', 'formEdit', EDIT_ICON),
        formEntry('form-field-settings', 'formFieldSettings', 'i-lucide-sliders-horizontal'),
        formEntry('form-settings', 'formSettings', 'i-lucide-settings-2'),
        formEntry('form-decisions', 'formDecisions', 'i-lucide-stamp'),
        formEntry('form-workflow', 'formWorkflow', 'i-lucide-git-branch'),
        formEntry('form-publish', 'formPublish', 'i-lucide-globe'),
        formEntry('form-archive', 'formArchive', 'i-lucide-archive'),
    ] },
    { order: 700, destinations: [
        formEntry('form-applications', 'formApplications', 'i-lucide-table'),
        formEntry('form-public-view', 'formPublicView', 'i-lucide-external-link'),
    ] },
    { order: 430, destinations: [
        { id: 'settings-embed', ...keys('settingsEmbed'), labelKey: 'admin.settings.embed.label', icon: 'i-lucide-code', target: admin('/admin/settings/embed'), requires: ADMIN }
    ] },
    { order: 440, destinations: CASEWORK_ACCOUNT_AND_APPLICATION },
    { order: 600, destinations: CASEWORK_RESPONSES_AND_LIST_ACTIONS }
];

export function settingsCard(cardKey: string): FunctionWhere {
    return { key: 'functionSearch.where.settingsCard', params: { card: cardKey } };
}

export function settingsSection(cardKey: string, sectionKey: string): FunctionWhere {
    return { key: 'functionSearch.where.settingsSection', params: { card: cardKey, section: sectionKey } };
}

/** Builders of index entries, shared with the Pro part of the index. */
export const functionDestinationParts = { keys, admin, applicationCard, applicationEntry, page, STAFF, ADMIN } as const;

export function deniedReason(
    destination: FunctionDestination,
    access: FunctionSearchAccess
): FunctionDeniedReason | null {
    for (const requirement of destination.requires) {
        if (requirement === 'staff' && !access.isStaff) return 'staff';
        if (requirement === 'admin' && !access.isAdmin) return 'admin';
        if (requirement === 'platform-admin' && !access.isPlatformAdmin) return 'platform-admin';
        if (requirement === 'municipality' && access.inOrganisationWorkspace) return 'municipality';
        if (requirement === 'organisation' && !access.inOrganisationWorkspace) return 'organisation';
        if (requirement === 'form-create' && access.canCreateFormSchema === false) return 'form-create';
    }
    return null;
}

export function isDestinationAllowed(destination: FunctionDestination, access: FunctionSearchAccess): boolean {
    return deniedReason(destination, access) === null;
}

// --- Matching ---------------------------------------------------------------

/** Lower case, without diacritics, `ß` as `ss`: "Übergänge" matches "ubergange". */
export function normalizeSearchText(value: string): string {
    return value
        .toLocaleLowerCase('de')
        .replace(/ß/gu, 'ss')
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .replace(/\s+/gu, ' ')
        .trim();
}

function tokens(value: string): string[] {
    return normalizeSearchText(value).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

export function splitKeywords(value: string): string[] {
    return value.split(',').map(keyword => keyword.trim()).filter(Boolean);
}

export interface SearchableEntry {
    label: string
    secondLine: string
    keywords: readonly string[]
}

const MIN_IN_WORD_LENGTH = 4;

function joinedSpelling(text: string): string {
    return text.replace(/-/gu, '');
}

/**
 * A hyphenated text plus its joined spelling ("e-mail-vorlagen emailvorlagen"),
 * so that "email" and "fitconnect" find "E-Mail-Vorlagen" and "FIT-Connect".
 */
function withJoinedSpelling(text: string): string {
    return text.includes('-') ? `${text} ${joinedSpelling(text)}` : text;
}

/** True when `token` starts a word in `text`: at the start or after any character that is not a letter or digit (space, hyphen, „ or “). */
function wordPrefix(text: string, token: string): boolean {
    for (let index = text.indexOf(token); index !== -1; index = text.indexOf(token, index + 1)) {
        if (index === 0 || !/[\p{L}\p{N}]/u.test(text.charAt(index - 1))) return true;
    }
    return false;
}

/**
 * Score of one entry for a query; lower is better, `null` = no match.
 * Every query word must occur somewhere: at a word start of the label, a
 * keyword or the second line, or (from four letters) inside a label or keyword word.
 */
export function scoreEntry(entry: SearchableEntry, query: string): number | null {
    const queryTokens = tokens(query);
    if (queryTokens.length === 0) return null;

    const plainLabel = normalizeSearchText(entry.label);
    const label = withJoinedSpelling(plainLabel);
    const secondLine = normalizeSearchText(entry.secondLine);
    const keywords = entry.keywords.map(keyword => withJoinedSpelling(normalizeSearchText(keyword)));

    let total = 0;
    for (const token of queryTokens) {
        let best: number | null = null;
        // Inside a word (German compounds such as "Bescheidvorlagen") only from four letters on,
        // so a short workspace fragment like "bau" does not hit "Textbaustein".
        const inWord = token.length >= MIN_IN_WORD_LENGTH;
        if (wordPrefix(label, token)) best = 0;
        else if (inWord && label.includes(token)) best = 1;
        else if (keywords.some(keyword => wordPrefix(keyword, token))) best = 2;
        else if (inWord && keywords.some(keyword => keyword.includes(token))) best = 3;
        // The second line only at word starts: "bau" must not find "einbauen" ahead of a workspace.
        else if (wordPrefix(secondLine, token)) best = 4;
        if (best === null) return null;
        total += best;
    }
    // A label that starts with the whole query ranks first.
    const wholeQuery = normalizeSearchText(query);
    if (plainLabel.startsWith(wholeQuery) || joinedSpelling(plainLabel).startsWith(joinedSpelling(wholeQuery))) total -= 1;
    return total;
}

// --- Palette builder --------------------------------------------------------

export interface FunctionPaletteItem {
    id: string
    label: string
    /** Quieter second line: what you do there, or where the function is. */
    description: string
    icon: string
    disabled: boolean
    /** Navigation target; absent for in-page jumps and for entries that cannot be opened. */
    to?: string | { path: string, query?: Record<string, string> }
    /** In-page jump on the application detail page. */
    sectionId?: string
    /** Control inside that section to focus instead of its heading. */
    focusTarget?: string
    destinationId: string
}

export interface FunctionPaletteGroup {
    id: typeof FUNCTION_PALETTE_GROUP_ID | typeof FUNCTION_PALETTE_DENIED_GROUP_ID
    label: string
    items: FunctionPaletteItem[]
}

export const FUNCTION_PALETTE_GROUP_ID = 'functions';
const DENIED_REASON_KEYS: Record<FunctionDeniedReason, string> = {
    'staff': 'access.reasons.staff',
    'admin': 'access.reasons.admin',
    'platform-admin': 'access.reasons.platformAdmin',
    'municipality': 'access.reasons.municipality',
    'organisation': 'access.reasons.organisation',
    'form-create': 'errors.schema.writeForbidden'
};
export const FUNCTION_PALETTE_DENIED_GROUP_ID = 'functions-unavailable';
export const FUNCTION_PALETTE_MAX_RESULTS = 8;

export interface FunctionPaletteOptions {
    query: string
    access: FunctionSearchAccess
    translate: (key: string, params?: Record<string, string>) => string
    /** Resolves an admin path below the current workspace (`workspaceRoute`). */
    resolveAdminPath: (path: string) => string
    citizenViewPath: string
    profilePath: string
    /**
     * Section ids present on the open application page, or `null` when no
     * application detail page is open.
     */
    applicationSections: ReadonlySet<string> | null
    /**
     * A sentence a card of the open application states about itself (`data-function-search-note`), shown at
     * its entry instead of the description: the entry "Antragsdaten" names why editing is locked, as the card does.
     */
    applicationSectionNotes?: ReadonlyMap<string, string>
    destinations?: readonly FunctionDestination[]
}

function resolveTarget(destination: FunctionDestination, options: FunctionPaletteOptions): FunctionPaletteItem['to'] {
    const target = destination.target;
    if (target.kind === 'citizen-view') return options.citizenViewPath;
    if (target.kind === 'profile') return options.profilePath;
    const path = options.resolveAdminPath(target.path);
    return target.query ? { path, query: { ...target.query } } : path;
}

/**
 * Where an entry lives. An entry of an open application, seen while no application is open, says what to do
 * first ("Erst einen Antrag öffnen, dann ..."), not a place the person is not at.
 */
function whereLine(destination: FunctionDestination, translate: FunctionPaletteOptions['translate'], awayFromApplication = false): string | null {
    if (!destination.where) return null;
    const params: Record<string, string> = {};
    for (const [name, key] of Object.entries(destination.where.params ?? {})) {
        params[name] = translate(key);
    }
    const key = awayFromApplication && destination.context === 'application' ? `${destination.where.key}Away` : destination.where.key;
    return translate(key, params);
}

/**
 * Builds the two function-search groups for a query:
 * "Seiten und Funktionen" (allowed, best first, at most eight) and
 * "Für Ihre Rolle nicht verfügbar" (matches the person may not open, disabled).
 * With an empty query there are no groups at all.
 */
export function buildFunctionPaletteGroups(options: FunctionPaletteOptions): FunctionPaletteGroup[] {
    if (tokens(options.query).length === 0) return [];

    const { translate, access } = options;
    const destinations = options.destinations ?? functionDestinations();
    const onApplicationPage = options.applicationSections !== null;

    /**
     * `tier` breaks a tie of the score: on an application page a card of the
     * open application (0) comes before a page elsewhere (1), and a card this
     * application does not have (2) comes last.
     */
    type Scored = { item: FunctionPaletteItem, score: number, tier: number, index: number };
    const allowed: Scored[] = [];
    const denied: Scored[] = [];

    destinations.forEach((destination, index) => {
        const label = translate(destination.labelKey);
        const description = translate(destination.descriptionKey);
        const where = whereLine(destination, translate, !onApplicationPage);
        const keywords = splitKeywords(translate(destination.keywordsKey));
        const reason = deniedReason(destination, access);
        const inPage = destination.context === 'application' && onApplicationPage && Boolean(destination.sectionId);

        // Away from its object a context function says only where it is;
        // every other entry with a place names the place first.
        const shownLine = !where || inPage
            ? description
            : destination.context
                ? where
                : translate('functionSearch.placeAndText', { place: where, text: description });
        const score = scoreEntry({ label, secondLine: `${shownLine} ${description}`, keywords }, options.query);
        if (score === null) return;

        if (reason) {
            denied.push({
                index,
                score,
                tier: 1,
                item: {
                    id: `function:${destination.id}`,
                    destinationId: destination.id,
                    label,
                    description: translate(DENIED_REASON_KEYS[reason]),
                    icon: destination.icon,
                    disabled: true
                }
            });
            return;
        }

        if (inPage) {
            const present = options.applicationSections!.has(destination.sectionId!);
            const note = present ? options.applicationSectionNotes?.get(destination.sectionId!) : undefined;
            allowed.push({
                index,
                score,
                tier: present ? 0 : 2,
                item: {
                    id: `function:${destination.id}`,
                    destinationId: destination.id,
                    label,
                    description: present ? (note || description) : translate('functionSearch.notOnThisApplication'),
                    icon: destination.icon,
                    disabled: !present,
                    ...(present ? { sectionId: destination.sectionId } : {}),
                    ...(present && destination.focusTarget ? { focusTarget: destination.focusTarget } : {})
                }
            });
            return;
        }

        allowed.push({
            index,
            score,
            tier: 1,
            item: {
                id: `function:${destination.id}`,
                destinationId: destination.id,
                label,
                description: shownLine,
                icon: destination.icon,
                disabled: false,
                to: resolveTarget(destination, options)
            }
        });
    });

    const byRank = (a: Scored, b: Scored) => a.score - b.score || a.tier - b.tier || a.index - b.index;
    const groups: FunctionPaletteGroup[] = [];

    if (allowed.length > 0) {
        groups.push({
            id: FUNCTION_PALETTE_GROUP_ID,
            label: translate('functionSearch.groups.functions'),
            items: allowed.sort(byRank).slice(0, FUNCTION_PALETTE_MAX_RESULTS).map(entry => entry.item)
        });
    }
    if (denied.length > 0) {
        groups.push({
            id: FUNCTION_PALETTE_DENIED_GROUP_ID,
            label: translate('functionSearch.groups.unavailable'),
            items: denied.sort(byRank).slice(0, FUNCTION_PALETTE_MAX_RESULTS).map(entry => entry.item)
        });
    }
    return groups;
}

/** True on `/…/admin/applications/<id>` (not the print view). */
export function isApplicationDetailPath(path: string): boolean {
    return /\/admin\/applications\/[^/]+\/?$/u.test(path);
}

export function presentApplicationSections(root: Pick<Document, 'getElementById'>): Set<string> {
    const present = new Set<string>();
    for (const id of Object.values(APPLICATION_SECTION_IDS)) {
        if (root.getElementById(id)) present.add(id);
    }
    return present;
}

/** Notes the cards of the open application state about themselves (`data-function-search-note`). */
export function applicationSectionNotes(root: Pick<Document, 'getElementById'>): Map<string, string> {
    const notes = new Map<string, string>();
    for (const id of Object.values(APPLICATION_SECTION_IDS)) {
        const note = root.getElementById(id)?.getAttribute('data-function-search-note')?.trim();
        if (note) notes.set(id, note);
    }
    return notes;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The control an entry names, if the section shows it and it can take focus. */
function namedControl(section: HTMLElement, focusTarget: string | undefined): HTMLElement | null {
    if (!focusTarget) return null;
    const control = section.querySelector<HTMLElement>(`[data-function-search-target="${focusTarget}"]`);
    if (!control || control.matches(':disabled, [aria-disabled="true"]')) return null;
    return control;
}

/**
 * Scrolls a section of the current page into view and moves focus to the
 * control the entry names, else to the section heading (made focusable for
 * this one jump) or, without heading, its first control. Returns false when
 * the section is not on the page.
 */
export function focusPageSection(
    root: Pick<Document, 'getElementById'>,
    sectionId: string,
    options: { reducedMotion?: boolean, focusTarget?: string } = {}
): boolean {
    const section = root.getElementById(sectionId);
    if (!section) return false;

    const control = namedControl(section, options.focusTarget);
    const heading = control ? null : section.querySelector<HTMLElement>('h1, h2, h3, h4');
    const target = control ?? heading ?? section.querySelector<HTMLElement>(FOCUSABLE) ?? section;
    if ((target === heading || target === section) && !target.hasAttribute('tabindex')) {
        target.setAttribute('tabindex', '-1');
        target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true });
    }

    section.scrollIntoView({ block: 'start', behavior: options.reducedMotion ? 'auto' : 'smooth' });
    target.focus({ preventScroll: true });
    return true;
}
