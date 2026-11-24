export interface SubmissionReceipt {
    referenceNumber: string
    formTitle: string
    submittedAt: string
    jurisdictionName: string | null
    organisationName: string | null
}

export function readSubmissionReceipt(value: unknown, expectedReference: string): SubmissionReceipt | null {
    if (!value || typeof value !== 'object') return null;

    const raw = value as Partial<Record<keyof SubmissionReceipt, unknown>>;
    const referenceNumber = receiptText(raw.referenceNumber);
    const formTitle = receiptText(raw.formTitle);
    const submittedAt = receiptText(raw.submittedAt);
    const jurisdictionName = receiptText(raw.jurisdictionName);
    const organisationName = receiptText(raw.organisationName);

    if (!referenceNumber || referenceNumber !== expectedReference || !formTitle || !submittedAt) return null;
    if (!Number.isFinite(Date.parse(submittedAt)) || (!jurisdictionName && !organisationName)) return null;

    return { referenceNumber, formTitle, submittedAt, jurisdictionName, organisationName };
}

function receiptText(value: unknown): string | null {
    return typeof value === 'string' ? value.trim() || null : null;
}
