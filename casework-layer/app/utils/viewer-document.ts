/** A document the viewer loads: its file route, type and page count. */
export interface ViewerDocument {
    id: string
    label: string | null
    fieldId: string | null
    personBlock: string | null
    originalName: string | null
    mime: 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/tiff' | null
    pageCount: number
    state: string | null
    fileUrl: string | null
}
