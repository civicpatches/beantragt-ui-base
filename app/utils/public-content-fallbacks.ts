import type { PublicContentPageKey } from '~/utils/locale-routing';

interface PublicContentFallback {
    titleDe: string
    titleEn: string
    htmlDe: string
    htmlEn: string
}

/**
 * Texts of the legal and help pages for as long as the responsible office
 * has not entered its own (platform pages, and municipality pages without
 * stored content).
 *
 * They hold no operator data and invent nothing: every statement a page
 * must carry is named as missing, with where it will appear. The only
 * concrete sentences describe what this portal itself does ("Meine Daten",
 * deleting the account).
 */
export const PUBLIC_CONTENT_FALLBACKS: Record<PublicContentPageKey, PublicContentFallback> = {
    privacy: {
        titleDe: 'Datenschutzerklärung',
        titleEn: 'Privacy policy',
        htmlDe: `
<p><strong>Diese Datenschutzerklärung ist noch nicht vollständig.</strong> Die verantwortliche Stelle hat ihre Angaben noch nicht hinterlegt. Bis dahin fehlen hier Pflichtangaben.</p>
<h2>Wer verantwortlich ist</h2>
<p>Hier stehen Name und Anschrift der verantwortlichen Stelle, sobald die verantwortliche Stelle die Angaben hinterlegt hat.</p>
<h2>Datenschutzbeauftragte</h2>
<p>Hier steht, wie Sie die Datenschutzbeauftragte oder den Datenschutzbeauftragten erreichen, sobald die verantwortliche Stelle die Angaben hinterlegt hat.</p>
<h2>Welche Daten verarbeitet werden und wozu</h2>
<p>Hier steht, welche Daten verarbeitet werden, zu welchem Zweck, auf welcher Rechtsgrundlage und wie lange sie gespeichert werden, sobald die verantwortliche Stelle die Angaben hinterlegt hat.</p>
<h2>Ihre Rechte</h2>
<p>Sie haben das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung und Beschwerde bei einer Aufsichtsbehörde. Welche Aufsichtsbehörde zuständig ist, steht hier, sobald die verantwortliche Stelle die Angaben hinterlegt hat.</p>
<h2>Ihre Daten in diesem Portal</h2>
<p>Eine Übersicht Ihrer gespeicherten Daten, Ihre Einwilligungen und die Löschung finden Sie nach der Anmeldung unter <a href="/meine-daten">„Meine Daten“</a>.</p>
<p>Unter „Meine Daten“ können Sie mit „Alle meine Daten löschen“ jederzeit Ihr Konto löschen. Gelöscht werden die Anmeldeadresse, Ihre Profile mit Einwilligungen und Bankverbindung, Verknüpfungen mit Anmeldediensten wie der BundID, Anträge, deren E-Mail-Bestätigung noch offen ist, und hochgeladene Anlagen, die nie mit einem Antrag eingereicht wurden. Eingereichte Anträge, Bescheide, Nachrichten und Anlagen gehören zur Akte der zuständigen Dienststelle. Sie bleiben dort unverändert, bis die Aufbewahrungsfrist der Dienststelle abgelaufen ist. Vor dem Löschen sehen Sie je Antrag Aktenzeichen, Dienststelle und das voraussichtliche Löschdatum. Eine weitergehende Löschung nach Art. 17 DSGVO können Sie bei der zuständigen Dienststelle beantragen.</p>`,
        htmlEn: `
<p><strong>This privacy policy is not complete yet.</strong> The responsible office has not entered its details yet. Until then, required information is missing here.</p>
<h2>Who is responsible</h2>
<p>The name and address of the responsible office will appear here once the responsible office has entered them.</p>
<h2>Data protection officer</h2>
<p>How to reach the data protection officer will appear here once the responsible office has entered it.</p>
<h2>Which data is processed and why</h2>
<p>Which data is processed, for what purpose, on which legal basis and for how long it is kept will appear here once the responsible office has entered it.</p>
<h2>Your rights</h2>
<p>You have the right to access, rectification, erasure, restriction of processing and to lodge a complaint with a supervisory authority. Which supervisory authority is responsible will appear here once the responsible office has entered it.</p>
<h2>Your data in this portal</h2>
<p>After signing in, an overview of your stored data, your consents and the deletion are available under <a href="/meine-daten">“My Data”</a>.</p>
<p>Under “My Data” you can delete your account at any time with “Delete all my data”. This deletes the sign-in address, your profiles with consents and bank details, links to sign-in services such as BundID, applications whose email confirmation is still open and uploaded attachments that were never submitted with an application. Submitted applications, decisions, messages and attachments belong to the record of the responsible office. They stay there unchanged until the retention period of the office ends. Before the deletion you see the reference number, office and expected deletion date of each application. You can request a further erasure under Art. 17 GDPR from the responsible office.</p>`
    },
    legal_notice: {
        titleDe: 'Impressum',
        titleEn: 'Legal notice',
        htmlDe: `
<p><strong>Dieses Impressum ist noch nicht vollständig.</strong> Die verantwortliche Stelle hat ihre Angaben noch nicht hinterlegt. Bis dahin fehlen hier Pflichtangaben.</p>
<h2>Wer dieses Portal anbietet</h2>
<p>Hier stehen Name und Anschrift der Stelle, die dieses Portal anbietet, sobald die verantwortliche Stelle die Angaben hinterlegt hat.</p>
<h2>Vertretung</h2>
<p>Hier steht, wer die Stelle vertritt, sobald die verantwortliche Stelle die Angaben hinterlegt hat.</p>
<h2>Kontakt</h2>
<p>Hier stehen Telefonnummer und E-Mail-Adresse, sobald die verantwortliche Stelle die Angaben hinterlegt hat.</p>`,
        htmlEn: `
<p><strong>This legal notice is not complete yet.</strong> The responsible office has not entered its details yet. Until then, required information is missing here.</p>
<h2>Who offers this portal</h2>
<p>The name and address of the office that offers this portal will appear here once the responsible office has entered them.</p>
<h2>Representation</h2>
<p>Who represents the office will appear here once the responsible office has entered it.</p>
<h2>Contact</h2>
<p>A phone number and an email address will appear here once the responsible office has entered them.</p>`
    },
    accessibility: {
        titleDe: 'Barrierefreiheitserklärung',
        titleEn: 'Accessibility statement',
        htmlDe: `
<p><strong>Diese Erklärung ist noch nicht vollständig.</strong> Die verantwortliche Stelle hat ihre Angaben noch nicht hinterlegt. Bis dahin fehlen hier Pflichtangaben.</p>
<h2>Wie barrierefrei dieses Portal ist</h2>
<p>Hier steht, wie weit dieses Portal barrierefrei ist und wann das geprüft wurde, sobald die verantwortliche Stelle die Angaben hinterlegt hat.</p>
<h2>Was noch nicht barrierefrei ist</h2>
<p>Hier stehen die bekannten Barrieren und wann sie behoben werden, sobald die verantwortliche Stelle die Angaben hinterlegt hat.</p>
<h2>Barriere melden</h2>
<p>Hier steht, wie Sie eine Barriere melden können, sobald die verantwortliche Stelle die Angaben hinterlegt hat.</p>
<h2>Schlichtungsverfahren</h2>
<p>Hier steht, an welche Schlichtungsstelle Sie sich wenden können, wenn Ihre Meldung nicht zufriedenstellend beantwortet wird, sobald die verantwortliche Stelle die Angaben hinterlegt hat.</p>`,
        htmlEn: `
<p><strong>This statement is not complete yet.</strong> The responsible office has not entered its details yet. Until then, required information is missing here.</p>
<h2>How accessible this portal is</h2>
<p>How accessible this portal is and when it was checked will appear here once the responsible office has entered it.</p>
<h2>What is not accessible yet</h2>
<p>The known barriers and when they will be fixed will appear here once the responsible office has entered them.</p>
<h2>Report a barrier</h2>
<p>How to report a barrier will appear here once the responsible office has entered it.</p>
<h2>Conciliation procedure</h2>
<p>Which conciliation body you can turn to if your report is not answered satisfactorily will appear here once the responsible office has entered it.</p>`
    },
    easy_language: {
        titleDe: 'Informationen in Leichter Sprache',
        titleEn: 'Information in easy language',
        htmlDe: `
<h2>Was ist diese Seite?</h2>
<p>Hier können Sie Anträge online stellen.</p>
<h2>So stellen Sie einen Antrag</h2>
<p>Wählen Sie ein Formular aus. Füllen Sie die Felder aus. Laden Sie Unterlagen hoch, wenn das Formular sie braucht. Danach senden Sie den Antrag ab.</p>
<h2>Nach dem Absenden</h2>
<p>Sie bekommen ein Aktenzeichen. Damit können Sie den Status später wiederfinden. Den Link „Status prüfen“ finden Sie unten auf jeder Seite.</p>
<h2>Hilfe</h2>
<p>Hier steht, wen Sie um Hilfe fragen können, sobald die verantwortliche Stelle die Angaben hinterlegt hat.</p>`,
        htmlEn: `
<h2>What is this page?</h2>
<p>Here you can send applications online.</p>
<h2>How to send an application</h2>
<p>Choose a form. Fill in the fields. Upload documents when the form asks for them. Then send the application.</p>
<h2>After sending</h2>
<p>You get a reference number. You can use it later to find the status. The link “Check status” is at the bottom of every page.</p>
<h2>Help</h2>
<p>Who you can ask for help will appear here once the responsible office has entered it.</p>`
    },
    sign_language: {
        titleDe: 'Informationen in Gebärdensprache',
        titleEn: 'Information in sign language',
        htmlDe: `
<p><strong>Auf dieser Seite gibt es noch kein Video.</strong></p>
<p>Hier steht ein Video in Deutscher Gebärdensprache, sobald die verantwortliche Stelle es hinterlegt hat.</p>`,
        htmlEn: `
<p><strong>There is no video on this page yet.</strong></p>
<p>A video in German Sign Language will appear here once the responsible office has added it.</p>`
    }
};
