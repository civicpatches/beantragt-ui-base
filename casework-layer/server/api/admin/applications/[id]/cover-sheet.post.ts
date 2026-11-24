import { handleNachreichung } from '../../../../utils/admin-nachreichung';

/** "Deckblatt drucken": a new cover sheet with a new identifier as PDF/A (internal, Nuxt proxy only). */
export default defineEventHandler(event => handleNachreichung(event, 'print'));
