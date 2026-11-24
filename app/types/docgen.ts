/**
 * Staff projections of the docgen API (beantragt_docgen) as the Nuxt
 * proxy forwards them. The proxy whitelists every field; see
 * server/utils/admin-docgen.ts in the Pro layer. (The citizen build check
 * rejects any app/ file that names the Pro layer directory.)
 */
import type { DeliveryPreview, DeliveryRoute } from './delivery';

export type DocgenPurpose = 'approval' | 'rejection' | 'request_info' | 'acknowledgement' | 'other';
export type DocgenRoute = 'none' | 'template' | 'case_system';

export interface DocgenScope {
    id: number
    type: 'organisation' | 'jurisdiction'
    name: string
}

export interface DocgenTemplateError {
    id: string
    message: string
    tag: string | null
}

export interface DocgenTemplate {
    id: string
    family: string
    version: number
    name: string
    purpose: DocgenPurpose
    closesProcedure: boolean
    status: 'draft' | 'released'
    scope: DocgenScope | null
    filename: string
    size: number
    sha256: string
    placeholders: string[]
    loops: string[]
    errors: DocgenTemplateError[]
    systemPlaceholders: string[]
    createdAt: number
    createdBy: string | null
    releasedAt: number | null
    releasedBy: string | null
}

export interface DocgenTemplateDetail extends DocgenTemplate {
    versions: DocgenTemplate[]
}

export interface DocgenCatalog {
    templates: DocgenTemplate[]
    canManage: boolean
    purposes: DocgenPurpose[]
    closingPurposes: DocgenPurpose[]
}

export interface DocgenScopeSettings {
    scope: number
    senderAddress: string
    effectiveSenderAddress: string
}

export interface DocgenHealth {
    configured: boolean
    status: string
    gotenberg?: string
    verapdf?: string
}

export interface DocgenComparison {
    known: string[]
    unknown: Array<{ tag: string, suggestion: string | null }>
    protected: string[]
    unused: string[]
}

export interface DocgenFormTemplate {
    family: string
    name: string
    purpose: DocgenPurpose
    latestVersion: number
    /** Newest version of the family (draft or released). */
    latestId: string
    latestStatus: 'draft' | 'released'
    latestHasErrors: boolean
    releasedVersion: number | null
    releasedId: string | null
    comparison: DocgenComparison
}

export interface DocgenWarning {
    code: string
    family?: string
    placeholders?: Array<{ tag: string, suggestion: string | null }>
}

export interface DocgenFormSettings {
    formId: string
    route: DocgenRoute
    routes: DocgenRoute[]
    templates: DocgenFormTemplate[]
    warnings: DocgenWarning[]
    scope: DocgenScope
    /** DocgenScopeAccess::canManageTemplates() for the form's scope. */
    canManage: boolean
    /** The form's catalog is the catalog of the selected workspace. */
    catalogInWorkspace: boolean
    /** Delivery offer of the form; `routes: []` and `default: ''` = not configured. */
    delivery: DocgenFormDelivery
}

/**
 * Stored delivery offer of a form plus the routes that can be used
 * (`availableRoutes` lacks `bundid` while no postbox transport exists).
 */
export interface DocgenFormDelivery {
    configured: boolean
    routes: DeliveryRoute[]
    default: DeliveryRoute | ''
    availableRoutes: DeliveryRoute[]
}

export interface DocgenVariableLabel {
    de: string
    en: string
}

export interface DocgenVariableSection {
    id: string
    title: DocgenVariableLabel
}

export interface DocgenVariableChild {
    tag: string
    syntax: string
    label: DocgenVariableLabel
    type: string
    protected: boolean
    privacyKind: string | null
}

export interface DocgenVariable {
    tag: string
    syntax: string
    group: 'system' | 'form'
    label: DocgenVariableLabel
    type: string
    section: DocgenVariableSection | null
    protected: boolean
    repeatable: boolean
    privacyKind?: string | null
    children?: DocgenVariableChild[]
}

export interface DocgenVariables {
    formId: string
    title: string
    variables: DocgenVariable[]
    loopExample: string
}

export interface DocgenFormUploadResult {
    template: DocgenTemplate
    comparison: DocgenComparison
    settings: DocgenFormSettings
}

export interface DocgenValidation {
    profile: string
    compliant: boolean
    failedRules: number
    failedChecks: number
    summary: string
}

export interface DocgenPreview {
    sha256: string
    docxSha256: string
    current: boolean
    validation: DocgenValidation | null
    viewedByYou: boolean
}

/**
 * Cover sheet of a request letter (Nachreichung): a companion PDF/A on the
 * letter's own row, released with the letter as the next document of the
 * same response, never on its own. The proxy builds the download path
 * (`.../documents/{id}/cover-pdf`); no Drupal URL is forwarded.
 */
export interface DocgenCover {
    sha256: string
    validation: DocgenValidation | null
}

export interface DocgenDocument {
    id: string
    title: string
    purpose: DocgenPurpose
    closesProcedure: boolean
    state: 'draft' | 'releasing' | 'released'
    template: {
        id: string | null
        family: string
        version: number
        name: string | null
        sha256: string
    }
    dataSha256: string
    missing: string[]
    protectedOmitted: string[]
    renderedMissing: string[]
    protectedValues: boolean
    docx: {
        sha256: string
        revision: number
        source: 'rendered' | 'uploaded'
        size: number | null
    }
    preview: DocgenPreview | null
    /** Request letters with the cover sheet switch on; NULL otherwise. */
    cover: DocgenCover | null
    /** When the DOCX was last rendered from the template (seconds); the request deadline counts from this day. */
    renderedAt: number | null
    canRelease: boolean
    releaseBlockers: string[]
    createdAt: number
    createdBy: string | null
    changedAt: number
    releasedAt: number | null
    releasedBy: string | null
    responseId: string | null
    releaseId: string | null
    historyIntact: boolean
}

export interface DocgenCaseTemplate {
    id: string
    family: string
    version: number
    name: string
    purpose: DocgenPurpose
    closesProcedure: boolean
}

export interface DocgenCaseOverview {
    route: DocgenRoute
    templates: DocgenCaseTemplate[]
    documents: DocgenDocument[]
    canRelease: boolean
    maxReleaseDocuments: number
    /** What a release would do; NULL without the delivery service. */
    delivery: DeliveryPreview | null
}

export interface DocgenReleaseResult {
    documents: DocgenDocument[]
    response: { id: string }
}

export interface DocgenResponse<T> {
    data: T
}
