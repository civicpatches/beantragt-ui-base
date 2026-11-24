import type { DeliveryPreview, DeliveryRoute } from './delivery';

export interface ExternalResponseDocument {
    id: string
    filename: string
    mimeType: string
    size: number
    sha512: string
    downloadUrl: string
}

export interface ExternalResponse {
    id: string
    title: string
    source: string
    externalReference: string
    status: 'pending' | 'released'
    /** `postal`: provided on route post, no email to the applicant. */
    notificationState: 'pending' | 'sending' | 'sent' | 'failed' | 'not_applicable' | 'postal'
    receivedAt: number
    releasedAt: number | null
    availableAt: number | null
    retrievedAt: number | null
    documents: ExternalResponseDocument[]
    /** Case-system outcome; NULL for a response without outcome. */
    outcome?: 'approved' | 'rejected' | 'filed' | null
    /** The outcome in the words of the connection or the case system ("Festsetzung"); NULL keeps the product word. */
    outcomeLabel?: string | null
    /** filing_receipt: staff only, never released (outcome filed). */
    kind?: 'decision' | 'filing_receipt'
    /** Staff only: documents carry protected application data in clear text. */
    containsProtected?: boolean
    /** A decision (approval, rejection or a reply without filing outcome); its portal copy is labelled as a copy. */
    isDecision: boolean
    /** Effective route fixed at provision; `''` while pending or for rows provided before stage 1. */
    deliveryRoute: DeliveryRoute | ''
}

export interface ExternalResponsesPayload {
    data: ExternalResponse[]
    /** `delivery`: what a release would do; only with `canRelease`. */
    meta: { canRelease: boolean, canReadProtected?: boolean, delivery?: DeliveryPreview }
}
