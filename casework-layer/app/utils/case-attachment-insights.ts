/**
 * Extension seam of the attachments composable (contract 2.3 and 3.2).
 *
 * The open core (`composables/useAdminApplicationAttachments.ts`) lists, groups and counts the attachments, shows
 * them in the slide-over, and knows quarantine. Everything an analysis says about an attachment (pre-check,
 * analysis runs, document guard) comes from the insights a layer registers here as a factory; the core calls it
 * once per composable instance with its own state. Nothing registered: every attachment is `quarantined` or `none`,
 * the details carry inert values and no analysis request is ever made.
 *
 * Registration is idempotent and holds one factory: the same factory is taken once, and its remover clears the
 * slot only if it is still the one it registered.
 *
 * Part of the open case-work layer (moves with the detail slice, contract 3.4).
 */
import type { ComputedRef, Ref } from 'vue';
import type { AdminApplicationAttachment } from '~/types';
import type { FormSchema } from '~/types/form';
import type {
    AttachmentAnalysisDisplayItem,
    AttachmentAnalysisListSection,
    AttachmentAnalysisStorySection,
    AttachmentAnalysisSummaryItem,
    AttachmentDetails,
    AttachmentRowState
} from '../composables/useAdminApplicationAttachments';

type MaybeComputedRef<T> = Ref<T> | ComputedRef<T>;
type BadgeColor = 'success' | 'error' | 'warning' | 'neutral';

/** What the core hands the insights: its options and the state they read (always the current values, as refs). */
export interface CaseAttachmentsCore {
    applicationId: string
    application: MaybeComputedRef<{ origin?: string | null, data?: Record<string, unknown> } | null | undefined>
    schema: MaybeComputedRef<FormSchema | null>
    applicationQuery: MaybeComputedRef<Record<string, unknown>>
    isAdmin: MaybeComputedRef<boolean>
    refreshApplication: () => Promise<unknown>
    refreshAttachmentAnalysis?: (signal: AbortSignal) => Promise<unknown>
    /** The loaded attachments without the ones deleted here. */
    attachments: ComputedRef<AdminApplicationAttachment[]>
    /** The attachment shown in the slide-over. */
    current: ComputedRef<AdminApplicationAttachment | null>
    /** Schema field id and CRM key -> label, without fallbacks. */
    fieldLabels: ComputedRef<Record<string, string>>
    /** The label the list shows for a field, with its fallbacks. */
    getFieldLabel: (key: string) => string
    isQuarantined: (attachment: AdminApplicationAttachment) => boolean
    /** Encrypted or redacted values the current staff member may not read. */
    isProtectedValue: (value: unknown) => boolean
}

/** The analysis part of the slide-over details (today's `AttachmentDetails` without size, download and delete). */
export interface CaseAttachmentInsightDetails {
    /** The analysis or document guard section is shown (the card's rule). */
    showPanel: boolean
    showAnalysis: boolean
    showGuard: boolean
    statusLabel: string
    statusColor: BadgeColor
    description: string
    summaryItems: AttachmentAnalysisSummaryItem[]
    listSections: AttachmentAnalysisListSection[]
    extractedItems: AttachmentAnalysisDisplayItem[]
    technicalItems: AttachmentAnalysisSummaryItem[]
    storySections: AttachmentAnalysisStorySection[]
    panelBeforePreview?: boolean
    canStartAnalysis: boolean
    canRerunAnalysis: boolean
    isAnalyzing: boolean
    runLabel: string
    runAriaLabel: string
}

type Attachment = AdminApplicationAttachment;

/**
 * The analysis entries of the composable's return object, under today's names, so the detail page, the slide-over
 * and their tests read the same keys after the cut. The core fills them from the insights or with inert values.
 */
