import { computed, ref, watch } from 'vue';
import type { ComputedRef, Ref } from 'vue';
import type {
    AdminApplicationAttachment,
    AdminApplicationDetailResponse,
    AdminApplicationProof
} from '~/types';
import type { ApplicationAttachmentUpload, FormField, FormSchema } from '~/types/form';
import { getLocalizedFormSectionTitle } from '~/utils/form-schema';
import { splitRepeatedSections, type ApplicationDataSectionView } from '~~/casework-layer/app/utils/application-data-sections';
import { formatFieldValue } from '~/composables/useFormatters';
import { isProtectedApplicationDataValue, isRedactedApplicationDataValue } from '~~/casework-layer/app/utils/application-data-redaction';
import { isStoredConditionMet } from '~/utils/form-condition-value';
import type { ViewerDocument } from '~~/casework-layer/app/utils/viewer-document';
import {
    caseAttachmentInsightsFactory,
    type CaseAttachmentInsightDetails,
    type CaseAttachmentInsightEntries,
    type CaseAttachmentsCore
} from '~~/casework-layer/app/utils/case-attachment-insights';

type MaybeComputedRef<T> = Ref<T> | ComputedRef<T>;
type BadgeColor = 'success' | 'error' | 'warning' | 'neutral';
type AttachmentQuery = Record<string, unknown>;

/**
 * State of one attachment in the list and the slide-over, first match wins: quarantine, pre-check finding,
 * a completed analysis that needs a look, a run that did not happen (quiet word), clean (green check), nothing.
 * Every text comes from the existing status, description and pre-check wording; nothing here derives a finding.
 */
export interface AttachmentRowState {
    kind: 'quarantined' | 'finding' | 'attention' | 'quiet' | 'clean' | 'none'
    /** Badges of an exception; colour never stands alone, every badge has its word. */
    badges: Array<{ text: string, color: 'error' | 'warning' | 'neutral' }>
    /** The sentence shown below the row on the page (quarantine, finding, attention). */
    sentence: string
    /** The calm word of a run that did not happen or a pre-check that is not available. */
    word: string
    /** Accessible text and title of the green check. */
    checkLabel: string
    /** Existing explanation of a quiet state, shown in the slide-over only. */
    explanation: string
    /** Long status text needs its own line so the file name can use the available width. */
    separateLine?: boolean
}

/** One file field of the list: its attachments, stored references without a loaded file, or a missing required proof. */
export interface AttachmentListGroup {
    /** Stable key of the group: `field:<id>`, `follow-up` or `other`. */
    key: string
    /** The schema field (or the follow-up field id); empty for the group of everything else. */
    fieldId: string
    label: string
    attachments: AdminApplicationAttachment[]
    /** Files the application data names but the staff member may not load (protected data). */
    storedReferences: StoredAttachmentReference[]
    /** Description of the protected-attachments notice, empty when it does not apply. */
    protectedNotice: string
    /** Required and visible for this application, but without any document. */
    missing: boolean
    proof?: Pick<AdminApplicationProof, 'required' | 'status'>
}

/**
 * What the slide-over's right column shows for the shown attachment: the data of the former analysis dialog and
 * the actions of the former card. Size, download and delete are the core's; the rest is what the registered
 * insights say (`CaseAttachmentInsightDetails`), inert without them.
 */
export interface AttachmentDetails extends CaseAttachmentInsightDetails {
    size: string
    canDownload: boolean
    deleting: boolean
    deleteDisabled: boolean
}

/** What opened the slide-over, held by id so a re-render of the list never leaves a stale element behind. */
export type AttachmentOpener = { kind: 'row', attachmentId: string } | { kind: 'field', fieldId: string } | { kind: 'message', commentId: string, fileId: string };

/** Field id the backend gives a follow-up document (Nachreichung, BulkEnvelopeDecisions). */
const FOLLOW_UP_FIELD_ID = 'nachreichung';
/** Field id Drupal assigns to uploads sent with a message. */
const MESSAGE_ATTACHMENT_FIELD_ID = 'comment_attachment';
const UNASSIGNED_FIELD_ID = '@unassigned';

export interface AttachmentListSummary {
    /** Required, visible file fields of a non-repeatable section; null when the list cannot say (load failed). */
    required: number | null
    present: number
    missing: number
    quarantined: number
    /** Pre-check findings and completed analyses that need a look. */
    attention: number
}

interface ApplicationDataDisplayRow {
    key: string
    value: unknown
}

export interface AttachmentAnalysisSummaryItem {
    label: string
    value: string
    /** Short chips of the batch review (pre-check tile only). */
    chips?: Array<{ text: string, color: BadgeColor }>
}

export interface AttachmentAnalysisListSection {
    key: string
    label: string
    items: string[]
}

export interface AttachmentAnalysisComparison {
    /** Label of the form field the applicant answered. */
    label: string
    /** The applicant's own answer, formatted; empty when not answered. */
    value: string
    status: 'match' | 'mismatch' | 'no_answer' | 'protected' | 'no_value'
}

export interface AttachmentAnalysisDisplayItem {
    key: string
    label: string
    value: string
    piiScrubbed?: boolean
    /** Personal value read from the attachment for this procedure (staff only). */
    purposeBound?: boolean
    comparison?: AttachmentAnalysisComparison
}

