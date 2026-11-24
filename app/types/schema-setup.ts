/**
 * Guided form setup "Was fragt das Formular?".
 *
 * Shapes of the internal Nuxt routes under /api/admin/schemas/:id/setup.
 * The server builds every screen and question from the stored schema, the
 * Drupal gate blockers, the stored recommendations and the latest decisions;
 * the browser renders them and sends answers, never a schema.
 */

export const SETUP_PROPERTIES = [
    'wording',
    'privacy.kind',
    'sensitive',
    'format',
    'validation',
    'analysis.document',
    'analysis.expectedDocumentType'
] as const;
export type SetupProperty = typeof SETUP_PROPERTIES[number];

export const SETUP_CHOICES = ['accepted', 'other', 'kept'] as const;
export type SetupChoice = typeof SETUP_CHOICES[number];

export type SetupOrigin = 'rule' | 'model';

export type SetupIneligibleReason = 'not_draft' | 'was_published' | 'not_compiled' | 'section_too_large';

export type SetupBlockerCode = 'sensitive_required' | 'high_risk_kind_required' | 'privacy_kind_required' | 'schema_invalid';

export interface SetupSetsLine {
    code: string
    params: Record<string, string | number>
}

export interface SetupFieldDetail {
    fieldId: string
    label: string
    type: string
    required: boolean
    format: string | null
    privacyKind: string | null
}

export interface SetupQuestionOption {
    /** `null` is the "leave as it is" option ("So lassen", "Passt so"). */
    value: unknown
    labelKey: string | null
    label: string | null
}

export interface SetupRecommendationView {
    value: unknown
    origin: SetupOrigin
    ruleId: string | null
    why: { key: string, params: Record<string, string> } | null
    quote: string | null
    source: { title: string, page: number | null, version: string } | null
}

export interface SetupAnswerView {
    choice: SetupChoice
    value: unknown
    decidedAt: number
    decidedBy: string
}

export interface SetupQuestion {
    id: string
    fieldId: string
    fieldLabel: string
    property: SetupProperty
    blocking: boolean
    options: SetupQuestionOption[]
    current: unknown
    recommendation: SetupRecommendationView | null
    answer: SetupAnswerView | null
    stale: boolean
}

export interface SetupScreen {
    id: string
    title: string
    sets: SetupSetsLine[]
    details: SetupFieldDetail[]
    questions: SetupQuestion[]
}

export interface SetupBlocker {
    screenId: string | null
    fieldId: string | null
    fieldLabel: string | null
    code: string
    questionId: string | null
}

export interface SetupEditorIssue {
    screenId: string | null
    fieldId: string | null
    fieldLabel: string | null
    code: string
}

export interface SetupReview {
    blockers: SetupBlocker[]
    editorIssues: SetupEditorIssue[]
    open: number
}

export interface SetupView {
    form: { id: string, title: string, revisionId: number, version: number, sourceFileName: string }
    eligible: boolean
    ineligibleReason: SetupIneligibleReason | null
    canPublish: boolean
    documents: { available: number, run: { createdAt: number, kept: number } | null }
    screens: SetupScreen[]
    review: SetupReview
}

/** An office form is visible from its municipality, while setup runs in its own workspace. */
export type SetupReadView = SetupView | {
    eligible: false
    ineligibleReason: null
    workspaceMismatch: { path: string | null }
    canPublish: boolean
};

export interface SetupAnswerInput {
    fieldId: string
    property: SetupProperty
    choice: SetupChoice
    value?: unknown
}

export interface SetupScreenSaveBody {
    expectedRevision: number
    answers: SetupAnswerInput[]
}

export interface SetupScreenSaveResponse {
    revisionId: number
    version: number
    saved: boolean
    screen: SetupScreen
    review: SetupReview
}

/** Upper bounds of section 5 of the contract (100 fields per section). */
export const SETUP_MAX_FIELDS_PER_SECTION = 100;
export const SETUP_MAX_ANSWERS = 301;
export const SETUP_MAX_DECISIONS = 401;
