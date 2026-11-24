import type { Ref } from 'vue';
import type { DocgenDocument } from '~/types/docgen';
import type { DocumentPreviewSource } from '~/utils/document-preview-extension';

export interface DocumentReviewView {
    sha256: string
    revision: number
    at: string
}

export type DocumentReviewFile = Pick<DocumentPreviewSource, 'url' | 'blob'>;

export interface DocumentReviewContext {
    document: DocgenDocument
    byAgent: boolean | null
    previewFailure: Ref<string>
    blocked: Ref<boolean>
    pending: Ref<string | null>
    codeText: (code: string) => string
    createPreview: (document: DocgenDocument) => void
    downloadBlocked: Ref<boolean>
    openPdf: (document: DocgenDocument) => void
    download: (document: DocgenDocument, kind: 'pdf' | 'cover-pdf') => void
    openCover: (document: DocgenDocument) => void
    coverShown: (document: DocgenDocument) => DocumentReviewFile | undefined
    openRelease: (document: DocgenDocument) => void
    needsRerender: (document: DocgenDocument) => boolean
    rerender: () => void
    documentErrors: Map<string, string>
    previews: Map<string, DocumentReviewFile>
    viewErrors: Map<string, string>
    viewRequests: Set<string>
    acknowledgePreview: (document: DocgenDocument, url: string) => Promise<void>
    finishRelease: (document: DocgenDocument) => void
    viewedInSession: Ref<DocumentReviewView | null>
}

export interface DocumentReviewCopy {
    title: string
    released: string
    releaseFailed: string
    releaseTitle: string
    releaseSelection: string
    releaseDescription: (document: DocgenDocument | undefined, view: DocumentReviewView | null) => string
}
