type Translate = (key: string, params?: Record<string, unknown>) => string;

/** "Antragsteller" or "Haushaltsmitglied n" from the closed shape the proxy lets through. */
export function personLabelText(t: Translate, label: string | null): string {
    if (label === 'Antragsteller') return t('admin.nachreichung.person.applicant');
    const member = label ? /^Haushaltsmitglied (\d{1,3})$/u.exec(label) : null;
    return member ? t('admin.nachreichung.person.member', { number: member[1] }) : '';
}
