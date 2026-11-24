/**
 * Who filed an application, for the header of the application page.
 *
 * The name comes only from the contact data of the application (`crmData`,
 * keyed by the platform's contact keys), never from a form field picked by
 * its label: the product stays form-schema agnostic. Protected or redacted
 * values arrive as objects and are skipped, so the header then shows the date
 * alone.
 */
function plainText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

export function applicantNameFromContactData(crmData: Record<string, unknown> | null | undefined): string {
    if (!crmData) return '';
    const fullName = plainText(crmData['person.full_name']);
    if (fullName) return fullName;
    return [plainText(crmData['person.first_name']), plainText(crmData['person.last_name'])].filter(Boolean).join(' ');
}
