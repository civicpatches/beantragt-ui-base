<script setup lang="ts">
import { inject, nextTick, useId } from 'vue';
import type { DropdownMenuItem } from '@nuxt/ui';
import AppDocumentPreview from '~/components/app/DocumentPreview.vue';
import { documentPreviewExtensionKey } from '~/utils/document-preview-extension';
import ApplicationSectionEventPill from '~/components/ApplicationSectionEventPill.vue';
import DocumentViewRetry from './DocumentViewRetry.vue';
/**
 * Decision documents of one application: draft from a released Word
 * template, revise in Word, mandatory PDF/A preview, joint release.
 *
 * Release rule (enforced by Drupal, mirrored here): only the PDF/A made from
 * the current DOCX, veraPDF-compliant and opened by this person can be
 * released. Browser previews confirm received bytes. The Pro viewer waits for a
 * visible rendered page. Drupal records the view for the SHA-256 of the current preview. A release that was started but not
 * finished ("releasing") can only be finished, never changed.
 */
import type { RouteLocationRaw } from 'vue-router';
import type { DocgenCaseOverview, DocgenDocument, DocgenReleaseResult, DocgenResponse, DocgenVariables } from '~/types/docgen';
import { formatDateTime } from '~/composables/useFormatters';
import { staffDocumentReviewCopy } from '../../utils/staff-extensions';
import type { DocumentReviewContext, DocumentReviewFile } from '../../utils/document-review';
import { staffFetch } from '~~/casework-layer/app/composables/api/useStaffSessionFetch';
import { useDocgenMessages } from '../../composables/useDocgenMessages';
import { DOCGEN_MAX_UPLOAD_BYTES, docgenErrorInfo, docgenPlaceholderLabel, docgenRetryAfter, docgenTemplateSlug, docgenVariableLabel, fetchDocgenFile, fileToBase64, releasableDocuments, saveBlob, sha256Hex } from '../../utils/docgen';

const props = withDefaults(defineProps<{
    applicationId: string
    formId?: string | null
    documentId?: string
    byAgent?: boolean | null
    /** Where decisions of this form are set up (editor, panel "Bescheide"); only for roles that may open it. */
    setupTo?: RouteLocationRaw | null
}>(), { byAgent: null, setupTo: null });
/**
 * `requestWay` tells the page whether a Nachforderung can be written here:
 * the template route with a released template of purpose "Nachforderung".
 * `null` while unknown, for example when the role may not see this card.
 */
const emit = defineEmits<{ busy: [pending: boolean], released: [], requestWay: [way: 'available' | 'missing' | null] }>();
const { t, locale } = useI18n();
const reviewCopy = staffDocumentReviewCopy();
const toast = useToast();
const documentViewer = inject(documentPreviewExtensionKey, null);
const { withWorkspaceQuery, selectedWorkspaceKey } = useWorkspaceContext();
const { docgenMessage, codeText } = useDocgenMessages();

const overview = shallowRef<DocgenCaseOverview | null>(null);
const hidden = ref(false);
const loading = ref(false);
const loadError = ref('');
const actionError = ref('');
/** Errors of actions on one document, shown under that document's actions. */
const documentErrors = reactive(new Map<string, string>());
const pending = ref<string | null>(null);
const selectedTemplateId = ref<string | null>(null);
const draftTitle = ref('');
const createExpanded = ref(false);
const cooldownUntil = ref(0);
const now = ref(Date.now());
const previews = reactive(new Map<string, DocumentReviewFile & { sha256?: string | null, revision: number }>());
const viewErrors = reactive(new Map<string, string>());
const viewRequests = reactive(new Set<string>());

function samePreview(document: DocgenDocument | undefined, file: { sha256?: string | null, revision: number }) {
    return document?.preview?.current && document.preview.sha256 === file.sha256 && document.docx.revision === file.revision;
}
/** Cover sheets opened here: blob URL plus the hash it belongs to (Nachreichung). */
const coverPreviews = reactive(new Map<string, DocumentReviewFile & { sha256: string }>());
const releaseOpen = ref(false);
const releaseSelection = ref<string[]>([]);
const discardId = ref<string | null>(null);
let discardTrigger: HTMLElement | null = null;
const rerenderId = ref<string | null>(null);
const uploadTarget = ref<string | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
let sequence = 0;
let reviewMounted = true;
// The retained review can be removed by a workspace change while a request is in flight.
// Legacy application-page orchestration is deliberately unchanged.
function reviewScope() {
    const workspace = selectedWorkspaceKey.value;
    const applicationId = props.applicationId;
    return () => !props.documentId || (reviewMounted && workspace === selectedWorkspaceKey.value && applicationId === props.applicationId);
}
const previewAreaId = useId();
const createAnotherId = useId();
let ticker: ReturnType<typeof setInterval> | null = null;

watch(pending, value => emit('busy', value !== null), { flush: 'sync' });

const base = computed(() => `/api/admin/applications/${props.applicationId}/docgen`);
const documents = computed(() => props.documentId ? (overview.value?.documents ?? []).filter(document => document.id === props.documentId) : overview.value?.documents ?? []);
const variables = shallowRef<DocgenVariables['variables']>([]);

function missingPlaceholders(document: DocgenDocument) {
    return document.missing.length ? document.missing : document.renderedMissing;
}

// This optional catalogue is permission-scoped separately from the case.
const variablesFormId = computed(() =>
    !props.documentId && documents.value.some(document => document.state === 'draft' && missingPlaceholders(document).length > 0)
        ? props.formId
        : null
);
watch([variablesFormId, selectedWorkspaceKey], async ([formId], _previous, onCleanup) => {
    variables.value = [];
    if (!formId) return;
    let current = true;
    onCleanup(() => {
        current = false;
    });
    try {
        const result = await staffFetch<DocgenResponse<DocgenVariables>>(`/api/admin/docgen/forms/${formId}/variables`, { query: withWorkspaceQuery() });
        if (current) variables.value = result.data.variables;
    } catch {
        // The alert can use readable fallback labels without catalogue access.
    }
});

const placeholderLabels = computed(() => new Map(
    variables.value.flatMap(variable => [variable, ...(variable.children ?? [])])
        .map(variable => [variable.tag, docgenVariableLabel(variable, locale.value)] as const)
));

function placeholderLabel(tag: string) {
    const label = placeholderLabels.value.get(tag) || (tag === 'nachforderung.deckblatt_hinweis' ? t('docgenUi.case.coverSheetPlaceholder') : undefined);
    return docgenPlaceholderLabel(tag, label, locale.value) || t('docgenUi.case.unnamedPlaceholder');
}

function placeholderList(tags: string[]) {
    return new Intl.ListFormat(locale.value).format(tags.map(placeholderLabel));
}

function visibleReleaseBlockers(document: DocgenDocument) {
    if (document.preview) return document.releaseBlockers;
    return document.releaseBlockers.filter(
        code => code !== 'docgen.deadline_outdated' && code !== 'docgen.preview_stale'
    );
}

function documentCreated(document: DocgenDocument) {
    const name = document.createdBy?.trim();
    const date = timestamp(document.createdAt);
    // Drupal's RenderDataBuilder recognises accounts named agent.* the same way.
    if (name && /^agent\./iu.test(name)) return t('docgenUi.case.createdAutomatically', { date });
    return name ? t('docgenUi.case.createdBy', { name, date }) : t('docgenUi.case.createdAt', { date });
}
const hasDrafts = computed(() => documents.value.some(document => document.state === 'draft'));
const templates = computed(() => overview.value?.templates ?? []);
const route = computed(() => overview.value?.route ?? 'none');
/**
 * Application page: hidden only on 404 (no such module or case). A form without a template route shows one
 * line that says so and who can set it up, a case-system route one line that points to the responses.
 */
