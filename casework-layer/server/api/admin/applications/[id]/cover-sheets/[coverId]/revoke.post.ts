import { handleNachreichung } from '../../../../../../utils/admin-nachreichung';

/** "Deckblatt sperren" with a reason (internal, Nuxt proxy only). */
export default defineEventHandler(event => handleNachreichung(event, 'revoke'));
