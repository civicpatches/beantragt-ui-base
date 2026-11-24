const LEGACY_STATUS_LABELS: Record<string, string> = {
    new: 'Neu',
    in_review: 'In Pruefung',
    approved: 'Genehmigt',
    rejected: 'Abgelehnt'
};

export function workflowStatusExportLabel(machineName: string | null | undefined, label?: string | null): string {
    const trimmedLabel = typeof label === 'string' ? label.trim() : '';
    if (trimmedLabel !== '') return trimmedLabel;

    const machine = typeof machineName === 'string' ? machineName : '';
    return LEGACY_STATUS_LABELS[machine] ?? machine;
}