const visible = computed(() => props.documentId ? (loading.value || overview.value !== null || loadError.value !== '') : !hidden.value && (loadError.value !== '' || overview.value !== null));
/** One line instead of the full card: nothing to create, nothing to show. */
const compactNote = computed(() => {
    if (props.documentId) return '';
    if (!overview.value || loadError.value || documents.value.length > 0) return '';
    if (route.value === 'none') return t('docgenUi.case.noRouteShort');
    if (route.value === 'case_system') return t('docgenUi.case.caseSystem');
    return '';
});
const compact = computed(() => !props.documentId && compactNote.value !== '');
/** Show the purpose, version and whether the template closes the case in one muted line. */
function templateFacts(template: { purpose: string, version: number, closesProcedure?: boolean }): string {
    return [
        t(`docgenUi.purpose.${template.purpose}`),
        t('docgenUi.form.latestVersion', { version: template.version }),
        template.closesProcedure ? t('docgenUi.closes') : ''
    ].filter(Boolean).join(' · ');
}
function chooseTemplate(value: unknown) {
    selectedTemplateId.value = typeof value === 'string' ? value : null;
}
const templateItems = computed(() => templates.value.map(template => ({
    value: template.id,
    label: template.name,
    description: templateFacts(template)
})));
/** Nothing set up: the page names it and offers the way to set it up, or says who can. */
const showSetupWay = computed(() => compact.value && route.value === 'none');

function documentTemplate(document: DocgenDocument) {
    return t('docgenUi.case.templateVersion', { name: document.template.name || document.title, version: document.template.version });
}

function draftFacts(document: DocgenDocument) {
    return [
        t(`docgenUi.purpose.${document.purpose}`),
        document.closesProcedure ? t('docgenUi.case.closesProcedure') : '',
        documentTemplate(document)
    ].filter(Boolean).join(' · ');
}

function pdfStatus(document: DocgenDocument) {
    if (pending.value === `preview:${document.id}`) return t('docgenUi.case.previewRunning');
    if (!document.preview) return;
    if (!document.preview.current) return t('docgenUi.case.stale');
    if (!document.preview.validation?.compliant) return t('docgenUi.case.notCompliant');
}

function fileMenuItems(document: DocgenDocument): DropdownMenuItem[] {
    const items: DropdownMenuItem[] = [
        {
            'label': t('docgenUi.case.downloadDocx'),
            'icon': 'i-lucide-file-down',
            'disabled': downloadBlocked.value,
            'data-testid': 'docgen-download-docx',
            'onSelect': () => download(document, 'docx')
        },
        {
            'label': t('docgenUi.case.uploadDocx'),
            'icon': 'i-lucide-file-up',
            'disabled': blocked.value,
            'data-testid': 'docgen-upload-docx',
            'onSelect': () => chooseUpload(document)
        }
    ];
    const file = previews.get(document.id);
    if (file) {
        items.push(
            {
                label: t('docgenUi.case.downloadPdf'),
                icon: 'i-lucide-file-down',
                disabled: downloadBlocked.value,
                onSelect: () => download(document, 'pdf')
            },
            {
                label: t('docgenUi.case.newTab'),
                icon: 'i-lucide-external-link',
                href: file.url,
                external: true,
                target: '_blank',
                rel: 'noopener'
            }
        );
    }
    return items;
}

function draftMenuItems(document: DocgenDocument): DropdownMenuItem[][] {
    const discard: DropdownMenuItem = {
        label: t('docgenUi.case.discard'),
        icon: 'i-lucide-trash-2',
        color: 'error',
        disabled: blocked.value,
        onSelect: () => {
            discardTrigger = window.document.querySelector(`[data-docgen-draft-menu="${CSS.escape(`${previewAreaId}-${document.id}`)}"]`);
            discardId.value = document.id;
        }
    };
    if (!document.preview?.current) return [[discard]];
    return [[{
        'label': t('docgenUi.case.previewAgain'),
        'data-testid': 'docgen-preview',
        'disabled': blocked.value,
        'onSelect': () => createPreview(document)
    }], [discard]];
}
watch(() => [overview.value, hidden.value] as const, () => {
    if (props.documentId) return;
    if (!overview.value) {
        emit('requestWay', null);
        return;
    }
    // Decisions from the case system: no sentence about templates, it would contradict the Bescheide line.
    if (overview.value.route === 'case_system') {
        emit('requestWay', null);
        return;
    }
    const available = overview.value.route === 'template' && overview.value.templates.some(template => template.purpose === 'request_info');
    emit('requestWay', available ? 'available' : 'missing');
}, { immediate: true });
const coolingDown = computed(() => cooldownUntil.value > now.value);
const cooldownSeconds = computed(() => Math.max(0, Math.ceil((cooldownUntil.value - now.value) / 1000)));
const blocked = computed(() => pending.value !== null || coolingDown.value);
/** Downloads only read from Drupal, so a docgen cooldown does not block them. */
const downloadBlocked = computed(() => pending.value !== null);
const releasable = computed(() => releasableDocuments(documents.value));
const maxRelease = computed(() => props.documentId ? 1 : overview.value?.maxReleaseDocuments ?? 10);
const releaseDocuments = computed(() => releasableDocuments(documents.value, releaseSelection.value[0]));
const releaseCloses = computed(() => documents.value.some(document => releaseSelection.value.includes(document.id) && document.closesProcedure));
/**
 * How the selected documents go out: a selection with an approval or
 * rejection is a decision, anything else a communication. Post means the
 * texts name the portal copy and the postal duty.
 */
const releaseGoesByPost = computed(() => {
    const delivery = overview.value?.delivery;
    if (!delivery) return false;
    const decision = documents.value.some(document => releaseSelection.value.includes(document.id) && (document.purpose === 'approval' || document.purpose === 'rejection'));
    return delivery[decision ? 'decision' : 'communication'].route === 'postal';
});
/** Selected request letters whose cover sheet goes out with them as the next document of the same response. */
const releaseCovers = computed(() => documents.value.filter(document => releaseSelection.value.includes(document.id) && document.cover));
/** One response holds at most maxReleaseDocuments PDFs, cover sheets included (docgen.release_count_invalid). */
const releasePdfLimit = computed(() => overview.value?.maxReleaseDocuments ?? 10);
const releasePdfsValid = computed(() => releaseSelection.value.length + releaseCovers.value.length <= releasePdfLimit.value);
const releaseCountValid = computed(() => releaseSelection.value.length >= 1 && releaseSelection.value.length <= maxRelease.value && releasePdfsValid.value);

function timestamp(seconds: number | null): string {
    return seconds ? formatDateTime(new Date(seconds * 1000).toISOString(), locale?.value) : '';
}

function startCooldown(seconds: number) {
    cooldownUntil.value = Date.now() + seconds * 1000;
    now.value = Date.now();
    if (ticker) clearInterval(ticker);
    ticker = setInterval(() => {
        now.value = Date.now();
        if (!coolingDown.value && ticker) {
            clearInterval(ticker);
            ticker = null;
        }
    }, 1000);
}