export interface CaseAttachmentInsightEntries {
    attachmentAnalysisDescription: (attachment: Attachment) => string
    attachmentAnalysisListSections: (attachment: Attachment) => AttachmentAnalysisListSection[]
    attachmentAnalysisModalCanRerun: ComputedRef<boolean>
    attachmentAnalysisModalDescription: ComputedRef<string>
    attachmentAnalysisModalExtractedItems: ComputedRef<AttachmentAnalysisDisplayItem[]>
    attachmentAnalysisModalIsAnalyzing: ComputedRef<boolean>
    attachmentAnalysisModalListSections: ComputedRef<AttachmentAnalysisListSection[]>
    attachmentAnalysisModalRunLabel: ComputedRef<string>
    attachmentAnalysisModalShowsGuard: ComputedRef<boolean>
    attachmentAnalysisModalStatusColor: ComputedRef<BadgeColor>
    attachmentAnalysisModalStatusLabel: ComputedRef<string>
    attachmentAnalysisModalStorySections: ComputedRef<AttachmentAnalysisStorySection[]>
    attachmentAnalysisModalSummaryItems: ComputedRef<AttachmentAnalysisSummaryItem[]>
    attachmentAnalysisModalTechnicalItems: ComputedRef<AttachmentAnalysisSummaryItem[]>
    attachmentAnalysisRunAriaLabel: (attachment: Attachment) => string
    attachmentAnalysisRunLabel: (attachment: Attachment) => string
    attachmentAnalysisStatusColor: (attachment: Attachment) => BadgeColor
    attachmentAnalysisStatusLabel: (attachment: Attachment) => string
    attachmentAnalysisStorySections: (attachment: Attachment) => AttachmentAnalysisStorySection[]
    attachmentAnalysisSummaryItems: (attachment: Attachment) => AttachmentAnalysisSummaryItem[]
    canOpenAttachmentAnalysis: (attachment: Attachment) => boolean
    canRerunAttachmentAnalysis: (attachment: Attachment) => boolean
    canStartAttachmentAnalysis: (attachment: Attachment) => boolean
    isAnalyzingAttachment: (attachment: Attachment) => boolean
    shouldShowAttachmentAnalysis: (attachment: Attachment) => boolean
    shouldShowAttachmentGuard: (attachment: Attachment) => boolean
}

export interface CaseAttachmentInsights {
    /** A request of the insights is in flight (the page blocks other mutations meanwhile). */
    busy: ComputedRef<boolean>
    /** The state of a non-quarantined attachment; null = no statement, the core then answers `{ kind: 'none' }`. */
    rowState: (attachment: Attachment) => AttachmentRowState | null
    /** The analysis part of the details of the shown attachment; null = inert. */
    details: (attachment: Attachment | null) => CaseAttachmentInsightDetails | null
    /** The single run, or the rerun of a story; Drupal decides finally. */
    start: (attachment: Attachment, story?: 'legacy' | 'citizen' | 'staff') => Promise<void>
    /** Reruns a story of the shown attachment. */
    rerunStory: (story: 'citizen' | 'staff') => void
    refreshAnalysis?: () => void
    /** The sentence of the protected-attachments notice of a field; null = the core's sentence. */
    protectedNoticeDescription: (fieldId: string) => string | null
    entries: CaseAttachmentInsightEntries
}

export type CaseAttachmentInsightsFactory = (core: CaseAttachmentsCore) => CaseAttachmentInsights;

/**
 * Context of the staff outlet `case-attachment-insight` of the attachments slide-over. It is mounted twice: in the
 * action row above the viewer (`actions`) and below the viewer (`panel`), the two places the analysis had there.
 */
export interface CaseAttachmentInsightContext {
    part: 'actions' | 'panel'
    /** The shown attachment. */
    attachment: AdminApplicationAttachment
    /** The right column's details: core fields plus what the registered insights say (inert without them). */
    details: AttachmentDetails
    /** The row state the slide-over shows above (quarantine included), so the panel never says it twice. */
    state: AttachmentRowState
    /** The slide-over's own events, so the page keeps its wiring. */
    runAnalysis: () => void
    rerunStory: (story: 'citizen' | 'staff') => void
    refreshAnalysis?: () => void
}

let registered: CaseAttachmentInsightsFactory | null = null;

export function registerCaseAttachmentInsights(factory: CaseAttachmentInsightsFactory): () => void {
    if (registered === factory) return () => {};
    registered = factory;
    return () => {
        if (registered === factory) registered = null;
    };
}

/** The registered factory, or null in the open build. */
export function caseAttachmentInsightsFactory(): CaseAttachmentInsightsFactory | null {
    return registered;
}
