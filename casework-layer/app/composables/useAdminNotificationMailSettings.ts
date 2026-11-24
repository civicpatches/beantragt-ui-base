import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
import { staffFetch } from '~~/casework-layer/app/composables/api/useStaffSessionFetch';
import { parseSettingsError } from '~/composables/useSettingsError';

export type NotificationMailCategory = 'citizen' | 'staff';
export type NotificationMailFieldKey = 'subject' | 'body';
export type NotificationMailEditorLanguage = 'default' | string;

export interface NotificationMailText {
    subject?: string
    body?: string
}

export interface NotificationMailTemplateSection {
    id?: string
    enabled?: boolean
    lockedEnabled?: boolean
    requiredTokens?: string[]
    default?: NotificationMailText
    translations?: Record<string, NotificationMailText>
}

export interface NotificationMailSettingsResponse {
    section: string
    data: {
        templates?: Record<string, NotificationMailTemplateSection>
    }
}

export interface EmailTemplate {
    id: string
    label: string
    description: string
    subject: string
    body: string
    enabled: boolean
    lockedEnabled: boolean
    requiredTokens: string[]
    translations: Record<string, NotificationMailText>
    category: NotificationMailCategory
}

const SUBJECT_FIELD_ID = 'settings-email-subject';
const BODY_FIELD_ID = 'settings-email-body';

const TEMPLATE_ORDER = [
    'application_confirmation_request',
    'application_confirmation',
    'status_change',
    'approval',
    'rejection',
    'application_comment_staff',
    'external_response_available',
    'new_application_alert',
    'assignment_alert',
    'delegation_alert',
    'application_comment_citizen',
    'deadline_alert',
    'resubmission_reminder',
    'escalation_alert'
];

const TEMPLATE_CATEGORIES: Record<string, NotificationMailCategory> = {
    application_confirmation_request: 'citizen',
    application_confirmation: 'citizen',
    status_change: 'citizen',
    approval: 'citizen',
    rejection: 'citizen',
    application_comment_staff: 'citizen',
    external_response_available: 'citizen',
    new_application_alert: 'staff',
    assignment_alert: 'staff',
    delegation_alert: 'staff',
    application_comment_citizen: 'staff',
    deadline_alert: 'staff',
    resubmission_reminder: 'staff',
    escalation_alert: 'staff'
};

const TOKEN_KEYS = [
    '@full_name',
    '@reference_number',
    '@form_title',
    '@application_date',
    '@new_status',
    '@old_status',
    '@status_internal',
    '@escalation_days',
    '@due_date',
    '@assigned_to',
    '@assigned_team',
    '@org_name',
    '@rejection_reason',
    '@citizen_application_url',
    '@admin_application_url',
    '@confirmation_url'
];

// Applicants never see staff names: the backend blanks @assigned_to in
// citizen mails, so the picker does not offer it there.
const STAFF_ONLY_TOKEN_KEYS = new Set(['@assigned_to']);

function templateTokenKeys(category: NotificationMailCategory): string[] {
    return category === 'staff'
        ? [...TOKEN_KEYS]
        : TOKEN_KEYS.filter(token => !STAFF_ONLY_TOKEN_KEYS.has(token));
}