function fail(error: unknown, release = false, fallbackKey = 'docgenUi.case.loadError'): string {
    const retry = docgenRetryAfter(error);
    if (retry) startCooldown(retry);
    if (props.documentId && release && ['docgen.delivery_failed', 'docgen.delivery_unavailable', 'docgen.scan_failed'].includes(docgenErrorInfo(error).code ?? '')) {
        return reviewCopy?.releaseFailed ?? docgenMessage(error);
    }
    const message = docgenMessage(error, fallbackKey);
    // finalize() can also return docx_rejected; keep the detail without console-forbidden wording.
    return props.documentId && docgenErrorInfo(error).code === 'docgen.docx_rejected'
        ? message.replace(t('docgen.docx_rejected'), t('docgen.conversion_failed'))
        : message;
}

function revokePreview(id: string) {
    const url = previews.get(id)?.url;
    if (url) URL.revokeObjectURL(url);
    previews.delete(id);
    viewErrors.delete(id);
}

function revokeCover(id: string) {
    const cover = coverPreviews.get(id);
    if (cover) URL.revokeObjectURL(cover.url);
    coverPreviews.delete(id);
}

/** An opened cover sheet belongs to one hash: a re-render or a discard makes it stale. */
function coverShown(document: DocgenDocument): DocumentReviewFile | undefined {
    const cover = coverPreviews.get(document.id);
    return cover && cover.sha256 === document.cover?.sha256 ? cover : undefined;
}

async function load() {
    const current = ++sequence;
    loading.value = true;
    loadError.value = '';
    try {
        const result = await staffFetch<DocgenResponse<DocgenCaseOverview>>(base.value, { query: withWorkspaceQuery() });
        if (current !== sequence) return;
        overview.value = result.data;
        hidden.value = false;
        if (!result.data.templates.some(template => template.id === selectedTemplateId.value)) {
            selectedTemplateId.value = result.data.templates.length === 1 ? result.data.templates[0]!.id : null;
        }
        for (const id of [...previews.keys()]) {
            const document = result.data.documents.find(item => item.id === id);
            const file = previews.get(id);
            if (file && !samePreview(document, file)) revokePreview(id);
        }
        for (const [id, cover] of [...coverPreviews.entries()]) {
            const document = result.data.documents.find(item => item.id === id);
            if (document?.cover?.sha256 !== cover.sha256) revokeCover(id);
        }
    } catch (error) {
        if (current !== sequence) return;
        const info = docgenErrorInfo(error);
        // Batch review: the draft is not available here. Application page: 403 and 404 hide the card. A signed-in
        // person without the right gets 404 from Drupal (DocgenCaseController::requireCase), so no role ever saw
        // a 403 line here; 403 is left for a lost session or a refused token.
        if (props.documentId && (info.status === 403 || info.status === 404)) {
            hidden.value = false;
            overview.value = null;
            loadError.value = t('docgenUi.case.notAvailableHere');
            return;
        }
        if (info.status === 403 || info.status === 404) {
            hidden.value = true;
            overview.value = null;
            return;
        }
        overview.value = null;
        loadError.value = fail(error);
    } finally {
        if (current === sequence) {
            loading.value = false;
        }
    }
}

function replaceDocument(document: DocgenDocument) {
    const file = previews.get(document.id);
    if (file && !samePreview(document, file)) revokePreview(document.id);
    if (!overview.value) return;
    const list = overview.value.documents.some(item => item.id === document.id)
        ? overview.value.documents.map(item => item.id === document.id ? document : item)
        : [document, ...overview.value.documents];
    overview.value = { ...overview.value, documents: list };
}

/**
 * Runs one action. An error of an action on a document is shown under that
 * document's actions (the card head may be out of view); errors of the draft
 * creation and the joint release stay at the card head or in the dialog.
 */
async function run(key: string, action: () => Promise<unknown>, options: { documentId?: string, download?: boolean } = {}) {
    if (options.download ? downloadBlocked.value : blocked.value) return;
    if (props.documentId && key.startsWith('preview:')) previewFailure.value = '';
    pending.value = key;
    actionError.value = '';
    if (options.documentId) documentErrors.delete(options.documentId);
    const workspace = selectedWorkspaceKey.value;
    const applicationId = props.applicationId;
    try {
        const success = await action();
        if (workspace !== selectedWorkspaceKey.value || applicationId !== props.applicationId) return;
        if (typeof success === 'string') toast.add({ title: success, color: 'success', icon: 'i-lucide-circle-check' });
    } catch (error) {
        if (workspace !== selectedWorkspaceKey.value || applicationId !== props.applicationId) return;
        const message = fail(error, key === 'release' || key.startsWith('finish:'));
        if (props.documentId && key.startsWith('preview:')) previewFailure.value = message;
        if (options.documentId) {
            documentErrors.set(options.documentId, message);
        } else {
            actionError.value = message;
        }
        const code = docgenErrorInfo(error).code;
        if (code !== 'docgen.busy' && code !== 'docgen.rate_limited') await load();
    } finally {
        pending.value = null;
    }
}

function createDraft() {
    const templateId = selectedTemplateId.value;
    if (!templateId) return;
    void run('create', async () => {
        const result = await staffFetch<DocgenResponse<DocgenDocument>>(`${base.value}/documents`, {
            method: 'POST',
            query: withWorkspaceQuery(),
            body: { templateId, ...(draftTitle.value.trim() ? { title: draftTitle.value.trim() } : {}) }
        });
        replaceDocument(result.data);
        draftTitle.value = '';
        createExpanded.value = false;
        await nextTick();
        if (window.document.activeElement === window.document.body) window.document.getElementById(createAnotherId)?.focus();
        return t('docgenUi.case.created');
    });
}

function createPreview(document: DocgenDocument, event?: MouseEvent) {
    const current = reviewScope();
    const trigger = event?.currentTarget;
    void run(`preview:${document.id}`, async () => {
        if (!props.documentId) revokePreview(document.id);
        const result = await staffFetch<DocgenResponse<DocgenDocument>>(`${base.value}/documents/${document.id}/preview`, { method: 'POST', query: withWorkspaceQuery() });
        if (!current()) return;
        if (props.documentId) {
            revokePreview(document.id);
            viewedInSession.value = null;
        }
        replaceDocument(result.data);
        return t('docgenUi.case.previewReady');
    }, { documentId: document.id }).then(async () => {
        if (!(trigger instanceof HTMLElement)) return;
        await nextTick();
        if (trigger.isConnected && window.document.activeElement === window.document.body) trigger.focus();
    });
}

/**
 * Confirms a preview PDF that arrived completely: Drupal records the view
 * only for the hash of the current preview. A failed download confirms
 * nothing, so the release stays blocked.
 */
async function confirmViewed(document: DocgenDocument, blob: Blob, previewStillCurrent: () => boolean = () => true): Promise<void> {
    const current = reviewScope();
    // Preserve the original evaluation order: URL and workspace before hashing.
    const url = `${base.value}/documents/${document.id}/viewed`;
    const query = withWorkspaceQuery();
    const pdfSha256 = await sha256Hex(blob);
    if (!current() || !previewStillCurrent()) return;
    const result = await staffFetch<DocgenResponse<DocgenDocument>>(url, {
        method: 'POST',
        query,
        body: { pdfSha256 }
    });
    if (!current() || !previewStillCurrent()) return;
    replaceDocument(result.data);
    if (props.documentId) viewedInSession.value = { sha256: result.data.preview?.sha256 ?? '', revision: result.data.docx.revision, at: new Date().toISOString() };
}

