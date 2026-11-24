import { apiNotFound } from '../utils/api-not-found';

/** Keep unknown API routes out of Nuxt's SPA HTML fallback. */
export default defineEventHandler(apiNotFound);
