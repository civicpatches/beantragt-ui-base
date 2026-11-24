import { handleDocgenCase } from '../../../../../utils/admin-docgen';

/** Decision documents of one application. */
export default defineEventHandler(event => handleDocgenCase(event, ''));
