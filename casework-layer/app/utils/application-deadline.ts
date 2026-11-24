const COMPLETED_SEMANTIC_FLAGS = new Set(['approved', 'rejected', 'closed', 'withdrawn']);
const deadlineCalendar = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
});

interface DeadlineApplication {
    dueDate?: string | null
    statusFlags?: readonly string[]
}

export function deadlineDateKey(date: Date): string {
    const parts = new Map(deadlineCalendar.formatToParts(date).map(part => [part.type, part.value]));
    return `${parts.get('year')}-${parts.get('month')}-${parts.get('day')}`;
}

export function isCompletedApplication(application: DeadlineApplication): boolean {
    return application.statusFlags?.some(flag => COMPLETED_SEMANTIC_FLAGS.has(flag)) ?? false;
}

export function isDeadlineOverdue(application: DeadlineApplication | null, today: string): boolean {
    return Boolean(application?.dueDate && application.dueDate < today && !isCompletedApplication(application));
}
