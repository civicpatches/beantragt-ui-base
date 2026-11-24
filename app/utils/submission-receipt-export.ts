import printStyles from '../assets/css/print.css?raw';

export interface ReceiptRow {
    label: string
    value: string
}

export function printSubmissionReceipt(frame: HTMLIFrameElement, title: string, rows: ReceiptRow[], locale: string): void {
    // Print an about:blank document so browser headers cannot include the confirmation URL.
    const view = frame.contentWindow;
    const sheet = frame.contentDocument;
    if (!view || !sheet || typeof view.print !== 'function') throw new Error('Print document unavailable');

    sheet.documentElement.lang = locale;
    const styles = sheet.createElement('style');
    styles.textContent = printStyles;
    sheet.head.replaceChildren(styles);
    sheet.title = title;

    const heading = sheet.createElement('h1');
    heading.textContent = title;
    const details = sheet.createElement('dl');
    for (const { label, value } of rows) {
        const group = sheet.createElement('div');
        group.className = 'print-field';
        const term = sheet.createElement('dt');
        const definition = sheet.createElement('dd');
        term.textContent = label;
        definition.textContent = value;
        group.append(term, definition);
        details.append(group);
    }
    sheet.body.replaceChildren(heading, details);
    view.print();
}

export async function downloadSubmissionReceipt(title: string, rows: ReceiptRow[], filename: string): Promise<void> {
    const [{ default: pdfMake }, { default: fonts }] = await Promise.all([
        import('pdfmake/build/pdfmake'),
        import('pdfmake/build/vfs_fonts')
    ]);
    pdfMake.addVirtualFileSystem(fonts);

    await pdfMake.createPdf({
        pageSize: 'A4',
        info: { title },
        content: [
            { text: title, fontSize: 20, bold: true, marginBottom: 20 },
            ...rows.map(({ label, value }) => ({
                stack: [{ text: label, bold: true }, { text: value }],
                marginBottom: 10
            }))
        ]
    }).download(filename);
}