async function acknowledgePreview(document: DocgenDocument, url: string) {
    const file = previews.get(document.id);
    if (!file || viewRequests.has(url)) return;
    const workspace = selectedWorkspaceKey.value;
    const applicationId = props.applicationId;
    const currentDocument = () => documents.value.find(item => item.id === document.id);
    const stillCurrent = () => reviewMounted && workspace === selectedWorkspaceKey.value
      && applicationId === props.applicationId && previews.get(document.id)?.url === url
      && samePreview(currentDocument(), file) === true;
    if (!stillCurrent() || currentDocument()?.preview?.viewedByYou) return;
    viewRequests.add(url);
    try {
        await confirmViewed(document, file.blob, stillCurrent);
        if (stillCurrent()) viewErrors.delete(document.id);
    } catch (error) {
        if (stillCurrent()) viewErrors.set(document.id, fail(error, false, 'docgenUi.case.viewRecordFailed'));
    } finally {
        viewRequests.delete(url);
    }
}

/** Loads the PDF/A and opens the preview for the current revision. */
function openPdf(document: DocgenDocument) {
    const workspace = selectedWorkspaceKey.value;
    const applicationId = props.applicationId;
    const revision = { sha256: document.preview?.sha256, revision: document.docx.revision };
    const current = () => reviewMounted && workspace === selectedWorkspaceKey.value && applicationId === props.applicationId
      && samePreview(documents.value.find(item => item.id === document.id), revision) === true;
    void run(`open:${document.id}`, async () => {
        const { blob } = await fetchDocgenFile(`${base.value}/documents/${document.id}/pdf`, withWorkspaceQuery(), 'bescheid.pdf');
        if (!current()) return;
        revokePreview(document.id);
        const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
        previews.set(document.id, { ...revision, blob, url });
        if (!props.documentId && document.state === 'draft') {
            await nextTick();
            if (current()) window.document.getElementById(`${previewAreaId}-${document.id}`)?.focus();
        }
        if (!documentViewer) await confirmViewed(document, blob, current);
    }, { documentId: document.id });
}

const DOWNLOAD_FALLBACK = { 'docx': 'bescheid.docx', 'pdf': 'bescheid.pdf', 'cover-pdf': 'deckblatt.pdf' } as const;

function download(document: DocgenDocument, kind: 'docx' | 'pdf' | 'cover-pdf') {
    const current = reviewScope();
    void run(`download:${kind}:${document.id}`, async () => {
        const { blob, filename } = await fetchDocgenFile(`${base.value}/documents/${document.id}/${kind}`, withWorkspaceQuery(), DOWNLOAD_FALLBACK[kind]);
        if (!current()) return;
        saveBlob(blob, filename);
        // Only the letter's PDF counts as viewed; the release rule concerns the letter.
        if (!documentViewer && kind === 'pdf' && document.state === 'draft' && document.preview?.current) await confirmViewed(document, blob);
    }, { documentId: document.id, download: true });
}

/** Embeds the cover sheet next to the letter; records no view (Drupal records none for it). */
function openCover(document: DocgenDocument) {
    const sha256 = document.cover?.sha256;
    if (!sha256) return;
    const current = reviewScope();
    void run(`cover:${document.id}`, async () => {
        const { blob } = await fetchDocgenFile(`${base.value}/documents/${document.id}/cover-pdf`, withWorkspaceQuery(), 'deckblatt.pdf');
        if (!current()) return;
        revokeCover(document.id);
        coverPreviews.set(document.id, { url: URL.createObjectURL(new Blob([blob], { type: 'application/pdf' })), blob, sha256 });
    }, { documentId: document.id, download: true });
}

function chooseUpload(document: DocgenDocument) {
    if (blocked.value) return;
    uploadTarget.value = document.id;
    fileInput.value?.click();
}

function onFileChosen(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    const target = uploadTarget.value;
    input.value = '';
    uploadTarget.value = null;
    if (!file || !target) return;
    if (!file.name.toLowerCase().endsWith('.docx')) {
        documentErrors.set(target, t('docgenUi.form.fileType'));
        return;
    }
    if (file.size > DOCGEN_MAX_UPLOAD_BYTES) {
        documentErrors.set(target, t('docgenUi.form.fileTooLarge'));
        return;
    }
    void run(`upload:${target}`, async () => {
        const content = await fileToBase64(file);
        revokePreview(target);
        const result = await staffFetch<DocgenResponse<DocgenDocument>>(`${base.value}/documents/${target}/docx`, {
            method: 'POST',
            query: withWorkspaceQuery(),
            body: { filename: file.name, content }
        });
        replaceDocument(result.data);
        return t('docgenUi.case.uploaded');
    }, { documentId: target });
}

function confirmDiscard() {
    const id = discardId.value;
    if (!id) return;
    void run(`discard:${id}`, async () => {
        await staffFetch(`${base.value}/documents/${id}`, { method: 'DELETE', query: withWorkspaceQuery() });
        discardId.value = null;
        revokePreview(id);
        revokeCover(id);
        documentErrors.delete(id);
        await load();
        return t('docgenUi.case.discarded');
    }, { documentId: id });
}

function restoreDiscardFocus(event: Event) {
    const trigger = discardTrigger;
    discardTrigger = null;
    if (!trigger?.isConnected) return;
    event.preventDefault();
    trigger.focus();
}

/**
 * "Neu aus der Vorlage erstellen" (Nachreichung step 1): a request letter
 * whose deadline is from an earlier day and whose Word file was uploaded.
 * A rendered draft gets the new deadline from the next preview instead.
 */
function needsRerender(document: DocgenDocument): boolean {
    if (document.state !== 'draft') return false;
    // A missing or invalid cover sheet is produced anew only from the template, whatever the source.
    if (document.releaseBlockers.includes('docgen.cover_sheet_missing')) return true;
    return document.docx.source === 'uploaded' && document.releaseBlockers.includes('docgen.deadline_outdated');
}

/** The confirmation names the lost Word changes only when there are any. */
const rerenderDescription = computed(() => {
    const document = documents.value.find(item => item.id === rerenderId.value);
    return t(document?.docx.source === 'rendered' ? 'docgenUi.case.rerenderConfirmRendered' : 'docgenUi.case.rerenderConfirm');
});

/** Closes the confirmation at once: progress and errors show at the document's own button. */
function confirmRerender() {
    const id = rerenderId.value;
    if (!id || blocked.value) return;
    rerenderId.value = null;
    const current = reviewScope();
    void run(`rerender:${id}`, async () => {
        const result = await staffFetch<DocgenResponse<DocgenDocument>>(`${base.value}/documents/${id}/rerender`, { method: 'POST', query: withWorkspaceQuery() });
        if (!current()) return;
        revokePreview(id);
        revokeCover(id);
        if (props.documentId) viewedInSession.value = null;
        replaceDocument(result.data);
        return t('docgenUi.case.rerendered');
    }, { documentId: id });
}

function openRelease(document: DocgenDocument) {
    if (blocked.value || !document.canRelease) return;
    releaseSelection.value = [document.id];
    actionError.value = '';
    releaseOpen.value = true;
}

function toggleRelease(id: string, checked: boolean) {
    releaseSelection.value = checked
        ? [...new Set([...releaseSelection.value, id])]
        : releaseSelection.value.filter(item => item !== id);
}

