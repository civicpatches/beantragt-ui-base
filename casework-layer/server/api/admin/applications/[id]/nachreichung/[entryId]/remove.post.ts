import { handleNachreichung } from '../../../../../../utils/admin-nachreichung';

/** "Vom Antrag entfernen": deletes the attachments of one receipt, the status stays (internal, Nuxt proxy only). */
export default defineEventHandler(event => handleNachreichung(event, 'remove'));
