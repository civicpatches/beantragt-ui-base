import { handleDocgenAdmin } from '../../../utils/admin-docgen';

/** Decision templates, scope and form settings, variables, sample, health. */
export default defineEventHandler(event => handleDocgenAdmin(event));
