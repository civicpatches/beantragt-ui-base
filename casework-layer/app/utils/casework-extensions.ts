import { registerApplicationEventKinds } from '~/utils/application-events';
/**
 * What the open case-work shell registers in the staff registries: sidebar entries, settings cards, form links and case actions, the
 * open function-search destinations and the path rule of the application list. Called by
 * `plugins/casework-extensions.ts`; moves with the shell into the case-work layer. Pro adds its part in
 * `pro-staff-extensions.ts`.
 */
import FimEditorAction from '../components/admin/FimEditorAction.vue';
import FormListRowAction from '../components/admin/FormListRowAction.vue';
import CaseDocgenSection from '../components/admin/CaseDocgenSection.vue';
import CaseSupplementsSection from '../components/admin/CaseSupplementsSection.vue';
import ApplicationsExportMenu from '../components/admin/ApplicationsExportMenu.vue';
import { CASEWORK_STAFF_PATH_RULES } from './admin-access';
import { CASEWORK_FUNCTION_DESTINATIONS } from './function-search';
import { registerFormListDetailPath, registerFunctionDestinations, registerStaffNavEntries, registerStaffPathRules, registerStaffSettingsRows, registerStaffOutlet, type StaffNavEntry } from './staff-extensions';

export const CASEWORK_STAFF_NAV_ENTRIES: readonly StaffNavEntry[] = [
    {
        id: 'forms',
        order: 10,
        audience: 'admin',
        item: ({ t, workspaceRoute, routePath }) => ({
            label: t('nav.forms'),
            icon: 'i-lucide-file-text',
            to: workspaceRoute('/admin/forms'),
            active: /\/admin\/forms(?:\/|$)/iu.test(routePath)
        })
    },
    {
        id: 'formGroups',
        order: 20,
        audience: 'admin',
        item: ({ t, workspaceRoute, routePath }) => ({
            label: t('nav.formGroups'),
            icon: 'i-lucide-folder-tree',
            to: workspaceRoute('/admin/form-groups'),
            active: routePath.includes('/admin/form-groups')
        })
    },
    {
        id: 'fim',
        order: 30,
        audience: 'admin',
        item: ({ t, workspaceRoute, routePath }) => ({
            label: t('nav.fimCatalog'),
            icon: 'i-lucide-database',
            to: workspaceRoute('/admin/fim'),
            active: routePath.includes('/admin/fim')
        })
    },
    {
        id: 'applications',
        order: 50,
        audience: 'staff',
        item: ({ t, workspaceRoute, routePath }) => ({
            label: t('nav.applications'),
            icon: 'i-lucide-inbox',
            to: workspaceRoute('/admin/applications'),
            active: routePath.includes('/admin/applications')
        })
    },
    {
        id: 'settings',
        order: 100,
        audience: 'admin',
        item: ({ t, workspaceRoute, routePath }) => ({
            label: t('nav.settings'),
            icon: 'i-lucide-settings',
            to: workspaceRoute('/admin/settings'),
            active: routePath.includes('/admin/settings')
        })
    }
];

/** Registers the open part; returns the function that removes it again. */
export function registerCaseworkStaffExtensions(): () => void {
    const removers = [
        registerApplicationEventKinds(['scan', 'message', 'reply', 'assigned', 'release', 'documents']),
        registerStaffSettingsRows([
            { key: 'content', group: 'citizen', order: 20 },
            { key: 'email', group: 'processing', order: 30, municipalityOnly: true },
            { key: 'decisions', group: 'processing', order: 20 },
            { key: 'workflow', group: 'processing', order: 10 },
            { key: 'branding', group: 'citizen', order: 10 },
            { key: 'embed', group: 'citizen', order: 40 },
            { key: 'general', group: 'operations', order: 10 },
            { key: 'tenant', group: 'operations', order: 20 }
        ]),
        registerStaffNavEntries(CASEWORK_STAFF_NAV_ENTRIES),
        registerFunctionDestinations(CASEWORK_FUNCTION_DESTINATIONS),
        registerStaffPathRules(CASEWORK_STAFF_PATH_RULES),
        registerStaffOutlet('fim-imported-actions', FimEditorAction),
        registerStaffOutlet('form-list-row-actions', FormListRowAction),
        registerFormListDetailPath(formId => `/admin/forms/${formId}`),
        registerStaffOutlet('case-docgen', CaseDocgenSection),
        registerStaffOutlet('case-supplements', CaseSupplementsSection),
        registerStaffOutlet('case-list-actions', ApplicationsExportMenu)
    ];
    return () => removers.forEach(remove => remove());
}