export interface AttachmentAnalysisStorySection {
    /** `precheck`: the batch pre-check of an attachment from a scanned batch, never rerun from here. */
    story: 'citizen' | 'staff' | 'precheck'
    label: string
    statusLabel: string
    statusColor: BadgeColor
    description: string
    summaryItems: AttachmentAnalysisSummaryItem[]
    extractedItems: AttachmentAnalysisDisplayItem[]
    /** Source facts the run reported: truncated PDF, unredacted scan. */
    notices: string[]
    /** A case worker may start this story again (Drupal decides finally). */
    canRerun: boolean
    /** The story has no record yet: its action starts the first run. */
    firstRun: boolean
    staffResult?: {
        checks: AttachmentAnalysisSummaryItem[]
        comparisons: Array<{ key: string, label: string, reportedLabel: string, extracted: string, reported: string, status: string }>
        runError: string
        refreshError: boolean
        refreshing: boolean
        hasResult: boolean
    }
}

export interface StoredAttachmentReference {
    attachmentId: string
    filename: string
    size?: number
    mimeType?: string
}

interface ApplicationLike {
    origin?: string | null
    data?: Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function useAdminApplicationAttachments(options: {
    applicationId: string
    application: MaybeComputedRef<ApplicationLike | null | undefined>
    schema: MaybeComputedRef<FormSchema | null>
    applicationResponse: MaybeComputedRef<AdminApplicationDetailResponse | null | undefined>
    applicationQuery: MaybeComputedRef<AttachmentQuery>
    isAdmin: MaybeComputedRef<boolean>
    booleanLabels: MaybeComputedRef<{ yes: string, no: string }>
    refreshApplication: () => Promise<unknown>
    refreshAttachmentAnalysis?: (signal: AbortSignal) => Promise<unknown>
}) {
    const { locale, t } = useI18n();
    const toast = useToast();
    const { resolveApiErrorMessage } = useApiErrorMessage();

    const deletingQuarantineAttachmentId = ref<string | null>(null);
    const locallyDeletedAttachmentIds = ref<Set<string>>(new Set());
    /** The attachment shown in the slide-over; its details feed the right column. */
    const analysisAttachmentId = ref<string | null>(null);

    const fieldLabels = computed(() => {
        const labels: Record<string, string> = {};
        if (!options.schema.value) return labels;
        for (const section of options.schema.value.sections) {
            for (const field of section.fields) {
                labels[field.id] = field.label;
                if (field.crm_key) {
                    labels[field.crm_key] = field.label;
                }
            }
        }
        return labels;
    });

    // Field definitions by id and by CRM key (same precedence as fieldLabels),
    // so a value finds its type and format whichever key the row or CRM card uses.
    const fieldsById = computed(() => {
        const fields = new Map<string, FormField>();
        if (!options.schema.value) return fields;
        for (const section of options.schema.value.sections) {
            for (const field of section.fields) {
                fields.set(field.id, field);
                if (field.crm_key) {
                    fields.set(field.crm_key, field);
                }
            }
        }
        return fields;
    });

    const fileFieldIds = computed(() => {
        const ids = new Set<string>();
        if (!options.schema.value) return ids;
        for (const section of options.schema.value.sections) {
            for (const field of section.fields) {
                if (field.type === 'file') {
                    ids.add(field.id);
                }
            }
        }
        return ids;
    });

    const applicationAttachments = computed<AdminApplicationAttachment[]>(() =>
        (options.applicationResponse.value?.meta?.attachments ?? [])
            .filter(attachment => !locallyDeletedAttachmentIds.value.has(attachment.id))
    );
    const proofCompleteness = computed(() => options.applicationResponse.value?.meta?.proofCompleteness);
    const usesProofProjection = computed(() => options.application.value?.origin === 'bulk' || proofCompleteness.value !== undefined);
    const proofFieldByAttachment = computed(() => {
        const fields = new Map<string, string>();
        const projection = proofCompleteness.value;
        if (projection?.available) {
            for (const proof of projection.proofs) {
                for (const id of proof.attachmentIds) fields.set(id, proof.fieldId);
            }
        }
        return fields;
    });

    const analysisAttachment = computed<AdminApplicationAttachment | null>(() => {
        if (!analysisAttachmentId.value) return null;
        return applicationAttachments.value.find(attachment => attachment.id === analysisAttachmentId.value) ?? null;
    });

    const attachmentsByFieldId = computed(() => {
        const groups = new Map<string, AdminApplicationAttachment[]>();
        for (const attachment of applicationAttachments.value) {
            if (attachment.fieldId === MESSAGE_ATTACHMENT_FIELD_ID) continue;
            const fieldId = usesProofProjection.value && attachment.fieldId !== FOLLOW_UP_FIELD_ID
                ? proofFieldByAttachment.value.get(attachment.id) ?? UNASSIGNED_FIELD_ID
                : attachment.fieldId;
            const entries = groups.get(fieldId) || [];
            entries.push(attachment);
            groups.set(fieldId, entries);
        }
        return groups;
    });

    const attachmentLoadFailed = computed(() =>
        options.applicationResponse.value?.meta?.attachmentLoadFailed === true
    );

    const storedDataRows = computed<ApplicationDataDisplayRow[]>(() => {
        const data = options.application.value?.data ?? {};
        const rows = Object.entries(data).map(([key, value]) => ({ key, value }));

        for (const fieldId of attachmentsByFieldId.value.keys()) {
            if (usesProofProjection.value && fieldId === UNASSIGNED_FIELD_ID) continue;
            if (!Object.hasOwn(data, fieldId)) rows.push({ key: fieldId, value: [] });
        }

        return rows;
    });

    const splitData = computed(() => splitRepeatedSections(storedDataRows.value, options.schema.value, options.application.value?.origin));
    const applicationDataRows = computed(() => splitData.value.rows);
    const applicationDataSections = computed<ApplicationDataSectionView[]>(() => splitData.value.sections.map(group => ({
        key: group.key,
        title: getLocalizedFormSectionTitle(group.section, locale.value).trim() || group.key,
        entries: group.entries.map((entry, index) => ({
            ...entry,
            label: t('admin.detail.repeatedEntryLabel', { number: index + 1 })
        })),
        rows: group.rows
    })));

    function getFieldLabel(key: string): string {
        if (fieldLabels.value[key]) return fieldLabels.value[key];
        // The follow-up documents' fixed field id is no schema field: its title, never the raw id.
        if (key === FOLLOW_UP_FIELD_ID) return t('admin.detail.attachmentList.followUpGroup');
        if (key === UNASSIGNED_FIELD_ID) return t('admin.detail.attachmentList.unassignedGroup');
        // CRM keys outside the form schema.
        if (key === 'applicant_full_name') return t('admin.detail.applicantFullName');
        if (key === 'applicant_email') return t('admin.detail.applicantEmail');
        return key;
    }

    /** Encrypted or redacted values the current staff member may not read. */
    function isProtectedDisplayValue(value: unknown): boolean {
        return isRedactedApplicationDataValue(value) || isProtectedApplicationDataValue(value);
    }

    function attachmentsForField(fieldId: string): AdminApplicationAttachment[] {
        return attachmentsByFieldId.value.get(fieldId) ?? [];
    }

    function metadataAttachmentCount(value: unknown): number | null {
        if (!Array.isArray(value)) return null;
        if (value.length === 0) return 0;
        return value.every(item =>
            item
            && typeof item === 'object'
            && !Array.isArray(item)
            && typeof (item as { attachmentId?: unknown }).attachmentId === 'string'
            && typeof (item as { filename?: unknown }).filename === 'string'
        )
            ? value.length
            : null;
    }

    function storedAttachmentCountForFieldValue(value: unknown): number {
        return metadataAttachmentCount(value) === null
            ? 0
            : storedAttachmentReferencesForFieldValue(value).length;
    }

    function shouldShowProtectedAttachmentNotice(fieldId: string, value: unknown): boolean {
        return !usesProofProjection.value && fileFieldIds.value.has(fieldId)
          && storedAttachmentCountForFieldValue(value) > 0
          && attachmentsForField(fieldId).length === 0
          && !attachmentLoadFailed.value;
    }

    function protectedAttachmentNoticeDescription(fieldId: string): string {
        // Pro names the analysis in the sentence of a field configured for it.
        return insights?.protectedNoticeDescription(fieldId) ?? t('admin.detail.protectedAttachmentsHiddenDescription');
    }

    function formatAttachmentSize(size: number | undefined): string {
        if (!Number.isFinite(size) || !size || size <= 0) return '0 KB';
        if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
        return `${Math.ceil(size / 1024)} KB`;
    }

    function isQuarantinedAttachment(attachment: AdminApplicationAttachment): boolean {
        return attachment.scanStatus === 'quarantined';
    }

    function addLocalSetValue(target: Ref<Set<string>>, id: string) {
        target.value = new Set([...target.value, id]);
    }

    // The analysis half (pre-check, runs, document guard) comes from the registered insights, created once per
    // instance with the core's state; without them every attachment is quarantined or none.
    const core: CaseAttachmentsCore = {
        applicationId: options.applicationId,
        application: options.application,
        schema: options.schema,
        applicationQuery: options.applicationQuery,
        isAdmin: options.isAdmin,
        refreshApplication: options.refreshApplication,
        refreshAttachmentAnalysis: options.refreshAttachmentAnalysis,
        attachments: applicationAttachments,
        current: analysisAttachment,
        fieldLabels,
        getFieldLabel,
        isQuarantined: isQuarantinedAttachment,
        isProtectedValue: isProtectedDisplayValue
    };
    const insights = caseAttachmentInsightsFactory()?.(core) ?? null;
    const insightEntries: CaseAttachmentInsightEntries = insights?.entries ?? inertInsightEntries();
    const attachmentAnalysisBusy = insights?.busy ?? computed(() => false);

    function isAttachmentPreviewImage(attachment: AdminApplicationAttachment | null): boolean {
        if (!attachment) return false;
        return /^image\/(png|jpeg)$/i.test(attachment.mimeType)
          || /\.(png|jpe?g)$/i.test(attachment.filename);
    }

    function isAttachmentPreviewPdf(attachment: AdminApplicationAttachment | null): boolean {
        if (!attachment) return false;
        return attachment.mimeType === 'application/pdf' || /\.pdf$/i.test(attachment.filename);
    }

    function canPreviewAttachment(attachment: AdminApplicationAttachment): boolean {
        return !isQuarantinedAttachment(attachment)
          && (isAttachmentPreviewImage(attachment) || isAttachmentPreviewPdf(attachment));
    }

    /** Kind of file for the type icon and its accessible word: the preview rules, anything else is a plain file. */
    function attachmentFileKind(attachment: AdminApplicationAttachment): 'pdf' | 'image' | 'other' {
        if (isAttachmentPreviewImage(attachment)) return 'image';
        if (isAttachmentPreviewPdf(attachment)) return 'pdf';
        return 'other';
    }

    /**
     * The attachment metadata needed by the preview. The file comes from the
     * scoped inline preview route without a query: the viewer adds the workspace query itself. Null where today's
     * preview was not offered (quarantine, other file types), so the viewer never loads such a file.
     */
    function attachmentViewerDocument(attachment: AdminApplicationAttachment): ViewerDocument | null {
        if (!canPreviewAttachment(attachment)) return null;
        const mime: ViewerDocument['mime'] = isAttachmentPreviewImage(attachment)
            ? (/png/i.test(attachment.mimeType) || /\.png$/i.test(attachment.filename) ? 'image/png' : 'image/jpeg')
            : 'application/pdf';
        return {
            id: attachment.id,
            label: attachment.filename,
            fieldId: attachment.fieldId,
            personBlock: null,
            originalName: attachment.filename,
            mime,
            pageCount: 0,
            state: null,
            fileUrl: `/api/admin/applications/${options.applicationId}/attachments/${attachment.id}/preview`
        };
    }

    /**
     * Shows an attachment in the slide-over. Every attachment of the list opens, also one without an analysis or
     * in quarantine: the right column decides what it offers (viewer, details, actions) by the existing guards.
     */
    function showAttachmentDetails(attachment: AdminApplicationAttachment) {
        analysisAttachmentId.value = attachment.id;
    }

    function closeAttachmentAnalysis() {
        analysisAttachmentId.value = null;
    }

    const attachmentAnalysisModalSize = computed(() =>
        analysisAttachment.value ? formatAttachmentSize(analysisAttachment.value.size) : ''
    );

    const attachmentAnalysisModalCanDownload = computed(() =>
        analysisAttachment.value ? !isQuarantinedAttachment(analysisAttachment.value) : false
    );

    function quarantineMessage(attachment: AdminApplicationAttachment): string {
        return attachment.scanMessage || t('admin.detail.quarantineScanMessageFallback');
    }

    async function deleteQuarantinedAttachment(attachment: AdminApplicationAttachment) {
        if (!isQuarantinedAttachment(attachment) || !attachment.canResolveQuarantine || deletingQuarantineAttachmentId.value) return;

        const confirmed = window.confirm(t('admin.detail.deleteQuarantinedAttachmentConfirm', { filename: attachment.filename }));
        if (!confirmed) return;

        const reason = window.prompt(t('admin.detail.deleteQuarantinedAttachmentReasonPrompt'), '');
        if (reason === null) return;
        deletingQuarantineAttachmentId.value = attachment.id;
        try {
            await $fetch(`/api/admin/applications/${options.applicationId}/attachments/${attachment.id}`, {
                method: 'DELETE',
                query: options.applicationQuery.value,
                body: {
                    reason
                }
            });
            addLocalSetValue(locallyDeletedAttachmentIds, attachment.id);
            try {
                await options.refreshApplication();
            } catch {
                // The server-side mutation succeeded; keep the optimistic local removal.
            }
            toast.add({
                title: t('admin.detail.quarantinedAttachmentDeleted'),
                color: 'success'
            });
        } catch (e: unknown) {
            toast.add({
                title: t('admin.detail.quarantinedAttachmentDeleteError'),
                description: resolveApiErrorMessage(e, 'admin.detail.quarantinedAttachmentDeleteError'),
                color: 'error'
            });
        } finally {
            deletingQuarantineAttachmentId.value = null;
        }
    }

    function storedAttachmentReferencesForFieldValue(value: unknown): StoredAttachmentReference[] {
        if (!Array.isArray(value)) return [];
        return value
            .map((item): StoredAttachmentReference | null => {
                if (!isRecord(item)) return null;
                const attachmentId = typeof item.attachmentId === 'string' ? item.attachmentId.trim() : '';
                const filename = typeof item.filename === 'string' ? item.filename.trim() : '';
                if (!attachmentId || !filename) return null;

                const reference: StoredAttachmentReference = {
                    attachmentId,
                    filename
                };
                const size = Number((item as Partial<ApplicationAttachmentUpload>).size);
                if (Number.isFinite(size) && size > 0) {
                    reference.size = size;
                }
                const mimeType = typeof item.mimeType === 'string' ? item.mimeType.trim() : '';
                if (mimeType) {
                    reference.mimeType = mimeType;
                }
                return reference;
            })
            .filter((item): item is StoredAttachmentReference =>
                item !== null && !locallyDeletedAttachmentIds.value.has(item.attachmentId)
            );
    }

    function storedAttachmentReferencesForField(fieldId: string, value: unknown): StoredAttachmentReference[] {
        if (usesProofProjection.value) return [];
        if (!fileFieldIds.value.has(fieldId) && metadataAttachmentCount(value) === null) return [];
        if (attachmentsForField(fieldId).length > 0) return [];
        return storedAttachmentReferencesForFieldValue(value);
    }

    function formatApplicationDataValue(key: string, value: unknown, source?: 'history'): string {
        if (isProtectedDisplayValue(value)) return t('admin.detail.protectedValue');
        const attachmentCount = metadataAttachmentCount(value);
        if (fileFieldIds.value.has(key) || (attachmentCount !== null && (source !== 'history' || attachmentCount > 0))) {
            if (source === 'history') return attachmentCountLabel(attachmentCount ?? 0);
            const count = (
                attachmentsForField(key).length
                || (!usesProofProjection.value && storedAttachmentCountForFieldValue(value))
                || 0
            );
            return attachmentCountLabel(count);
        }
        const field = fieldsById.value.get(key);
        return formatFieldValue(value, {
            type: field?.type,
            format: field?.format,
            step: field?.validation?.step,
            locale: locale.value,
            booleanLabels: options.booleanLabels.value
        });
    }

    function attachmentCountLabel(count: number): string {
        return t(count === 1 ? 'admin.detail.attachmentCountOne' : 'admin.detail.attachmentCountMany', { count });
    }

    /**
     * The state cell of one attachment, first match wins: quarantine here, then what the
     * registered insights say (pre-check finding, analysis needing a look, a quiet word, the green check); no
     * statement is nothing.
     */
    function attachmentRowState(attachment: AdminApplicationAttachment): AttachmentRowState {
        const base = { badges: [], sentence: '', word: '', checkLabel: '', explanation: '' };
        if (isQuarantinedAttachment(attachment)) {
            return {
                ...base,
                kind: 'quarantined',
                badges: [{ text: t('admin.detail.quarantinedAttachment'), color: 'error' }],
                sentence: t('admin.detail.quarantinedAttachmentDescription', { message: quarantineMessage(attachment) })
            };
        }
        return insights?.rowState(attachment) ?? { ...base, kind: 'none' };
    }

    /** File fields of the schema in form order, with the section they belong to. */
    const schemaFileFields = computed(() => (options.schema.value?.sections ?? []).flatMap(section =>
        section.fields.filter(field => field.type === 'file').map(field => ({ field, repeatable: section.repeatable === true }))
    ));

    /** The reader may not reveal protected data (Drupal's `protected_data_redacted`, i.e. `!can_reveal`). */
    const readerWithoutReveal = computed(() => options.applicationResponse.value?.meta?.protectedDataRedacted === true);

    /**
     * Drupal's rule for an attachment field (ApplicationAttachmentApiController::isSensitiveSchemaField): a file
     * field is sensitive unless it says `sensitive: false`. Such a field's attachments never reach a reader without
     * the reveal permission, so the list cannot know whether one exists.
     */
    function isSensitiveAttachmentField(field: FormField): boolean {
        const flag = (field as { sensitive?: unknown }).sensitive;
        if (flag === undefined) return true;
        if (typeof flag === 'boolean') return flag;
        if (typeof flag === 'number') return flag !== 0;
        if (typeof flag === 'string') {
            const normalized = flag.trim().toLowerCase();
            if (['0', 'false', 'no', 'off', ''].includes(normalized)) return false;
            return true;
        }
        return true;
    }

    /**
     * Required means `required` on the field, visible means its `conditionalOn` is met by the stored application
     * data, the rule the form and the data edit use (isStoredConditionMet: the page's isConditionMet on the condition as the page receives it, a stored number as the page's text). A file field of a repeatable section belongs
     * to a person of a batch case, and a sensitive file field the reader cannot receive cannot be judged:
     * neither counts here.
     */
    function requiredForCompleteness(field: FormField, repeatable: boolean): boolean {
        if (field.required !== true || repeatable) return false;
        if (readerWithoutReveal.value && isSensitiveAttachmentField(field)) return false;
        const condition = field.conditionalOn;
        return !condition || isStoredConditionMet(condition, options.application.value?.data?.[condition.fieldId]);
    }

    /**
     * The groups of the list: each file field of the form with attachments, stored references or a
     * missing required document, in form order; then the follow-up documents (Nachreichung, the fixed field id the
     * backend gives them) under their existing title; then everything the schema has no file field for, under one
     * generic label, never a raw field id. A field is missing only when nothing names a document: no loaded
     * attachment, no stored reference, no protected value, and the attachments did load.
     */
    const attachmentListGroups = computed<AttachmentListGroup[]>(() => {
        const messageFiles = applicationAttachments.value.filter(attachment => attachment.fieldId === MESSAGE_ATTACHMENT_FIELD_ID);
        if (usesProofProjection.value) {
            const projection = proofCompleteness.value;
            const byId = new Map(applicationAttachments.value
                .filter(attachment => attachment.fieldId !== MESSAGE_ATTACHMENT_FIELD_ID && attachment.fieldId !== FOLLOW_UP_FIELD_ID)
                .map(attachment => [attachment.id, attachment]));
            const groups: AttachmentListGroup[] = [];
            const addGroup = (key: string, fieldId: string, label: string, attachments: AdminApplicationAttachment[], proof?: AdminApplicationProof) => {
                groups.push({ key, fieldId, label, attachments, storedReferences: [], protectedNotice: '',
                    missing: proof?.required === true && proof.status === 'missing',
                    ...(proof ? { proof: { required: proof.required, status: proof.status } } : {}) });
            };
            if (projection?.available) {
                for (const proof of projection.proofs) {
                    const attachments = proof.attachmentIds.flatMap(id => byId.get(id) ?? []);
                    const label = proof.personIndex === null
                        ? proof.label
                        : `${proof.label} · ${t('admin.detail.repeatedEntryLabel', { number: proof.personIndex + 1 })}`;
                    addGroup(`proof:${proof.fieldId}:${proof.personIndex ?? ''}`, proof.fieldId, label, attachments, proof);
                }
            }
            const remaining = attachmentsForField(UNASSIGNED_FIELD_ID);
            const unassignedIds = new Set(projection?.available ? projection.unassignedAttachmentIds : []);
            const unassigned = remaining.filter(attachment => unassignedIds.has(attachment.id) || attachment.fieldId === UNASSIGNED_FIELD_ID);
            const other = remaining.filter(attachment => !unassigned.includes(attachment));
            for (const [key, fieldId, label, attachments] of [
                ['unassigned', UNASSIGNED_FIELD_ID, 'unassignedGroup', unassigned],
                ['follow-up', FOLLOW_UP_FIELD_ID, 'followUpGroup', attachmentsForField(FOLLOW_UP_FIELD_ID)],
                ['messages', MESSAGE_ATTACHMENT_FIELD_ID, 'messagesGroup', messageFiles],
                ['other', '', 'otherGroup', other]
            ] as const) {
                if (attachments.length) addGroup(key, fieldId, t(`admin.detail.attachmentList.${label}`), attachments);
            }
            return groups;
        }
        const data = options.application.value?.data ?? {};
        const groups: AttachmentListGroup[] = [];
        const seen = new Set<string>();
        for (const { field, repeatable } of schemaFileFields.value) {
            if (seen.has(field.id) || field.id === MESSAGE_ATTACHMENT_FIELD_ID) continue;
            seen.add(field.id);
            const value = data[field.id];
            const attachments = attachmentsForField(field.id);
            const storedReferences = storedAttachmentReferencesForField(field.id, value);
            const protectedNotice = shouldShowProtectedAttachmentNotice(field.id, value) ? protectedAttachmentNoticeDescription(field.id) : '';
            const missing = requiredForCompleteness(field, repeatable)
              && !attachmentLoadFailed.value
              && attachments.length === 0
              && storedAttachmentReferencesForFieldValue(value).length === 0
              && !isProtectedDisplayValue(value);
            if (!attachments.length && !storedReferences.length && !protectedNotice && !missing) continue;
            groups.push({ key: `field:${field.id}`, fieldId: field.id, label: getFieldLabel(field.id), attachments, storedReferences, protectedNotice, missing });
        }
        const followUp = seen.has(FOLLOW_UP_FIELD_ID) ? [] : attachmentsForField(FOLLOW_UP_FIELD_ID);
        seen.add(FOLLOW_UP_FIELD_ID);
        if (followUp.length) {
            groups.push({ key: 'follow-up', fieldId: FOLLOW_UP_FIELD_ID, label: t('admin.detail.attachmentList.followUpGroup'), attachments: followUp, storedReferences: [], protectedNotice: '', missing: false });
        }
        seen.add(MESSAGE_ATTACHMENT_FIELD_ID);
        if (messageFiles.length) {
            groups.push({ key: 'messages', fieldId: MESSAGE_ATTACHMENT_FIELD_ID, label: t('admin.detail.attachmentList.messagesGroup'), attachments: messageFiles, storedReferences: [], protectedNotice: '', missing: false });
        }
        // Data rows whose value names stored files without a schema file field, and attachments of fields the
        // schema no longer has: one group, as the former card listed them, without exposing the field ids.
        const other: AttachmentListGroup = { key: 'other', fieldId: '', label: t('admin.detail.attachmentList.otherGroup'), attachments: [], storedReferences: [], protectedNotice: '', missing: false };
        for (const [fieldId, value] of Object.entries(data)) {
            if (seen.has(fieldId) || attachmentsForField(fieldId).length) continue;
            other.storedReferences.push(...storedAttachmentReferencesForField(fieldId, value));
        }
        for (const [fieldId, attachments] of attachmentsByFieldId.value) {
            if (seen.has(fieldId)) continue;
            other.attachments.push(...attachments);
        }
        if (other.attachments.length || other.storedReferences.length) groups.push(other);
        return groups;
    });

    /** All loaded attachments in list order: the slide-over's sequence and its "Anlage n von m". */
    const orderedAttachments = computed(() => attachmentListGroups.value.flatMap(group => group.attachments));

    const attachmentListSummary = computed<AttachmentListSummary>(() => {
        const states = orderedAttachments.value.map(attachmentRowState);
        const quarantineAndAttention = {
            quarantined: states.filter(state => state.kind === 'quarantined').length,
            attention: states.filter(state => state.kind === 'finding' || state.kind === 'attention').length
        };
        if (usesProofProjection.value) {
            const projection = proofCompleteness.value;
            const counts = projection?.available ? projection : null;
            return { required: counts?.required ?? null, present: counts?.present ?? 0, missing: counts?.missing ?? 0, ...quarantineAndAttention };
        }
        const counted = new Set<string>();
        const required = attachmentLoadFailed.value
            ? null
            : schemaFileFields.value.filter(({ field, repeatable }) => {
                if (counted.has(field.id) || !requiredForCompleteness(field, repeatable)) return false;
                counted.add(field.id);
                return true;
            }).length;
        const missing = attachmentListGroups.value.filter(group => group.missing).length;
        return {
            required,
            present: required === null ? 0 : required - missing,
            missing,
            ...quarantineAndAttention
        };
    });

    /** The right column of the slide-over: the former analysis dialog's data and the former card's actions. */
    const attachmentSlideoverDetails = computed<AttachmentDetails>(() => {
        const attachment = analysisAttachment.value;
        const deleting = deletingQuarantineAttachmentId.value;
        return {
            size: attachmentAnalysisModalSize.value,
            ...(insights?.details(attachment) ?? INERT_INSIGHT_DETAILS),
            canDownload: attachmentAnalysisModalCanDownload.value,
            deleting: Boolean(attachment && deleting === attachment.id),
            deleteDisabled: Boolean(attachment && deleting !== null && deleting !== attachment.id)
        };
    });

    // ── Slide-over: open state, opener and the neighbour after a removal ──────────────────
    const attachmentsOpen = ref(false);
    /** What opened the slide-over, by id: the row or the form-data line is looked up again at close time. */
    const attachmentOpener = ref<AttachmentOpener | null>(null);
    /** Position of the shown attachment, so a removed one (quarantine delete) gives way to its neighbour. */
    let shownAttachmentIndex = 0;

    function openAttachmentSlideover(attachment: AdminApplicationAttachment, opener: AttachmentOpener | null = { kind: 'row', attachmentId: attachment.id }) {
        attachmentOpener.value = opener;
        showAttachmentDetails(attachment);
        attachmentsOpen.value = true;
    }

    /** The form-data line of a file field opens the slide-over at that field's first attachment. */
    function openFieldAttachments(fieldId: string) {
        const first = attachmentsForField(fieldId)[0];
        if (first) openAttachmentSlideover(first, { kind: 'field', fieldId });
    }

    function setAttachmentsOpen(open: boolean) {
        attachmentsOpen.value = open;
    }

    function attributeSelectorValue(value: string): string {
        return value.replace(/["\\]/gu, '\\$&');
    }

    /** The element the focus returns to: the opener if it still exists, else the block heading, else the data card. */
    function attachmentFocusTarget(): HTMLElement | null {
        if (typeof document === 'undefined') return null;
        const opener = attachmentOpener.value;
        const selector = opener?.kind === 'row'
            ? `[data-attachment-open][data-attachment-id="${attributeSelectorValue(opener.attachmentId)}"]`
            : opener?.kind === 'message'
                ? `[data-comment-id="${attributeSelectorValue(opener.commentId)}"] [data-message-file="${attributeSelectorValue(opener.fileId)}"]`
                : opener?.kind === 'field'
                    ? `[data-attachments-field="${attributeSelectorValue(opener.fieldId)}"]`
                    : null;
        return (selector ? document.querySelector<HTMLElement>(selector) : null)
          ?? document.querySelector<HTMLElement>('[data-attachment-list-heading]')
          ?? document.getElementById('application-data-card');
    }

    /** After the slide-over has closed: clear the shown attachment and return the focus. */
    function attachmentSlideoverClosed() {
        const target = attachmentFocusTarget();
        closeAttachmentAnalysis();
        attachmentOpener.value = null;
        target?.focus();
    }

    // Synchronous, so the position is known before any later removal in the same tick.
    watch(analysisAttachment, (attachment) => {
        if (!attachment) return;
        const index = orderedAttachments.value.findIndex(item => item.id === attachment.id);
        if (index >= 0) shownAttachmentIndex = index;
    }, { flush: 'sync' });

    watch([attachmentsOpen, analysisAttachment, orderedAttachments], () => {
        if (!attachmentsOpen.value || analysisAttachment.value) return;
        const list = orderedAttachments.value;
        if (!list.length) {
            attachmentsOpen.value = false;
            return;
        }
        showAttachmentDetails(list[Math.min(shownAttachmentIndex, list.length - 1)]!);
    });

    return {
        analysisAttachment,
        attachmentSlideoverDetails,
        attachmentFocusTarget,
        attachmentOpener,
        attachmentSlideoverClosed,
        attachmentsOpen,
        openAttachmentSlideover,
        openFieldAttachments,
        setAttachmentsOpen,
        applicationAttachments,
        applicationDataRows,
        applicationDataSections,
        attachmentAnalysisBusy,
        attachmentAnalysisDescription: insightEntries.attachmentAnalysisDescription,
        attachmentAnalysisListSections: insightEntries.attachmentAnalysisListSections,
        attachmentAnalysisModalCanDownload,
        attachmentAnalysisModalCanRerun: insightEntries.attachmentAnalysisModalCanRerun,
        attachmentAnalysisModalDescription: insightEntries.attachmentAnalysisModalDescription,
        attachmentAnalysisModalExtractedItems: insightEntries.attachmentAnalysisModalExtractedItems,
        attachmentAnalysisModalIsAnalyzing: insightEntries.attachmentAnalysisModalIsAnalyzing,
        attachmentAnalysisModalListSections: insightEntries.attachmentAnalysisModalListSections,
        attachmentAnalysisModalRunLabel: insightEntries.attachmentAnalysisModalRunLabel,
        attachmentAnalysisModalShowsGuard: insightEntries.attachmentAnalysisModalShowsGuard,
        attachmentAnalysisModalSize,
        attachmentAnalysisModalStatusColor: insightEntries.attachmentAnalysisModalStatusColor,
        attachmentAnalysisModalStatusLabel: insightEntries.attachmentAnalysisModalStatusLabel,
        attachmentAnalysisModalStorySections: insightEntries.attachmentAnalysisModalStorySections,
        attachmentAnalysisModalSummaryItems: insightEntries.attachmentAnalysisModalSummaryItems,
        attachmentAnalysisModalTechnicalItems: insightEntries.attachmentAnalysisModalTechnicalItems,
        attachmentAnalysisRunAriaLabel: insightEntries.attachmentAnalysisRunAriaLabel,
        attachmentAnalysisRunLabel: insightEntries.attachmentAnalysisRunLabel,
        attachmentAnalysisStatusColor: insightEntries.attachmentAnalysisStatusColor,
        attachmentAnalysisStatusLabel: insightEntries.attachmentAnalysisStatusLabel,
        attachmentAnalysisStorySections: insightEntries.attachmentAnalysisStorySections,
        attachmentAnalysisSummaryItems: insightEntries.attachmentAnalysisSummaryItems,
        attachmentFileKind,
        attachmentListGroups,
        attachmentListSummary,
        attachmentLoadFailed,
        attachmentRowState,
        attachmentsForField,
        attachmentViewerDocument,
        canOpenAttachmentAnalysis: insightEntries.canOpenAttachmentAnalysis,
        canPreviewAttachment,
        canRerunAttachmentAnalysis: insightEntries.canRerunAttachmentAnalysis,
        canStartAttachmentAnalysis: insightEntries.canStartAttachmentAnalysis,
        closeAttachmentAnalysis,
        deleteQuarantinedAttachment,
        deletingQuarantineAttachmentId,
        formatApplicationDataValue,
        formatAttachmentSize,
        getFieldLabel,
        isAnalyzingAttachment: insightEntries.isAnalyzingAttachment,
        isProtectedDisplayValue,
        isQuarantinedAttachment,
        orderedAttachments,
        protectedAttachmentNoticeDescription,
        quarantineMessage,
        rerunAttachmentAnalysisStoryFromModal: (story: 'citizen' | 'staff') => insights?.rerunStory(story),
        refreshAnalysis: () => insights?.refreshAnalysis?.(),
        shouldShowAttachmentAnalysis: insightEntries.shouldShowAttachmentAnalysis,
        shouldShowAttachmentGuard: insightEntries.shouldShowAttachmentGuard,
        shouldShowProtectedAttachmentNotice,
        showAttachmentDetails,
        startAttachmentAnalysis: (attachment: AdminApplicationAttachment, story?: 'legacy' | 'citizen' | 'staff') => insights?.start(attachment, story) ?? Promise.resolve(),
        storedAttachmentReferencesForField
    };
}

/** The analysis part of the details when nothing is registered, and of today's dialog without a shown attachment. */
const INERT_INSIGHT_DETAILS: CaseAttachmentInsightDetails = {
    showPanel: false,
    showAnalysis: false,
    showGuard: false,
    statusLabel: '',
    statusColor: 'neutral',
    description: '',
    summaryItems: [],
    listSections: [],
    extractedItems: [],
    technicalItems: [],
    storySections: [],
    canStartAnalysis: false,
    canRerunAnalysis: false,
    isAnalyzing: false,
    runLabel: '',
    runAriaLabel: ''
};

/** The analysis entries of the return object when nothing is registered: nothing to say, nothing offered. */
function inertInsightEntries(): CaseAttachmentInsightEntries {
    const no = () => false;
    const empty = () => '';
    const none = () => [];
    return {
        attachmentAnalysisDescription: empty,
        attachmentAnalysisListSections: none,
        attachmentAnalysisModalCanRerun: computed(() => false),
        attachmentAnalysisModalDescription: computed(() => ''),
        attachmentAnalysisModalExtractedItems: computed(() => []),
        attachmentAnalysisModalIsAnalyzing: computed(() => false),
        attachmentAnalysisModalListSections: computed(() => []),
        attachmentAnalysisModalRunLabel: computed(() => ''),
        attachmentAnalysisModalShowsGuard: computed(() => false),
        attachmentAnalysisModalStatusColor: computed(() => 'neutral' as const),
        attachmentAnalysisModalStatusLabel: computed(() => ''),
        attachmentAnalysisModalStorySections: computed(() => []),
        attachmentAnalysisModalSummaryItems: computed(() => []),
        attachmentAnalysisModalTechnicalItems: computed(() => []),
        attachmentAnalysisRunAriaLabel: empty,
        attachmentAnalysisRunLabel: empty,
        attachmentAnalysisStatusColor: () => 'neutral',
        attachmentAnalysisStatusLabel: empty,
        attachmentAnalysisStorySections: none,
        attachmentAnalysisSummaryItems: none,
        canOpenAttachmentAnalysis: no,
        canRerunAttachmentAnalysis: no,
        canStartAttachmentAnalysis: no,
        isAnalyzingAttachment: no,
        shouldShowAttachmentAnalysis: no,
        shouldShowAttachmentGuard: no
    };
}
