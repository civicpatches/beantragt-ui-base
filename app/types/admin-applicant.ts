export interface AdminApplicantApplicationSummary {
    id: string
    referenceNumber: string | null
    created: string | null
    changed: string | null
}

export interface AdminApplicantProfileRow {
    id: string
    email: string
    fullName: string | null
    phone: string | null
    address: string | null
    street: string | null
    postalCode: string | null
    city: string | null
    protectedFields: Array<'iban' | 'accountHolder'>
    applicationCount: number
    firstSeen: string | null
    lastActivity: string | null
    latestApplication: AdminApplicantApplicationSummary | null
    applications: AdminApplicantApplicationSummary[]
    profileCompleteness: number
}

export interface AdminApplicantsResponse {
    data: AdminApplicantProfileRow[]
    meta: {
        count: number
        applicationCount: number
        skippedWithoutEmail: number
        truncated: boolean
    }
}