function confirmRelease() {
    const current = reviewScope();
    if (!releaseCountValid.value) return;
    const selection = props.documentId ? releaseSelection.value.filter(id => id === props.documentId) : [...releaseSelection.value];
    if (props.documentId && (selection.length !== 1 || !documents.value[0]?.canRelease)) return;
    const postal = releaseGoesByPost.value;
    void run('release', async () => {
        const result = await staffFetch<DocgenResponse<DocgenReleaseResult>>(`${base.value}/release`, {
            method: 'POST',
            query: withWorkspaceQuery(),
            body: { documents: selection }
        });
        if (!current()) return;
        result.data.documents.forEach(replaceDocument);
        selection.forEach(revokePreview);
        releaseOpen.value = false;
        emit('released');
        return props.documentId && reviewCopy ? reviewCopy.released : t(postal ? 'docgenUi.case.releasedPostal' : 'docgenUi.case.released');
    });
}

/** Finishes a release that was started but not booked; it provides the notice at most once. */
function finishRelease(document: DocgenDocument) {
    const current = reviewScope();
    void run(`finish:${document.id}`, async () => {
        const result = await staffFetch<DocgenResponse<DocgenReleaseResult>>(`${base.value}/release`, {
            method: 'POST',
            query: withWorkspaceQuery(),
            body: { documents: [document.id] }
        });
        if (!current()) return;
        result.data.documents.forEach(replaceDocument);
        result.data.documents.forEach(item => revokePreview(item.id));
        emit('released');
        return props.documentId && reviewCopy ? reviewCopy.released : t('docgenUi.case.releaseFinished');
    }, { documentId: document.id });
}

watch(releaseOpen, (open) => {
    if (!open && pending.value !== 'release') actionError.value = '';
});

const previewFailure = ref('');
const viewedInSession = shallowRef<{ sha256: string, revision: number, at: string } | null>(null);
function reviewContext(document: DocgenDocument): DocumentReviewContext {
    return {
        document,
        byAgent: props.byAgent,
        previewFailure,
        blocked,
        pending,
        codeText,
        createPreview,
        downloadBlocked,
        openPdf,
        download,
        openCover,
        coverShown,
        openRelease,
        needsRerender,
        rerender: () => {
            rerenderId.value = document.id;
        },
        documentErrors,
        previews,
        viewErrors,
        viewRequests,
        acknowledgePreview,
        finishRelease,
        viewedInSession
    };
}

const reviewReleaseDescription = computed(() => reviewCopy?.releaseDescription(documents.value[0], viewedInSession.value) ?? '');
watch([() => props.applicationId, selectedWorkspaceKey], () => {
    if (props.documentId) {
        previewFailure.value = '';
        viewedInSession.value = null;
    }
    overview.value = null;
    hidden.value = false;
    createExpanded.value = false;
    releaseOpen.value = false;
    discardId.value = null;
    rerenderId.value = null;
    documentErrors.clear();
    [...previews.keys()].forEach(revokePreview);
    [...coverPreviews.keys()].forEach(revokeCover);
    void load();
}, { immediate: true });

onUnmounted(() => {
    reviewMounted = false;
    if (props.documentId) sequence++;
    emit('busy', false);
    if (ticker) clearInterval(ticker);
    [...previews.keys()].forEach(revokePreview);
    [...coverPreviews.keys()].forEach(revokeCover);
});

defineExpose({ reload: load });
</script>