function fallbackTemplateLabel(id: string): string {
    return id
        .split('_')
        .filter(Boolean)
        .map(part => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
        .join(' ');
}

function templateSortIndex(id: string): number {
    const index = TEMPLATE_ORDER.indexOf(id);
    return index === -1 ? TEMPLATE_ORDER.length : index;
}

function normalizeStringList(value: unknown): string[] {
    return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string')
        : [];
}

function requiredTokenBodyOnly(templateId: string, token: string): boolean {
    return templateId === 'application_confirmation_request' && token === '@confirmation_url';
}

function textContainsToken(text: string, token: string): boolean {
    return text.includes(token);
}

function tokenFromDetail(detail: string | null): string | null {
    if (!detail) return null;
    const match = detail.match(/required token\s+([@a-z0-9_]+)/iu);
    return match?.[1] ?? null;
}

interface NotificationMailErrorTarget {
    field: NotificationMailFieldKey
    language: NotificationMailEditorLanguage
}

function fieldFromErrorPath(field: string | null, templateId: string): NotificationMailErrorTarget | null {
    if (!field || !field.startsWith(`templates.${templateId}.`)) return null;

    const path = field.slice(`templates.${templateId}.`.length);
    const defaultMatch = path.match(/^default(?:\.(subject|body))?$/u);
    if (defaultMatch) {
        return {
            field: (defaultMatch[1] ?? 'body') as NotificationMailFieldKey,
            language: 'default'
        };
    }

    const translationMatch = path.match(/^translations\.([^.]+)(?:\.(subject|body))?$/u);
    if (translationMatch?.[1]) {
        return {
            field: (translationMatch[2] ?? 'body') as NotificationMailFieldKey,
            language: translationMatch[1]
        };
    }

    return null;
}

function normalizedTranslationText(text: NotificationMailText | undefined): NotificationMailText | null {
    const normalized: NotificationMailText = {};
    if (text?.subject?.trim()) normalized.subject = text.subject;
    if (text?.body?.trim()) normalized.body = text.body;
    return Object.keys(normalized).length > 0 ? normalized : null;
}

function normalizedTranslations(
    translations: Record<string, NotificationMailText>,
    fallback: NotificationMailText
): Record<string, NotificationMailText> {
    return Object.fromEntries(
        Object.entries(translations)
            .sort(([a], [b]) => a.localeCompare(b))
            .flatMap(([langcode, text]) => {
                const normalized = normalizedTranslationText(text);
                if (!normalized) return [];
                const subject = normalized.subject ?? fallback.subject;
                const body = normalized.body ?? fallback.body;
                if (!subject?.trim() || !body?.trim()) return [];
                return [[langcode, { subject, body }] as const];
            })
    );
}

export function useAdminNotificationMailSettings() {
    const { t, te, locales } = useI18n();
    const toast = useToast();
    const workspaceContext = useWorkspaceContext();
    const {
        currentWorkspace,
        selectedWorkspaceSlug,
        selectedWorkspaceKey,
        workspaceRoute,
        loadWorkspaces
    } = workspaceContext;

    const templates = ref<EmailTemplate[]>([]);
    const isLoading = ref(true);
    const loadError = ref<string | null>(null);
    const permissionError = ref(false);
    const activeTemplateId = ref<string | null>(null);
    const activeEditorLanguage = ref<NotificationMailEditorLanguage>('default');
    const editDefault = reactive<Required<NotificationMailText>>({ subject: '', body: '' });
    const editTranslations = reactive<Record<string, Required<NotificationMailText>>>({});
    const isToggling = ref(false);
    const isSaving = ref(false);
    const saveError = ref<string | null>(null);
    const fieldErrorsByLanguage = reactive<Record<string, Partial<Record<NotificationMailFieldKey, string>>>>({});

    const fieldErrors = reactive<Record<NotificationMailFieldKey, string | undefined>>({
        subject: undefined,
        body: undefined
    });

    function editableTranslation(langcode: string): Required<NotificationMailText> {
        editTranslations[langcode] ??= { subject: '', body: '' };
        return editTranslations[langcode];
    }

    const editSubject = computed({
        get: () => activeEditorLanguage.value === 'default'
            ? editDefault.subject
            : editableTranslation(activeEditorLanguage.value).subject,
        set: (value: string) => {
            if (activeEditorLanguage.value === 'default') {
                editDefault.subject = value;
            } else {
                editableTranslation(activeEditorLanguage.value).subject = value;
            }
            clearActiveFieldError('subject');
        }
    });

    const editBody = computed({
        get: () => activeEditorLanguage.value === 'default'
            ? editDefault.body
            : editableTranslation(activeEditorLanguage.value).body,
        set: (value: string) => {
            if (activeEditorLanguage.value === 'default') {
                editDefault.body = value;
            } else {
                editableTranslation(activeEditorLanguage.value).body = value;
            }
            clearActiveFieldError('body');
        }
    });

    const jurisdictionIdentifier = computed(() => {
        const workspace = currentWorkspace.value;
        if (workspace?.jurisdictionSlug) return workspace.jurisdictionSlug;
        if (workspace?.jurisdictionInternalId !== null && workspace?.jurisdictionInternalId !== undefined) {
            return String(workspace.jurisdictionInternalId);
        }
        return selectedWorkspaceSlug.value || null;
    });

    const activeTemplate = computed(() => {
        if (!activeTemplateId.value) return null;
        return templates.value.find(template => template.id === activeTemplateId.value) ?? null;
    });

    const activeRequiredTokens = computed(() => activeTemplate.value?.requiredTokens ?? []);

    const editorLanguages = computed(() => {
        const configuredLocales = Array.isArray(locales.value) ? locales.value : [];
        const translationLanguages = configuredLocales.flatMap((locale) => {
            if (typeof locale === 'string') {
                return [{ label: locale, value: locale }];
            }
            if (!locale || typeof locale.code !== 'string') return [];
            return [{
                label: typeof locale.name === 'string' ? locale.name : locale.code,
                value: locale.code
            }];
        });

        return [
            {
                label: t('admin.settings.email.defaultLanguage'),
                value: 'default'
            },
            ...translationLanguages.map(language => ({
                ...language,
                chip: hasTranslationOverride(language.value)
                    ? { color: 'primary' as const }
                    : undefined,
                description: hasTranslationOverride(language.value)
                    ? t('admin.settings.email.translationOverride')
                    : undefined
            }))
        ];
    });

    const activeEditorLanguageLabel = computed(() =>
        editorLanguages.value.find(language => language.value === activeEditorLanguage.value)?.label
        ?? activeEditorLanguage.value
    );

    const activeRequiredTokenItems = computed(() =>
        activeRequiredTokens.value.map(token => ({
            key: token,
            missing: activeTemplate.value ? isTokenMissing(activeTemplate.value, token) : false
        }))
    );

    const templateVariables = computed(() => {
        const seen = new Set<string>();
        return [...activeRequiredTokens.value, ...templateTokenKeys(activeTemplate.value?.category ?? 'citizen')]
            .filter((token) => {
                if (seen.has(token)) return false;
                seen.add(token);
                return true;
            })
            .map(token => ({
                key: token,
                description: t(`admin.settings.email.tokens.${token.slice(1)}`),
                required: activeRequiredTokens.value.includes(token),
                missing: activeTemplate.value ? isTokenMissing(activeTemplate.value, token) : false
            }));
    });

    // Replaces `@placeholder` with its sample value so staff see a finished
    // mail before saving. Unknown placeholders stay as typed.
    function fillSamples(text: string): string {
        return text.replace(/@([a-z][a-z_]*)/gu, (match, name: string) => {
            const key = `admin.settings.email.previewSamples.${name}`;
            return te(key) ? t(key) : match;
        });
    }

    const previewSubject = computed(() => fillSamples(editSubject.value));
    const previewBody = computed(() => fillSamples(editBody.value));

    const citizenTemplates = computed(() =>
        templates.value.filter(template => template.category === 'citizen')
    );

    const staffTemplates = computed(() =>
        templates.value.filter(template => template.category === 'staff')
    );

    const isTemplateDirty = computed(() => {
        if (!activeTemplate.value) return false;
        return editDefault.subject !== activeTemplate.value.subject
          || editDefault.body !== activeTemplate.value.body
          || JSON.stringify(normalizedTranslations(editTranslations, editDefault))
          !== JSON.stringify(normalizedTranslations(activeTemplate.value.translations, activeTemplate.value));
    });

    function syncVisibleFieldErrors() {
        const activeErrors = fieldErrorsByLanguage[activeEditorLanguage.value];
        fieldErrors.subject = activeErrors?.subject;
        fieldErrors.body = activeErrors?.body;
    }

    function clearActiveFieldError(field: NotificationMailFieldKey) {
        const errors = fieldErrorsByLanguage[activeEditorLanguage.value];
        if (errors) errors[field] = undefined;
        fieldErrors[field] = undefined;
        saveError.value = null;
    }

    function clearFieldErrors() {
        for (const language of Object.keys(fieldErrorsByLanguage)) {
            Reflect.deleteProperty(fieldErrorsByLanguage, language);
        }
        fieldErrors.subject = undefined;
        fieldErrors.body = undefined;
        saveError.value = null;
    }

    function selectEditorLanguage(language: NotificationMailEditorLanguage) {
        activeEditorLanguage.value = language;
        syncVisibleFieldErrors();
        saveError.value = null;
    }

    function hasTranslationOverride(langcode: string): boolean {
        return normalizedTranslationText(editTranslations[langcode]) !== null;
    }

    async function ensureJurisdictionIdentifier(): Promise<string | null> {
        if (!jurisdictionIdentifier.value) {
            await loadWorkspaces();
        }
        return jurisdictionIdentifier.value;
    }

    function templateLabel(id: string): string {
        const key = `admin.settings.email.templates.${id}.label`;
        const translated = t(key);
        return translated === key ? fallbackTemplateLabel(id) : translated;
    }

    function templateDescription(id: string): string {
        const key = `admin.settings.email.templates.${id}.description`;
        const translated = t(key);
        return translated === key ? '' : translated;
    }

    function mapTemplates(data: NotificationMailSettingsResponse['data']): EmailTemplate[] {
        return Object.entries(data.templates ?? {})
            .map(([id, template]) => ({
                id,
                label: templateLabel(id),
                description: templateDescription(id),
                subject: template.default?.subject ?? '',
                body: template.default?.body ?? '',
                enabled: template.lockedEnabled ? true : Boolean(template.enabled),
                lockedEnabled: Boolean(template.lockedEnabled),
                requiredTokens: normalizeStringList(template.requiredTokens),
                translations: template.translations ?? {},
                category: TEMPLATE_CATEGORIES[id] ?? 'citizen'
            }))
            .sort((a, b) => templateSortIndex(a.id) - templateSortIndex(b.id) || a.label.localeCompare(b.label));
    }

    function syncEditorFromActive() {
        const template = activeTemplate.value;
        editDefault.subject = template?.subject ?? '';
        editDefault.body = template?.body ?? '';
        for (const langcode of Object.keys(editTranslations)) {
            Reflect.deleteProperty(editTranslations, langcode);
        }
        for (const [langcode, text] of Object.entries(template?.translations ?? {})) {
            editTranslations[langcode] = {
                subject: text.subject ?? '',
                body: text.body ?? ''
            };
        }
        activeEditorLanguage.value = 'default';
        clearFieldErrors();
    }

    function applySection(data: NotificationMailSettingsResponse['data'], options: { syncEditor?: boolean } = {}) {
        templates.value = mapTemplates(data);
        if (!templates.value.some(template => template.id === activeTemplateId.value)) {
            activeTemplateId.value = templates.value[0]?.id ?? null;
        }
        if (options.syncEditor) {
            syncEditorFromActive();
        }
    }

    async function loadTemplates() {
        const requestJurisdiction = await ensureJurisdictionIdentifier();
        isLoading.value = true;
        loadError.value = null;
        permissionError.value = false;
        saveError.value = null;

        if (!requestJurisdiction) {
            templates.value = [];
            activeTemplateId.value = null;
            loadError.value = t('admin.settings.selectWorkspace');
            isLoading.value = false;
            return;
        }

        try {
            const response = await staffFetch<NotificationMailSettingsResponse>(
                `/api/admin/jurisdictions/${encodeURIComponent(requestJurisdiction)}/settings/notification_mail`
            );
            applySection(response.data, { syncEditor: true });
        } catch (e: unknown) {
            const { status, detail } = parseSettingsError(e);
            templates.value = [];
            activeTemplateId.value = null;
            if (status === 403) {
                permissionError.value = true;
                loadError.value = null;
                return;
            }
            if (status === 401) return;
            loadError.value = detail || t('admin.settings.email.loadError');
        } finally {
            isLoading.value = false;
        }
    }

    function selectTemplate(id: string) {
        activeTemplateId.value = id;
        syncEditorFromActive();
    }

    function canToggleTemplate(template: EmailTemplate): boolean {
        return !template.lockedEnabled;
    }

    function templateToggleLabel(template: EmailTemplate): string {
        if (template.lockedEnabled) return t('admin.settings.email.lockedEnabled');
        const action = template.enabled
            ? t('admin.settings.email.deactivateTemplate')
            : t('admin.settings.email.activateTemplate');
        return `${action} ${template.label}`;
    }

    async function setTemplateEnabled(id: string, enabled: boolean) {
        const template = templates.value.find(item => item.id === id);
        if (!template || template.enabled === enabled) return;
        if (template.lockedEnabled) {
            template.enabled = true;
            toast.add({
                title: t('admin.settings.email.lockedEnabled'),
                color: 'neutral'
            });
            return;
        }

        const requestJurisdiction = await ensureJurisdictionIdentifier();
        if (!requestJurisdiction) {
            toast.add({
                title: t('admin.settings.selectWorkspace'),
                icon: 'i-lucide-circle-x',
                color: 'error'
            });
            return;
        }

        const previousEnabled = template.enabled;
        template.enabled = enabled;
        isToggling.value = true;
        try {
            const response = await staffFetch<NotificationMailSettingsResponse>(
                `/api/admin/jurisdictions/${encodeURIComponent(requestJurisdiction)}/settings/notification_mail`,
                {
                    method: 'PATCH',
                    body: {
                        data: {
                            templates: {
                                [id]: { enabled }
                            }
                        }
                    }
                }
            );
            applySection(response.data);
            toast.add({
                title: enabled
                    ? t('admin.settings.email.templateActivated')
                    : t('admin.settings.email.templateDeactivated'),
                color: enabled ? 'success' : 'neutral'
            });
        } catch (error: unknown) {
            template.enabled = previousEnabled;
            if (parseSettingsError(error).status === 401) return;
            toast.add({
                title: t('admin.settings.email.toggleError'),
                color: 'error'
            });
        } finally {
            isToggling.value = false;
        }
    }

    function editorTextForLanguage(template: EmailTemplate, language: NotificationMailEditorLanguage): Required<NotificationMailText> {
        if (template.id !== activeTemplateId.value) {
            return { subject: template.subject, body: template.body };
        }
        if (language === 'default') {
            return editDefault;
        }
        const translation = editableTranslation(language);
        return {
            subject: translation.subject.trim() ? translation.subject : editDefault.subject,
            body: translation.body.trim() ? translation.body : editDefault.body
        };
    }

    function isTokenMissing(
        template: EmailTemplate,
        token: string,
        language: NotificationMailEditorLanguage = activeEditorLanguage.value
    ): boolean {
        if (!template.requiredTokens.includes(token)) return false;
        const text = editorTextForLanguage(template, language);
        if (requiredTokenBodyOnly(template.id, token)) {
            return !textContainsToken(text.body, token);
        }
        return !textContainsToken(`${text.subject}\n${text.body}`, token);
    }

    function requiredTokenError(token: string): string {
        return `${t('admin.settings.email.validation.requiredTokenMissing')} ${token}`;
    }

    function validateRequiredTokens(template: EmailTemplate): boolean {
        clearFieldErrors();
        const languages: NotificationMailEditorLanguage[] = [
            'default',
            ...Object.keys(normalizedTranslations(editTranslations, editDefault))
        ];
        for (const language of languages) {
            for (const token of template.requiredTokens) {
                if (!isTokenMissing(template, token, language)) continue;
                activeEditorLanguage.value = language;
                fieldErrorsByLanguage[language] = {
                    body: requiredTokenError(token)
                };
                syncVisibleFieldErrors();
                focusField('body');
                return false;
            }
        }
        return true;
    }

    function errorForBackendDetail(field: NotificationMailFieldKey, detail: string | null): string {
        const token = tokenFromDetail(detail);
        if (token) return requiredTokenError(token);
        return detail || t(`admin.settings.email.validation.${field}Invalid`);
    }

    function applyBackendFieldError(templateId: string, field: string | null, detail: string | null): boolean {
        const target = fieldFromErrorPath(field, templateId);
        if (!target) return false;
        activeEditorLanguage.value = target.language;
        fieldErrorsByLanguage[target.language] = {
            ...fieldErrorsByLanguage[target.language],
            [target.field]: errorForBackendDetail(target.field, detail)
        };
        syncVisibleFieldErrors();
        focusField(target.field);
        return true;
    }

    function focusField(field: NotificationMailFieldKey) {
        nextTick(() => {
            if (!import.meta.client) return;
            document.getElementById(field === 'subject' ? SUBJECT_FIELD_ID : BODY_FIELD_ID)?.focus();
        });
    }

    async function handleSaveTemplate() {
        const template = activeTemplate.value;
        if (!template || isSaving.value) return;
        if (!validateRequiredTokens(template)) return;

        const requestJurisdiction = await ensureJurisdictionIdentifier();
        if (!requestJurisdiction) {
            toast.add({
                title: t('admin.settings.selectWorkspace'),
                icon: 'i-lucide-circle-x',
                color: 'error'
            });
            return;
        }

        isSaving.value = true;
        saveError.value = null;
        try {
            const response = await staffFetch<NotificationMailSettingsResponse>(
                `/api/admin/jurisdictions/${encodeURIComponent(requestJurisdiction)}/settings/notification_mail`,
                {
                    method: 'PATCH',
                    body: {
                        data: {
                            templates: {
                                [template.id]: {
                                    default: {
                                        subject: editDefault.subject,
                                        body: editDefault.body
                                    },
                                    translations: normalizedTranslations(editTranslations, editDefault)
                                }
                            }
                        }
                    }
                }
            );
            applySection(response.data, { syncEditor: true });
            toast.add({
                title: t('admin.settings.email.templateSaved'),
                color: 'success'
            });
        } catch (e: unknown) {
            const { status, field, detail } = parseSettingsError(e);
            if (status === 401) {
                return;
            } else if (!applyBackendFieldError(template.id, field, detail)) {
                saveError.value = detail || t('admin.settings.email.saveError');
            }
            toast.add({
                title: t('admin.settings.email.saveError'),
                description: saveError.value ?? undefined,
                color: 'error'
            });
        } finally {
            isSaving.value = false;
        }
    }

    watch(selectedWorkspaceKey, (next, previous) => {
        if (!previous || next === previous) return;
        loadTemplates();
    });

    onMounted(() => {
        loadTemplates();
    });

    return {
        templates,
        citizenTemplates,
        staffTemplates,
        isLoading,
        loadError,
        permissionError,
        activeTemplateId,
        activeTemplate,
        activeEditorLanguage,
        activeEditorLanguageLabel,
        editorLanguages,
        activeRequiredTokens,
        activeRequiredTokenItems,
        editSubject,
        editBody,
        fieldErrors,
        isToggling,
        isSaving,
        saveError,
        isTemplateDirty,
        templateVariables,
        previewSubject,
        previewBody,
        hasTranslationOverride,
        workspaceRoute,
        subjectFieldId: SUBJECT_FIELD_ID,
        bodyFieldId: BODY_FIELD_ID,
        jurisdictionIdentifier,
        loadTemplates,
        selectTemplate,
        selectEditorLanguage,
        canToggleTemplate,
        templateToggleLabel,
        setTemplateEnabled,
        handleSaveTemplate
    };
}
