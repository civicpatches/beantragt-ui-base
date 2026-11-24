import { handleNachreichung } from '../../../../utils/admin-nachreichung';

/** Nachreichung card of one application: requests and cover sheets (internal, Nuxt proxy only). */
export default defineEventHandler(event => handleNachreichung(event, 'card'));