<template>
  <section
    v-if="visible"
    :id="documentId ? undefined : 'docgen-panel'"
    tabindex="-1"
    :class="documentId ? 'min-w-0 [overflow-wrap:anywhere]' : 'mb-6 min-w-0 rounded-lg bg-default p-4 ring ring-default sm:px-6 sm:pt-5 sm:pb-6'"
    :data-compact="compact ? 'true' : undefined"
    :aria-label="documentId && reviewCopy ? reviewCopy.title : t('docgenUi.case.title')"
    :aria-busy="loading || pending !== null"
    :data-event-ready="!loading && !loadError"
    data-testid="docgen-panel"
  >
    <div
      class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1"
      :class="documentId ? undefined : 'min-h-8'"
    >
      <div
        v-if="!documentId"
        class="flex min-w-0 items-center gap-2"
      >
        <UIcon
          name="i-lucide-stamp"
          class="size-4 shrink-0 text-muted"
          aria-hidden="true"
        />
        <h2 class="min-w-0 break-words text-base font-semibold text-highlighted">
          {{ t('docgenUi.case.title') }}
        </h2>
        <span
          v-if="documents.length"
          class="text-sm text-muted tabular-nums"
          data-testid="docgen-count"
        >{{ documents.length }}</span>
        <ApplicationSectionEventPill
          kind="release"
          :card-total="documents.length"
        />
        <AdminCardExplanation
          :label="t('docgenUi.case.explain')"
          :text="t('docgenUi.case.intro')"
        />
      </div>
      <UBadge
        v-if="coolingDown"
        color="warning"
        icon="i-lucide-hourglass"
      >
        {{ t('docgenUi.case.retryIn', { seconds: cooldownSeconds }) }}
      </UBadge>
    </div>
    <p
      v-if="compactNote"
      class="mt-2 max-w-prose text-sm text-muted"
      data-testid="docgen-compact-note"
    >
      {{ compactNote }}
      <ULink
        v-if="showSetupWay && setupTo"
        :to="setupTo"
        class="inline-block min-h-6 font-medium text-default underline underline-offset-2"
        data-testid="docgen-setup-link"
      >{{ t('docgenUi.case.setupLink') }}</ULink>
    </p>
    <AccessReason
      v-if="showSetupWay && !setupTo"
      :id="`docgen-setup-reason-${applicationId}`"
      class="mt-1"
      reason="admin"
    />
    <p
      v-if="!documentId && !compact && route === 'case_system'"
      class="mt-2 text-sm text-muted"
    >
      {{ t('docgenUi.case.caseSystem') }}
    </p>
    <p
      v-if="!documentId && route === 'none' && documents.length"
      class="mt-2 text-sm text-muted"
    >
      {{ t('docgenUi.case.notConfigured') }}
    </p>

    <p
      v-if="actionError && !releaseOpen"
      role="alert"
      class="mt-3 text-sm text-error"
      data-testid="docgen-error"
    >
      {{ actionError }}
    </p>

    <div
      v-if="loadError"
      role="alert"
      class="mt-3"
    >
      <p class="mb-3 text-sm text-error">
        {{ loadError }}
      </p>
      <UButton
        color="neutral"
        variant="outline"
        :disabled="loading"
        @click="load"
      >
        {{ t('common.retry') }}
      </UButton>
    </div>

    <!-- Draft from a template -->
    <div
      v-if="!documentId && overview && route === 'template'"
      class="mt-4 space-y-3"
    >
      <p
        v-if="!templates.length"
        class="text-sm text-muted"
      >
        {{ t('docgenUi.case.noTemplates') }}
      </p>
      <UCollapsible
        v-else
        :open="!hasDrafts || createExpanded"
        @update:open="createExpanded = $event"
      >
        <template
          v-if="hasDrafts"
          #default
        >
          <UButton
            :id="createAnotherId"
            color="neutral"
            variant="ghost"
            icon="i-lucide-plus"
          >
            {{ t('docgenUi.case.createAnother') }}
          </UButton>
        </template>
        <template #content>
          <div :class="hasDrafts ? 'mt-3 space-y-3' : 'space-y-3'">
            <!-- The number of templates determines the control: one is a line of text, two to
                 four a radio group, more a select. Every template carries its test id `docgen-template-<slug>`: the line,
                 the radio's label, and in the select the label of its option (Nuxt UI 4.11.3 binds no attribute of an
                 item to the option element, only `class`; the label slot is inside the option, and a click on it selects
                 the option). The select's options exist only while it is open, and in the framework's portal under
                 `body`, not inside the panel: a script opens `docgen-template-choice` first and looks the option up in the
                 page. -->
            <p
              v-if="templates.length === 1"
              class="max-w-prose text-sm"
              :data-testid="`docgen-template-${docgenTemplateSlug(templates[0]!.name)}`"
            >
              {{ t('docgenUi.case.templateLine', { name: templates[0]!.name }) }}
              <span class="text-muted">· {{ templateFacts(templates[0]!) }}</span>
            </p>
            <URadioGroup
              v-else-if="templates.length <= 4"
              :model-value="selectedTemplateId ?? undefined"
              :items="templateItems"
              :legend="t('docgenUi.case.chooseTemplate')"
              :disabled="blocked"
              data-testid="docgen-template-choice"
              @update:model-value="chooseTemplate"
            >
              <template #label="{ item }">
                <span :data-testid="`docgen-template-${docgenTemplateSlug(String(item.label))}`">{{ item.label }}</span>
              </template>
            </URadioGroup>
            <UFormField
              v-else
              :label="t('docgenUi.case.chooseTemplate')"
              class="max-w-xl"
            >
              <USelect
                :model-value="selectedTemplateId ?? undefined"
                :items="templateItems"
                :disabled="blocked"
                class="w-full sm:w-72"
                data-testid="docgen-template-choice"
                @update:model-value="chooseTemplate"
              >
                <template #item-label="{ item }">
                  <span :data-testid="`docgen-template-${docgenTemplateSlug(String(item.label))}`">{{ item.label }}</span>
                </template>
              </USelect>
            </UFormField>
            <div class="flex flex-col gap-2 sm:flex-row sm:items-end">
              <UFormField
                :label="t('docgenUi.case.titleFieldLabel')"
                :hint="t('docgenUi.case.optionalHint')"
                class="min-w-0 max-w-xl flex-1"
              >
                <UInput
                  v-model="draftTitle"
                  :placeholder="t('docgenUi.case.titlePlaceholder')"
                  :maxlength="200"
                  class="w-full"
                />
              </UFormField>
              <!-- Natural width at 390 px too: a full-width button under "Titel" read as a second field. -->
              <UButton
                class="self-start sm:self-auto"
                color="neutral"
                variant="outline"
                data-testid="docgen-create"
                :loading="pending === 'create'"
                :disabled="blocked || !selectedTemplateId"
                @click="createDraft"
              >
                {{ t('docgenUi.case.create') }}
              </UButton>
            </div>
          </div>
        </template>
      </UCollapsible>
    </div>

    <p
      v-if="overview && !documents.length && (documentId || route === 'template')"
      class="mt-4 text-sm text-muted"
    >
      {{ t(documentId ? 'docgenUi.case.documentGone' : 'docgenUi.case.empty') }}
    </p>

    <input
      v-if="!documentId"
      ref="fileInput"
      type="file"
      accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      class="hidden"
      tabindex="-1"
      aria-hidden="true"
      @change="onFileChosen"
    >

    <ul
      v-if="documents.length"
      class="mt-4"
    >
      <li
        v-for="document in documents"
        :key="document.id"
        :data-event-target="`release:${document.id}`"
        class="application-event-entry min-w-0 space-y-3"
        :class="documentId ? 'rounded-lg border border-default p-3 sm:p-4' : 'border-t border-default pt-4'"
        data-testid="docgen-document"
      >
        <StaffExtensionOutlet
          v-if="documentId"
          name="case-document-review"
          :context="reviewContext(document)"
        />
        <template v-else>
          <div class="flex flex-wrap items-start justify-between gap-2">
            <div class="min-w-0">
              <h3 class="break-words font-semibold">
                {{ document.title }}
              </h3>
              <p class="text-sm text-muted">
                {{ document.state === 'draft' ? draftFacts(document) : documentTemplate(document) }}
              </p>
            </div>
            <div
              v-if="document.state !== 'draft'"
              class="flex flex-wrap gap-1"
            >
              <UBadge
                color="neutral"
              >
                {{ t(`docgenUi.purpose.${document.purpose}`) }}
              </UBadge>
              <UBadge
                v-if="document.closesProcedure"
                color="warning"
                icon="i-lucide-flag"
              >
                {{ t('docgenUi.closes') }}
              </UBadge>
              <UBadge
                :color="document.state === 'released' ? 'success' : 'warning'"
                :data-testid="document.state === 'released' ? 'docgen-released' : document.state === 'releasing' ? 'docgen-releasing' : undefined"
              >
                {{ t(`docgenUi.state.${document.state}`) }}
              </UBadge>
            </div>
          </div>

          <p class="text-sm text-muted">
            {{ documentCreated(document) }}
            · {{ t('docgenUi.case.revision', { revision: document.docx.revision, source: t(document.docx.source === 'uploaded' ? 'docgenUi.case.sourceUploaded' : 'docgenUi.case.sourceRendered') }) }}
          </p>

          <div
            v-if="document.state === 'draft'"
            class="flex flex-wrap gap-1"
          >
            <UBadge color="neutral">
              {{ t('docgenUi.state.draft') }}
            </UBadge>
            <UBadge
              v-if="document.preview?.current && document.preview.validation?.compliant"
              color="success"
              icon="i-lucide-badge-check"
              data-testid="docgen-preview-compliant"
            >
              {{ t('docgenUi.case.compliant') }}
            </UBadge>
            <UBadge
              v-if="document.preview?.current && document.preview.viewedByYou"
              color="success"
              icon="i-lucide-eye"
            >
              {{ t('docgenUi.case.viewed') }}
            </UBadge>
          </div>

          <p
            v-if="document.protectedValues"
            class="flex items-start gap-2 text-sm"
          >
            <UIcon
              name="i-lucide-shield"
              class="mt-0.5 size-4 shrink-0 text-warning"
              aria-hidden="true"
            />
            {{ t('docgenUi.case.protectedValues') }}
          </p>
          <p
            v-if="document.protectedOmitted.length"
            class="break-words text-sm"
          >
            {{ t('docgenUi.case.protectedOmitted', { list: placeholderList(document.protectedOmitted) }) }}
          </p>
          <UAlert
            v-if="document.state === 'draft' && missingPlaceholders(document).length"
            color="warning"
            icon="i-lucide-triangle-alert"
            :title="t('docgenUi.case.missingTitle')"
          >
            <template #description>
              <ul
                v-if="missingPlaceholders(document).length > 1"
                class="list-disc ps-5"
              >
                <li
                  v-for="tag in missingPlaceholders(document)"
                  :key="tag"
                >
                  {{ placeholderLabel(tag) }}
                </li>
              </ul>
              <p v-else>
                {{ t('docgenUi.case.singleMissingPlaceholder', { label: placeholderLabel(missingPlaceholders(document)[0]!) }) }}
              </p>
              <p class="mt-1">
                {{ t(document.missing.length ? 'docgenUi.case.missingHelp' : 'docgenUi.case.renderedMissingHelp') }}
              </p>
            </template>
          </UAlert>
          <p
            v-if="!document.historyIntact"
            role="alert"
            class="text-sm text-error"
          >
            {{ t('docgenUi.case.historyBroken') }}
          </p>

          <template v-if="document.state === 'draft'">
            <p
              class="sr-only"
              role="status"
              aria-live="polite"
            >
              {{ previews.has(document.id) && document.preview?.viewedByYou ? t('docgenUi.case.viewRecorded') : '' }}
            </p>
            <div
              v-if="previews.has(document.id)"
              :id="`${previewAreaId}-${document.id}`"
              class="h-[32rem]"
              tabindex="-1"
              role="region"
              :aria-label="t('docgenUi.case.previewFrameTitle', { title: document.title })"
              data-testid="docgen-pdf-preview"
            >
              <AppDocumentPreview
                :preview="{ ...previews.get(document.id)!, title: t('docgenUi.case.previewFrameTitle', { title: document.title }) }"
                class="h-full"
                hide-actions
                @rendered="url => acknowledgePreview(document, url)"
                @fallback="url => acknowledgePreview(document, url)"
              />
            </div>
            <p
              v-else
              class="text-sm text-muted empty:sr-only"
              role="status"
            >
              {{ pdfStatus(document) }}
            </p>

            <div
              class="flex flex-wrap items-center gap-2"
              role="group"
              :aria-label="t('docgenUi.case.actions', { title: document.title })"
            >
              <UButton
                v-if="!previews.has(document.id)"
                color="neutral"
                variant="outline"
                class="min-h-11"
                :icon="document.preview?.current ? 'i-lucide-eye' : undefined"
                :loading="pending === `preview:${document.id}` || pending === `open:${document.id}`"
                :disabled="blocked"
                :data-testid="document.preview?.current ? 'docgen-open-pdf' : 'docgen-preview'"
                @click="document.preview?.current ? openPdf(document) : createPreview(document, $event)"
              >
                {{ t(document.preview?.current ? 'docgenUi.case.openPdf' : document.preview ? 'docgenUi.case.previewAgain' : 'docgenUi.case.preview') }}
              </UButton>
              <UDropdownMenu
                :items="fileMenuItems(document)"
                :external-icon="false"
              >
                <UButton
                  color="neutral"
                  variant="outline"
                  trailing-icon="i-lucide-chevron-down"
                  class="min-h-11"
                >
                  {{ t('docgenUi.case.fileMenu') }}
                </UButton>
              </UDropdownMenu>
              <UDropdownMenu :items="draftMenuItems(document)">
                <UButton
                  :data-docgen-draft-menu="`${previewAreaId}-${document.id}`"
                  color="neutral"
                  variant="outline"
                  icon="i-lucide-ellipsis"
                  class="min-h-11"
                  :aria-label="t('docgenUi.case.moreActions', { title: document.title })"
                />
              </UDropdownMenu>
              <UButton
                v-if="document.canRelease"
                class="ms-auto min-h-11"
                :disabled="blocked"
                data-testid="docgen-release"
                @click="openRelease(document)"
              >
                {{ t('docgenUi.case.release') }}
              </UButton>
              <!-- Focusable on purpose (aria-disabled), so the reasons below are announced. -->
              <UButton
                v-else
                color="neutral"
                variant="outline"
                class="ms-auto min-h-11 cursor-not-allowed opacity-75"
                aria-disabled="true"
                :aria-describedby="visibleReleaseBlockers(document).length ? `docgen-blockers-${document.id}` : undefined"
              >
                {{ t('docgenUi.case.release') }}
              </UButton>
            </div>
          </template>
          <p
            v-if="documentErrors.has(document.id)"
            role="alert"
            class="text-sm text-error"
            data-testid="docgen-document-error"
          >
            {{ documentErrors.get(document.id) }}
          </p>
          <DocumentViewRetry
            v-if="previews.has(document.id) && viewErrors.has(document.id) && !document.preview?.viewedByYou"
            :error="viewErrors.get(document.id)!"
            :loading="viewRequests.has(previews.get(document.id)!.url)"
            :disabled="blocked"
            @retry="acknowledgePreview(document, previews.get(document.id)!.url)"
          />
          <div
            v-if="document.state === 'draft' && !document.canRelease && visibleReleaseBlockers(document).length"
            :id="`docgen-blockers-${document.id}`"
            class="text-sm"
          >
            <p class="font-medium">
              {{ t('docgenUi.case.blockersTitle') }}
            </p>
            <ul class="list-disc ps-5 text-muted">
              <li
                v-for="code in visibleReleaseBlockers(document)"
                :key="code"
              >
                {{ code === 'docgen.access_denied' ? t('docgenUi.case.noReleasePermission') : code === 'docgen.preview_not_viewed' && document.protectedValues ? `${codeText(code)} ${t('docgenUi.reasons.protected_values')}` : codeText(code) }}
              </li>
            </ul>
          </div>
          <UButton
            v-if="needsRerender(document)"
            color="neutral"
            variant="outline"
            icon="i-lucide-refresh-ccw"
            class="min-h-11"
            :disabled="blocked"
            :loading="pending === `rerender:${document.id}`"
            data-testid="docgen-rerender"
            @click="rerenderId = document.id"
          >
            {{ t('docgenUi.case.rerender') }}
          </UButton>

          <!-- Cover sheet of a request letter: the next document of the same response, never sent alone. -->
          <div
            v-if="document.cover && document.state !== 'released'"
            class="space-y-2 rounded-md border border-default p-3 text-sm"
            data-testid="docgen-cover"
          >
            <p class="flex items-center gap-2 font-medium">
              <UIcon
                name="i-lucide-qr-code"
                class="size-4 shrink-0"
                aria-hidden="true"
              />
              {{ t('docgenUi.case.coverTitle') }}
            </p>
            <p class="text-muted">
              {{ t('docgenUi.case.coverWithLetter') }}
            </p>
            <div class="flex flex-wrap gap-2">
              <UButton
                color="neutral"
                variant="outline"
                icon="i-lucide-qr-code"
                class="min-h-11"
                :loading="pending === `cover:${document.id}`"
                :disabled="downloadBlocked"
                data-testid="docgen-open-cover"
                @click="openCover(document)"
              >
                {{ t('docgenUi.case.coverOpen') }}
              </UButton>
              <UButton
                color="neutral"
                variant="outline"
                icon="i-lucide-file-down"
                class="min-h-11"
                :loading="pending === `download:cover-pdf:${document.id}`"
                :disabled="downloadBlocked"
                data-testid="docgen-download-cover"
                @click="download(document, 'cover-pdf')"
              >
                {{ t('docgenUi.case.coverDownload') }}
              </UButton>
            </div>
            <div
              v-if="coverShown(document)"
              class="space-y-2"
              data-testid="docgen-cover-preview"
            >
              <UButton
                :href="coverShown(document)?.url"
                target="_blank"
                rel="noopener"
                color="neutral"
                variant="outline"
                icon="i-lucide-external-link"
                class="min-h-11"
              >
                {{ t('docgenUi.case.newTab') }}
              </UButton>
              <AppDocumentPreview
                :preview="{ ...coverShown(document)!, title: t('docgenUi.case.coverFrameTitle', { title: document.title }) }"
                class="h-[32rem]"
                hide-actions
              />
            </div>
          </div>

          <!-- Started but unfinished release: only finishing is possible. -->
          <div
            v-if="document.state === 'releasing'"
            class="space-y-2 text-sm"
          >
            <p>{{ t('docgenUi.case.releasingHint') }}</p>
            <UButton
              v-if="document.canRelease"
              icon="i-lucide-stamp"
              class="min-h-11"
              :loading="pending === `finish:${document.id}`"
              :disabled="blocked"
              data-testid="docgen-finish-release"
              @click="finishRelease(document)"
            >
              {{ t('docgenUi.case.finishRelease') }}
            </UButton>
            <p
              v-else
              class="text-muted"
            >
              {{ t('docgenUi.case.noReleasePermission') }}
            </p>
          </div>

          <!-- Released: print copies -->
          <div
            v-if="document.state === 'released'"
            class="space-y-2 text-sm"
          >
            <p>{{ document.releasedBy ? t('docgenUi.case.releasedBy', { name: document.releasedBy, date: timestamp(document.releasedAt) }) : t('docgenUi.case.releasedAt', { date: timestamp(document.releasedAt) }) }}</p>
            <p class="font-medium">
              {{ t('docgenUi.case.printTitle') }}
            </p>
            <div class="flex flex-wrap gap-2">
              <UButton
                color="neutral"
                variant="outline"
                icon="i-lucide-file-down"
                class="min-h-11"
                :loading="pending === `download:pdf:${document.id}`"
                :disabled="downloadBlocked"
                @click="download(document, 'pdf')"
              >
                {{ t('docgenUi.case.downloadPdf') }}
              </UButton>
              <UButton
                color="neutral"
                variant="outline"
                icon="i-lucide-file-text"
                class="min-h-11"
                :loading="pending === `download:docx:${document.id}`"
                :disabled="downloadBlocked"
                @click="download(document, 'docx')"
              >
                {{ t('docgenUi.case.downloadDocx') }}
              </UButton>
              <UButton
                v-if="document.cover"
                color="neutral"
                variant="outline"
                icon="i-lucide-qr-code"
                class="min-h-11"
                :loading="pending === `download:cover-pdf:${document.id}`"
                :disabled="downloadBlocked"
                data-testid="docgen-download-cover"
                @click="download(document, 'cover-pdf')"
              >
                {{ t('docgenUi.case.coverDownload') }}
              </UButton>
            </div>
          </div>
        </template>
      </li>
    </ul>

    <!-- Joint release -->
    <UModal
      v-model:open="releaseOpen"
      :title="documentId && reviewCopy ? reviewCopy.releaseTitle : t('docgenUi.case.releaseDialogTitle')"
      :description="documentId ? reviewReleaseDescription : t(releaseGoesByPost ? 'docgenUi.case.releaseDialogPostal' : 'docgenUi.case.releaseDialogDescription')"
      :dismissible="pending !== 'release'"
      :close="pending !== 'release'"
    >
      <template #body>
        <div
          class="space-y-4 text-sm"
          data-testid="docgen-release-dialog"
        >
          <fieldset class="space-y-2">
            <legend class="mb-2 font-medium">
              {{ documentId && reviewCopy ? reviewCopy.releaseSelection : t('docgenUi.case.releaseSelection') }}
            </legend>
            <UCheckbox
              v-for="document in releaseDocuments"
              :key="document.id"
              :model-value="releaseSelection.includes(document.id)"
              :label="document.title"
              :description="`${t(`docgenUi.purpose.${document.purpose}`)}${document.closesProcedure ? `, ${t('docgenUi.closes')}` : ''}`"
              :disabled="pending === 'release' || (!releaseSelection.includes(document.id) && releaseSelection.length >= maxRelease)"
              @update:model-value="toggleRelease(document.id, $event === true)"
            />
          </fieldset>
          <ul
            v-if="releaseCovers.length"
            class="space-y-1"
            data-testid="docgen-release-covers"
          >
            <li
              v-for="document in releaseCovers"
              :key="document.id"
              class="flex items-start gap-2"
            >
              <UIcon
                name="i-lucide-qr-code"
                class="mt-0.5 size-4 shrink-0"
                aria-hidden="true"
              />
              {{ t('docgenUi.case.releaseCover', { title: document.title }) }}
            </li>
          </ul>
          <p
            v-if="!releasePdfsValid"
            role="alert"
            class="text-error"
          >
            {{ t('docgenUi.case.releaseCoverLimit', { max: releasePdfLimit }) }}
          </p>
          <p
            v-if="releasable.length > maxRelease"
            class="text-muted"
          >
            {{ t('docgenUi.case.releaseLimit', { max: maxRelease }) }}
          </p>
          <UAlert
            v-if="releaseCloses"
            role="status"
            color="warning"
            icon="i-lucide-triangle-alert"
            :title="t('docgenUi.case.releaseClosesWarning')"
          />
          <p
            v-if="actionError"
            role="alert"
            class="text-error"
          >
            {{ actionError }}
          </p>
          <div class="flex flex-wrap justify-end gap-2">
            <UButton
              color="neutral"
              variant="ghost"
              class="min-h-11"
              :disabled="pending === 'release'"
              @click="releaseOpen = false"
            >
              {{ t('common.cancel') }}
            </UButton>
            <UButton
              icon="i-lucide-stamp"
              class="min-h-11"
              data-testid="docgen-release-confirm"
              :loading="pending === 'release'"
              :disabled="!releaseCountValid || (pending !== null && pending !== 'release') || coolingDown"
              @click="confirmRelease"
            >
              {{ t('docgenUi.case.releaseConfirm') }}
            </UButton>
          </div>
        </div>
      </template>
    </UModal>

    <!-- Discard -->
    <UModal
      v-if="!documentId"
      :open="discardId !== null"
      :title="t('docgenUi.case.discardTitle')"
      :description="t('docgenUi.case.discardDescription')"
      :content="{ onCloseAutoFocus: restoreDiscardFocus }"
      @update:open="(value: boolean) => { if (!value && !pending) discardId = null }"
    >
      <template #footer>
        <div class="flex w-full flex-wrap justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            class="min-h-11"
            :disabled="pending !== null"
            @click="discardId = null"
          >
            {{ t('common.cancel') }}
          </UButton>
          <UButton
            color="error"
            icon="i-lucide-trash-2"
            class="min-h-11"
            :loading="pending === `discard:${discardId}`"
            :disabled="pending !== null"
            @click="confirmDiscard"
          >
            {{ t('docgenUi.case.discard') }}
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- Create again from the template: the Word changes are lost. -->
    <UModal
      :open="rerenderId !== null"
      :title="t('docgenUi.case.rerender')"
      :description="rerenderDescription"
      @update:open="(value: boolean) => { if (!value && !pending) rerenderId = null }"
    >
      <template #footer>
        <div
          class="flex w-full flex-wrap justify-end gap-2"
          data-testid="docgen-rerender-dialog"
        >
          <UButton
            color="neutral"
            variant="ghost"
            class="min-h-11"
            :disabled="pending !== null"
            @click="rerenderId = null"
          >
            {{ t('common.cancel') }}
          </UButton>
          <UButton
            icon="i-lucide-refresh-ccw"
            class="min-h-11"
            :disabled="blocked"
            data-testid="docgen-rerender-confirm"
            @click="confirmRerender"
          >
            {{ t('docgenUi.case.rerender') }}
          </UButton>
        </div>
      </template>
    </UModal>
  </section>
</template>
