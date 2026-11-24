import { handleNachreichung } from '../../../../../../utils/admin-nachreichung';

/** "Frist der Nachforderung verlängern" with a new date and a reason (internal, Nuxt proxy only). */
export default defineEventHandler(event => handleNachreichung(event, 'deadline'));
