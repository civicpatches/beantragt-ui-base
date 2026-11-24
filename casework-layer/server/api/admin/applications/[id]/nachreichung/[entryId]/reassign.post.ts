import { handleNachreichung } from '../../../../../../utils/admin-nachreichung';

/** "Neu zuordnen": removes the receipt and sends its envelope back to the Sichtung (internal, Nuxt proxy only). */
export default defineEventHandler(event => handleNachreichung(event, 'reassign'));
